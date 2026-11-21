import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { whatsappActionSchema } from '@/lib/validators/whatsapp'
import { whatsapp } from '@/lib/whatsapp/client'
import { businessWaDigits } from '@/lib/constants/payment'
import { panelStatus, recordWhatsappAction, sendTestToStaff } from '@/lib/whatsapp/admin'
import { logError } from '@/lib/log'

// Sistem → WhatsApp (docs/rencana-gowa-self-host.md §4.1) — superadmin saja (K5). GOWA tak pernah publik: QR diambil server dan dikirim sebagai
// data URI. Semua respons `no-store` (QR dan kode pasangan = kredensial masuk sementara).
const NO_STORE = { 'Cache-Control': 'no-store' }

const REASON_TEXT: Record<string, string> = {
  unconfigured: 'Gateway WhatsApp belum dikonfigurasi (WA_GATEWAY_URL).',
  unreachable: 'Gateway WhatsApp tidak dapat dijangkau.',
  unauthorized: 'Gateway menolak kredensial (WA_GATEWAY_USER/WA_GATEWAY_PASSWORD).',
  alreadyConnected: 'WhatsApp sudah terhubung.',
  failed: 'Gateway WhatsApp tidak memberi jawaban yang sah. Coba lagi.',
}
const fail = (reason: string, status = 502) => NextResponse.json(err(REASON_TEXT[reason] ?? REASON_TEXT.failed!), { status: reason === 'alreadyConnected' ? 409 : status, headers: NO_STORE })

export async function GET() {
  try {
    await requireSuperAdmin()
  } catch (e) {
    return authFailureResponse(e, 'admin/system/whatsapp/GET')
  }
  try {
    return NextResponse.json(ok(await panelStatus()), { headers: NO_STORE })
  } catch (e) {
    logError('admin/system/whatsapp/GET', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  let staffId: string
  try {
    staffId = (await requireSuperAdmin()).userId
  } catch (e) {
    return authFailureResponse(e, 'admin/system/whatsapp/POST')
  }
  try {
    const parsed = whatsappActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { action } = parsed.data

    const rl = await consume(policy(action === 'test' ? 'whatsappTestUser' : 'whatsappAdminUser', staffId))
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec)

    // Jejak ditulis sesudah tindakan gateway; kegagalan menulis jejak tidak boleh menyembunyikan hasil tindakan yang sudah terjadi.
    const audit = (a: Parameters<typeof recordWhatsappAction>[1], outcome: string) =>
      recordWhatsappAction(staffId, a, outcome).catch(e => logError('admin/system/whatsapp/audit', e))

    switch (action) {
      case 'qr': {
        const r = await whatsapp.loginQr()
        await audit('wa_qr', r.ok ? 'ok' : r.reason)
        return r.ok ? NextResponse.json(ok({ qr: r.dataUri, durationSec: r.durationSec }), { headers: NO_STORE }) : fail(r.reason)
      }
      case 'pairCode': {
        const business = businessWaDigits()
        if (!business) return NextResponse.json(err('Nomor bisnis (NEXT_PUBLIC_BUSINESS_WA) belum diisi.'), { status: 422, headers: NO_STORE })
        const r = await whatsapp.loginWithCode(business)
        await audit('wa_pair_code', r.ok ? 'ok' : r.reason)
        return r.ok ? NextResponse.json(ok({ code: r.code }), { headers: NO_STORE }) : fail(r.reason)
      }
      case 'disconnect':
      case 'reconnect': {
        const r = action === 'disconnect' ? await whatsapp.logout() : await whatsapp.reconnect()
        await audit(action === 'disconnect' ? 'wa_disconnect' : 'wa_reconnect', r.ok ? 'ok' : r.reason)
        return r.ok ? NextResponse.json(ok(await panelStatus()), { headers: NO_STORE }) : fail(r.reason)
      }
      case 'test': {
        const r = await sendTestToStaff(staffId)
        await audit('wa_test', r.status)
        if (r.status === 'unverified') return NextResponse.json(err('Nomor WhatsApp akun Anda belum terverifikasi — pesan uji hanya dikirim ke nomor terverifikasi milik Anda.'), { status: 422 })
        return NextResponse.json(ok(r))
      }
    }
  } catch (e) {
    logError('admin/system/whatsapp/POST', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
