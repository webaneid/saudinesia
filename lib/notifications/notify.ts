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

export async function notify(input: NotifyInput): Promise<ChannelOutcome[]> {
  try {
    return await run(input)
  } catch (e) {
    console.error('[notify] kegagalan tak terduga:', safeErr(e))
    return []
  }
}

async function run({ userId, bookingId = null, event, dedupe = false }: NotifyInput): Promise<ChannelOutcome[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true, fullName: true } })
  if (!user) return []

  const out: ChannelOutcome[] = []
  const deliver = (channel: 'whatsapp' | 'email', recipient: string, preview: string, send: () => Promise<SendOutcome>) =>
    deliverOne({ userId, bookingId, type: event.type, dedupe }, channel, recipient, preview, send)

  // WhatsApp — hanya bila kejadian punya pesan WA dan akun punya nomor.
  const wa = waMessage(event)
  if (wa && user.phone) {
    const phone = user.phone
    out.push(await deliver('whatsapp', phone, wa.slice(0, 200), () => whatsapp.sendMessage({ phone, message: wa })))
  }

  // Email — hanya bila akun punya alamat yang bisa dituju. Email placeholder (`*.invalid`) tidak pernah dikirimi.
  if (isDeliverableEmail(user.email)) {
    const email = user.email
    const setting = await prisma.siteSetting.findFirst({ select: { emailNotificationsEnabled: true } })
    const content = emailContent(event, { name: user.fullName.trim(), bookingId })
    if (setting && !setting.emailNotificationsEnabled) {
      out.push(await deliver('email', email, content.subject, async () => ({ status: 'skipped', reason: 'Notifikasi email dinonaktifkan di pengaturan admin' })))
    } else {
      out.push(
        await deliver('email', email, content.subject, () =>
          // Kunci idempotensi per pemanggilan: retry di dalam sendEmail tidak bisa mengirim ganda; pengiriman terpisah yang
          // memang diinginkan (mis. bukti ditolak dua kali) tidak ikut tertelan.
          sendEmail({ to: email, subject: content.subject, html: content.html, text: content.text, idempotencyKey: randomUUID() }),
        ),
      )
    }
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
