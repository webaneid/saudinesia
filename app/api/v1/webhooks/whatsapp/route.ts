import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/auth/rateLimit'
import { whatsapp } from '@/lib/whatsapp/client'
import { WEBHOOK_MAX_BODY_BYTES, processWebhook, webhookSecret } from '@/lib/whatsapp/webhook'
import { ok, err } from '@/lib/validators'

// Webhook GOWA untuk pesan MASUK (ADR-0002, docs/arsitektur-whatsapp-verifikasi.md §3). Endpoint publik: SATU-SATUNYA penjaganya adalah tanda tangan
// HMAC (lib/whatsapp/webhook.ts — semua logikanya diuji otomatis). GOWA mencoba ulang sampai 5 kali pada non-2xx dan menunggu ≤10 dtk → semua
// pesan sah yang diabaikan dibalas 2xx.

/** Baca body dengan batas ukuran SEBELUM terbaca penuh (bukan membaca semuanya lalu mengukur). */
async function readLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel(); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function POST(request: Request) {
  try {
    // Tanpa secret yang kuat: mati sebelum membaca body apa pun.
    if (!webhookSecret()) return NextResponse.json(err('Webhook belum dikonfigurasi'), { status: 503 })

    const rawBody = await readLimited(request, WEBHOOK_MAX_BODY_BYTES)
    if (rawBody === null) return NextResponse.json(err('Terlalu besar'), { status: 413 })

    const out = await processWebhook({ rawBody, signature: request.headers.get('x-hub-signature-256'), ip: clientIp(request) })
    if (out.reply) void whatsapp.sendMessage(out.reply)
    if (out.status !== 200) {
      return NextResponse.json(err(out.error ?? 'Ditolak'), {
        status: out.status,
        ...(out.retryAfterSec ? { headers: { 'Retry-After': String(Math.ceil(out.retryAfterSec)) } } : {}),
      })
    }
    return NextResponse.json(ok({ handled: out.handled === true }))
  } catch (error) {
    console.error('[webhooks/whatsapp]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
