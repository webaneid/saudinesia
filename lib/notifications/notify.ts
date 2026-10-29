import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { whatsapp } from '@/lib/whatsapp/client'
import { sendEmail } from '@/lib/email/resend'
import { emailContent } from '@/lib/email/templates'
import { waMessage, type NotificationEvent } from '@/lib/notifications/events'

// SATU pintu notifikasi (docs/arsitektur-notifikasi.md §3). Dipanggil dari route/cron; TIDAK PERNAH melempar —
// notifikasi tidak boleh menggagalkan operasi bisnis (aturan CLAUDE.md § WhatsApp, kini berlaku untuk email juga).
// Setiap kanal menulis SATU baris NotificationLog dengan status JUJUR: sent | failed | skipped.

export type NotifyInput = {
  userId: string
  bookingId?: string | null
  event: NotificationEvent
  /**
   * true = lewati kanal yang SUDAH berstatus 'sent' untuk (user, booking, jenis kejadian). Untuk kejadian yang tidak boleh
   * terkirim dua kali (pengingat cron, auto-cancel, booking_submitted). 'failed'/'skipped' tidak dihitung → dicoba lagi.
   */
  dedupe?: boolean
}

export type ChannelOutcome = {
  channel: 'whatsapp' | 'email'
  status: 'sent' | 'failed' | 'skipped' | 'duplicate'
}

type SendOutcome =
  | { status: 'sent'; id?: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

const MAX_ERROR_LENGTH = 300
/** Tiap booking memicu 3 WhatsApp (konfirmasi + 2 pengingat) + hasil pembayaran: 10 cukup untuk pemakaian wajar. */
const WA_MAX_PER_NUMBER_PER_DAY = 10

export async function notify(input: NotifyInput): Promise<ChannelOutcome[]> {
  try {
    return await run(input)
  } catch (e) {
    console.error('[notify] kegagalan tak terduga:', safeErr(e))
    return []
  }
}

async function run({ userId, bookingId = null, event, dedupe = false }: NotifyInput): Promise<ChannelOutcome[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true, fullName: true } })
  if (!user) return []

  const deliver = (channel: 'whatsapp' | 'email', recipient: string, preview: string, send: () => Promise<SendOutcome>) =>
    deliverOne({ userId, bookingId, type: event.type, dedupe }, channel, recipient, preview, send)

  // KEDUA KANAL BERJALAN PARALEL dan tidak saling menunggu: email adalah jaring pengaman. Gateway WhatsApp yang mati/lambat/diblokir
  // (timeout 10 dtk × 3 percobaan + jeda ≈ 34 dtk) tidak boleh menunda atau menggagalkan email. Tiap kanal menulis log sendiri dan tidak melempar.
  const tasks: Promise<ChannelOutcome>[] = []

  // WhatsApp — hanya bila kejadian punya pesan WA dan akun punya nomor WhatsApp (bukan nomor telepon biasa).
  const wa = waMessage(event)
  if (wa && user.whatsapp) {
    const phone = user.whatsapp
    tasks.push(deliver('whatsapp', phone, wa.slice(0, 200), async () => {
      // WhatsApp HANYA ke nomor yang sudah dibuktikan milik pemilik akun (ADR-0002) — menutup risiko pesan ke nomor orang lain (SEC-32).
      // Nomor belum terverifikasi: email saja (email tak terpengaruh).
      if (!user.whatsappVerifiedAt || user.verifiedWhatsapp !== phone) return { status: 'skipped' as const, reason: 'Nomor WhatsApp belum terverifikasi' }
      // Penjaga defensif: WhatsApp hanya untuk akun yang tercatat menyetujuinya (UU PDP) — jangan bergantung pada "kebetulan hanya dua jalur
      // yang mengisi nomor". Dan batas harian per NOMOR TUJUAN: nomor tak terverifikasi bisa milik orang lain; pesan beruntun ke orang yang
      // tak mengenal Saudinesia membahayakan nomor gateway (alasan lingkup WhatsApp diperkecil). Email tetap terkirim.
      const consented = await prisma.consentLog.findFirst({ where: { userId, type: 'whatsapp_notifications' }, select: { id: true } })
      if (!consented) return { status: 'skipped' as const, reason: 'Belum ada persetujuan notifikasi WhatsApp' }
      const sentToday = await prisma.notificationLog.count({
        where: { channel: 'whatsapp', recipient: phone, status: { in: ['sent', 'failed'] }, sentAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      })
      if (sentToday >= WA_MAX_PER_NUMBER_PER_DAY) return { status: 'skipped' as const, reason: 'Batas pesan WhatsApp per nomor per hari tercapai' }
      return whatsapp.sendMessage({ phone, message: wa })
    }))
  }

  // Email — hanya bila akun punya alamat yang bisa dituju dan terverifikasi. Email placeholder (`*.invalid`) tidak pernah dikirimi.
  if (isDeliverableEmail(user.email)) {
    const email = user.email
    tasks.push((async () => {
      const setting = await prisma.siteSetting.findFirst({ select: { emailNotificationsEnabled: true } })
      const content = emailContent(event, { name: user.fullName.trim(), bookingId })
      // Alamat yang pemiliknya belum membuktikan (akun buatan staf yang belum diaktifkan) bisa salah ketik atau milik orang lain: rincian pesanan tak boleh dikirim ke sana (SEC-106).
      // Pesan auth (tautan aktivasi) tidak lewat notify() — ia memang dikirim ke alamat yang belum terbukti.
      if (!user.emailVerifiedAt) {
        return deliver('email', email, content.subject, async () => ({ status: 'skipped' as const, reason: 'Alamat email belum diverifikasi pemiliknya' }))
      }
      if (setting && !setting.emailNotificationsEnabled) {
        return deliver('email', email, content.subject, async () => ({ status: 'skipped' as const, reason: 'Notifikasi email dinonaktifkan di pengaturan admin' }))
      }
      return deliver('email', email, content.subject, () =>
        // Kunci idempotensi per pemanggilan: retry di dalam sendEmail tidak bisa mengirim ganda; pengiriman terpisah yang
        // memang diinginkan (mis. bukti ditolak dua kali) tidak ikut tertelan.
        sendEmail({ to: email, subject: content.subject, html: content.html, text: content.text, idempotencyKey: randomUUID() }),
      )
    })())
  }

  // allSettled: galat tak terduga di satu kanal (mis. query DB) tidak boleh membuang hasil kanal lain.
  const settled = await Promise.allSettled(tasks)
  const out: ChannelOutcome[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') out.push(r.value)
    else console.error('[notify] satu kanal gagal tak terduga:', safeErr(r.reason))
  }

  // Peringatan keras bila TIDAK ADA kanal yang sampai (mis. WhatsApp mati DAN email dimatikan/belum dikonfigurasi): pengguna tidak
  // mendapat pemberitahuan apa pun. Tanpa PII — hanya jenis kejadian.
  if (out.length > 0 && !out.some((o) => o.status === 'sent' || o.status === 'duplicate')) {
    console.error(`[notify] TIDAK ADA kanal yang terkirim untuk kejadian ${event.type}: ${out.map((o) => `${o.channel}=${o.status}`).join(' ')}`)
  } else if (out.length === 0) {
    console.error(`[notify] TIDAK ADA kanal yang bisa dituju untuk kejadian ${event.type} (tanpa email yang valid dan tanpa WhatsApp)`)
  }
  return out
}

async function deliverOne(
  ctx: { userId: string; bookingId: string | null; type: string; dedupe: boolean },
  channel: 'whatsapp' | 'email',
  recipient: string,
  preview: string,
  send: () => Promise<SendOutcome>,
): Promise<ChannelOutcome> {
  if (ctx.dedupe) {
    const done = await prisma.notificationLog.findFirst({
      where: { userId: ctx.userId, bookingId: ctx.bookingId, type: ctx.type, channel, status: 'sent' },
      select: { id: true },
    })
    if (done) return { channel, status: 'duplicate' }
  }

  // send() mengembalikan hasil (tidak melempar); try/catch hanya pengaman untuk kegagalan tak terduga.
  let result: SendOutcome
  try {
    result = await send()
  } catch (e) {
    result = { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }

  const detail = result.status === 'skipped' ? result.reason : result.status === 'failed' ? result.error : null
  try {
    await prisma.notificationLog.create({
      data: {
        userId: ctx.userId,
        bookingId: ctx.bookingId,
        channel,
        type: ctx.type,
        recipient,
        messagePreview: preview,
        status: result.status,
        error: detail ? detail.slice(0, MAX_ERROR_LENGTH) : null,
        externalId: result.status === 'sent' ? result.id ?? null : null,
      },
    })
  } catch (e) {
    console.error('[notify] gagal menulis log:', safeErr(e))
  }
  return { channel, status: result.status }
}

// Pesan galat Prisma memuat argumen query (alamat email, nomor) — PII tidak boleh masuk log aplikasi; cukup jenis & kode galat.
function safeErr(e: unknown): string {
  if (!(e instanceof Error)) return 'galat tak dikenal'
  const code = (e as { code?: unknown }).code
  return typeof code === 'string' ? `${e.name} (${code})` : e.name
}

const EMAIL_SHAPE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

function isDeliverableEmail(email: string | null | undefined): email is string {
  return Boolean(email && EMAIL_SHAPE.test(email) && !email.toLowerCase().endsWith('.invalid'))
}
