// Siklus hidup booking v2 (docs/arsitektur-booking-engine-v2.md §10.1, Fase 3) terhadap DATABASE SUNGGUHAN:
// status TAMPILAN diturunkan (bukan disimpan) dan filter SQL-nya identik dengan fungsi turunannya, tanggal acuan dihitung dari item, hangus HANYA bila belum ada uang masuk
// (batas hari mengikuti zona aplikasi, idempoten, tanpa refund), pengingat H-1/hari-H, batas bayar = akhir hari jatuh tempo, serta penjaga sumber (draf tak tampil ke jamaah, kunci baris di jalur batal/unggah).
// Bagian murni dijalankan di beberapa TZ proses (lihat package.json).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { addDays, dbDateOf, todayInApp } from '@/lib/time'
import { STATUS_FILTERS, displayStatus, displayStatusOf, isOverdue, isPilgrimCancellable, paymentDeadlineFor, paymentState, statusSelect, statusWhere, type DisplayStatus } from '@/lib/booking/lifecycle'
import { recomputeBookingDates } from '@/lib/booking/dates'
import { dueReminders, expireOverdueBookings } from '@/lib/booking/expire'
import { cancelBooking } from '@/lib/booking/cancel'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')

// ── murni ────────────────────────────────────────────────────────────────────────────────────────
const base = { confirmedAt: null as Date | null, hasPendingPayment: false, departureDate: null as Date | null, returnDate: null as Date | null }
const d = (s: string) => new Date(`${s}T00:00:00Z`)
await t('displayStatus: tabel nilai (siklus hidup × konfirmasi × bukti menunggu)', () => {
  const rows: Array<[Partial<typeof base> & { status: BookingStatus }, DisplayStatus]> = [
    [{ status: 'draft' }, 'draft'],
    [{ status: 'draft', hasPendingPayment: true }, 'draft'],
    [{ status: 'active' }, 'awaiting_payment'],
    [{ status: 'active', hasPendingPayment: true }, 'payment_review'],
    [{ status: 'active', confirmedAt: new Date() }, 'confirmed'],
    [{ status: 'active', confirmedAt: new Date(), hasPendingPayment: true }, 'confirmed'],
    [{ status: 'completed', confirmedAt: new Date() }, 'completed'],
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'expired' }, 'expired'],
  ]
  for (const [f, want] of rows) assert.equal(displayStatus({ ...base, ...f }, '2027-06-05'), want, JSON.stringify(f))
})
await t('displayStatus: "dalam perjalanan" = dikonfirmasi dan hari ini di antara berangkat–pulang INKLUSIF; tanggal kosong → tetap "dikonfirmasi"', () => {
  const c = { ...base, status: 'active' as const, confirmedAt: new Date(), departureDate: d('2027-06-01'), returnDate: d('2027-06-10') }
  const at = (today: string) => displayStatus(c, today)
  assert.deepEqual(['2027-05-31', '2027-06-01', '2027-06-05', '2027-06-10', '2027-06-11'].map(at), ['confirmed', 'in_progress', 'in_progress', 'in_progress', 'confirmed'])
  assert.equal(displayStatus({ ...c, returnDate: null }, '2027-06-05'), 'confirmed')
  assert.equal(displayStatus({ ...c, departureDate: null }, '2027-06-05'), 'confirmed')
  assert.equal(displayStatus({ ...c, confirmedAt: null }, '2027-06-05'), 'awaiting_payment', 'belum dikonfirmasi tak pernah "dalam perjalanan"')
})
await t('displayStatus tanpa argumen memakai HARI INI zona aplikasi (bukan zona proses)', () => {
  const today = todayInApp()
  const c = { ...base, status: 'active' as const, confirmedAt: new Date(), departureDate: dbDateOf(today), returnDate: dbDateOf(addDays(today, 3)) }
  assert.equal(displayStatus(c), 'in_progress')
  assert.equal(displayStatus({ ...c, departureDate: dbDateOf(addDays(today, 1)) }), 'confirmed')
})
await t('paymentState / isOverdue / isPilgrimCancellable', () => {
  assert.deepEqual([[1000, 0], [1000, 400], [1000, 1000], [1000, 1200], [1000, 999.995], [0, 0]].map(([a, b]) => paymentState(a!, b!)), ['unpaid', 'partial', 'paid', 'overpaid', 'paid', 'unpaid'])
  const now = new Date('2026-10-30T10:00:00Z'), past = new Date('2026-10-29T10:00:00Z'), future = new Date('2026-10-31T10:00:00Z')
  assert.deepEqual([isOverdue({ status: 'active', paymentDeadline: past }, 1000, 0, now), isOverdue({ status: 'active', paymentDeadline: past }, 1000, 1000, now), isOverdue({ status: 'active', paymentDeadline: future }, 1000, 0, now), isOverdue({ status: 'cancelled', paymentDeadline: past }, 1000, 0, now), isOverdue({ status: 'active', paymentDeadline: null }, 1000, 0, now)], [true, false, false, false, false])
  assert.deepEqual([isPilgrimCancellable({ status: 'active', confirmedAt: null }), isPilgrimCancellable({ status: 'active', confirmedAt: new Date() }), isPilgrimCancellable({ status: 'draft', confirmedAt: null }), isPilgrimCancellable({ status: 'completed', confirmedAt: null })], [true, false, false, false])
})
await t('label/warna/filter KONSISTEN: kunci BOOKING_STATUS = BOOKING_TONE = STATUS_FILTERS = DisplayStatus', () => {
  const keys = Object.keys(BOOKING_STATUS).sort()
  assert.deepEqual(Object.keys(BOOKING_TONE).sort(), keys)
  assert.deepEqual([...STATUS_FILTERS].sort(), keys)
})
await t('batas bayar = AKHIR hari jatuh tempo di zona aplikasi (bukan +24 jam): Jakarta 31 Okt 03.00 + 4 hari → 4 Nov 23.59.59,999 WIB', () => {
  const dl = paymentDeadlineFor(new Date('2026-10-30T20:00:00Z'), 4) // 31 Okt 03.00 WIB
  assert.equal(dl.toISOString(), '2026-11-04T16:59:59.999Z')
  assert.equal(paymentDeadlineFor(new Date('2026-10-30T16:59:59Z'), 0).toISOString(), '2026-10-30T16:59:59.999Z', '0 hari = akhir hari ini WIB')
  assert.equal(paymentDeadlineFor(new Date('2026-10-30T17:00:00Z'), 0).toISOString(), '2026-10-31T16:59:59.999Z', 'lewat tengah malam WIB = sudah hari berikutnya')
})

// ── basis data ───────────────────────────────────────────────────────────────────────────────────
const tag = `lc${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pemesan Siklus', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const ids: string[] = []
let n = 0
type Mk = { status?: BookingStatus; confirmed?: boolean; dep?: string | null; ret?: string | null; deadline?: Date | null; total?: number; pays?: Array<'pending' | 'confirmed' | 'rejected'> }
async function mk(o: Mk = {}) {
  const b = await prisma.booking.create({ data: {
    bookingCode: `${tag}-${++n}`, userId: user.id, status: o.status ?? 'active', confirmedAt: o.confirmed ? new Date() : null,
    departureDate: o.dep === null ? null : new Date(`${o.dep ?? '2091-01-01'}T00:00:00Z`), returnDate: o.ret === null ? null : new Date(`${o.ret ?? o.dep ?? '2091-01-10'}T00:00:00Z`),
    season: 'regular', totalAmount: o.total ?? 1_000_000, paymentDeadline: o.deadline ?? null,
  } })
  ids.push(b.id)
  for (const status of o.pays ?? []) await prisma.payment.create({ data: { bookingId: b.id, amount: status === 'confirmed' ? (o.total ?? 1_000_000) : 0, method: 'bank_transfer', status, ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}) } })
  return b.id
}
const settings = await prisma.invoiceSettings.upsert({ where: { id: 'global' }, create: { id: 'global' }, update: {} })
const setExpire = (days: number) => prisma.invoiceSettings.update({ where: { id: 'global' }, data: { expireDaysBeforeReference: days } })

await t('FILTER SQL = TURUNAN: tiap booking jatuh tepat di SATU filter, dan filter itu = displayStatusOf (termasuk tanggal kosong & berjalan hari ini)', async () => {
  const today = todayInApp()
  const sample: Record<string, string> = {}
  const add = async (label: string, o: Mk) => { sample[await mk(o)] = label }
  await add('draft', { status: 'draft' })
  await add('awaiting_payment', {})
  await add('payment_review', { pays: ['pending'] })
  await add('awaiting_payment', { pays: ['rejected'] })
  await add('confirmed', { confirmed: true, pays: ['confirmed'] })
  await add('confirmed', { confirmed: true, dep: null, ret: null })
  await add('in_progress', { confirmed: true, dep: today, ret: addDays(today, 5) })
  await add('in_progress', { confirmed: true, dep: addDays(today, -5), ret: today })
  await add('confirmed', { confirmed: true, dep: addDays(today, 1), ret: addDays(today, 5) })
  await add('confirmed', { confirmed: true, dep: addDays(today, -9), ret: addDays(today, -1) })
  await add('completed', { status: 'completed', confirmed: true })
  await add('cancelled', { status: 'cancelled' })
  await add('expired', { status: 'expired' })
  const rows = await prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true, ...statusSelect } })
  for (const r of rows) assert.equal(displayStatusOf(r), sample[r.id], `turunan salah untuk ${sample[r.id]}`)
  for (const f of STATUS_FILTERS) {
    const got = (await prisma.booking.findMany({ where: { id: { in: ids }, AND: [statusWhere(f)] }, select: { id: true } })).map(x => x.id).sort()
    const want = Object.entries(sample).filter(([, v]) => v === f).map(([k]) => k).sort()
    assert.deepEqual(got, want, `filter ${f}`)
  }
})

await t('recomputeBookingDates: paling awal / paling akhir dari item; tanpa item bertanggal nilai lama TIDAK diubah', async () => {
  const id = await mk({ dep: '2090-01-01', ret: '2090-01-02' })
  await recomputeBookingDates(prisma, id)
  const same = await prisma.booking.findUniqueOrThrow({ where: { id } })
  assert.deepEqual([same.departureDate?.toISOString().slice(0, 10), same.returnDate?.toISOString().slice(0, 10)], ['2090-01-01', '2090-01-02'])
  await prisma.bookingMuthowif.create({ data: { bookingId: id, startDate: d('2091-03-10'), endDate: d('2091-03-12'), numDays: 3, numPeople: 2, totalPrice: 1 } })
  await prisma.bookingMuthowif.create({ data: { bookingId: id, startDate: d('2091-03-05'), endDate: d('2091-03-08'), numDays: 4, numPeople: 2, totalPrice: 1 } })
  const hp = await prisma.hajiProduct.create({ data: { name: `Haji ${tag}`, hajiType: 'reguler', year: 2091, departureDate: d('2091-03-20'), returnDate: d('2091-04-01') } })
  await prisma.bookingHaji.create({ data: { bookingId: id, hajiProductId: hp.id, numPersons: 1, totalPrice: 1 } })
  const r = await recomputeBookingDates(prisma, id)
  assert.deepEqual([r.first?.toISOString().slice(0, 10), r.last?.toISOString().slice(0, 10)], ['2091-03-05', '2091-04-01'])
  const after = await prisma.booking.findUniqueOrThrow({ where: { id } })
  assert.deepEqual([after.departureDate?.toISOString().slice(0, 10), after.returnDate?.toISOString().slice(0, 10)], ['2091-03-05', '2091-04-01'])
  await prisma.bookingHaji.deleteMany({ where: { bookingId: id } }); await prisma.hajiProduct.delete({ where: { id: hp.id } })
  await prisma.booking.update({ where: { id }, data: { status: 'cancelled' } }) // bawa item muthowif tanpa kuota: jangan ikut pekerjaan hangus di uji lain
  const draft = await mk({ status: 'draft', dep: null, ret: null })
  const none = await recomputeBookingDates(prisma, draft)
  assert.deepEqual([none.first, none.last], [null, null])
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: draft } })).departureDate, null, 'draf tanpa item tetap tanpa tanggal')
})

// ── hangus ───────────────────────────────────────────────────────────────────────────────────────
const mine = (r: { expired: Array<{ id: string }> }) => r.expired.map(x => x.id).filter(i => ids.includes(i)).sort()
await t('HANGUS: hanya booking hidup, belum dikonfirmasi, TANPA pembayaran pending/confirmed, dan berangkat ≤ hari ini + N (batas hari mengikuti zona aplikasi WIB)', async () => {
  await setExpire(7)
  // "sekarang" tetap: 31 Okt 00.30 WIB (= 30 Okt 17.30 UTC) → hari ini WIB = 2026-10-31 → batas = 2026-11-07
  const now = new Date('2026-10-30T17:30:00Z')
  const edge = await mk({ dep: '2026-11-07' })
  const beyond = await mk({ dep: '2026-11-08' })
  const rejectedOnly = await mk({ dep: '2026-11-03', pays: ['rejected'] })
  const hasPending = await mk({ dep: '2026-11-03', pays: ['pending'] })
  const hasPaid = await mk({ dep: '2026-11-03', pays: ['confirmed'] })
  const confirmedNoPay = await mk({ dep: '2026-11-03', confirmed: true })
  const cancelled = await mk({ status: 'cancelled', dep: '2026-11-03' })
  const draft = await mk({ status: 'draft', dep: '2026-11-03' })
  const noDate = await mk({ dep: null, ret: null })
  const r = await expireOverdueBookings(now)
  assert.deepEqual(mine(r), [edge, rejectedOnly].sort())
  const st = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
  assert.deepEqual(await Promise.all([edge, rejectedOnly, beyond, hasPending, hasPaid, confirmedNoPay, cancelled, draft, noDate].map(st)), ['expired', 'expired', 'active', 'active', 'active', 'active', 'cancelled', 'draft', 'active'])
  const again = await expireOverdueBookings(now)
  assert.deepEqual(mine(again), [], 'idempoten: dijalankan lagi tak mengubah apa pun')
  // satu menit lebih awal (hari ini masih 30 Okt WIB) → batas 6 Nov: tanggal 7 Nov belum hangus
  await prisma.booking.update({ where: { id: edge }, data: { status: 'active' } })
  assert.deepEqual(mine(await expireOverdueBookings(new Date('2026-10-30T16:59:00Z'))), [], 'sebelum tengah malam WIB batas belum maju')
  assert.deepEqual(mine(await expireOverdueBookings(new Date('2026-10-30T17:00:00Z'))), [edge], 'tepat tengah malam WIB batas maju satu hari')
})
await t('hangus = 0 hari → nonaktif sama sekali', async () => {
  await setExpire(0)
  const id = await mk({ dep: '2026-11-01' })
  assert.deepEqual(mine(await expireOverdueBookings(new Date('2026-10-30T17:30:00Z'))), [])
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id } })).status, 'active')
})
await t('HANGUS tanpa refund; pembatalan biasa: refund dihitung dari uang yang SUDAH MASUK (tanpa uang masuk → tanpa baris Refund, SEC-118); pesanan hangus tetap menyimpan datanya', async () => {
  await setExpire(365)
  const far = '2091-01-01' // > 60 hari → kebijakan refund 100% bila lewat jalur batal
  const toExpire = await mk({ dep: far, total: 5_000_000 })
  const toCancel = await mk({ dep: far, total: 5_000_000, confirmed: true, pays: ['confirmed'] })
  const unpaid = await mk({ dep: far, total: 5_000_000 })
  const pendingOnly = await mk({ dep: far, total: 5_000_000, pays: ['pending', 'rejected'] })
  assert.deepEqual(mine(await expireOverdueBookings(new Date('2090-12-31T01:00:00Z'))).filter(i => i === toExpire), [toExpire])
  assert.equal(await prisma.refund.count({ where: { bookingId: toExpire } }), 0, 'hangus: tanpa refund')
  const cancelled = await prisma.$transaction(async tx => cancelBooking(tx, await tx.booking.findUniqueOrThrow({ where: { id: toCancel }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true } }), 'uji'))
  assert.equal(cancelled.refundAmount, 5_000_000)
  assert.equal(await prisma.refund.count({ where: { bookingId: toCancel } }), 1)
  for (const id of [unpaid, pendingOnly]) {
    const r = await prisma.$transaction(async tx => cancelBooking(tx, await tx.booking.findUniqueOrThrow({ where: { id }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true } }), 'uji'))
    assert.equal(r.refundAmount, 0, 'belum ada uang masuk → refund 0')
    assert.equal(await prisma.refund.count({ where: { bookingId: id } }), 0, 'tak ada baris Refund untuk uang yang tak pernah diterima')
  }
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: toExpire } })).totalAmount.toString(), '5000000', 'data tetap tersimpan')
  await setExpire(settings.expireDaysBeforeReference)
})
await t('HANGUS melepas kuota yang ditahan: reservasi muthowif (pool, pending) kembali ke 0 untuk tiap hari; booking yang kuotanya rusak tidak menghentikan yang lain', async () => {
  await setExpire(365)
  const days = ['2095-05-01', '2095-05-02']
  for (const date of days) await prisma.muthowifPoolAvailability.upsert({ where: { date: d(date) }, create: { date: d(date), pendingCount: 3 }, update: { pendingCount: 3 } })
  const held = await mk({ dep: days[0], ret: days[1] })
  await prisma.bookingMuthowif.create({ data: { bookingId: held, startDate: d(days[0]!), endDate: d(days[1]!), numDays: 2, numPeople: 3, totalPrice: 1 } })
  const broken = await mk({ dep: '2095-06-01' }) // item tanpa baris kuota → pelepasan gagal; harus dilewati, bukan menjatuhkan seluruh pekerjaan
  await prisma.bookingMuthowif.create({ data: { bookingId: broken, startDate: d('2095-06-01'), endDate: d('2095-06-01'), numDays: 1, numPeople: 1, totalPrice: 1 } })
  const r = await expireOverdueBookings(new Date('2095-04-01T01:00:00Z'))
  assert.ok(mine(r).includes(held), 'booking dengan kuota tertahan hangus')
  const pool = await prisma.muthowifPoolAvailability.findMany({ where: { date: { in: days.map(d) } }, orderBy: { date: 'asc' } })
  assert.deepEqual(pool.map(p => p.pendingCount), [0, 0])
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: broken } })).status, 'active', 'gagal → tetap hidup (transaksi dibatalkan), tidak setengah hangus')
  assert.equal(r.skipped >= 1, true)
  await prisma.booking.update({ where: { id: broken }, data: { status: 'cancelled' } })
  await prisma.muthowifPoolAvailability.deleteMany({ where: { date: { in: days.map(d) } } })
  await setExpire(settings.expireDaysBeforeReference)
})

// ── pengingat ────────────────────────────────────────────────────────────────────────────────────
await t('PENGINGAT: H-0 / H-1 menurut hari kalender WIB (tepat 00.00 hari berikutnya = H-1); bukti menunggu / dikonfirmasi / batal / draf tak diingatkan', async () => {
  const now = new Date('2026-10-30T01:00:00Z') // 30 Okt 08.00 WIB
  const d0 = await mk({ deadline: new Date('2026-10-30T16:59:59.999Z') })
  const d1 = await mk({ deadline: new Date('2026-10-31T16:59:59.999Z') })
  const midnight = await mk({ deadline: new Date('2026-10-30T17:00:00.000Z') }) // 00.00 WIB 31 Okt = hari berikutnya
  await mk({ deadline: new Date('2026-11-01T16:59:59.999Z') }) // H-2: belum
  await mk({ deadline: new Date('2026-10-29T16:59:59.999Z') }) // kemarin: lewat
  await mk({ deadline: new Date('2026-10-30T16:59:59.999Z'), pays: ['pending'] })
  await mk({ deadline: new Date('2026-10-30T16:59:59.999Z'), confirmed: true })
  await mk({ deadline: new Date('2026-10-30T16:59:59.999Z'), status: 'cancelled' })
  await mk({ deadline: new Date('2026-10-30T16:59:59.999Z'), status: 'draft' })
  const got = (await dueReminders(now)).filter(r => ids.includes(r.id)).map(r => [r.id, r.kind] as const).sort((a, b) => a[0].localeCompare(b[0]))
  assert.deepEqual(got, ([[d0, 'd0'], [d1, 'd1'], [midnight, 'd1']] as const).slice().sort((a, b) => a[0].localeCompare(b[0])))
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────
await t('PENJAGA: draf tak pernah sampai ke jamaah (daftar, detail, API, invoice); batal-sendiri & unggah bukti mengunci baris lalu memeriksa ULANG status', () => {
  for (const f of ['app/[locale]/(pilgrim)/dashboard/page.tsx', 'app/[locale]/(pilgrim)/bookings/[id]/page.tsx', 'app/api/v1/bookings/route.ts', 'app/api/v1/bookings/[id]/route.ts']) assert.match(read(f), /status: \{ not: 'draft' \}/, f)
  assert.match(read('app/api/v1/bookings/[id]/invoice/route.ts'), /status === 'draft'/)
  const cancel = read('app/api/v1/bookings/[id]/route.ts')
  assert.match(cancel, /FOR UPDATE/); assert.match(cancel, /isPilgrimCancellable\(booking\)/)
  const del = cancel.slice(cancel.indexOf('export async function DELETE'))
  assert.match(del, /userId: session\.userId, status: \{ not: 'draft' \}/, 'DELETE: draf = 404 (SEC-120)')
  assert.ok(del.indexOf("status: 'pending'") > del.indexOf('FOR UPDATE'), 'DELETE: bukti menunggu → tolak, diperiksa DI DALAM kunci (SEC-119)')
  assert.match(cancel, /const \{ confirmedById: _staff, \.\.\.visible \} = booking/, 'GET: id staf tak dikirim ke jamaah (SEC-120)')
  assert.ok(!/ok\(\{ \.\.\.booking,/.test(cancel), 'GET tak lagi menyebar baris booking mentah')
  const bukti = read('app/api/v1/bookings/[id]/payment/bukti/route.ts')
  assert.match(bukti, /FOR UPDATE/); assert.match(bukti, /fresh\.status !== 'active' \|\| fresh\.confirmedAt !== null/)
  assert.match(bukti, /userId: session\.userId, status: \{ not: 'draft' \}/, 'bukti: draf = 404')
  assert.ok((bukti.match(/discardUpload\(uploaded, filePath\)/g) ?? []).length >= 2, 'bukti: berkas dibuang bila ditolak di dalam kunci atau transaksi gagal (SEC-122)')
})
await t('PENJAGA: cron memakai zona aplikasi + dimuat SETELAH zona dimuat; tak ada lagi pembatalan otomatis 24 jam; hangus lewat cancelBooking(…, expired); proses pembayaran memeriksa active+belum dikonfirmasi', () => {
  const job = read('lib/cron/bookingLifecycleJob.ts')
  assert.match(job, /getAppTimezone\(\)/); assert.match(job, /\{ timezone \}/)
  assert.match(read('instrumentation-node.ts'), /await loadAppTimezone\(\)\s*\n\s*startBookingLifecycleJobs\(\)/)
  assert.ok(!/autocancelJob|startAutoCancelJob/.test(read('instrumentation-node.ts')))
  assert.match(read('lib/booking/expire.ts'), /cancelBooking\(tx, booking, '[^']+', 'expired'\)/)
  assert.match(read('lib/booking/expire.ts'), /FOR UPDATE/)
  assert.match(read('lib/payments/process.ts'), /booking\.status !== 'active' \|\| booking\.confirmedAt !== null/)
  assert.match(read('lib/payments/process.ts'), /confirmedAt: new Date\(\), confirmedById: input\.byUserId/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────
await setExpire(settings.expireDaysBeforeReference)
await prisma.refund.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.booking.deleteMany({ where: { id: { in: ids } } })
await prisma.user.deleteMany({ where: { id: { in: [user.id, staff.id] } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
