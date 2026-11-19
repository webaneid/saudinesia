import { NextResponse } from 'next/server'
import { clientIp, consume, policy } from '@/lib/auth/rateLimit'
import { ok, err } from '@/lib/validators'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { ipaymuFromEnv, parseCallback, verifyCallbackSignature } from '@/lib/payments/ipaymu'
import { syncAndNotify } from '@/lib/payments/gateway'
import { logError, logWarn } from '@/lib/log'

// Callback iPaymu (Fase 9, docs/arsitektur-booking-engine-v2.md §10.12 langkah 5). Endpoint publik: isi callback HANYA pemicu — status/nominal/biaya
// dibaca ulang dari iPaymu (`/transaction`) oleh `syncGatewayPayment`, jadi callback palsu tak bisa mengonfirmasi apa pun. X-Signature diperiksa sebagai
// saringan + log. Callback yang diabaikan tetap dijawab 200 ringkas (iPaymu mencoba ulang pada non-2xx).
const MAX_BODY = 16 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function readLimited(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY) { await reader.cancel(); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function POST(request: Request) {
  try {
    const hit = await consume(policy('gatewayWebhookIp', clientIp(request) ?? 'unknown'))
    if (!hit.allowed) return NextResponse.json(err('Terlalu banyak permintaan'), { status: 429, headers: { 'Retry-After': String(hit.retryAfterSec) } })
    const raw = await readLimited(request)
    if (raw === null) return NextResponse.json(err('Terlalu besar'), { status: 413 })
    const payload = parseCallback(raw, request.headers.get('content-type') ?? '')
    if (!payload) return NextResponse.json(err('Format tidak dikenal'), { status: 400 })

    const ref = String(payload.reference_id ?? payload.referenceId ?? '')
    if (!UUID.test(ref)) return NextResponse.json(ok({ received: true })) // bukan pembayaran kita
    const trx = payload.trx_id == null ? null : String(payload.trx_id)

    const s = await getInvoiceSettings()
    const cfg = ipaymuFromEnv(s.gatewaySandbox)
    if (cfg && !verifyCallbackSignature(cfg.va, payload, request.headers.get('x-signature'))) {
      logWarn('webhooks/ipaymu X-Signature tak cocok — tetap dipastikan lewat /transaction', ref) // reference_id = id pembayaran (bukan data pribadi)
    }
    await syncAndNotify(ref, { trxIdHint: trx })
    return NextResponse.json(ok({ received: true }))
  } catch (e) {
    logError('webhooks/ipaymu', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
