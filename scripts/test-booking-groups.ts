// Rombongan dalam satu booking (docs/arsitektur-booking-engine-v2.md §10.8, Fase 11d-1) terhadap DATABASE SUNGGUHAN:
// bentuk rombongan (skema draf + mesin), jumlah orang item DITURUNKAN dari ukuran sasaran (masukan diabaikan), tamu hotel = ukuran sasaran, rencana berangkat
// visa per rombongan, aturan Visa Plus per rombongan (K11d-1 = a), anggota paket per rombongan, FK komposit (rombongan booking lain ditolak DB), CHECK nama,
// revisi booking berrombongan (11d-2a: pindah jamaah, rombongan baru/ganti nama/ditiadakan, Visa Plus per rombongan), dan booking tanpa rombongan tidak berubah.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { prepareBooking, RuleViolationError, writeBooking, type BookingInput } from '@/lib/booking/create'
import { groupLabel, groupView, normalizeGroups, scopeToGroup } from '@/lib/booking/groups'
import { buildInvoiceData, invoiceBookingInclude } from '@/lib/pdf/invoiceData'
import { generateInvoicePdf } from '@/lib/pdf/invoice'
import { bookingFailure, simulateBooking } from '@/lib/booking/simulate'
import { previewRevision, reviseBooking, revisionEditorState, RevisionError } from '@/lib/booking/revise'
import { createDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import { bookingSnapshotTotals } from '@/lib/pricing/engine/snapshot'
import { withBookingCode } from '@/lib/utils/bookingCode'
import { bookingDraftSchema, bookingRevisionSchema, type BookingDraft, type BookingRevisionInput } from '@/lib/validators/booking'
import { calendarDateOf } from '@/lib/time'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `grp${Date.now()}`
const cents = (x: number) => Math.round(x * 100)
const U = '00000000-0000-4000-8000-000000000001'

// ── murni ────────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('normalizeGroups: jumlah orang item = ukuran sasaran (masukan diabaikan); tamu hotel tak punya kolom orang; tanpa rombongan = apa adanya', () => {
  const base: BookingInput = {
    groups: [{}, {}],
    pilgrims: [{ group: 0 }, { group: 0 }, { group: 0 }, { group: 1 }],
    items: [
      { itemType: 'flight', flightScheduleId: U, departureDate: '2090-06-05', numPassengers: 99, group: 0 },
      { itemType: 'transport', transportQuotaId: U, numPassengers: 1, group: 1 },
      { itemType: 'muthowif', startDate: '2090-06-05', endDate: '2090-06-06', numDays: 2, numPeople: 7 },
      { itemType: 'hotel', hotelRoomScheduleId: U, checkIn: '2090-06-05', checkOut: '2090-06-07', nights: 2, numRooms: 3 },
    ],
  }
  const n = normalizeGroups(base)
  assert.deepEqual(n.items.map(i => (i.itemType === 'flight' || i.itemType === 'transport' ? i.numPassengers : i.itemType === 'muthowif' ? i.numPeople : i.itemType === 'hotel' ? i.numRooms : -1)), [3, 1, 4, 3])
  assert.equal(n.totalPilgrims, 4)
  const plain: BookingInput = { pilgrims: [{}, {}], items: [{ itemType: 'transport', transportQuotaId: U, numPassengers: 5 }] }
  assert.equal(normalizeGroups(plain), plain, 'tanpa rombongan: objek yang sama')
})

await t('normalizeGroups menolak bentuk tak sah: rujukan tanpa groups, satu rombongan, jamaah tanpa rombongan, indeks di luar, rombongan kosong', () => {
  const bad: BookingInput[] = [
    { pilgrims: [{ group: 0 }], items: [] },
    { pilgrims: [{}], items: [{ itemType: 'transport', transportQuotaId: U, numPassengers: 1, group: 0 }] },
    { groups: [{}], pilgrims: [{ group: 0 }], items: [] },
    { groups: [{}, {}], pilgrims: [{ group: 0 }, {}], items: [] },
    { groups: [{}, {}], pilgrims: [{ group: 0 }, { group: 2 }], items: [] },
    { groups: [{}, {}], pilgrims: [{ group: 0 }, { group: 1 }], items: [{ itemType: 'transport', transportQuotaId: U, numPassengers: 1, group: 5 }] },
    { groups: [{}, { label: 'Kosong' }], pilgrims: [{ group: 0 }], items: [] },
  ]
  for (const b of bad) assert.throws(() => normalizeGroups(b), (e: unknown) => bookingFailure(e).status === 422, JSON.stringify(b))
})

await t('bookingDraftSchema: rombongan sah diterima; bentuk tak sah ditolak per kolom; nama ≤ 60 tanpa karakter kontrol; kunci liar ditolak', () => {
  const ok = (v: unknown) => bookingDraftSchema.safeParse(v).success
  const pilgrims = [{ group: 0 }, { group: 1 }]
  assert.equal(ok({ items: [], pilgrims, groups: [{ label: 'Keluarga Pak Ahmad' }, { plannedTravelDate: '2090-06-08' }] }), true)
  assert.equal(ok({ items: [], pilgrims: [{}, {}] }), true, 'tanpa rombongan tetap sah')
  assert.equal(ok({ items: [], pilgrims, groups: [{}] }), false, 'satu rombongan')
  assert.equal(ok({ items: [], pilgrims: [{ group: 0 }, {}], groups: [{}, {}] }), false, 'jamaah tanpa rombongan')
  assert.equal(ok({ items: [], pilgrims: [{ group: 0 }, { group: 0 }], groups: [{}, {}] }), false, 'rombongan kosong')
  assert.equal(ok({ items: [], pilgrims: [{ group: 0 }], groups: undefined }), false, 'rujukan tanpa groups')
  assert.equal(ok({ items: [], pilgrims, groups: [{ label: 'x'.repeat(61) }, {}] }), false)
  assert.equal(ok({ items: [], pilgrims, groups: [{ label: 'baris\nbaru' }, {}] }), false)
  assert.equal(ok({ items: [], pilgrims, groups: [{ label: 'A', price: 1 }, {}] }), false)
  assert.equal(ok({ items: [{ itemType: 'transport', transportQuotaId: U, numPassengers: 1, group: 2 }], pilgrims, groups: [{}, {}] }), false)
  assert.equal(groupLabel(null, 0), 'Rombongan A'); assert.equal(groupLabel('', 1), 'Rombongan B'); assert.equal(groupLabel('Keluarga', 0), 'Keluarga'); assert.equal(groupLabel(null, 26), 'Rombongan 27')
})

await t('scopeToGroup: item rombongan + item semua; paket/ziarah tersaring sejalan urutannya; jamaah rombongan saja', () => {
  const data: BookingInput = {
    groups: [{}, {}],
    pilgrims: [{ group: 0 }, { group: 1 }, { group: 1 }],
    items: [
      { itemType: 'package', packageId: U, departureId: U, numPeople: 1, choices: {}, group: 0 },
      { itemType: 'flight', flightScheduleId: U, departureDate: '2090-06-05', numPassengers: 3 },
      { itemType: 'package', packageId: U, departureId: U, numPeople: 2, choices: {}, group: 1 },
    ],
  }
  const s = scopeToGroup(data, ['P0', 'P1'], [], 1)
  assert.deepEqual(s.data.items.map(i => i.itemType), ['flight', 'package']); assert.deepEqual(s.packages, ['P1']); assert.equal(s.data.pilgrims.length, 2)
})

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Rombongan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
async function addCost(productType: string, productId: string, component: string, cost: number) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost }] as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } }).catch(() => undefined)
}
const visa = await prisma.visaProduct.create({ data: { name: `${tag} Visa Mandiri`, visaType: 'Umroh' } })
await addCost('visa', visa.id, 'visa', 1_000_000); await repriceOwner('visa', visa.id)
const visaPlus = await prisma.visaProduct.create({ data: { name: `${tag} Visa Plus`, visaType: 'Umroh', requiredComponents: [{ type: 'flight' }] } })
await addCost('visa', visaPlus.id, 'visa', 1_000_000); await repriceOwner('visa', visaPlus.id)
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: `${tag} JED` } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 20 } })
await addCost('flight', flight.id, 'tiket', 5_000_000); await repriceOwner('flight', flight.id)
const roomType = await prisma.roomType.create({ data: { name: `${tag} quad`, defaultCapacity: 4 } })
const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'madinah' } })
const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
const room = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 50 } })
await addCost('hotel', room.id, 'kamar', 1_000_000); await repriceOwner('hotel', room.id)
const trip = await prisma.transportTrip.create({ data: { name: `${tag} bandara`, category: 'airport', origin: 'JED', destination: 'Makkah' } })
const van = await prisma.transportVehicle.create({ data: { name: `${tag} van`, vehicleType: 'van', capacity: 10 } })
const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: van.id } })
await addCost('transport', pricing.id, 'sewa', 800_000); await repriceOwner('transport', pricing.id)
const quota = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2090-06-08'), totalSeats: 10 } })
const pkg = await prisma.package.create({ data: { name: `${tag} Paket`, durationDays: 9 } })
const pkgDep = await prisma.packageDeparture.create({ data: { packageId: pkg.id, departureDate: new Date('2090-06-05'), totalSeats: 100 } }) // K1 (DB uji)
await addCost('package', pkg.id, 'handling', 500_000); await repriceOwner('package', pkg.id)

async function place(input: BookingInput): Promise<string> {
  const prepared = await prepareBooking(input)
  return withBookingCode(async (tx, bookingCode) => {
    const bk = await tx.booking.create({ data: { bookingCode, userId: user.id, status: 'active', season: 'regular', totalAmount: 0 } })
    await writeBooking(tx, prepared, bk.id)
    return bk.id
  }, { isolationLevel: 'Serializable' })
}
const failOf = async (input: BookingInput) => {
  try { await place(input) } catch (e) { return bookingFailure(e) }
  assert.fail('seharusnya ditolak')
}

// Rombongan A (3 orang, Visa Plus, tiket tgl 5) + rombongan B (2 orang, visa mandiri, transport tgl 8, rencana visa tgl 20) + hotel untuk SEMUA (bertemu di Madinah).
const TWO: BookingInput = {
  groups: [{ label: 'Keluarga Pak Ahmad' }, { plannedTravelDate: '2090-06-20' }],
  pilgrims: [
    { group: 0, visaProductId: visaPlus.id }, { group: 0, visaProductId: visaPlus.id }, { group: 0, visaProductId: visaPlus.id },
    { group: 1, visaProductId: visa.id }, { group: 1, visaProductId: visa.id },
  ],
  items: [
    { itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-05', numPassengers: 1, group: 0 },
    { itemType: 'transport', transportQuotaId: quota.id, numPassengers: 9, group: 1 },
    { itemType: 'hotel', hotelRoomScheduleId: room.id, checkIn: '2090-06-10', checkOut: '2090-06-12', nights: 2, numRooms: 2 },
  ],
}

let bookingId = ''
await t('dua rombongan: pratinjau = pesanan; baris rombongan + nama; jumlah orang item = ukuran sasaran; tamu hotel = semua; jamaah tertaut rombongannya', async () => {
  const preview = await simulateBooking({ userId: user.id }, TWO, 3)
  bookingId = await place(TWO)
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      totalAmount: true,
      groups: { orderBy: { position: 'asc' }, select: { id: true, position: true, label: true, plannedTravelDate: true } },
      flights: { select: { numPassengers: true, groupId: true } }, transports: { select: { numPassengers: true, groupId: true } },
      hotels: { select: { numGuests: true, numRooms: true, groupId: true } },
      pilgrims: { orderBy: { id: 'asc' }, select: { groupId: true, visaApplication: { select: { visaProductId: true, plannedTravelDate: true } } } },
    },
  })
  assert.equal(Number(b.totalAmount), preview.total, 'pratinjau = pesanan')
  const [a, bb] = b.groups
  assert.deepEqual(b.groups.map(g => [g.position, g.label]), [[1, 'Keluarga Pak Ahmad'], [2, null]])
  assert.equal(calendarDateOf(bb!.plannedTravelDate!), '2090-06-20')
  assert.deepEqual(b.flights, [{ numPassengers: 3, groupId: a!.id }], 'tiket rombongan A = 3 orang (masukan 1 diabaikan)')
  assert.deepEqual(b.transports, [{ numPassengers: 2, groupId: bb!.id }], 'transport rombongan B = 2 orang (masukan 9 diabaikan)')
  assert.deepEqual(b.hotels, [{ numGuests: 5, numRooms: 2, groupId: null }], 'hotel untuk semua: 5 tamu, kamar bebas')
  assert.deepEqual(b.pilgrims.map(p => p.groupId).sort(), [a!.id, a!.id, a!.id, bb!.id, bb!.id].sort())
  const byGroup = (gid: string) => b.pilgrims.filter(p => p.groupId === gid)
  assert.ok(byGroup(a!.id).every(p => p.visaApplication?.visaProductId === visaPlus.id && calendarDateOf(p.visaApplication.plannedTravelDate!) === '2090-06-05'), 'A: visa plus, berangkat = tiket A')
  assert.ok(byGroup(bb!.id).every(p => p.visaApplication?.visaProductId === visa.id && calendarDateOf(p.visaApplication.plannedTravelDate!) === '2090-06-20'), 'B: tanpa tiket → rencana rombongan, BUKAN tiket A')
  assert.equal((await prisma.flightSchedule.findUniqueOrThrow({ where: { id: flight.id } })).pendingSeats, 3, 'kursi tertahan = ukuran rombongan')
  assert.equal((await prisma.transportQuota.findUniqueOrThrow({ where: { id: quota.id } })).pendingSeats, 2)
})

await t('groupView: tanpa rombongan = null; nama dari label hidup, kosong → Rombongan A/B; NULL/tak dikenal = "Semua jamaah" urutan 0; urut posisi, bukan urutan baris', () => {
  assert.equal(groupView([]), null)
  const v = groupView([{ id: 'b', label: null, position: 2 }, { id: 'a', label: 'Kel. Ahmad', position: 1 }])!
  assert.deepEqual([v.name('a'), v.name('b'), v.name(null), v.name('x')], ['Kel. Ahmad', 'Rombongan B', 'Semua jamaah', 'Semua jamaah'])
  assert.deepEqual([v.rank(null), v.rank('a'), v.rank('b')], [0, 1, 2])
})

await t('invoice (11d-2b): bagian per rombongan — "Semua jamaah" dulu lalu urut posisi; nama dari label HIDUP (ganti nama → invoice ikut, snapshot tak berubah dan tak memuat nama); I4 tetap; PDF jadi', async () => {
  const load = () => prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: invoiceBookingInclude })
  const inv = await buildInvoiceData(await load())
  assert.deepEqual(inv.lineItems.map(l => [l.section, l.label.split(' — ')[0]]), [
    ['Semua jamaah', `${tag} hotel`],
    ['Keluarga Pak Ahmad', inv.lineItems[1]!.label], ...Array.from({ length: 3 }, () => ['Keluarga Pak Ahmad', `${tag} Visa Plus`]),
    ['Rombongan B', inv.lineItems[5]!.label], ...Array.from({ length: 2 }, () => ['Rombongan B', `${tag} Visa Mandiri`]),
  ])
  assert.match(inv.lineItems[1]!.label, /CGK/); assert.match(inv.lineItems[5]!.label, /bandara/)
  assert.equal(cents(inv.subtotal), cents(Number((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).totalAmount)), 'I4')
  const snapsBefore = JSON.stringify(await prisma.priceSnapshot.findMany({ where: { bookingId }, orderBy: { id: 'asc' } }))
  assert.ok(!snapsBefore.includes('Ahmad'), 'nama rombongan tidak pernah masuk snapshot')
  await prisma.bookingGroup.updateMany({ where: { bookingId, position: 2 }, data: { label: 'Rombongan Kantor' } })
  const renamed = await buildInvoiceData(await load())
  assert.deepEqual([...new Set(renamed.lineItems.map(l => l.section))], ['Semua jamaah', 'Keluarga Pak Ahmad', 'Rombongan Kantor'])
  assert.equal(JSON.stringify(await prisma.priceSnapshot.findMany({ where: { bookingId }, orderBy: { id: 'asc' } })), snapsBefore, 'snapshot tak tersentuh')
  await prisma.bookingGroup.updateMany({ where: { bookingId, position: 2 }, data: { label: null } })
  const pdf = await generateInvoicePdf(renamed)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})

await t('Visa Plus per rombongan (K11d-1 = a): tiket rombongan A tak memenuhi Visa Plus rombongan B → 422 berlabel rombongan; tiket untuk semua memenuhi keduanya', async () => {
  const before = await prisma.booking.count({ where: { userId: user.id } })
  const plusInB: BookingInput = { ...TWO, pilgrims: TWO.pilgrims.map(p => ({ ...p, visaProductId: visaPlus.id })) }
  const f = await failOf(plusInB)
  assert.equal(f.status, 422)
  assert.equal(f.violations?.length, 1, 'hanya rombongan B yang melanggar')
  assert.equal(f.violations?.[0]?.missing, 'flight'); assert.match(f.violations?.[0]?.message ?? '', /^Rombongan B: /)
  assert.equal(await prisma.booking.count({ where: { userId: user.id } }), before, 'tanpa booking tersisa')
  const forAll: BookingInput = { ...plusInB, items: plusInB.items.map(i => (i.itemType === 'flight' ? { ...i, group: undefined } : i)) }
  const p = await simulateBooking({ userId: user.id }, forAll, 3)
  assert.ok(p.total > 0)
})

await t('tanpa rombongan: perilaku lama — tiket satu-satunya memenuhi semua Visa Plus, tamu hotel = semua jamaah, tak ada baris rombongan', async () => {
  const plain: BookingInput = {
    pilgrims: [{ visaProductId: visaPlus.id }, { visaProductId: visaPlus.id }],
    items: [{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-06', numPassengers: 2 }, { itemType: 'hotel', hotelRoomScheduleId: room.id, checkIn: '2090-06-10', checkOut: '2090-06-11', nights: 1, numRooms: 1 }],
    totalPilgrims: 2,
  }
  const id = await place(plain)
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { groups: true, hotels: { select: { numGuests: true, groupId: true } }, pilgrims: { select: { groupId: true } } } })
  assert.deepEqual(b.groups, []); assert.deepEqual(b.hotels, [{ numGuests: 2, groupId: null }]); assert.ok(b.pilgrims.every(p => p.groupId === null))
  const inv = await buildInvoiceData(await prisma.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude }))
  assert.ok(inv.lineItems.length > 0 && inv.lineItems.every(l => !('section' in l)), 'invoice tanpa rombongan: tanpa bagian (tampilan lama)')
})

await t('DB: item/jamaah tak dapat menunjuk rombongan booking LAIN (FK komposit); nama rombongan dijaga CHECK (panjang, karakter kontrol, posisi ≥ 1)', async () => {
  const other = await place({ ...TWO, pilgrims: TWO.pilgrims.map(p => ({ group: p.group })), items: TWO.items.filter(i => i.itemType === 'hotel') })
  const otherGroup = await prisma.bookingGroup.findFirstOrThrow({ where: { bookingId: other } })
  const hotelRow = await prisma.bookingHotel.findFirstOrThrow({ where: { bookingId } })
  await assert.rejects(prisma.bookingHotel.update({ where: { id: hotelRow.id }, data: { groupId: otherGroup.id } }), 'rombongan booking lain')
  const pilgrimRow = await prisma.bookingPilgrim.findFirstOrThrow({ where: { bookingId } })
  await assert.rejects(prisma.bookingPilgrim.update({ where: { id: pilgrimRow.id }, data: { groupId: otherGroup.id } }), 'jamaah ke rombongan booking lain')
  await assert.rejects(prisma.bookingGroup.create({ data: { bookingId, position: 9, label: 'x'.repeat(61) } }))
  await assert.rejects(prisma.bookingGroup.create({ data: { bookingId, position: 9, label: 'a\nb' } }))
  await assert.rejects(prisma.bookingGroup.create({ data: { bookingId, position: 9, label: '' } }))
  await assert.rejects(prisma.bookingGroup.create({ data: { bookingId, position: 0 } }))
  await assert.rejects(prisma.bookingGroup.create({ data: { bookingId, position: 1 } }), 'posisi unik per booking')
})

await t('mesin memeriksa ulang bentuk rombongan sebelum resolusi/kuota: rombongan tanpa jamaah → 422, tanpa booking', async () => {
  const f = await failOf({ groups: [{}, {}], pilgrims: [{ group: 0 }], items: [] })
  assert.equal(f.status, 422); assert.match(f.message, /Rombongan B belum punya jamaah/)
})

await t('anggota Paket per rombongan: paket rombongan A → hanya jamaah A anggotanya (jumlah = ukuran A); campuran paket "semua" + "per rombongan" ditolak 422', async () => {
  const PKG = (group?: number) => ({ itemType: 'package' as const, packageId: pkg.id, departureId: pkgDep.id, numPeople: 1, choices: {}, ...(group === undefined ? {} : { group }) })
  const id = await place({ groups: [{}, {}], pilgrims: [{ group: 0 }, { group: 1 }, { group: 0 }], items: [PKG(0)] })
  const rows = await prisma.bookingPackage.findMany({ where: { bookingId: id }, select: { id: true, numPeople: true } })
  assert.equal(rows.length, 1); assert.equal(rows[0]!.numPeople, 2, 'jumlah = ukuran rombongan A')
  const ps = await prisma.bookingPilgrim.findMany({ where: { bookingId: id }, select: { bookingPackageId: true, group: { select: { position: true } } } })
  assert.ok(ps.every(p => (p.group?.position === 1) === (p.bookingPackageId === rows[0]!.id)), 'anggota paket = tepat jamaah rombongan A')
  const f = await failOf({ groups: [{}, {}], pilgrims: [{ group: 0 }, { group: 1 }], items: [PKG(), PKG(1)] })
  assert.equal(f.status, 422); assert.match(f.message, /untuk semua jamaah tidak dapat digabung/)
})

// ── Revisi booking berrombongan (11d-2a) ─────────────────────────────────────────────────────────────────────────────
// Booking terbit lewat draf admin (mesin yang sama + invoice) — revisi mensyaratkan invoice.
const draft = await createDraft(user.id); assert.ok(draft.ok)
const draftBody: BookingDraft = {
  groups: [{ label: 'Keluarga Pak Ahmad' }, { plannedTravelDate: '2090-06-20' }],
  pilgrims: [{ group: 0, visaProductId: visa.id }, { group: 0, visaProductId: visa.id }, { group: 1, visaProductId: visa.id }, { group: 1, visaProductId: visa.id }],
  items: [
    { itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-05', numPassengers: 2, group: 0 },
    { itemType: 'transport', transportQuotaId: quota.id, numPassengers: 2, group: 1 },
    { itemType: 'hotel', hotelRoomScheduleId: room.id, checkIn: '2090-06-10', checkOut: '2090-06-12', nights: 2, numRooms: 1 },
  ],
}
assert.ok((await saveDraft(draft.id, draftBody)).ok)
const pub = await publishDraft(draft.id, { byUserId: user.id }); assert.ok(pub.ok, JSON.stringify(pub))
const rid = draft.id
const seats = async () => ({
  flight: (await prisma.flightSchedule.findUniqueOrThrow({ where: { id: flight.id } })).pendingSeats,
  transport: (await prisma.transportQuota.findUniqueOrThrow({ where: { id: quota.id } })).pendingSeats,
})
/** Masukan revisi dari keadaan editor (isi sekarang, tanpa perubahan) — diubah per uji. */
async function current(): Promise<BookingRevisionInput> {
  const st = (await revisionEditorState(rid))!
  return {
    expectedRevision: st.revision, invoiceDate: st.invoiceDate, dueDate: st.dueDate,
    items: st.items.map(i => ({ ref: i.ref, item: i.item })),
    pilgrims: st.pilgrims.map(p => ({ pilgrimId: p.pilgrimId, group: p.group, ...(p.visaProductId && !p.visaFromPackage && { visaProductId: p.visaProductId }) })),
    groups: st.groups.map(g => ({ id: g.id, ...(g.label && { label: g.label }), ...(g.plannedTravelDate && { plannedTravelDate: g.plannedTravelDate }) })),
  }
}

await t('revisi: editor memuat rombongan (urut posisi) + rombongan item/jamaah; dikirim ulang tanpa ubahan = tidak ada perubahan; skema menerima bentuk itu', async () => {
  const st = (await revisionEditorState(rid))!
  assert.deepEqual(st.groups.map(g => [g.label, g.plannedTravelDate]), [['Keluarga Pak Ahmad', null], [null, '2090-06-20']])
  assert.deepEqual(st.items.map(i => [i.item.itemType, i.item.group]), [['hotel', undefined], ['transport', 1], ['flight', 0]])
  assert.deepEqual(st.pilgrims.map(p => p.group).sort(), [0, 0, 1, 1])
  const input = await current()
  assert.ok(bookingRevisionSchema.safeParse(input).success)
  const pv = await previewRevision(rid, input, user.id, { allowNoChange: true })
  assert.deepEqual(pv.changes, [])
  await assert.rejects(reviseBooking(rid, input, user.id), (e: unknown) => e instanceof RevisionError && e.status === 422 && /Tidak ada perubahan/.test(e.message))
})

await t('revisi: pindah jamaah B→A + jamaah baru di B → tiket A ditulis ulang 3 orang (kuota ikut), transport B tetap (ukuran sama), hotel tetap, visa jamaah baru = rencana B; riwayat tanpa nama rombongan', async () => {
  const before = await seats()
  const input = await current()
  const moved = input.pilgrims.find(p => p.group === 1)!
  moved.group = 0
  input.pilgrims.push({ group: 1, visaProductId: visa.id })
  const ids = await prisma.booking.findUniqueOrThrow({ where: { id: rid }, select: { hotels: { select: { id: true } }, transports: { select: { id: true } }, flights: { select: { id: true } } } })
  const r = await reviseBooking(rid, input, user.id)
  assert.deepEqual(r.changes.map(c => c.kind).sort(), ['group_move', 'pilgrim_add', 'replace'])
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: rid },
    select: {
      groups: { orderBy: { position: 'asc' }, select: { id: true } },
      flights: { select: { id: true, numPassengers: true, groupId: true } }, transports: { select: { id: true, numPassengers: true } }, hotels: { select: { id: true, numGuests: true } },
      pilgrims: { select: { id: true, groupId: true, visaApplication: { select: { plannedTravelDate: true } } } },
    },
  })
  const [a, bb] = b.groups
  assert.equal(b.flights[0]!.numPassengers, 3); assert.equal(b.flights[0]!.groupId, a!.id); assert.notEqual(b.flights[0]!.id, ids.flights[0]!.id, 'tiket ditulis ulang')
  assert.equal(b.transports[0]!.id, ids.transports[0]!.id, 'transport B dipertahankan'); assert.equal(b.transports[0]!.numPassengers, 2)
  assert.equal(b.hotels[0]!.id, ids.hotels[0]!.id); assert.equal(b.hotels[0]!.numGuests, 5, 'tamu hotel = semua jamaah sesudah revisi')
  assert.equal(b.pilgrims.find(p => p.id === moved.pilgrimId)!.groupId, a!.id)
  const fresh = b.pilgrims.filter(p => !input.pilgrims.some(x => x.pilgrimId === p.id))
  assert.equal(fresh.length, 1); assert.equal(fresh[0]!.groupId, bb!.id); assert.equal(calendarDateOf(fresh[0]!.visaApplication!.plannedTravelDate!), '2090-06-20', 'visa jamaah baru B = rencana B, bukan tiket A')
  const after = await seats()
  assert.equal(after.flight - before.flight, 1, 'kursi tiket +1 (2 dilepas, 3 ditahan)'); assert.equal(after.transport, before.transport)
  const log = await prisma.bookingRevision.findFirstOrThrow({ where: { bookingId: rid }, orderBy: { revision: 'desc' }, select: { summary: true } })
  assert.ok(!JSON.stringify(log.summary).includes('Ahmad'), 'nama rombongan tidak masuk riwayat')
})

await t('revisi: ganti nama + rombongan baru C (jamaah dipindah dari A) → baris rombongan diperbarui/dibuat, riwayat "Rombongan" tanpa nama', async () => {
  const input = await current()
  input.groups![0] = { ...input.groups![0]!, label: 'Keluarga Bu Siti' }
  input.groups!.push({ label: 'Rombongan Kantor' })
  input.pilgrims.find(p => p.group === 0)!.group = 2
  const r = await reviseBooking(rid, input, user.id)
  assert.ok(r.changes.some(c => c.kind === 'groups'))
  assert.ok(!JSON.stringify(r.changes).match(/Siti|Kantor/), 'nama tidak masuk ringkasan')
  const gs = await prisma.bookingGroup.findMany({ where: { bookingId: rid }, orderBy: { position: 'asc' }, select: { position: true, label: true, _count: { select: { pilgrims: true } } } })
  assert.deepEqual(gs.map(g => [g.position, g.label, g._count.pilgrims]), [[1, 'Keluarga Bu Siti', 2], [2, null, 2], [3, 'Rombongan Kantor', 1]])
  assert.equal((await prisma.bookingFlight.findFirstOrThrow({ where: { bookingId: rid } })).numPassengers, 2, 'tiket A mengikuti ukuran A')
})

await t('revisi: Visa Plus per rombongan juga di revisi (422 berlabel rombongan); rombongan booking lain → 422; rombongan kosong → 422; semuanya tanpa perubahan tersimpan', async () => {
  const rev = (await revisionEditorState(rid))!.revision
  const plus = await current()
  plus.pilgrims.find(p => p.group === 1)!.visaProductId = visaPlus.id
  await assert.rejects(previewRevision(rid, plus, user.id), (e: unknown) => e instanceof RuleViolationError && /^Rombongan B: /.test(e.violations[0]?.message ?? ''))
  const foreign = await current()
  const other = await prisma.bookingGroup.findFirstOrThrow({ where: { bookingId: { not: rid } } })
  foreign.groups![1] = { id: other.id }
  await assert.rejects(previewRevision(rid, foreign, user.id), (e: unknown) => e instanceof RevisionError && e.status === 422)
  const empty = await current()
  for (const p of empty.pilgrims) if (p.group === 2) p.group = 0
  assert.equal(bookingRevisionSchema.safeParse(empty).success, false, 'skema menolak rombongan tanpa jamaah')
  await assert.rejects(previewRevision(rid, empty, user.id), /belum punya jamaah/)
  assert.equal((await revisionEditorState(rid))!.revision, rev)
})

await t('revisi: rombongan ditiadakan → semua baris rombongan terhapus, item/jamaah tanpa rombongan, kuota tetap konsisten', async () => {
  const input = await current()
  input.groups = []
  for (const p of input.pilgrims) delete p.group
  input.items = input.items.map(i => ({ ...i, item: { ...i.item, group: undefined } }))
  const r = await reviseBooking(rid, input, user.id)
  assert.ok(r.changes.some(c => c.kind === 'groups' && c.detail === 'rombongan ditiadakan'))
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: rid }, select: { groups: true, pilgrims: { select: { groupId: true } }, flights: { select: { groupId: true } }, transports: { select: { groupId: true } } } })
  assert.deepEqual(b.groups, []); assert.ok([...b.pilgrims, ...b.flights, ...b.transports].every(x => x.groupId === null))
  assert.equal(cents((await bookingSnapshotTotals(prisma, rid)).sellIdr), cents(Number((await prisma.booking.findUniqueOrThrow({ where: { id: rid } })).totalAmount)), 'I4')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { userId: user.id } }) // cascade: item, jamaah, rombongan, visa, snapshot
const starts = { startsWith: tag }
await prisma.packageDeparture.deleteMany({ where: { package: { name: starts } } }) // FK Restrict (K1)
await prisma.package.deleteMany({ where: { name: starts } })
await prisma.visaProduct.deleteMany({ where: { name: starts } })
await prisma.flightSchedule.deleteMany({ where: { route: { origin: starts } } })
await prisma.flightRoute.deleteMany({ where: { origin: starts } })
await prisma.transportQuota.deleteMany({ where: { pricing: { trip: { name: starts } } } })
await prisma.transportPricing.deleteMany({ where: { trip: { name: starts } } })
await prisma.transportTrip.deleteMany({ where: { name: starts } })
await prisma.transportVehicle.deleteMany({ where: { name: starts } })
await prisma.hotel.deleteMany({ where: { name: starts } })
await prisma.roomType.deleteMany({ where: { name: starts } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { email: { contains: tag } } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
assert.equal(await prisma.bookingGroup.count({ where: { booking: { userId: user.id } } }), 0)
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
