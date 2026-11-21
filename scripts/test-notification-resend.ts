// Uji kirim ulang dari log notifikasi (docs/arsitektur-notifikasi.md §14) terhadap DATABASE SUNGGUHAN + gateway WhatsApp & Resend PALSU.
// Fokus: pesan disusun ulang dari data booking TERKINI, jenis tak didukung/keadaan yang tak cocok DITOLAK, aturan kanal notify() tetap berlaku.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { canResendLog, resendNotification, resendTarget } from '@/lib/notifications/resend'
import { addDays, dbDateOf, todayInApp } from '@/lib/time'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`) }
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'

let waSeen: FakeRequest[] = []
let mailSeen: FakeRequest[] = []
// `/devices` = pencarian perangkat GOWA oleh klien (lib/whatsapp/client.ts) — bukan pesan, tidak dihitung.
const wa = await startFakeServer(async (req) => { if (req.path === '/devices') return { status: 200, body: { results: [{ id: 'saudinesia' }] } }; waSeen.push(req); return { status: 200 } })
const mail = await startFakeServer((req) => { mailSeen.push(req); return { status: 200, body: { id: `msg_${mailSeen.length}` } } })
env.WA_GATEWAY_URL = `http://127.0.0.1:${wa.port}`
env.RESEND_API_KEY = 're_test_key'; env.RESEND_FROM = 'Saudinesia <noreply@saudinesia.test>'; env.RESEND_API_URL = `http://127.0.0.1:${mail.port}`
env.APP_URL = 'https://saudinesia.test'
const reset = () => { waSeen = []; mailSeen = [] }
const waText = () => String((waSeen[0]?.body as { message?: unknown } | undefined)?.message ?? '')

const tag = `rs${Date.now()}`
const ids: { users: string[]; bookings: string[]; logs: string[] } = { users: [], bookings: [], logs: [] }
let n = 0
async function user(verifiedWa = true) {
  const number = `62811${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`
  const u = await prisma.user.create({ data: {
    email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, whatsapp: number, role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(),
    consentLogs: { create: { type: 'whatsapp_notifications', version: 'uji' } },
    ...(verifiedWa ? { whatsappVerifiedAt: new Date(), verifiedWhatsapp: number } : {}),
  } })
  ids.users.push(u.id); return u
}
type Mk = { status?: 'active' | 'cancelled' | 'completed'; confirmed?: boolean; dep?: string; deadline?: Date | null; paid?: number; invoice?: boolean }
async function booking(userId: string, o: Mk = {}) {
  const b = await prisma.booking.create({ data: {
    bookingCode: `${tag}-B${++n}`, userId, status: o.status ?? 'active', confirmedAt: o.confirmed ? new Date() : null,
    departureDate: o.dep ? dbDateOf(o.dep) : null, returnDate: o.dep ? dbDateOf(addDays(o.dep, 9)) : null,
    season: 'regular', totalAmount: 1_000_000, paymentDeadline: o.deadline === undefined ? null : o.deadline,
  } })
  ids.bookings.push(b.id)
  if (o.paid) await prisma.payment.create({ data: { bookingId: b.id, amount: o.paid, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date() } })
  if (o.invoice) await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-INV-${n}`, sequenceKey: `r${n}`.slice(0, 8), sequence: 900_000 + n, issuedAt: new Date(), invoiceDate: dbDateOf(todayInApp()), dueDate: dbDateOf(addDays(todayInApp(), 3)), companySnapshot: {} } })
  return b
}
async function log(userId: string, bookingId: string | null, type: string) {
  const l = await prisma.notificationLog.create({ data: { userId, bookingId, channel: 'email', type, recipient: 'x@example.test', status: 'failed' } })
  ids.logs.push(l.id); return l
}

try {
  console.log('== penolakan ==')
  await t('log tak ada / jenis tak didukung / tanpa booking → ditolak tanpa mengirim apa pun', async () => {
    reset(); const u = await user(); const b = await booking(u.id)
    assert.deepEqual(await resendTarget('00000000-0000-4000-8000-000000000000'), { ok: false, reason: 'not_found' })
    assert.deepEqual(await resendTarget((await log(u.id, b.id, 'booking_expired')).id), { ok: false, reason: 'not_resendable' })
    assert.deepEqual(await resendTarget((await log(u.id, null, 'payment_confirmed')).id), { ok: false, reason: 'no_booking' })
    assert.equal(canResendLog({ type: 'visa_status_change', bookingId: b.id }), false)
    assert.equal(canResendLog({ type: 'invoice_issued', bookingId: null }), false)
    assert.equal(canResendLog({ type: 'invoice_issued', bookingId: b.id }), true)
    assert.equal(waSeen.length + mailSeen.length, 0)
  })

  await t('booking batal → inactive; pembayaran diterima tetap boleh untuk booking selesai', async () => {
    reset(); const u = await user()
    const off = await booking(u.id, { status: 'cancelled', paid: 500_000, deadline: new Date(Date.now() + 86_400_000 * 2) })
    assert.deepEqual(await resendNotification(off.id, 'payment_reminder_d1'), { ok: false, reason: 'inactive' })
    assert.deepEqual(await resendNotification(off.id, 'payment_confirmed'), { ok: false, reason: 'inactive' })
    const done = await booking(u.id, { status: 'completed', paid: 1_000_000 })
    assert.equal((await resendNotification(done.id, 'payment_confirmed')).ok, true)
    assert.deepEqual(await resendNotification(done.id, 'payment_reminder_d0'), { ok: false, reason: 'inactive' })
  })

  console.log('== disusun dari data TERKINI ==')
  await t('pengingat bayar memakai sisa tagihan terkini; lunas → not_applicable', async () => {
    reset(); const u = await user()
    const b = await booking(u.id, { paid: 400_000, deadline: new Date(Date.now() + 86_400_000 * 3) })
    const r = await resendNotification(b.id, 'payment_reminder_d1')
    assert.ok(r.ok); assert.deepEqual(r.channels.map(c => `${c.channel}:${c.status}`).sort(), ['email:sent', 'whatsapp:sent'])
    assert.match(waText(), /sisa tagihan \*Rp\s?600\.000\*/i)
    await prisma.payment.create({ data: { bookingId: b.id, amount: 600_000, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date() } })
    assert.deepEqual(await resendNotification(b.id, 'payment_reminder_d1'), { ok: false, reason: 'not_applicable' })
    const noDeadline = await booking(u.id)
    assert.deepEqual(await resendNotification(noDeadline.id, 'payment_reminder_d0'), { ok: false, reason: 'not_applicable' })
  })

  await t('pembayaran diterima tanpa uang masuk → not_applicable; dengan uang → sisa terkini', async () => {
    reset(); const u = await user()
    const none = await booking(u.id)
    assert.deepEqual(await resendNotification(none.id, 'payment_confirmed'), { ok: false, reason: 'not_applicable' })
    const part = await booking(u.id, { paid: 250_000 })
    assert.ok((await resendNotification(part.id, 'payment_confirmed')).ok)
    assert.match(waText(), /Sisa tagihan: \*Rp\s?750\.000\*/)
  })

  await t('pengingat berangkat menyebut sisa hari SEBENARNYA; hari-H/terlewat atau belum terkonfirmasi → not_applicable', async () => {
    reset(); const u = await user()
    const b5 = await booking(u.id, { confirmed: true, dep: addDays(todayInApp(), 5) })
    assert.ok((await resendNotification(b5.id, 'departure_reminder_7d')).ok)
    assert.match(waText(), /5 hari lagi/); assert.doesNotMatch(waText(), /7 hari lagi/)
    assert.match(String((mailSeen[0]?.body as { subject?: unknown }).subject), /5 hari lagi/)
    reset()
    const b1 = await booking(u.id, { confirmed: true, dep: addDays(todayInApp(), 1) })
    assert.ok((await resendNotification(b1.id, 'departure_reminder_7d')).ok); assert.match(waText(), /besok/)
    const today = await booking(u.id, { confirmed: true, dep: todayInApp() })
    assert.deepEqual(await resendNotification(today.id, 'departure_reminder_1d'), { ok: false, reason: 'not_applicable' })
    const unpaid = await booking(u.id, { dep: addDays(todayInApp(), 5) })
    assert.deepEqual(await resendNotification(unpaid.id, 'departure_reminder_7d'), { ok: false, reason: 'not_applicable' })
  })

  await t('invoice terbit memakai invoice terkini; tanpa invoice → not_applicable', async () => {
    reset(); const u = await user()
    const none = await booking(u.id)
    assert.deepEqual(await resendNotification(none.id, 'invoice_issued'), { ok: false, reason: 'not_applicable' })
    const b = await booking(u.id, { invoice: true })
    assert.ok((await resendNotification(b.id, 'invoice_issued')).ok)
    assert.match(waText(), new RegExp(`${tag}-INV-`)); assert.match(waText(), /https:\/\/saudinesia\.test\/id\/invoice\//)
  })

  console.log('== aturan kanal tetap ==')
  await t('nomor WhatsApp belum terverifikasi → WA dilewati, email tetap terkirim; tiap kirim ulang = baris log baru', async () => {
    reset(); const u = await user(false); const b = await booking(u.id, { paid: 100_000 })
    const r = await resendNotification(b.id, 'payment_confirmed')
    assert.ok(r.ok); assert.deepEqual(r.channels.map(c => `${c.channel}:${c.status}`).sort(), ['email:sent', 'whatsapp:skipped'])
    assert.equal(waSeen.length, 0)
    await resendNotification(b.id, 'payment_confirmed') // tanpa dedupe: memang dikirim ulang
    assert.equal(await prisma.notificationLog.count({ where: { bookingId: b.id, channel: 'email', status: 'sent' } }), 2)
  })

  console.log('== penjaga sumber ==')
  await t('route: peran admin, uuid, batas laju per booking SEBELUM mengirim; halaman: tombol hanya lewat canResendLog, waktu lewat formatInstant', async () => {
    const route = readFileSync('app/api/v1/admin/notifications/[id]/resend/route.ts', 'utf8')
    assert.match(route, /await requireBookingManage\(\)/)
    assert.match(route, /z\.uuid\(\)/)
    assert.ok(route.indexOf("policy('notificationResendBooking'") > 0 && route.indexOf("policy('notificationResendBooking'") < route.indexOf('resendNotification('), 'batas laju sebelum kirim')
    const page = readFileSync('app/[locale]/admin/(protected)/notifications/page.tsx', 'utf8')
    assert.match(page, /canResendLog\(l\)/); assert.match(page, /formatInstant\(l\.sentAt/); assert.doesNotMatch(page, /toLocaleString/)
  })
} finally {
  await prisma.notificationLog.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { id: { in: ids.logs } }] } })
  await prisma.payment.deleteMany({ where: { bookingId: { in: ids.bookings } } })
  await prisma.invoice.deleteMany({ where: { bookingId: { in: ids.bookings } } })
  await prisma.booking.deleteMany({ where: { id: { in: ids.bookings } } })
  await prisma.consentLog.deleteMany({ where: { userId: { in: ids.users } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
  await wa.stop(); await mail.stop()
  await prisma.$disconnect()
}

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
