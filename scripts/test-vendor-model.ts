// Uji model vendor tunggal (ADR-0003, docs/arsitektur-vendor.md, Fase 1) terhadap DATABASE SUNGGUHAN: kategori/vendor sistem hasil migrasi,
// kesamaan nameKey TS↔SQL, keunikan, FK, many-to-many, skema Zod, assertVendorUsable dan penghitung pemakaian (termasuk snapshot visa).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { SYSTEM_VENDOR_CATEGORIES, SYSTEM_VENDOR_KEYS, VENDOR_CONTEXT_CATEGORIES, VENDOR_CATEGORY_SLUGS, slugifyCategoryName, vendorNameKey } from '@/lib/constants/vendor'
import { vendorCategoryCreateSchema, vendorCategoryUpdateSchema, vendorCreateSchema, vendorUpdateSchema } from '@/lib/validators/vendor'
import { VendorNotUsableError, assertVendorUsable, getVendorUsage } from '@/lib/vendors/integrity'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

const tag = `vm${Date.now()}`
const created = { vendors: [] as string[], categories: [] as string[], users: [] as string[] }
const mkVendor = async (name: string, extra: Record<string, unknown> = {}) => {
  const v = await prisma.vendor.create({ data: { name: `${tag} ${name}`, nameKey: vendorNameKey(`${tag} ${name}`), countryCode: 'SA', ...extra } })
  created.vendors.push(v.id)
  return v
}
const rejects = async (p: Promise<unknown>) => { try { await p } catch { return true } return false }

console.log('== hasil migrasi ==')

await t('9 kategori sistem ada di DB dan SAMA dengan lib/constants/vendor.ts (slug, nama, urutan, isSystem)', async () => {
  const rows = await prisma.vendorCategory.findMany({ where: { isSystem: true }, orderBy: { sortOrder: 'asc' } })
  assert.deepEqual(rows.map(r => ({ slug: r.slug, name: r.name, sortOrder: r.sortOrder })), SYSTEM_VENDOR_CATEGORIES.map(c => ({ ...c })))
  assert.deepEqual(new Set(Object.values(VENDOR_CATEGORY_SLUGS)), new Set(rows.map(r => r.slug)))
  for (const ctx of Object.values(VENDOR_CONTEXT_CATEGORIES)) for (const slug of ctx ?? []) assert.ok(rows.some(r => r.slug === slug), `konteks memakai slug yang tak ada: ${slug}`)
})

await t('vendor sistem "Saudinesia" ada: systemKey, negara ID, kategori internal', async () => {
  const v = await prisma.vendor.findUnique({ where: { systemKey: SYSTEM_VENDOR_KEYS.saudinesia }, include: { categories: true } })
  assert.ok(v); assert.equal(v.countryCode, 'ID'); assert.equal(v.isActive, true)
  assert.deepEqual(v.categories.map(c => c.slug), ['internal'])
})

console.log('== kunci nama, keunikan, FK ==')

await t('vendorNameKey (TS) == lower(regexp_replace(btrim(name), \'\\s+\', \' \', \'g\')) (SQL, dipakai migrasi) untuk spasi ganda/tab/huruf besar', async () => {
  for (const sample of ['Mas Adam', '  Mas   ADAM  ', 'Al-Rajhi\tBus', 'PT  Saudi\n Air', 'x']) {
    // $queryRawUnsafe + '\\s+': template literal bertag akan memakan backslash (\s → s) dan menghasilkan pola yang salah.
    const [row] = await prisma.$queryRawUnsafe<Array<{ k: string }>>("select lower(regexp_replace(btrim($1), '\\s+', ' ', 'g')) as k", sample)
    assert.equal(vendorNameKey(sample), row!.k, JSON.stringify(sample))
  }
})

await t('keunikan (nameKey, countryCode): duplikat ditolak; negara lain diizinkan; nameKey/countryCode NOT NULL (tanpa keduanya ditolak)', async () => {
  const a = await mkVendor('Unik')
  assert.ok(await rejects(prisma.vendor.create({ data: { name: 'dup', nameKey: a.nameKey, countryCode: 'SA' } })), 'duplikat harus ditolak')
  const other = await prisma.vendor.create({ data: { name: 'dup', nameKey: a.nameKey, countryCode: 'ID' } }); created.vendors.push(other.id)
  const bare = prisma.vendor.create({ data: { name: 'legacy1' } as never }) // tipe sengaja dilonggarkan: yang diuji adalah penolakan DB
  assert.ok(await rejects(bare), 'vendor tanpa nameKey/countryCode harus ditolak (NOT NULL)')
})

await t('FK: vendor yang dirujuk PreferredVendor atau ProductCost TIDAK bisa dihapus (Restrict); vendor sistem unik', async () => {
  const v = await mkVendor('Dirujuk')
  const pv = await prisma.preferredVendor.create({ data: { productType: 'visa', productId: randomUUID(), costComponent: 'individu', vendorId: v.id } })
  assert.ok(await rejects(prisma.vendor.delete({ where: { id: v.id } })), 'FK PreferredVendor harus menahan hapus')
  assert.ok(await rejects(prisma.preferredVendor.create({ data: { productType: 'visa', productId: randomUUID(), costComponent: 'x', vendorId: randomUUID() } })), 'vendor pilihan yatim harus ditolak FK')
  await prisma.preferredVendor.delete({ where: { id: pv.id } })
  const c = await prisma.productCost.create({ data: { productType: 'haji', productId: randomUUID(), vendorId: v.id, costComponent: 'k', currency: 'IDR', costTiers: [] } })
  assert.ok(await rejects(prisma.vendor.delete({ where: { id: v.id } })), 'FK ProductCost harus menahan hapus')
  await prisma.productCost.delete({ where: { id: c.id } })
  assert.ok(await rejects(prisma.vendor.create({ data: { name: 'sys2', nameKey: 'sys2', countryCode: 'ID', systemKey: SYSTEM_VENDOR_KEYS.saudinesia } })), 'systemKey unik')
})

await t('many-to-many: satu vendor banyak kategori; kategori dipakai banyak vendor; hapus vendor melepas tautan (kategori tak ikut terhapus)', async () => {
  const hotel = await prisma.vendorCategory.findUniqueOrThrow({ where: { slug: 'hotel' } }), bus = await prisma.vendorCategory.findUniqueOrThrow({ where: { slug: 'transport' } })
  const v = await mkVendor('MultiLayanan', { categories: { connect: [{ id: hotel.id }, { id: bus.id }] } })
  const got = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id }, include: { categories: true } })
  assert.deepEqual(got.categories.map(c => c.slug).sort(), ['hotel', 'transport'])
  assert.equal(await prisma.vendor.count({ where: { id: v.id, categories: { some: { slug: 'hotel' } } } }), 1, 'filter per kategori')
  await prisma.vendor.delete({ where: { id: v.id } }); created.vendors.splice(created.vendors.indexOf(v.id), 1)
  assert.ok(await prisma.vendorCategory.findUnique({ where: { id: hotel.id } }))
  assert.equal(await prisma.$queryRaw`select 1 from "_VendorToVendorCategory" where "A" = ${v.id}`.then(r => (r as unknown[]).length), 0)
})

console.log('== integritas ==')

await t('assertVendorUsable: aktif lolos; tak ada → not_found; nonaktif → inactive (pesan menyebut cara memulihkan)', async () => {
  const v = await mkVendor('Aktif')
  await assertVendorUsable(v.id)
  await assert.rejects(assertVendorUsable(randomUUID()), (e) => e instanceof VendorNotUsableError && e.reason === 'not_found')
  await prisma.vendor.update({ where: { id: v.id }, data: { isActive: false } })
  await assert.rejects(assertVendorUsable(v.id), (e) => e instanceof VendorNotUsableError && e.reason === 'inactive' && /menu Vendor/.test(e.message))
})

await t('getVendorUsage: biaya per productType + vendor pilihan + snapshot harga (JSON array_contains); vendor kosong → 0; vendor lain tak ikut', async () => {
  const v = await mkVendor('Dipakai'), other = await mkVendor('Lain')
  const cost = (type: string, vid: string) => prisma.productCost.create({ data: { productType: type, productId: randomUUID(), vendorId: vid, costComponent: 'k', currency: 'IDR', costTiers: [] } })
  await cost('haji', v.id); await cost('haji', v.id); await cost('package', v.id); await cost('flight', other.id)
  await prisma.preferredVendor.create({ data: { productType: 'flight', productId: randomUUID(), costComponent: 'tiket', vendorId: v.id } })
  const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } }); created.users.push(user.id)
  const bk = await prisma.booking.create({ data: { bookingCode: `VM${Date.now()}`, userId: user.id, departureDate: new Date('2027-01-01'), returnDate: new Date('2027-01-10'), season: 'regular', totalAmount: 1 } })
  // riwayat vendor ada di snapshot harga beku (kolom VisaApplication.vendorIdsUsed sudah dihapus — harga terpadu Fase 5)
  await prisma.priceSnapshot.create({ data: { bookingId: bk.id, itemType: 'visa', itemId: randomUUID(), itemLabel: 'Visa', itemQty: 1, description: 'Visa', qty: 1, unit: 'person', unitSellIdr: 1, totalSellIdr: 1, mode: 'auto', vendorIds: [v.id] } })
  const u = await getVendorUsage(v.id)
  assert.deepEqual(u, { costsByType: { haji: 2, package: 1 }, costs: 3, preferred: 1, snapshots: 1, costActuals: 0, total: 5 })
  assert.deepEqual(await getVendorUsage((await mkVendor('Kosong')).id), { costsByType: {}, costs: 0, preferred: 0, snapshots: 0, costActuals: 0, total: 0 })
  assert.equal((await getVendorUsage(other.id)).snapshots, 0, 'snapshot milik vendor lain tak boleh terhitung')
  await prisma.booking.delete({ where: { id: bk.id } })
})

console.log('== skema Zod ==')

await t('vendorCreateSchema: payload lengkap lolos & dinormalisasi; kolom kosong → null; wajib: nama, negara ISO, ≥1 kategori; pasangan kode negara untuk nomor', () => {
  const cat = randomUUID()
  const ok = vendorCreateSchema.safeParse({ name: '  Mas Adam  ', countryCode: 'SA', categoryIds: [cat], contactName: '', phoneCountryCode: 'SA', phone: '+966 55-123 4567', whatsappCountryCode: null, whatsapp: '',
    email: ' Info@MasAdam.COM ', website: 'https://masadam.example', notes: '', isActive: undefined })
  assert.equal(ok.success, true)
  if (ok.success) {
    assert.equal(ok.data.name, 'Mas Adam'); assert.equal(ok.data.phone, '966551234567'); assert.equal(ok.data.email, 'info@masadam.com')
    assert.equal(ok.data.contactName, null); assert.equal(ok.data.whatsapp, null); assert.equal(ok.data.notes, null); assert.equal(ok.data.isActive, true)
  }
  const base = { name: 'X', countryCode: 'SA', categoryIds: [cat] }
  assert.equal(vendorCreateSchema.safeParse(base).success, true)
  for (const bad of [{ ...base, name: '  ' }, { ...base, countryCode: 'ZZ' }, { ...base, countryCode: 'Saudi Arabia' }, { ...base, categoryIds: [] }, { ...base, categoryIds: [cat, cat] }, { ...base, categoryIds: ['bukan-uuid'] },
    { ...base, phone: '12' }, { ...base, phone: '5551234567' }, { ...base, whatsapp: '5551234567' }, { ...base, email: 'bukan-email' }, { ...base, website: 'ftp://x' }, { ...base, website: 'javascript:alert(1)' },
    { ...base, systemKey: 'saudinesia' }, { ...base, nameKey: 'x' }, { ...base, category: 'hotel' }, { ...base, country: 'Saudi Arabia' }, { ...base, contactInfo: 'x' }]) {
    assert.equal(vendorCreateSchema.safeParse(bad).success, false, JSON.stringify(bad))
  }
})

await t('vendorUpdateSchema: sebagian bidang sah; kosong/kolom liar ditolak; kategori kosong ditolak; vendorCategory schema strict', () => {
  assert.equal(vendorUpdateSchema.safeParse({ notes: 'baru' }).success, true)
  assert.equal(vendorUpdateSchema.safeParse({ isActive: false }).success, true)
  for (const bad of [{}, { categoryIds: [] }, { systemKey: 'x' }, { countryCode: 'XX' }, { phone: '55512345' }]) assert.equal(vendorUpdateSchema.safeParse(bad).success, false, JSON.stringify(bad))
  assert.equal(vendorCategoryCreateSchema.safeParse({ name: 'Rental Mobil' }).success, true)
  assert.equal(vendorCategoryCreateSchema.safeParse({ name: 'R', slug: 'x' }).success, false); assert.equal(vendorCategoryCreateSchema.safeParse({ name: 'R' }).success, false)
  assert.equal(vendorCategoryUpdateSchema.safeParse({ isActive: false }).success, true); assert.equal(vendorCategoryUpdateSchema.safeParse({ isSystem: false }).success, false)
  assert.equal(vendorCategoryUpdateSchema.safeParse({}).success, false)
})

await t('slugifyCategoryName: tanpa aksen, huruf kecil, pemisah tunggal; nama tanpa huruf/angka → kosong (ditolak pemanggil)', () => {
  assert.equal(slugifyCategoryName('Rental Mobil'), 'rental-mobil'); assert.equal(slugifyCategoryName('  Café / Résto!! '), 'cafe-resto')
  assert.equal(slugifyCategoryName('Visa / Syarikah'), 'visa-syarikah'); assert.equal(slugifyCategoryName('***'), '')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.productCost.deleteMany({ where: { vendorId: { in: created.vendors } } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: { in: created.vendors } } })
await prisma.vendor.deleteMany({ where: { id: { in: created.vendors } } })
await prisma.vendor.deleteMany({ where: { name: { in: ['dup', 'legacy1', 'legacy2'] } } })
await prisma.booking.deleteMany({ where: { userId: { in: created.users } } }) // juga bila tes gagal sebelum menghapusnya sendiri
await prisma.notificationLog.deleteMany({ where: { userId: { in: created.users } } })
await prisma.user.deleteMany({ where: { id: { in: created.users } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
