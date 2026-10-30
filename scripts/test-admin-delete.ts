// Hapus-aman produk admin (docs/arsitektur-admin-editor.md §6) terhadap DATABASE SUNGGUHAN: hapus fisik hanya bila tak ada riwayat yang merujuk
// (termasuk FK SET NULL yang diam-diam mengosongkan riwayat), baris polimorfik ikut bersih, race rujukan-masuk-saat-hapus tertangkap, dan
// penyidik FK membuat tes merah bila ada FK/tabel polimorfik baru yang belum dipertimbangkan.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { deleteHotel, deleteMuthowif, deletePackage, deleteTourPackage, deleteTourismSite, deleteVisaProduct } from '@/lib/admin/productDelete'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const tag = `del${Date.now()}`
const flat = (cost: number) => [{ minDays: 1, maxDays: 999, cost }]

// ── fixture bersama ──────────────────────────────────────────────────────────────────────────────────────────────────
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, fullName: tag, passwordHash: 'x', role: 'pilgrim' } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
const roomType = await prisma.roomType.create({ data: { name: `${tag} room`, defaultCapacity: 2 } })
const bookings: string[] = []
const newBooking = async () => { const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${bookings.length}`, userId: user.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1000 } }); bookings.push(b.id); return b.id }
const img = (productType: string, productId: string) => prisma.productImage.create({ data: { productType, productId, key: `${tag}/${productType}/${productId}.webp`, cardKey: `${tag}/${productType}/${productId}-c.webp` } })
const poly = async (productType: string, productId: string) => {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: 'X', currency: 'IDR', costTiers: flat(1000) } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: 'X', vendorId: vendor.id } })
  await prisma.documentRequirement.create({ data: { productType, productId, docType: 'ktp', label: 'KTP' } })
  await prisma.manifestFieldRequirement.create({ data: { productType, productId, fieldKey: 'nama', label: 'Nama', fieldType: 'text' } })
}
const polyCount = async (productType: string, productId: string) =>
  (await Promise.all([
    prisma.productCost.count({ where: { productType, productId } }), prisma.preferredVendor.count({ where: { productType, productId } }),
    prisma.documentRequirement.count({ where: { productType, productId } }), prisma.manifestFieldRequirement.count({ where: { productType, productId } }),
  ])).reduce((a, b) => a + b, 0)
const imgCount = (productType: string, productId: string) => prisma.productImage.count({ where: { productType, productId } })
const bystander = await prisma.package.create({ data: { name: `${tag} penonton` } }) // data milik produk LAIN harus tak tersentuh
await poly('package', bystander.id)

// ── MUTHOWIF ─────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('Muthowif: tanpa rujukan → dihapus (ketersediaan + foto ikut); tak ada → P2025', async () => {
  const m = await prisma.muthowif.create({ data: { name: `${tag} m1` } })
  await prisma.muthowifAvailability.create({ data: { muthowifId: m.id, date: new Date('2027-06-02') } })
  await img('muthowif', m.id)
  assert.deepEqual(await deleteMuthowif(m.id), { deleted: true })
  assert.equal(await prisma.muthowif.count({ where: { id: m.id } }), 0)
  assert.equal(await imgCount('muthowif', m.id), 0)
  await assert.rejects(() => deleteMuthowif(m.id), (e: { code?: string }) => e.code === 'P2025')
})
await t('Muthowif: pernah ditugaskan → NONAKTIF, riwayat penugasan TIDAK dikosongkan (FK SET NULL)', async () => {
  const m = await prisma.muthowif.create({ data: { name: `${tag} m2` } })
  const bk = await newBooking()
  const bm = await prisma.bookingMuthowif.create({ data: { bookingId: bk, muthowifId: m.id, startDate: new Date('2027-06-02'), endDate: new Date('2027-06-05'), numDays: 3, numPeople: 2, totalPrice: 100 } })
  const r = await deleteMuthowif(m.id)
  assert.equal(r.deleted, false); assert.match((r as { message: string }).message, /1 penugasan/)
  assert.equal((await prisma.muthowif.findUniqueOrThrow({ where: { id: m.id } })).isActive, false)
  assert.equal((await prisma.bookingMuthowif.findUniqueOrThrow({ where: { id: bm.id } })).muthowifId, m.id, 'riwayat penugasan harus utuh')
})
await t('Muthowif RACE: penugasan yang masuk SAAT hapus berjalan menang → nonaktif, bukan SET NULL diam-diam', async () => {
  const m = await prisma.muthowif.create({ data: { name: `${tag} m3` } })
  const bk = await newBooking()
  let bmId = ''
  const inserter = prisma.$transaction(async tx => {
    const row = await tx.bookingMuthowif.create({ data: { bookingId: bk, muthowifId: m.id, startDate: new Date('2027-06-02'), endDate: new Date('2027-06-05'), numDays: 3, numPeople: 1, totalPrice: 1 } })
    bmId = row.id
    await sleep(1200) // transaksi penugasan belum commit saat hapus dimulai
  })
  await sleep(300)
  const outcome = await deleteMuthowif(m.id)
  await inserter
  assert.equal(outcome.deleted, false, 'hapus harus menunggu lalu melihat rujukan baru')
  assert.equal((await prisma.bookingMuthowif.findUniqueOrThrow({ where: { id: bmId } })).muthowifId, m.id)
})

// ── SITUS WISATA ─────────────────────────────────────────────────────────────────────────────────────────────────────
await t('Situs: tanpa rujukan → dihapus (foto ikut); dipakai paket ziarah → nonaktif', async () => {
  const s1 = await prisma.tourismSite.create({ data: { name: `${tag} s1` } })
  await img('tourism_site', s1.id)
  assert.deepEqual(await deleteTourismSite(s1.id), { deleted: true })
  assert.equal(await imgCount('tourism_site', s1.id), 0)
  const s2 = await prisma.tourismSite.create({ data: { name: `${tag} s2` } })
  const tp = await prisma.tourPackage.create({ data: { name: `${tag} tp-host` } })
  await prisma.tourPackageSite.create({ data: { tourPackageId: tp.id, tourismSiteId: s2.id } })
  const r = await deleteTourismSite(s2.id)
  assert.equal(r.deleted, false)
  assert.equal((await prisma.tourismSite.findUniqueOrThrow({ where: { id: s2.id } })).isActive, false)
  assert.equal(await prisma.tourPackageSite.count({ where: { tourismSiteId: s2.id } }), 1)
  await prisma.tourPackage.delete({ where: { id: tp.id } })
})

// ── PAKET ZIARAH ─────────────────────────────────────────────────────────────────────────────────────────────────────
await t('Paket Ziarah: tanpa booking → dihapus beserta situs/biaya/foto; pernah dipesan → nonaktif, biaya utuh', async () => {
  const site = await prisma.tourismSite.create({ data: { name: `${tag} s3` } })
  const p1 = await prisma.tourPackage.create({ data: { name: `${tag} tp1` } })
  await prisma.tourPackageSite.create({ data: { tourPackageId: p1.id, tourismSiteId: site.id } })
  await poly('tour_package', p1.id); await img('tour_package', p1.id)
  assert.deepEqual(await deleteTourPackage(p1.id), { deleted: true })
  assert.equal(await prisma.tourPackageSite.count({ where: { tourPackageId: p1.id } }), 0)
  assert.equal(await polyCount('tour_package', p1.id), 0); assert.equal(await imgCount('tour_package', p1.id), 0)
  const p2 = await prisma.tourPackage.create({ data: { name: `${tag} tp2` } })
  await poly('tour_package', p2.id)
  const bk = await newBooking()
  await prisma.bookingTourPackage.create({ data: { bookingId: bk, tourPackageId: p2.id, tourDate: new Date('2027-06-03'), numPeople: 1, totalPrice: 1 } })
  assert.equal((await deleteTourPackage(p2.id)).deleted, false)
  assert.equal((await prisma.tourPackage.findUniqueOrThrow({ where: { id: p2.id } })).isActive, false)
  assert.equal(await polyCount('tour_package', p2.id), 4, 'biaya paket yang dipesan tak boleh hilang')
  await prisma.tourismSite.delete({ where: { id: site.id } })
})

// ── PAKET UMROH ──────────────────────────────────────────────────────────────────────────────────────────────────────
await t('Paket Umroh: dihapus beserta opsi (CASCADE), biaya & foto polimorfik; milik paket lain tak tersentuh', async () => {
  const v = await prisma.visaProduct.create({ data: { name: `${tag} v-opt`, visaType: 'Umroh' } })
  const p = await prisma.package.create({ data: { name: `${tag} pk1` } })
  await prisma.packageVisaOption.create({ data: { packageId: p.id, visaProductId: v.id } })
  await poly('package', p.id); await img('package', p.id)
  assert.deepEqual(await deletePackage(p.id), { deleted: true })
  assert.equal(await prisma.packageVisaOption.count({ where: { packageId: p.id } }), 0)
  assert.equal(await polyCount('package', p.id), 0); assert.equal(await imgCount('package', p.id), 0)
  assert.equal(await polyCount('package', bystander.id), 4, 'baris milik produk lain harus utuh')
  assert.equal((await deleteVisaProduct(v.id)).deleted, true, 'visa bebas setelah opsi paket hilang')
})

// ── VISA ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('Visa: tanpa rujukan → dihapus beserta biaya, syarat dokumen, field manifest, vendor pilihan, foto (dulu yatim)', async () => {
  const v = await prisma.visaProduct.create({ data: { name: `${tag} v1`, visaType: 'Umroh' } })
  await poly('visa', v.id); await img('visa', v.id)
  assert.deepEqual(await deleteVisaProduct(v.id), { deleted: true })
  assert.equal(await polyCount('visa', v.id), 0); assert.equal(await imgCount('visa', v.id), 0)
})
await t('Visa: dirujuk pengajuan visa / opsi paket / visa "included" paket → NONAKTIF; riwayat TIDAK dikosongkan (FK SET NULL)', async () => {
  // a) pengajuan visa jamaah
  const va = await prisma.visaProduct.create({ data: { name: `${tag} v2`, visaType: 'Umroh' } })
  const bk = await newBooking()
  const pg = await prisma.bookingPilgrim.create({ data: { bookingId: bk } })
  const app = await prisma.visaApplication.create({ data: { bookingPilgrimId: pg.id, visaProductId: va.id, visaType: 'Umroh' } })
  assert.equal((await deleteVisaProduct(va.id)).deleted, false)
  assert.equal((await prisma.visaApplication.findUniqueOrThrow({ where: { id: app.id } })).visaProductId, va.id, 'pengajuan visa harus tetap menunjuk produknya')
  // b) opsi paket umroh
  const vb = await prisma.visaProduct.create({ data: { name: `${tag} v3`, visaType: 'Umroh' } })
  const pk = await prisma.package.create({ data: { name: `${tag} pk2` } })
  await prisma.packageVisaOption.create({ data: { packageId: pk.id, visaProductId: vb.id } })
  assert.equal((await deleteVisaProduct(vb.id)).deleted, false)
  // c) visa "included" di paket (SET NULL)
  const vc = await prisma.visaProduct.create({ data: { name: `${tag} v4`, visaType: 'Umroh' } })
  const pk2 = await prisma.package.create({ data: { name: `${tag} pk3`, visaMode: 'included', includedVisaProductId: vc.id } })
  assert.equal((await deleteVisaProduct(vc.id)).deleted, false)
  assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: pk2.id } })).includedVisaProductId, vc.id, 'visa included paket harus utuh')
  for (const id of [va.id, vb.id, vc.id]) assert.equal((await prisma.visaProduct.findUniqueOrThrow({ where: { id } })).isActive, false)
})

// ── HOTEL ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function hotelWithSchedule(name: string) {
  const address = await prisma.address.create({ data: { type: 'domestic', fullAddress: 'Jl. Uji 1' } as never })
  const hotel = await prisma.hotel.create({ data: { name, city: 'makkah', addressId: address.id } })
  const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2027-06-01'), periodEnd: new Date('2027-06-30') } })
  const schedule = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 5 } })
  const service = await prisma.hotelService.create({ data: { hotelId: hotel.id, serviceName: 'Laundry' } })
  return { hotel, address, period, schedule, service }
}
await t('Hotel: tanpa rujukan → dihapus beserta periode, jadwal kamar, layanan, alamat, biaya per jadwal, foto', async () => {
  const h = await hotelWithSchedule(`${tag} h1`)
  await poly('hotel', h.schedule.id); await img('hotel', h.hotel.id)
  assert.deepEqual(await deleteHotel(h.hotel.id), { deleted: true })
  for (const [m, id] of [['hotelPricePeriod', h.period.id], ['hotelRoomSchedule', h.schedule.id], ['hotelService', h.service.id], ['address', h.address.id]] as const) {
    assert.equal(await (prisma[m] as unknown as { count: (a: object) => Promise<number> }).count({ where: { id } }), 0, `${m} harus ikut terhapus`)
  }
  assert.equal(await polyCount('hotel', h.schedule.id), 0); assert.equal(await imgCount('hotel', h.hotel.id), 0)
})
await t('Hotel: dirujuk booking kamar / layanan / hotel "included" paket / pilihan kamar paket ziarah → NONAKTIF, rujukan utuh', async () => {
  // a) booking kamar (RESTRICT)
  const a = await hotelWithSchedule(`${tag} h2`)
  const bk = await newBooking()
  await prisma.bookingHotel.create({ data: { bookingId: bk, hotelRoomScheduleId: a.schedule.id, checkIn: new Date('2027-06-02'), checkOut: new Date('2027-06-04'), nights: 2, numRooms: 1, numGuests: 2, pricePerNight: 100, totalPrice: 200 } })
  assert.equal((await deleteHotel(a.hotel.id)).deleted, false)
  // b) layanan hotel dibooking (RESTRICT)
  const b = await hotelWithSchedule(`${tag} h3`)
  await prisma.bookingService.create({ data: { bookingId: bk, hotelServiceId: b.service.id, totalPrice: 10 } })
  assert.equal((await deleteHotel(b.hotel.id)).deleted, false)
  // c) hotel "included" di paket umroh (SET NULL)
  const c = await hotelWithSchedule(`${tag} h4`)
  const pk = await prisma.package.create({ data: { name: `${tag} pk4`, hotelMakkahMode: 'included', includedHotelMakkahScheduleId: c.schedule.id } })
  assert.equal((await deleteHotel(c.hotel.id)).deleted, false)
  assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: pk.id } })).includedHotelMakkahScheduleId, c.schedule.id, 'hotel included paket harus utuh')
  // d) pilihan kamar di booking paket ziarah (SET NULL)
  const d = await hotelWithSchedule(`${tag} h5`)
  const tp = await prisma.tourPackage.create({ data: { name: `${tag} tp-h` } })
  const btp = await prisma.bookingTourPackage.create({ data: { bookingId: bk, tourPackageId: tp.id, tourDate: new Date('2027-06-03'), numPeople: 1, totalPrice: 1, chosenHotelRoomScheduleId: d.schedule.id } })
  assert.equal((await deleteHotel(d.hotel.id)).deleted, false)
  assert.equal((await prisma.bookingTourPackage.findUniqueOrThrow({ where: { id: btp.id } })).chosenHotelRoomScheduleId, d.schedule.id, 'pilihan kamar di booking harus utuh')
  for (const h of [a, b, c, d]) assert.equal((await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } })).isActive, false)
})

// ── PENYIDIK FK: perubahan skema yang belum dipertimbangkan membuat tes merah ──────────────────────────────────────────
const inbound = async (table: string) =>
  (await prisma.$queryRawUnsafe<{ ref: string }[]>( // identifier dari literal di file ini, bukan masukan; Prisma tak punya introspeksi katalog
    `select conrelid::regclass::text || '.' || a.attname || ' ' || confdeltype::text as ref from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where contype = 'f' and confrelid = '${table}'::regclass order by 1`,
  )).map(r => r.ref)
const EXPECTED_FK: Record<string, string[]> = {
  muthowif: ['booking_muthowif.muthowifId n', 'muthowif_availability.muthowifId c'],
  tourism_sites: ['tour_package_sites.tourismSiteId r'],
  tour_packages: ['booking_tour_packages.tourPackageId r', 'tour_package_hotel_options.tourPackageId c', 'tour_package_hotels.tourPackageId c', 'tour_package_sites.tourPackageId c'],
  packages: ['booking_packages.packageId r', 'package_catering_options.packageId c', 'package_hotel_options.packageId c', 'package_visa_options.packageId c'],
  visa_products: ['package_visa_options.visaProductId r', 'packages.includedVisaProductId n', 'visa_applications.visaProductId n'],
  hotels: ['hotel_price_periods.hotelId c', 'hotel_services.hotelId c'],
  hotel_room_schedules: [
    'booking_hotels.hotelRoomScheduleId r', 'booking_tour_packages.chosenHotelRoomScheduleId n', 'package_hotel_options.hotelRoomScheduleId r',
    'packages.includedHotelMadinahScheduleId n', 'packages.includedHotelMakkahScheduleId n', 'tour_package_hotel_options.hotelRoomScheduleId r', 'tour_package_hotels.hotelRoomScheduleId r',
  ],
  hotel_services: ['booking_services.hotelServiceId r'],
}
await t('penyidik FK: rujukan masuk ke setiap entitas yang bisa dihapus = daftar yang sudah dipertimbangkan di lib/admin/productDelete.ts', async () => {
  for (const [table, expected] of Object.entries(EXPECTED_FK)) {
    assert.deepEqual(await inbound(table), [...expected].sort(), `${table}: FK masuk berubah — perbarui hitungan rujukan di productDelete.ts lalu daftar ini`)
  }
})
await t('penyidik tabel polimorfik: set tabel ber-productType = yang dibersihkan dropPolymorphic', async () => {
  const rows = await prisma.$queryRaw<{ t: string }[]>`select table_name as t from information_schema.columns where column_name = 'productType' and table_schema = 'public' order by 1`
  // pricing_rules = aturan margin per TIPE produk (tanpa productId); product_images dibersihkan purgeProductMedia; empat lainnya oleh dropPolymorphic.
  assert.deepEqual(rows.map(r => r.t), ['document_requirements', 'manifest_field_requirements', 'preferred_vendors', 'pricing_rules', 'product_costs', 'product_images'])
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
const read = (p: string) => readFileSync(p, 'utf8')
await t('route DELETE: requireManager lebih dulu, memakai fungsi productDelete; 404/403/500 dibedakan', () => {
  const routes: Array<[string, string]> = [
    ['muthowif/[id]', 'deleteMuthowif'], ['tourism-sites/[id]', 'deleteTourismSite'], ['hotels/[id]', 'deleteHotel'],
    ['packages/[id]', 'deletePackage'], ['tour-packages/[id]', 'deleteTourPackage'], ['visa/[id]', 'deleteVisaProduct'],
  ]
  for (const [r, fn] of routes) {
    const src = read(`app/api/v1/admin/products/${r}/route.ts`)
    const del = src.slice(src.indexOf('export async function DELETE'))
    assert.ok(del.indexOf('requireManager()') > 0 && del.indexOf('requireManager()') < del.indexOf(fn), `${r}: requireManager harus lebih dulu`)
    assert.match(del, new RegExp(`ok\\(await ${fn}\\(id\\)\\)`), `${r}: harus memakai ${fn}`)
    assert.match(del, /isRecordNotFound\(e\)/, `${r}: tidak ada → 404`)
    assert.doesNotMatch(del, /\.delete\(/, `${r}: .delete() telanjang di route — pakai lib/admin/productDelete.ts`)
  }
  const lib = read('lib/admin/productDelete.ts')
  assert.equal((lib.match(/deleteOrDeactivate\(/g) ?? []).length, 1, 'semua hapus lewat satu pemanggilan deleteOrDeactivate')
  assert.match(lib, /FOR UPDATE/, 'pemeriksaan ulang harus di bawah kunci baris')
  assert.match(lib, /purgeProductMedia\(/); assert.match(lib, /dropPolymorphic\(tx, 'visa'/); assert.match(lib, /dropPolymorphic\(tx, 'package'/)
  assert.match(lib, /dropPolymorphic\(tx, 'tour_package'/); assert.match(lib, /dropPolymorphic\(tx, 'hotel'/)
  assert.match(lib, /visaApplication\.count/, 'pengajuan visa (SET NULL) harus dihitung'); assert.match(lib, /bookingMuthowif\.count/, 'penugasan muthowif (SET NULL) harus dihitung')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.productImage.deleteMany({ where: { key: { startsWith: `${tag}/` } } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await prisma.documentRequirement.deleteMany({ where: { productType: { in: ['package', 'visa', 'hotel', 'tour_package'] }, productId: bystander.id } })
await prisma.manifestFieldRequirement.deleteMany({ where: { productType: 'package', productId: bystander.id } })
await prisma.booking.deleteMany({ where: { id: { in: bookings } } }) // item booking ikut (CASCADE)
await prisma.package.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.tourPackage.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.visaProduct.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.tourismSite.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.muthowif.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.address.deleteMany({ where: { fullAddress: 'Jl. Uji 1' } })
await prisma.roomType.deleteMany({ where: { id: roomType.id } })
await prisma.vendor.deleteMany({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { id: user.id } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
