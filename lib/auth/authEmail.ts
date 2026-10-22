import { randomUUID } from 'node:crypto'
import { sendEmail, type EmailResult } from '@/lib/email/resend'
import { appUrl } from '@/lib/email/templates'
import { authEmailContent, type AuthEmailContext, type AuthEmailKind } from '@/lib/email/authTemplates'

// Pengiriman email auth: langsung lewat sendEmail (bukan notify()) — tautan berisi token tidak boleh masuk NotificationLog,
// dan kita perlu hasilnya. Hasil DICATAT tanpa token/alamat; route tetap membalas seragam (anti-enumerasi).

export async function sendAuthEmail(kind: AuthEmailKind, to: string, ctx: AuthEmailContext): Promise<EmailResult> {
  if (!appUrl()) {
    // Tanpa origin publik tautan tidak bisa dibuat — mengirim email tanpa tombol sama saja membuang kuota dan membingungkan.
    console.error(`[auth-email] ${kind} tidak dikirim: APP_URL belum diisi`)
    return { status: 'skipped', reason: 'APP_URL belum diisi' }
  }

  const content = authEmailContent(kind, ctx)
  const result = await sendEmail({ to, subject: content.subject, html: content.html, text: content.text, idempotencyKey: randomUUID() })

  if (result.status !== 'sent') console.error(`[auth-email] ${kind} ${result.status}: ${result.status === 'skipped' ? result.reason : result.error}`)

  // Dev persis 'development' dan email TIDAK terkirim (Resend belum dikonfigurasi ATAU kunci placeholder/ditolak): tautan ke LOG SERVER (tidak pernah ke
  // respons HTTP). Dulu hanya untuk 'skipped' — kunci dev placeholder membuat Resend menolak ('failed') sehingga daftar/lupa password buntu di dev.
  if (result.status !== 'sent' && process.env.NODE_ENV === 'development' && ctx.token) {
    const link = content.text.split('\n').find((l) => l.includes('?token='))
    if (link) console.log(`\n[DEV] ${kind} → ${link.slice(link.indexOf('http'))}\n`)
  }
  return result
}
