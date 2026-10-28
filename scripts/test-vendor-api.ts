// Uji API vendor + kategori (ADR-0003, docs/arsitektur-vendor.md, Fase 2) terhadap DATABASE SUNGGUHAN lewat handler asli dengan otorisasi disuntik:
// CRUD lengkap, keunikan, hapus aman (hapus sungguhan vs nonaktif), vendor sistem, kategori, bentuk ramping manager, dan penjaga bahwa HANYA
// lib/vendors/service.ts yang menulis tabel vendor.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { createVendorHandlers } from '@/lib/vendors/handlers'
import { createCostComponentHandlers } from '@/lib/pricing/costComponentHandlers'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

const tag = `va${Date.now()}`
const su = createVendorHandlers({ requireRead: async () => ({ role: 'superadmin' as const }), requireWrite: async () => undefined })
const mg = createVendorHandlers({ requireRead: async () => ({ role: 'manager' as const }), requireWrite: async () => { throw new Error('Forbidden') } })
const anon = createVendorHandlers({ requireRead: async () => { throw new Error('Unauthorized') }, requireWrite: async () => { throw new Error('Unauthorized') } })

const req = (body?: unknown, url = 'http://test.local/x') => new Request(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const get = (qs = '') => new Request(`http://test.local/x${qs}`)
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as { success: boolean; data?: any; error?: string; meta?: any } })

const cat = async (slug: string) => (await prisma.vendorCategory.findUniqueOrThrow({ where: { slug } })).id
const HOTEL = await cat('hotel'), BUS = await cat('transport'), OTHER = await cat('other')
const mk = async (name: string, extra: Record<string, unknown> = {}) => {
  const r = await json(await su.vendorsPOST(req({ name: `${tag} ${name}`, countryCode: 'SA', categoryIds: [HOTEL], ...extra })))
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body.data as { id: string; name: string }
}
const rawVendor = (id: string) => prisma.vendor.findUnique({ where: { id }, include: { categories: true } })
const createdCategories: string[] = []

console.log('== buat ==')

await t('POST 201: DTO tanpa kolom legacy/nameKey/addressId; nameKey tersimpan; kategori terpasang; kontak & alamat tersimpan; kolom kosong → null', async () => {
  const r = await json(await su.vendorsPOST(req({
    name: `  ${tag}  Mas   Adam `, countryCode: 'SA', categoryIds: [HOTEL, BUS], contactName: 'Pak Adam', phoneCountryCode: 'SA', phone: '+966 55 123 4567',
    whatsappCountryCode: 'SA', whatsapp: '0551234567', email: 'Info@MasAdam.test', website: 'https://masadam.test', notes: '',
    address: { type: 'international', fullAddress: 'Jl. Ibrahim Khalil 1', countryCode: 'SA', city: 'Makkah' },
  })))
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const v = r.body.data
  for (const leaked of ['category', 'country', 'contactInfo', 'nameKey', 'addressId']) assert.ok(!(leaked in v), `${leaked} tak boleh keluar`)
  assert.equal(v.name, `${tag}  Mas   Adam`) // hanya spasi luar yang dipangkas; nameKey melipat spasi dalam
  assert.equal(v.phone, '966551234567'); assert.equal(v.email, 'info@masadam.test'); assert.equal(v.notes, null); assert.equal(v.isSystem, false); assert.equal(v.isActive, true)
  assert.deepEqual(v.categories.map((c: any) => c.slug).sort(), ['hotel', 'transport']); assert.equal(v.address.city, 'Makkah')
  const row = await rawVendor(v.id)
  assert.equal(row!.nameKey, `${tag} mas adam`); assert.equal(row!.addressId, v.address.id)
})

await t('POST 400: tanpa kategori, kategori tak ada/nonaktif, negara bukan ISO, nomor tanpa kode negara, email/website buruk, kolom liar (systemKey/category/country/nameKey), body rusak', async () => {
  const dead = await prisma.vendorCategory.create({ data: { name: `${tag} mati`, slug: `${tag}-mati`, isActive: false } }); createdCategories.push(dead.id)
  const ok = { name: `${tag} X`, countryCode: 'SA', categoryIds: [HOTEL] }
  for (const [label, body] of Object.entries({
    tanpaKategori: { ...ok, categoryIds: [] }, kategoriAcak: { ...ok, categoryIds: [randomUUID()] }, kategoriNonaktif: { ...ok, categoryIds: [dead.id] },
    negaraTeks: { ...ok, countryCode: 'Saudi Arabia' }, nomorTanpaKode: { ...ok, phone: '5551234567' }, emailBuruk: { ...ok, email: 'x' }, websiteBuruk: { ...ok, website: 'javascript:alert(1)' },
    systemKey: { ...ok, systemKey: 'x' }, legacy: { ...ok, category: 'hotel' }, namaKosong: { ...ok, name: ' ' },
  })) {
    const r = await json(await su.vendorsPOST(req(body)))
    assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`)
  }
  assert.equal((await json(await su.vendorsPOST(new Request('http://x', { method: 'POST', body: 'xx' })))).status, 400)
})

await t('POST 409: nama sama (huruf besar/kecil, spasi ganda) di negara sama ditolak dengan menyebut vendor yang ada; negara lain diizinkan; vendor nonaktif disarankan diaktifkan kembali', async () => {
  const a = await mk('Ganda')
  const dup = await json(await su.vendorsPOST(req({ name: `  ${tag.toUpperCase()}   ganda `, countryCode: 'SA', categoryIds: [BUS] })))
  assert.equal(dup.status, 409); assert.match(dup.body.error!, /sudah ada/); assert.ok(dup.body.error!.includes(a.name))
  assert.equal((await json(await su.vendorsPOST(req({ name: `${tag} ganda`, countryCode: 'ID', categoryIds: [BUS] })))).status, 201)
  await prisma.vendor.update({ where: { id: a.id }, data: { isActive: false } })
  const again = await json(await su.vendorsPOST(req({ name: `${tag} ganda`, countryCode: 'SA', categoryIds: [BUS] })))
  assert.equal(again.status, 409); assert.match(again.body.error!, /nonaktif/)
})

console.log('== baca ==')

await t('GET list: superadmin penuh + meta; filter q/kategori/negara/status; urutan stabil; halaman diklem; manager mendapat bentuk RAMPING (tanpa kontak/alamat/catatan)', async () => {
  const a = await mk('Alpha', { categoryIds: [HOTEL], email: 'a@x.test', notes: 'rahasia' }), b = await mk('Beta', { categoryIds: [BUS], countryCode: 'ID' })
  await prisma.vendor.update({ where: { id: b.id }, data: { isActive: false } })
  const all = await json(await su.vendorsGET(get(`?q=${tag}&limit=50`)))
  assert.equal(all.status, 200); assert.ok(all.body.meta.total >= 2); assert.ok(all.body.data.every((v: any) => v.name.includes(tag)))
  const again = await json(await su.vendorsGET(get(`?q=${tag}&limit=50`)))
  assert.deepEqual(again.body.data.map((v: any) => v.id), all.body.data.map((v: any) => v.id), 'urutan stabil antar permintaan')
  assert.deepEqual((await json(await su.vendorsGET(get(`?q=${tag}&category=transport&status=inactive`)))).body.data.map((v: any) => v.id), [b.id])
  assert.deepEqual((await json(await su.vendorsGET(get(`?q=${tag}&country=ID`)))).body.data.map((v: any) => v.id).includes(b.id), true)
  assert.equal((await json(await su.vendorsGET(get(`?q=${tag}&status=active&country=ID`)))).body.data.some((v: any) => v.id === b.id), false)
  assert.equal((await json(await su.vendorsGET(get(`?q=${tag}&page=999&limit=1`)))).body.meta.page, (await json(await su.vendorsGET(get(`?q=${tag}&limit=1`)))).body.meta.totalPages)
  const slim = await json(await mg.vendorsGET(get(`?q=${tag}&status=active&limit=50`)))
  assert.equal(slim.status, 200)
  const row = slim.body.data.find((v: any) => v.id === a.id)
  assert.deepEqual(Object.keys(row).sort(), ['categories', 'countryCode', 'id', 'isActive', 'name'])
  assert.ok(!JSON.stringify(slim.body).includes('rahasia') && !JSON.stringify(slim.body).includes('a@x.test'))
})

await t('GET [id]: superadmin memuat pemakaian; manager/tanpa login → 403; id tak ada → 404', async () => {
  const v = await mk('Detail')
  await prisma.productCost.create({ data: { productType: 'haji', productId: randomUUID(), vendorId: v.id, costComponent: 'k', currency: 'IDR', costTiers: [] } })
  const r = await json(await su.vendorGET(get(), ctx(v.id)))
  assert.equal(r.status, 200); assert.deepEqual(r.body.data.usage, { costsByType: { haji: 1 }, costs: 1, preferred: 0, snapshots: 0, costActuals: 0, total: 1 })
  assert.equal((await json(await mg.vendorGET(get(), ctx(v.id)))).status, 403)
  assert.equal((await json(await anon.vendorGET(get(), ctx(v.id)))).status, 403)
  assert.equal((await json(await su.vendorGET(get(), ctx(randomUUID())))).status, 404)
})

console.log('== ubah ==')

await t('PUT: ubah nama → nameKey ikut; ubah kategori (set); alamat diperbarui di tempat (tak ada alamat yatim); bentrok nama → 409; kosong/kolom liar → 400; id tak ada → 404; aktifkan kembali', async () => {
  const a = await mk('Ubah', { address: { type: 'international', fullAddress: 'Alamat 1', countryCode: 'SA', city: 'Madinah' } })
  const before = await prisma.address.count()
  const put = async (body: unknown, id = a.id) => json(await su.vendorPUT(req(body), ctx(id)))
  let r = await put({ name: `${tag} Ubah Baru`, categoryIds: [BUS, OTHER], address: { type: 'international', fullAddress: 'Alamat 2', countryCode: 'SA', city: 'Jeddah' } })
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.data.categories.map((c: any) => c.slug).sort(), ['other', 'transport']); assert.equal(r.body.data.address.city, 'Jeddah')
  assert.equal((await rawVendor(a.id))!.nameKey, `${tag} ubah baru`); assert.equal(await prisma.address.count(), before, 'alamat diperbarui, bukan dibuat ganda')
  const other = await mk('Penabrak')
  r = await put({ name: `${tag} ubah baru` }, other.id); assert.equal(r.status, 409)
  assert.equal((await put({})).status, 400); assert.equal((await put({ systemKey: 'x' })).status, 400); assert.equal((await put({ categoryIds: [] })).status, 400); assert.equal((await put({ nameKey: 'x' })).status, 400)
  assert.equal((await put({ notes: 'x' }, randomUUID())).status, 404)
  assert.equal((await put({ isActive: false })).body.data.isActive, false); assert.equal((await put({ isActive: true })).body.data.isActive, true)
  assert.equal((await json(await mg.vendorPUT(req({ notes: 'x' }), ctx(a.id)))).status, 403)
})

await t('vendor SISTEM: tak bisa dinonaktifkan atau dihapus (409); kontaknya boleh diedit', async () => {
  const sys = await prisma.vendor.findUniqueOrThrow({ where: { systemKey: 'saudinesia' } })
  assert.equal((await json(await su.vendorPUT(req({ isActive: false }), ctx(sys.id)))).status, 409)
  assert.equal((await json(await su.vendorDELETE(req(), ctx(sys.id)))).status, 409)
  const r = await json(await su.vendorPUT(req({ notes: `${tag} catatan` }), ctx(sys.id)))
  assert.equal(r.status, 200); assert.equal(r.body.data.isSystem, true)
  await prisma.vendor.update({ where: { id: sys.id }, data: { notes: sys.notes } })
  assert.equal((await prisma.vendor.findUniqueOrThrow({ where: { id: sys.id } })).isActive, true)
})

console.log('== hapus aman ==')

await t('DELETE: tak dirujuk → HAPUS SUNGGUHAN (alamat dan tautan kategori ikut hilang); dirujuk biaya / vendor pilihan / snapshot visa → NONAKTIF + pesan rincian, data utuh; dapat diaktifkan kembali; 404 / 403', async () => {
  const free = await mk('Bebas', { address: { type: 'international', fullAddress: 'Alamat bebas', countryCode: 'SA', city: 'Makkah' } })
  const addrId = (await rawVendor(free.id))!.addressId!
  assert.deepEqual((await json(await su.vendorDELETE(req(), ctx(free.id)))).body.data, { deleted: true })
  assert.equal(await prisma.vendor.count({ where: { id: free.id } }), 0); assert.equal(await prisma.address.count({ where: { id: addrId } }), 0)
  assert.equal((await prisma.$queryRawUnsafe<unknown[]>(`select 1 from "_VendorToVendorCategory" where "A" = '${free.id}'`)).length, 0)

  const byCost = await mk('DipakaiBiaya'), byPref = await mk('DipakaiPilihan'), bySnap = await mk('DipakaiVisa')
  await prisma.productCost.create({ data: { productType: 'package', productId: randomUUID(), vendorId: byCost.id, costComponent: 'k', currency: 'IDR', costTiers: [] } })
  await prisma.preferredVendor.create({ data: { productType: 'flight', productId: randomUUID(), costComponent: 'tiket', vendorId: byPref.id } })
  const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  const bk = await prisma.booking.create({ data: { bookingCode: `VA${Date.now()}`, userId: user.id, departureDate: new Date('2027-01-01'), returnDate: new Date('2027-01-10'), season: 'regular', totalAmount: 1 } })
  await prisma.priceSnapshot.create({ data: { bookingId: bk.id, itemType: 'visa', itemId: randomUUID(), itemLabel: 'Visa', itemQty: 1, description: 'Visa', qty: 1, unit: 'person', unitSellIdr: 1, totalSellIdr: 1, mode: 'auto', vendorIds: [bySnap.id] } }) // riwayat vendor di snapshot harga
  for (const v of [byCost, byPref, bySnap]) {
    const r = await json(await su.vendorDELETE(req(), ctx(v.id)))
    assert.equal(r.status, 200); assert.equal(r.body.data.deleted, false); assert.equal(r.body.data.deactivated, true); assert.match(r.body.data.message, /dinonaktifkan/)
    assert.equal((await rawVendor(v.id))!.isActive, false)
  }
  assert.equal((await json(await su.vendorDELETE(req(), ctx(byCost.id)))).body.data.usage.costs, 1)
  assert.equal((await json(await su.vendorPUT(req({ isActive: true }), ctx(byCost.id)))).body.data.isActive, true)
  assert.equal((await json(await su.vendorDELETE(req(), ctx(randomUUID())))).status, 404)
  assert.equal((await json(await mg.vendorDELETE(req(), ctx(byCost.id)))).status, 403)
  await prisma.booking.delete({ where: { id: bk.id } }); await prisma.user.delete({ where: { id: user.id } })
})

console.log('== kategori ==')

await t('kategori: buat (slug dari nama, urutan otomatis); duplikat nama/slug → 409; nama tanpa huruf/angka → 400; ganti nama TIDAK mengubah slug; bentrok nama → 409; daftar memuat vendorCount; manager boleh baca, tak boleh tulis', async () => {
  const r = await json(await su.categoriesPOST(req({ name: `${tag} Rental Mobil` })))
  assert.equal(r.status, 201); const c = r.body.data; createdCategories.push(c.id)
  assert.equal(c.slug, `${tag}-rental-mobil`); assert.equal(c.isSystem, false); assert.equal(c.vendorCount, 0); assert.ok(c.sortOrder > 90)
  for (const name of [`${tag} rental mobil`, `${tag}   RENTAL  MOBIL`, `${tag}-rental-mobil`]) {
    const dup = await json(await su.categoriesPOST(req({ name })))
    assert.equal(dup.status, 409, name)
    assert.ok(dup.body.error!.includes(`Kategori "${c.name}" sudah ada`), `pesan harus menyebut kategori yang sudah ada: ${dup.body.error}`)
  }
  assert.equal((await json(await su.categoriesPOST(req({ name: '***' })))).status, 400); assert.equal((await json(await su.categoriesPOST(req({ name: 'ab', slug: 'x' })))).status, 400)
  const ren = await json(await su.categoryPUT(req({ name: `${tag} Sewa Mobil` }), ctx(c.id)))
  assert.equal(ren.status, 200); assert.equal(ren.body.data.slug, `${tag}-rental-mobil`); assert.equal(ren.body.data.name, `${tag} Sewa Mobil`)
  assert.equal((await json(await su.categoryPUT(req({ name: 'Hotel' }), ctx(c.id)))).status, 409)
  await mk('BerKategori', { categoryIds: [c.id] })
  const list = await json(await mg.categoriesGET())
  assert.equal(list.status, 200); assert.equal(list.body.data.find((x: any) => x.id === c.id).vendorCount, 1); assert.ok(list.body.data.some((x: any) => x.slug === 'hotel' && x.isSystem))
  assert.equal((await json(await mg.categoriesPOST(req({ name: `${tag} Lain` })))).status, 403); assert.equal((await json(await anon.categoriesGET())).status, 403)
})

await t('kategori bawaan sistem tak bisa dinonaktifkan/dihapus (409), tapi boleh diganti namanya; kategori dipakai → hapus = NONAKTIF (vendor tetap berkategori), tak dipakai → terhapus; kategori nonaktif tak bisa dipasang ke vendor baru', async () => {
  const hotel = await prisma.vendorCategory.findUniqueOrThrow({ where: { slug: 'hotel' } })
  assert.equal((await json(await su.categoryPUT(req({ isActive: false }), ctx(hotel.id)))).status, 409); assert.equal((await json(await su.categoryDELETE(req(), ctx(hotel.id)))).status, 409)
  const used = (await json(await su.categoriesPOST(req({ name: `${tag} Dipakai` })))).body.data; createdCategories.push(used.id)
  const v = await mk('PemakaiKategori', { categoryIds: [used.id] })
  const d = await json(await su.categoryDELETE(req(), ctx(used.id)))
  assert.equal(d.status, 200); assert.equal(d.body.data.deleted, false); assert.equal(d.body.data.vendorCount, 1)
  assert.equal((await rawVendor(v.id))!.categories.some(c => c.id === used.id), true, 'vendor tetap berkategori')
  assert.equal((await json(await su.vendorsPOST(req({ name: `${tag} Baru`, countryCode: 'SA', categoryIds: [used.id] })))).status, 400)
  const free = (await json(await su.categoriesPOST(req({ name: `${tag} Bebas` })))).body.data
  assert.deepEqual((await json(await su.categoryDELETE(req(), ctx(free.id)))).body.data, { deleted: true })
  assert.equal((await json(await su.categoryDELETE(req(), ctx(randomUUID())))).status, 404)
  assert.equal((await json(await su.categoryPUT(req({ isActive: true }), ctx(used.id)))).body.data.isActive, true)
})

console.log('== integrasi dengan route biaya ==')

await t('route biaya bersama: vendor NONAKTIF → 400 jelas (menyebut menu Vendor), vendor tak ada → 400, aktif → 201', async () => {
  const H = createCostComponentHandlers('haji', { authorize: async () => undefined })
  const haji = await prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'khusus', year: 2027, totalQuota: 1 } })
  const v = await mk('UntukBiaya')
  const post = async (vendorId: string) => H.collectionPOST(req({ costComponent: 'K', vendorId, currency: 'IDR', cost: 1000 }), ctx(haji.id))
  assert.equal((await post(v.id)).status, 201)
  await prisma.vendor.update({ where: { id: v.id }, data: { isActive: false } })
  const inactive = await json(await post(v.id)); assert.equal(inactive.status, 400); assert.match(inactive.body.error!, /nonaktif.*menu Vendor/)
  assert.equal((await post(randomUUID())).status, 400)
  await prisma.productCost.deleteMany({ where: { productId: haji.id } }); await prisma.hajiProduct.delete({ where: { id: haji.id } })
})

console.log('== penjaga sumber ==')

await t('HANYA lib/vendors/service.ts yang menulis tabel vendor/kategori (tak ada create/update/delete/upsert vendor di app/ atau lib/ lainnya); Muthowif tak membuat vendor; routes tipis', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [] })
  const writers = [...walk('app'), ...walk('lib'), ...walk('components')]
    .filter(f => f !== 'lib/vendors/service.ts' && /prisma\.(vendor|vendorCategory)\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers, [], 'penulis tabel vendor selain layanan:')
  const mu = readFileSync('app/api/v1/admin/products/muthowif/service-price/cost/route.ts', 'utf8')
  assert.doesNotMatch(mu, /vendor\.create|getOrCreateSaudinesiaVendor/); assert.match(mu, /systemKey: SYSTEM_VENDOR_KEYS\.saudinesia/)
  for (const f of ['vendors/route.ts', 'vendors/[id]/route.ts', 'vendor-categories/route.ts', 'vendor-categories/[id]/route.ts']) {
    const src = readFileSync(`app/api/v1/admin/system/${f}`, 'utf8')
    assert.match(src, /createVendorHandlers\(\)/, f); assert.ok(src.split('\n').length <= 10, f); assert.doesNotMatch(src, /prisma/, f)
  }
  for (const f of ['flight/schedules/[id]/cost', 'transport/pricing/[id]/cost', 'hotels/[id]/periods/[periodId]/prices', 'visa/[id]/cost-tiers']) {
    const src = readFileSync(`app/api/v1/admin/products/${f}/route.ts`, 'utf8')
    assert.match(src, /await assertVendorUsable\(/, `${f}: PUT harus memeriksa vendor`); assert.match(src, /vendorNotUsableResponse\(e\)/, `${f}: galat vendor → 400`)
  }
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
const vendors = await prisma.vendor.findMany({ where: { name: { startsWith: tag } }, select: { id: true, addressId: true } })
const ids = vendors.map(v => v.id)
await prisma.productCost.deleteMany({ where: { vendorId: { in: ids } } }); await prisma.preferredVendor.deleteMany({ where: { vendorId: { in: ids } } })
await prisma.vendor.deleteMany({ where: { id: { in: ids } } })
await prisma.address.deleteMany({ where: { id: { in: vendors.map(v => v.addressId).filter((x): x is string => !!x) } } })
await prisma.vendorCategory.deleteMany({ where: { OR: [{ id: { in: createdCategories } }, { slug: { startsWith: tag } }] } })
await prisma.booking.deleteMany({ where: { user: { email: { startsWith: tag } } } }); await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
