// Uji lib/notifications/notify.ts terhadap DATABASE SUNGGUHAN + gateway WhatsApp & Resend PALSU (docs/arsitektur-notifikasi.md §3–4).
// Fokus: log notifikasi harus JUJUR (sent | failed | skipped) — dulu selalu "sent", termasuk saat gateway belum dikonfigurasi.
//
// PENGAMAN: menulis user/booking/log sementara, jadi menolak berjalan kecuali nama database memuat "test", "_ci" atau "tmp".
// Dulu uji skrip pernah terhubung ke DB dev karena Bun memuat .env.local otomatis — jangan terulang.
import assert from 'node:assert/strict'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notifications/notify'
import type { NotificationEvent } from '@/lib/notifications/events'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'

const url = process.env.DATABASE_URL ?? ''
const dbName = url.split('/').pop()?.split('?')[0] ?? ''
if (!/(test|_ci|tmp)/i.test(dbName)) {
  console.error(`DITOLAK: database "${dbName}" bukan database uji (harus memuat test / _ci / tmp). Set DATABASE_URL ke database sekali pakai.`)
  process.exit(2)
}

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`)
  }
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'

// ───────────── server palsu ─────────────
type Req = FakeRequest
let waSeen: Req[] = []
let mailSeen: Req[] = []
let waStatus = 200
let mailScript: number[] = []
const wa = await startFakeServer((req) => { waSeen.push(req); return { status: waStatus } })
const mail = await startFakeServer((req) => {
  mailSeen.push(req)
  const status = mailScript.shift() ?? 200
  return { status, body: status === 200 ? { id: `msg_${mailSeen.length}` } : { message: 'gagal' } }
})

function configure(opts: { wa?: boolean; email?: boolean } = {}) {
  const { wa: useWa = true, email: useEmail = true } = opts
  if (useWa) env.WA_GATEWAY_URL = `http://127.0.0.1:${wa.port}`; else delete env.WA_GATEWAY_URL
  if (useEmail) { env.RESEND_API_KEY = 're_test_key'; env.RESEND_FROM = 'Saudinesia <noreply@saudinesia.test>'; env.RESEND_API_URL = `http://127.0.0.1:${mail.port}` }
  else { delete env.RESEND_API_KEY; delete env.RESEND_FROM }
  env.APP_URL = 'https://saudinesia.test'
  waSeen = []; mailSeen = []; waStatus = 200; mailScript = []
}

// ───────────── data uji ─────────────
const tag = `nt${Date.now()}`
// `phone` di opsi = nomor WhatsApp akun (notifikasi WA memakai User.whatsapp — docs/arsitektur-auth.md §3.5); telepon diisi sama.
const mk = (suffix: string, extra: Partial<{ email: string; phone: string | null; fullName: string }> = {}) => {
  const number = extra.phone === undefined ? `62811${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}` : extra.phone
  return prisma.user.create({
    data: { email: extra.email ?? `${tag}-${suffix}@example.test`, passwordHash: 'x', fullName: extra.fullName ?? `Uji ${suffix}`, phone: number, whatsapp: number, role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() },
  })
}
const ids: { users: string[]; bookings: string[] } = { users: [], bookings: [] }
async function user(...a: Parameters<typeof mk>) { const u = await mk(...a); ids.users.push(u.id); return u }
async function booking(userId: string) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${ids.bookings.length}`, userId, departureDate: new Date('2026-12-01'), returnDate: new Date('2026-12-12'), season: 'regular', totalAmount: 1000000 } })
  ids.bookings.push(b.id); return b
}
const logs = (userId: string, type?: string) => prisma.notificationLog.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ sentAt: 'asc' }, { channel: 'asc' }] })
const confirmed: NotificationEvent = { type: 'payment_confirmed', code: 'SND-9' }
const originalSetting = await prisma.siteSetting.findFirst()

try {
  console.log('== jujur: sent | failed | skipped ==')

  await t('kedua kanal sukses → dua baris "sent", email membawa externalId dan penerima benar', async () => {
    configure(); const u = await user('a'); const b = await booking(u.id)
    const out = await notify({ userId: u.id, bookingId: b.id, event: confirmed })
    assert.deepEqual(out.map((o) => `${o.channel}:${o.status}`).sort(), ['email:sent', 'whatsapp:sent'])
    const rows = await logs(u.id)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.status === 'sent' && r.error === null))
    const email = rows.find((r) => r.channel === 'email')!, whats = rows.find((r) => r.channel === 'whatsapp')!
    assert.equal(email.recipient, u.email); assert.match(email.externalId ?? '', /^msg_/); assert.match(email.messagePreview ?? '', /SND-9/)
    assert.equal(whats.recipient, u.phone); assert.equal(whats.externalId, null)
    assert.equal(waSeen.length, 1); assert.equal(mailSeen.length, 1)
    assert.equal(mailSeen[0]!.path, '/emails')
  })

  await t('REGRESI: gateway WhatsApp BELUM dikonfigurasi → "skipped", BUKAN "sent" (dulu selalu sent)', async () => {
    configure({ wa: false }); const u = await user('b')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'skipped')
    const r = (await logs(u.id)).find((x) => x.channel === 'whatsapp')!
    assert.equal(r.status, 'skipped'); assert.match(r.error ?? '', /WA_GATEWAY_URL/)
    assert.equal(waSeen.length, 0)
  })

  await t('REGRESI: gateway WhatsApp error 500 → "failed" dengan alasan (bukan "sent"); email tetap terkirim', async () => {
    configure(); waStatus = 500; const u = await user('c')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'failed')
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent')
    const r = (await logs(u.id)).find((x) => x.channel === 'whatsapp')!
    assert.equal(r.status, 'failed'); assert.match(r.error ?? '', /HTTP 500/)
    assert.equal(waSeen.length, 3, '1 percobaan + 2 retry')
  })

  await t('RESEND belum dikonfigurasi → email "skipped" dengan alasan, tidak ada request; WA tetap jalan', async () => {
    configure({ email: false }); const u = await user('d')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'skipped')
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'sent')
    assert.match((await logs(u.id)).find((x) => x.channel === 'email')!.error ?? '', /RESEND_API_KEY/)
    assert.equal(mailSeen.length, 0)
  })

  await t('Resend error 422 → email "failed" (alasan tercatat), WA tetap sent', async () => {
    configure(); mailScript = [422]; const u = await user('e')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'failed')
    const r = (await logs(u.id)).find((x) => x.channel === 'email')!
    assert.match(r.error ?? '', /HTTP 422/); assert.equal(r.externalId, null)
  })

  console.log('== penerima & kanal ==')

  await t('akun tanpa nomor → hanya email; kejadian tanpa pesan WA (welcome) → hanya email', async () => {
    configure(); const u = await user('f', { phone: null })
    assert.deepEqual((await notify({ userId: u.id, event: confirmed })).map((o) => o.channel), ['email'])
    configure()
    const v = await user('f2')
    assert.deepEqual((await notify({ userId: v.id, event: { type: 'welcome', name: 'Uji' } })).map((o) => o.channel), ['email'])
    assert.equal(waSeen.length, 0)
  })

  await t('email placeholder (*.invalid) tidak pernah dikirimi; hanya WA', async () => {
    configure(); const u = await user('g', { email: `${tag}-g@akun.invalid` })
    assert.deepEqual((await notify({ userId: u.id, event: confirmed })).map((o) => o.channel), ['whatsapp'])
    assert.equal(mailSeen.length, 0)
  })

  await t('saklar admin emailNotificationsEnabled=false → email "skipped", WA tidak terpengaruh', async () => {
    configure(); const u = await user('h')
    const row = originalSetting ?? (await prisma.siteSetting.create({ data: {} }))
    await prisma.siteSetting.update({ where: { id: row.id }, data: { emailNotificationsEnabled: false } })
    const out = await notify({ userId: u.id, event: confirmed })
    await prisma.siteSetting.update({ where: { id: row.id }, data: { emailNotificationsEnabled: originalSetting?.emailNotificationsEnabled ?? true } })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'skipped')
    assert.match((await logs(u.id)).find((x) => x.channel === 'email')!.error ?? '', /dinonaktifkan/)
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'sent')
    assert.equal(mailSeen.length, 0)
  })

  console.log('== dedupe ==')

  await t('dedupe: kanal yang sudah "sent" dilewati ("duplicate"), tidak ada baris/request baru', async () => {
    configure(); const u = await user('i'); const b = await booking(u.id)
    const ev: NotificationEvent = { type: 'payment_reminder_12h', code: 'SND-1', deadline: 'besok' }
    await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true })
    const again = await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true })
    assert.deepEqual(again.map((o) => o.status), ['duplicate', 'duplicate'])
    assert.equal((await logs(u.id)).length, 2)
    assert.equal(waSeen.length, 1); assert.equal(mailSeen.length, 1)
  })

  await t('dedupe TIDAK menghitung "failed"/"skipped": percobaan ulang berhasil (dulu pengingat gagal tak pernah dicoba lagi)', async () => {
    configure({ email: false }); const u = await user('j'); const b = await booking(u.id)
    const ev: NotificationEvent = { type: 'payment_reminder_22h', code: 'SND-2', deadline: 'nanti' }
    await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true }) // email skipped
    configure()                                                              // kredensial sekarang diisi
    const retry = await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true })
    assert.equal(retry.find((o) => o.channel === 'email')?.status, 'sent')
    assert.equal(retry.find((o) => o.channel === 'whatsapp')?.status, 'duplicate', 'WA sudah sent → tidak dobel')
    assert.equal(mailSeen.length, 1)
  })

  await t('tanpa dedupe, kejadian berulang SAH dikirim lagi (mis. bukti ditolak dua kali)', async () => {
    configure(); const u = await user('k')
    await notify({ userId: u.id, event: { type: 'payment_rejected', code: 'SND-3' } })
    await notify({ userId: u.id, event: { type: 'payment_rejected', code: 'SND-3' } })
    assert.equal(mailSeen.length, 2); assert.equal(waSeen.length, 2)
    const keys = mailSeen.map((m) => m.headers.get('idempotency-key'))
    assert.ok(keys[0] && keys[1] && keys[0] !== keys[1], 'kunci idempotensi berbeda per pengiriman')
  })

  console.log('== ketahanan & keamanan ==')

  await t('notify() tidak pernah melempar: user tidak ada → []', async () => {
    configure()
    assert.deepEqual(await notify({ userId: '00000000-0000-0000-0000-000000000000', event: confirmed }), [])
  })

  await t('nama berisi HTML: email yang dikirim ke Resend ter-escape', async () => {
    configure(); const u = await user('l', { fullName: '<img src=x onerror=alert(1)>' })
    await notify({ userId: u.id, event: confirmed })
    const html = mailSeen[0]!.body.html as string
    assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'))
  })

  await t('log email menyimpan subjek, BUKAN isi email', async () => {
    configure(); const u = await user('m')
    await notify({ userId: u.id, event: confirmed })
    const r = (await logs(u.id)).find((x) => x.channel === 'email')!
    assert.equal(r.messagePreview, mailSeen[0]!.body.subject)
    assert.ok(!(r.messagePreview ?? '').includes('<'))
  })
} finally {
  // Bersihkan SEMUA data uji (log → booking → user) dan kembalikan saklar.
  await prisma.notificationLog.deleteMany({ where: { userId: { in: ids.users } } })
  await prisma.booking.deleteMany({ where: { id: { in: ids.bookings } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
  if (originalSetting) await prisma.siteSetting.update({ where: { id: originalSetting.id }, data: { emailNotificationsEnabled: originalSetting.emailNotificationsEnabled } })
  await wa.stop(); await mail.stop()
  await prisma.$disconnect()
}

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
