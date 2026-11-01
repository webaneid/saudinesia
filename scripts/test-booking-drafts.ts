// Form booking admin (docs/arsitektur-booking-engine-v2.md §10.3, Fase 5) terhadap DATABASE SUNGGUHAN: draf (buat/simpan/basi/hapus), pratinjau = simulasi terbit yang
// di-ROLLBACK (angka sama dengan terbit, tak ada sisa tulisan maupun kuota), terbit (kuota ditahan sekali, harga dibekukan, jamaah kosong + rencana tanggal visa,
// jatuh tempo), terbit serentak (tepat satu), aturan visa & kuota sebagai galat terarah, validasi/kelengkapan data jamaah, CHECK DB, dan penjaga sumber.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createDraft, deleteDraft, previewDraft, publishDraft, readDraft, saveDraft } from '@/lib/booking/drafts'
import { bookingDraftSchema, type BookingDraft } from '@/lib/validators/booking'
import { completeness, validateFieldValues, type FieldDef } from '@/lib/manifest/values'
import { calendarDateOf, todayInApp, addDays } from '@/lib/time'
import { createCostActual, CostActualError } from '@/lib/costs/actuals'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `dr${Date.now()}`
const n = (v: unknown) => (v == null ? null : Number(v))
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]

// ── murni ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const id = '00000000-0000-4000-8000-000000000001'
await t('skema draf: ketat (kolom harga/total/status liar ditolak), Haji ditolak, minimal 1 jamaah, kuantitas = selisih tanggal', () => {
  const ok = (d: unknown) => bookingDraftSchema.safeParse(d).success
  assert.equal(ok({ items: [], pilgrims: [{}] }), true)
  assert.equal(ok({ items: [], pilgrims: [{}], totalAmount: 1 }), false)
  assert.equal(ok({ items: [], pilgrims: [{ visaProductId: id, price: 1 }] }), false)
  assert.equal(ok({ items: [], pilgrims: [] }), false)
  assert.equal(ok({ items: [{ itemType: 'haji', hajiProductId: id, numPersons: 1 }], pilgrims: [{}] }), false)
  assert.equal(ok({ items: [{ itemType: 'hotel', hotelRoomScheduleId: id, checkIn: '2090-06-01', checkOut: '2090-06-04', nights: 1, numRooms: 1 }], pilgrims: [{}] }), false, 'malam ≠ selisih tanggal')
  assert.equal(readDraft({ rusak: true }).pilgrims.length, 1, 'isi rusak dibaca sebagai draf kosong')
})
await t('nilai jamaah: bentuk per jenis field, kunci tak dikenal DITOLAK, kosong = null; kelengkapan hanya menghitung field wajib', () => {
  const fields: FieldDef[] = [
    { fieldKey: 'fullName', label: 'Nama', fieldType: 'text', required: true, options: null },
    { fieldKey: 'gender', label: 'Jenis kelamin', fieldType: 'select', required: true, options: [{ value: 'male', label: 'L' }, { value: 'female', label: 'P' }] },
    { fieldKey: 'email', label: 'Email', fieldType: 'email', required: false, options: null },
    { fieldKey: 'dob', label: 'Lahir', fieldType: 'date', required: false, options: null },
    { fieldKey: 'phone', label: 'HP', fieldType: 'phone', required: true, options: null },
  ]
  const good = validateFieldValues(fields, { fullName: ' Ahmad ', gender: 'male', email: '', dob: '1990-02-03', phone: { countryCode: 'ID', number: '81234' } })
  assert.ok(good.ok); assert.deepEqual(good.ok && good.values, { fullName: 'Ahmad', gender: 'male', email: null, dob: '1990-02-03', phone: { countryCode: 'ID', number: '81234' } })
  for (const [bad, key] of [[{ gender: 'x' }, 'gender'], [{ email: 'bukan-email' }, 'email'], [{ dob: '03-02-1990' }, 'dob'], [{ phone: { countryCode: 'ID', number: 'abc' } }, 'phone'], [{ rahasia: 'x' }, 'rahasia']] as const) {
    const r = validateFieldValues(fields, bad)
    assert.ok(!r.ok && key in r.errors, JSON.stringify(bad))
  }
  assert.deepEqual(completeness(fields, { fullName: 'A', phone: { countryCode: 'ID', number: '' } }), { required: 3, filled: 1, missing: ['Jenis kelamin', 'HP'], complete: false })
  assert.equal(completeness(fields, { fullName: 'A', gender: 'male', phone: { countryCode: 'ID', number: '8' } }).complete, true)
})

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
async function addCost(productType: string, productId: string, component: string, cost: number) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: flat(cost) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } })
}
const customer = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pelanggan Draf', role: 'pilgrim', isActive: true } })
const staff = await prisma.user.create({ data: { email: `${tag}-staf@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 5 } })
await addCost('flight', flight.id, 'tiket', 5_000_000); await repriceOwner('flight', flight.id) // jual 6.000.000
const visa = await prisma.visaProduct.create({ data: { name: `${tag} Visa`, visaType: 'Umroh', requiredComponents: [{ type: 'flight' }] } })
await addCost('visa', visa.id, 'visa', 1_000_000); await repriceOwner('visa', visa.id) // jual 1.200.000

const seats = () => prisma.flightSchedule.findUniqueOrThrow({ where: { id: flight.id }, select: { pendingSeats: true } }).then(s => s.pendingSeats)
const fl = (date: string, numPassengers: number) => ({ itemType: 'flight' as const, flightScheduleId: flight.id, departureDate: date, numPassengers })
const DRAFT: BookingDraft = { items: [fl('2090-06-10', 2)], pilgrims: [{ visaProductId: visa.id }, { visaProductId: visa.id }], dueDays: 3 }
const residue = async (bookingId: string) => ({
  flights: await prisma.bookingFlight.count({ where: { bookingId } }), pilgrims: await prisma.bookingPilgrim.count({ where: { bookingId } }),
  snapshots: await prisma.priceSnapshot.count({ where: { bookingId } }),
})
const drafts: string[] = []
async function newDraft(d: BookingDraft = DRAFT) {
  const r = await createDraft(customer.id); assert.ok(r.ok); drafts.push(r.id)
  assert.ok((await saveDraft(r.id, d)).ok)
  return r.id
}

await t('buat draf: hanya untuk pelanggan (staf → 404); baris draft tanpa item/kuota/total; isi draf tersimpan dan dibaca kembali', async () => {
  assert.deepEqual(await createDraft(staff.id), { ok: false, status: 404, message: 'Pelanggan tidak ditemukan' })
  const did = await newDraft()
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: did } })
  assert.deepEqual([b.status, n(b.totalAmount), b.departureDate, b.confirmedAt], ['draft', 0, null, null])
  assert.deepEqual(readDraft(b.draft), DRAFT)
  assert.deepEqual(await residue(did), { flights: 0, pilgrims: 0, snapshots: 0 })
})
await t('simpan draf: expectedUpdatedAt basi → 409 tanpa menimpa; draf yang sudah terbit tak bisa disimpan (404)', async () => {
  const did = await newDraft()
  const before = await prisma.booking.findUniqueOrThrow({ where: { id: did }, select: { updatedAt: true } })
  assert.ok((await saveDraft(did, { ...DRAFT, dueDays: 5 }, before.updatedAt.toISOString())).ok)
  const stale = await saveDraft(did, { ...DRAFT, dueDays: 9 }, before.updatedAt.toISOString())
  assert.equal(stale.ok === false && stale.status, 409)
  assert.equal(readDraft((await prisma.booking.findUniqueOrThrow({ where: { id: did } })).draft).dueDays, 5)
})
await t('PRATINJAU: baris + total = mesin pesan; SEMUA tulisan di-rollback (tak ada item/jamaah/snapshot, kursi tak tertahan, status & total draf tetap)', async () => {
  const did = await newDraft()
  const s0 = await seats()
  const r = await previewDraft(did)
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  assert.equal(r.preview.total, 2 * 6_000_000 + 2 * 1_200_000)
  assert.equal(r.preview.dueDays, 3)
  assert.ok(r.preview.lines.some(l => l.label.startsWith('Tiket')) && r.preview.lines.filter(l => l.label.includes('Visa')).length === 2, JSON.stringify(r.preview.lines))
  assert.deepEqual(await residue(did), { flights: 0, pilgrims: 0, snapshots: 0 })
  assert.equal(await seats(), s0)
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: did } })
  assert.deepEqual([b.status, n(b.totalAmount), b.departureDate], ['draft', 0, null])
})
await t('PRATINJAU isi belum disimpan (editor baris): override dipakai, total per item urut masukan, draf tersimpan TIDAK berubah', async () => {
  const did = await newDraft()
  const before = await prisma.booking.findUniqueOrThrow({ where: { id: did }, select: { draft: true, updatedAt: true } })
  const r = await previewDraft(did, { ...DRAFT, items: [fl('2090-06-10', 1), fl('2090-06-12', 3)] })
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  assert.deepEqual(r.preview.itemTotals, [6_000_000, 18_000_000])
  assert.equal(r.preview.total, 4 * 6_000_000 + 2 * 1_200_000)
  const after = await prisma.booking.findUniqueOrThrow({ where: { id: did }, select: { draft: true, updatedAt: true } })
  assert.deepEqual([readDraft(after.draft), after.updatedAt.getTime()], [readDraft(before.draft), before.updatedAt.getTime()])
  assert.deepEqual(await residue(did), { flights: 0, pilgrims: 0, snapshots: 0 })
})
await t('PRATINJAU: aturan visa tak terpenuhi → 422 + pelanggaran; kursi kurang → 409; draf tanpa produk → 422; tanggal di luar periode → 422; galat item membawa nomor barisnya', async () => {
  const noFlight = await newDraft({ items: [], pilgrims: [{ visaProductId: visa.id }] })
  const v = await previewDraft(noFlight)
  assert.ok(!v.ok && v.status === 422 && v.violations?.[0]?.missing === 'flight', JSON.stringify(v))
  const tooMany = await newDraft({ items: [fl('2090-06-10', 9)], pilgrims: [{}] })
  const q = await previewDraft(tooMany)
  assert.ok(!q.ok && q.status === 409, JSON.stringify(q))
  const empty = await newDraft({ items: [], pilgrims: [{}] })
  assert.deepEqual(await previewDraft(empty), { ok: false, status: 422, message: 'Tambahkan minimal satu produk' })
  const out = await newDraft({ items: [fl('2090-06-10', 1), fl('2090-07-10', 1)], pilgrims: [{}] })
  const o = await previewDraft(out)
  assert.ok(!o.ok && o.status === 422 && /periode jadwal/.test(o.message))
  assert.equal(!o.ok && o.itemIndex, 1, 'galat menunjuk baris ke-2 (editor baris menandai baris itu)')
  assert.equal(!q.ok && q.itemIndex, 0, 'kuota kurang menunjuk barisnya')
  assert.equal(!v.ok && v.itemIndex, undefined, 'pelanggaran aturan visa bukan galat baris')
})
await t('TERBIT: status aktif, draf dikosongkan, kursi ditahan SEKALI, total = pratinjau, jatuh tempo dari draf, jamaah dibuat kosong + rencana tanggal visa = tiket pergi', async () => {
  const did = await newDraft()
  const s0 = await seats()
  const p = await previewDraft(did)
  const r = await publishDraft(did, { byUserId: staff.id })
  assert.ok(r.ok, JSON.stringify(r))
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: did }, include: { pilgrims: { include: { visaApplication: true } } } })
  assert.deepEqual([b.status, b.draft, n(b.totalAmount)], ['active', null, p.ok ? p.preview.total : -1])
  assert.equal(await seats(), s0 + 2)
  assert.equal(calendarDateOf(b.paymentDeadline!) >= addDays(todayInApp(), 3), true)
  assert.equal(b.pilgrims.length, 2)
  for (const pg of b.pilgrims) {
    assert.deepEqual(pg.fieldValues, {})
    assert.equal(calendarDateOf(pg.visaApplication!.plannedTravelDate!), '2090-06-10')
  }
  assert.deepEqual([calendarDateOf(b.departureDate!), (await residue(did)).snapshots > 0], ['2090-06-10', true])
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { pendingSeats: s0 } })
})
await t('TERBIT ganda: terbit kedua → 404/409 tanpa menahan kuota lagi; dua terbit SERENTAK → tepat satu berhasil; draf yang sudah terbit tak bisa dihapus', async () => {
  const did = await newDraft()
  const s0 = await seats()
  assert.ok((await publishDraft(did, { byUserId: staff.id })).ok)
  const again = await publishDraft(did, { byUserId: staff.id })
  assert.equal(again.ok, false)
  assert.equal(await seats(), s0 + 2)
  assert.equal((await deleteDraft(did)).ok, false)
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { pendingSeats: s0 } })

  const race = await newDraft()
  const results = await Promise.all([publishDraft(race, { byUserId: staff.id }), publishDraft(race, { byUserId: staff.id })])
  assert.equal(results.filter(x => x.ok).length, 1, JSON.stringify(results))
  assert.equal(await seats(), s0 + 2, 'kuota ditahan sekali')
  assert.equal(await prisma.bookingFlight.count({ where: { bookingId: race } }), 1)
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { pendingSeats: s0 } })
})
await t('HAPUS draf: hapus sungguhan (baris hilang); id booking aktif → 404; CHECK DB: kolom draft hanya boleh terisi saat status draft', async () => {
  const did = await newDraft()
  assert.deepEqual(await deleteDraft(did), { ok: true })
  assert.equal(await prisma.booking.count({ where: { id: did } }), 0)
  assert.ok(await prisma.booking.count({ where: { userId: customer.id, status: 'active' } }) > 0, 'ada booking aktif hasil uji terbit')
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE bookings SET draft = '{"items":[]}' WHERE status = 'active' AND "userId" = '${customer.id}'`), /bookings_draft_only_in_draft|check/i)
})

await t('TERBIT terikat versi yang dipratinjau: expectedUpdatedAt basi (tab lain menyimpan) → 409 tanpa menahan kursi; versi terkini → terbit', async () => {
  const did = await newDraft()
  const seen = (await prisma.booking.findUniqueOrThrow({ where: { id: did }, select: { updatedAt: true } })).updatedAt.toISOString()
  assert.ok((await saveDraft(did, { ...DRAFT, dueDays: 7 })).ok) // tab lain
  const s0 = await seats()
  const stale = await publishDraft(did, { expectedUpdatedAt: seen, byUserId: staff.id })
  assert.ok(!stale.ok && stale.status === 409, JSON.stringify(stale))
  assert.equal(await seats(), s0)
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: did } })).status, 'draft')
  const now = (await prisma.booking.findUniqueOrThrow({ where: { id: did }, select: { updatedAt: true } })).updatedAt.toISOString()
  assert.ok((await publishDraft(did, { expectedUpdatedAt: now, byUserId: staff.id })).ok)
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { pendingSeats: s0 } })
})
await t('TERBIT ditolak untuk akun NONAKTIF atau TERHAPUS (UU PDP) sesudah draf dibuat — 409, draf tetap draf, kursi tak tertahan; buat draf untuk akun nonaktif → 409', async () => {
  const other = await prisma.user.create({ data: { email: `${tag}-lain@example.test`, passwordHash: 'x', fullName: 'Pelanggan Lain', role: 'pilgrim', isActive: true } })
  try {
    const c = await createDraft(other.id); assert.ok(c.ok)
    assert.ok((await saveDraft(c.id, DRAFT)).ok)
    const s0 = await seats()
    await prisma.user.update({ where: { id: other.id }, data: { isActive: false } })
    assert.equal(await createDraft(other.id).then(r => !r.ok && r.status), 409)
    const off = await publishDraft(c.id, { byUserId: staff.id })
    assert.ok(!off.ok && off.status === 409 && /nonaktif/.test(off.message), JSON.stringify(off))
    await prisma.user.update({ where: { id: other.id }, data: { isActive: true, email: `deleted-${other.id}@deleted.invalid` } })
    const gone = await publishDraft(c.id, { byUserId: staff.id })
    assert.ok(!gone.ok && gone.status === 409 && /dihapus/.test(gone.message), JSON.stringify(gone))
    assert.deepEqual([(await prisma.booking.findUniqueOrThrow({ where: { id: c.id } })).status, await seats()], ['draft', s0])
  } finally {
    await prisma.booking.deleteMany({ where: { userId: other.id } })
    await prisma.user.delete({ where: { id: other.id } })
  }
})
await t('pengeluaran vendor TIDAK bisa dicatat pada draf (draf dapat dihapus sungguhan → jejak uang keluar akan hilang) → 409', async () => {
  const did = await newDraft()
  await assert.rejects(
    () => createCostActual({ bookingId: did, vendorId: vendor.id, component: 'tiket', currency: 'IDR', amount: 1000, paidAt: todayInApp(), byUserId: staff.id }),
    (e: unknown) => e instanceof CostActualError && e.status === 409,
  )
  assert.equal(await prisma.costActual.count({ where: { bookingId: did } }), 0)
})

await t('KODE BOOKING: setelah draf di TENGAH dihapus, booking baru tetap dapat dibuat (urut tertinggi + 1, bukan jumlah + 1); 6 pembuatan SERENTAK → 6 kode berbeda', async () => {
  const a = await newDraft(); const b = await newDraft(); const c = await newDraft()
  const codes = await prisma.booking.findMany({ where: { id: { in: [a, b, c] } }, select: { bookingCode: true } })
  assert.ok((await deleteDraft(b)).ok)
  const d = await createDraft(customer.id)
  assert.ok(d.ok, JSON.stringify(d)); if (!d.ok) return
  drafts.push(d.id)
  const top = Math.max(...codes.map(x => Number(x.bookingCode.split('-')[2])))
  assert.equal(Number(d.bookingCode.split('-')[2]), top + 1)
  const many = await Promise.all(Array.from({ length: 6 }, () => createDraft(customer.id)))
  assert.ok(many.every(r => r.ok), JSON.stringify(many))
  assert.equal(new Set(many.map(r => r.ok && r.bookingCode)).size, 6)
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
await t('PENJAGA: satu mesin pesan (route jamaah + draf memakai prepareBooking/writeBooking); pratinjau selalu rollback; terbit mengunci & membaca ulang; route admin memakai requireBookingManage', () => {
  const engine = read('lib/booking/create.ts'); const dr = read('lib/booking/drafts.ts'); const route = read('app/api/v1/bookings/route.ts')
  assert.match(route, /prepareBooking\(/); assert.match(route, /writeBooking\(tx, prepared, bk\.id\)/)
  assert.match(dr, /throw new Rollback\(/); assert.match(dr, /if \(e instanceof Rollback\) return \{ ok: true, preview: e\.result \}/)
  assert.ok(dr.indexOf('lockDraft(tx, id)', dr.indexOf('export async function publishDraft')) > 0, 'terbit mengunci draf')
  assert.match(dr, /row\.status !== 'draft'/)
  assert.match(engine, /export async function writeBooking/)
  for (const f of ['app/api/v1/admin/bookings/drafts/route.ts', 'app/api/v1/admin/bookings/drafts/[id]/route.ts', 'app/api/v1/admin/bookings/drafts/[id]/preview/route.ts', 'app/api/v1/admin/bookings/drafts/[id]/publish/route.ts', 'app/api/v1/admin/bookings/catalog/route.ts', 'app/api/v1/admin/bookings/[id]/pilgrims/[pilgrimId]/route.ts']) {
    assert.match(read(f), /await requireBookingManage\(\)/, f)
  }
  assert.doesNotMatch(read('app/api/v1/admin/bookings/drafts/[id]/publish/route.ts'), /notify\(/, 'K5-1: tak ada notifikasi saat terbit di Fase 5')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { userId: customer.id } })
await prisma.visaProduct.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.flightSchedule.deleteMany({ where: { routeId: route.id } })
await prisma.flightRoute.delete({ where: { id: route.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { id: { in: [customer.id, staff.id] } } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
