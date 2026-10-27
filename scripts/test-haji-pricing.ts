// Uji harga Haji dari Komponen Biaya + CRUD aman + penjaga booking (docs/arsitektur-komponen-biaya.md, Fase 3) terhadap DATABASE SUNGGUHAN.
// Mencakup SEC-66 (Haji berharga 0 / nonaktif tidak boleh dipesan), semantik hapus-atau-nonaktifkan, katalog publik tanpa kolom kuota mentah.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { computeHajiBreakdown } from '@/lib/pricing/computeHajiPrice'
import { getPricePoint, repriceOwner, repriceOwnerType } from '@/lib/pricing/engine'
import { createCostComponentHandlers } from '@/lib/pricing/costComponentHandlers'
import { reserveHaji } from '@/lib/quota/adapters'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { deleteOrDeactivateHaji } from '@/lib/haji/delete'
import { hajiAvailable, hajiPriced, toCatalogHaji } from '@/lib/haji/catalog'
import { hajiProductCreateSchema, hajiProductUpdateSchema } from '@/lib/validators/adminUpdates'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const tag = `hj${Date.now()}`
const SRC = `HJ_TEST_${tag}`
const H = createCostComponentHandlers('haji', { authorize: async () => undefined })
const asManager = createCostComponentHandlers('haji', { authorize: async () => { throw new Error('Forbidden') } })

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
await prisma.exchangeRate.createMany({ data: [
  { fromCurrency: 'USD', toCurrency: 'IDR', midRate: 16000, spreadPercent: 2.5, sellRate: 16400, source: SRC, fetchedAt: new Date(Date.now() + 1000) },
  { fromCurrency: 'SAR', toCurrency: 'IDR', midRate: 4250, spreadPercent: 2.5, sellRate: 4350, source: SRC, fetchedAt: new Date(Date.now() + 1000) },
] })
const savedRules = await prisma.pricingRule.findMany({ where: { productType: { in: ['haji', 'package'] } } })
await prisma.pricingRule.deleteMany({ where: { productType: { in: ['haji', 'package'] } } })
await prisma.pricingRule.create({ data: { productType: 'haji', defaultMarginPercent: 40, roundingIncrement: 100000 } })

const mkHaji = (extra: Record<string, unknown> = {}) =>
  prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'khusus', year: 2027, totalQuota: 10, ...extra } })
const req = (body?: unknown) => new Request('http://test.local/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ictx = (id: string, costId: string) => ({ params: Promise.resolve({ id, costId }) })
const priceOf = async (id: string) => (await getPricePoint('haji', id))?.sellIdr ?? 0 // 0 = belum ada titik harga (belum berharga)
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const created: string[] = []
const haji = async (extra: Record<string, unknown> = {}) => { const p = await mkHaji(extra); created.push(p.id); return p }
// Sejak Fase 2 harga dibaca dari titik harga (bukan kolom `price`): produk "berharga" = punya titik harga `haji` bernilai itu.
const pricePoint = (ownerId: string, price: number) => prisma.pricePoint.create({ data: { ownerType: 'haji', ownerId, unit: 'package', autoSellIdr: price, sellIdr: price } })

console.log('== harga dari Komponen Biaya ==')

await t('CRUD komponen lewat handler bersama menghitung ulang HajiProduct.price (margin tipe `haji` 40 %, bulat 100.000); hapus semua → kembali 0', async () => {
  const h = await haji()
  assert.equal(await priceOf(h.id), 0)
  const post = async (body: unknown) => (await H.collectionPOST(req(body), ctx(h.id))).status
  assert.equal(await post({ costComponent: 'Visa Haji', vendorId: vendor.id, currency: 'USD', cost: 5000 }), 201)   // 5.000×16.400 = 82.000.000 ×1,4 = 114.800.000 → 114.800.000
  assert.equal(await post({ costComponent: 'Akomodasi', vendorId: vendor.id, currency: 'SAR', cost: 30000 }), 201)   // 30.000×4.350 = 130.500.000 ×1,4 = 182.700.000 → 182.700.000
  assert.equal(await post({ costComponent: 'Admin', vendorId: vendor.id, currency: 'IDR', cost: 1234567 }), 201)      // ×1,4 = 1.728.393,8 → 1.700.000
  assert.equal(await priceOf(h.id), 114800000 + 182700000 + 1700000)
  const b = await computeHajiBreakdown(h.id)
  assert.equal(b.components.length, 3); assert.equal(b.componentsTotalSellPrice, 299200000)
  const costs = await prisma.productCost.findMany({ where: { productType: 'haji', productId: h.id } })
  const admin = costs.find((c) => c.costComponent === 'Admin')!
  assert.equal((await H.itemPUT(req({ cost: 100000 }), ictx(h.id, admin.id))).status, 200)
  assert.equal(await priceOf(h.id), 114800000 + 182700000 + 100000) // 100.000 × 1,4 = 140.000 → dibulatkan ke kelipatan 100.000
  for (const c of costs) assert.equal((await H.itemDELETE(req(), ictx(h.id, c.id))).status, 200)
  assert.equal(await priceOf(h.id), 0)
})

await t('tanpa aturan margin `haji` jatuh ke aturan global/default (20 %, bulat 50.000) — perilaku sama modul lain', async () => {
  await prisma.pricingRule.deleteMany({ where: { productType: 'haji' } })
  const h = await haji()
  await prisma.productCost.create({ data: { productType: 'haji', productId: h.id, vendorId: vendor.id, costComponent: 'X', currency: 'IDR', costTiers: flat(1000000) } })
  const global = await prisma.pricingRule.findFirst({ where: { productType: 'global' } })
  const pct = global ? Number(global.defaultMarginPercent) : 20, inc = global ? global.roundingIncrement : 50000
  assert.equal((await computeHajiBreakdown(h.id)).componentsTotalSellPrice, Math.round(1000000 * (1 + pct / 100) / inc) * inc)
  await prisma.pricingRule.create({ data: { productType: 'haji', defaultMarginPercent: 40, roundingIncrement: 100000 } })
})

await t('komponen biaya Haji dicakup ke produk dan modulnya: milik paket/produk lain → 404; produk Haji tak ada → 404 tanpa baris yatim; vendor ngawur → 400', async () => {
  const h = await haji(), other = await haji()
  const foreignPkg = await prisma.productCost.create({ data: { productType: 'package', productId: randomUUID(), vendorId: vendor.id, costComponent: 'Milik Paket', currency: 'IDR', costTiers: flat(1000) } })
  const otherHaji = await prisma.productCost.create({ data: { productType: 'haji', productId: other.id, vendorId: vendor.id, costComponent: 'Milik Haji Lain', currency: 'IDR', costTiers: flat(1000) } })
  for (const cid of [foreignPkg.id, otherHaji.id]) {
    assert.equal((await H.itemPUT(req({ cost: 9 }), ictx(h.id, cid))).status, 404)
    assert.equal((await H.itemDELETE(req(), ictx(h.id, cid))).status, 404)
  }
  const ghost = randomUUID()
  assert.equal((await H.collectionPOST(req({ costComponent: 'Y', vendorId: vendor.id, currency: 'IDR', cost: 1 }), ctx(ghost))).status, 404)
  assert.equal(await prisma.productCost.count({ where: { productId: ghost } }), 0)
  assert.equal((await H.collectionPOST(req({ costComponent: 'Y', vendorId: randomUUID(), currency: 'IDR', cost: 1 }), ctx(h.id))).status, 400)
  assert.equal((await asManager.collectionPOST(req({ costComponent: 'Y', vendorId: vendor.id, currency: 'IDR', cost: 1 }), ctx(h.id))).status, 403)
  await prisma.productCost.deleteMany({ where: { id: { in: [foreignPkg.id, otherHaji.id] } } })
})

await t('cron kurs: repriceOwnerType menghitung ulang produk berkomponen mata uang yang berubah (juga yang NONAKTIF); produk tanpa komponen mata uang itu tak disentuh', async () => {
  const usd = await haji(), idr = await haji(), off = await haji({ isActive: false })
  await prisma.productCost.create({ data: { productType: 'haji', productId: usd.id, vendorId: vendor.id, costComponent: 'U', currency: 'USD', costTiers: flat(5000) } })
  await prisma.productCost.create({ data: { productType: 'haji', productId: idr.id, vendorId: vendor.id, costComponent: 'I', currency: 'IDR', costTiers: flat(5000000) } })
  await prisma.productCost.create({ data: { productType: 'haji', productId: off.id, vendorId: vendor.id, costComponent: 'U', currency: 'USD', costTiers: flat(5000) } })
  await prisma.pricePoint.create({ data: { ownerType: 'haji', ownerId: idr.id, unit: 'package', autoSellIdr: 1, sellIdr: 1 } }) // titik harga basi — tak boleh disentuh siklus USD
  await repriceOwnerType('haji', ['USD'])
  assert.equal(await priceOf(usd.id), 114800000); assert.equal(await priceOf(off.id), 114800000, 'produk nonaktif ikut dihitung ulang')
  assert.equal(await priceOf(idr.id), 1, 'tanpa komponen USD tak disentuh')
  await repriceOwnerType('haji')
  assert.equal(await priceOf(idr.id), 7000000)
  await repriceOwner('haji', usd.id)
})

console.log('== guard booking (SEC-66) ==')

const tryReserve = (id: string, n: number) => prisma.$transaction((tx) => reserveHaji(tx, id, n))

await t('produk NONAKTIF atau BELUM BERHARGA ditolak (ItemNotBookableError) dan kuota TIDAK ditahan; produk berharga & aktif lolos dan kuota pending naik', async () => {
  const unpriced = await haji(), inactive = await haji({ isActive: false }), good = await haji()
  await pricePoint(inactive.id, 1000000); await pricePoint(good.id, 5000000) // `unpriced` sengaja tanpa titik harga
  await assert.rejects(tryReserve(unpriced.id, 1), (e) => e instanceof ItemNotBookableError && /belum ditetapkan/.test(e.message))
  await assert.rejects(tryReserve(inactive.id, 1), (e) => e instanceof ItemNotBookableError && /tidak tersedia/.test(e.message))
  for (const id of [unpriced.id, inactive.id]) assert.equal((await prisma.hajiProduct.findUniqueOrThrow({ where: { id } })).pendingQuota, 0)
  await tryReserve(good.id, 3)
  assert.equal((await prisma.hajiProduct.findUniqueOrThrow({ where: { id: good.id } })).pendingQuota, 3)
})

await t('kuota habis tetap error "insufficient" (→ 409, bukan 422) dan transaksi rollback', async () => {
  const p = await haji({ totalQuota: 2 })
  await pricePoint(p.id, 5000000)
  await assert.rejects(tryReserve(p.id, 3), (e) => !(e instanceof ItemNotBookableError) && /insufficient/.test((e as Error).message))
  assert.equal((await prisma.hajiProduct.findUniqueOrThrow({ where: { id: p.id } })).pendingQuota, 0)
})

console.log('== CRUD: hapus aman ==')

await t('belum pernah dipesan → HAPUS SUNGGUHAN beserta komponen/vendor pilihan/syarat dokumen/field manifest miliknya; baris milik produk lain tak tersentuh', async () => {
  const h = await haji(), other = await haji()
  const mine = { productType: 'haji', productId: h.id }, theirs = { productType: 'haji', productId: other.id }
  for (const scope of [mine, theirs]) {
    await prisma.productCost.create({ data: { ...scope, vendorId: vendor.id, costComponent: 'K', currency: 'IDR', costTiers: flat(1000) } })
    await prisma.preferredVendor.create({ data: { ...scope, costComponent: 'K', vendorId: vendor.id } })
    await prisma.documentRequirement.create({ data: { ...scope, docType: 'passport', label: 'Paspor' } })
    await prisma.manifestFieldRequirement.create({ data: { ...scope, fieldKey: `f_${randomUUID().slice(0, 6)}`, label: 'F', fieldType: 'text' } })
  }
  assert.deepEqual(await deleteOrDeactivateHaji(h.id), { found: true, deleted: true })
  assert.equal(await prisma.hajiProduct.count({ where: { id: h.id } }), 0)
  for (const m of ['productCost', 'preferredVendor', 'documentRequirement', 'manifestFieldRequirement'] as const) {
    assert.equal(await (prisma[m] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: mine }), 0, `${m} milik produk harus ikut terhapus`)
    assert.equal(await (prisma[m] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: theirs }), 1, `${m} milik produk lain harus tetap`)
  }
  assert.equal(await prisma.hajiProduct.count({ where: { id: other.id } }), 1)
})

await t('sudah ada booking → TIDAK dihapus, dinonaktifkan; booking dan komponen biaya utuh; hitungan booking dilaporkan; id tak ada → found:false', async () => {
  const h = await haji()
  const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Haji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  const bk = await prisma.booking.create({ data: { bookingCode: `HJ${Date.now()}`, userId: user.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-07-10'), season: 'hajj', totalAmount: 5000000 } })
  await prisma.bookingHaji.create({ data: { bookingId: bk.id, hajiProductId: h.id, numPersons: 1, totalPrice: 5000000 } })
  await prisma.productCost.create({ data: { productType: 'haji', productId: h.id, vendorId: vendor.id, costComponent: 'K', currency: 'IDR', costTiers: flat(1000) } })
  assert.deepEqual(await deleteOrDeactivateHaji(h.id), { found: true, deleted: false, bookingCount: 1 })
  const after = await prisma.hajiProduct.findUniqueOrThrow({ where: { id: h.id } })
  assert.equal(after.isActive, false)
  assert.equal(await prisma.bookingHaji.count({ where: { hajiProductId: h.id } }), 1)
  assert.equal(await prisma.productCost.count({ where: { productType: 'haji', productId: h.id } }), 1, 'komponen biaya produk bertransaksi tidak dihapus')
  assert.deepEqual(await deleteOrDeactivateHaji(randomUUID()), { found: false })
  await prisma.booking.delete({ where: { id: bk.id } }); await prisma.user.delete({ where: { id: user.id } })
})

console.log('== kontrak masukan & katalog ==')

await t('harga BUKAN masukan: skema buat/ubah menolak `price`; mengaktifkan kembali (isActive) sah; kolom liar ditolak', () => {
  const base = { name: 'Haji X', hajiType: 'khusus', year: 2027, totalQuota: 5 }
  assert.equal(hajiProductCreateSchema.safeParse(base).success, true)
  assert.equal(hajiProductCreateSchema.safeParse({ ...base, price: 100 }).success, false)
  assert.equal(hajiProductUpdateSchema.safeParse({ price: 100 }).success, false)
  assert.equal(hajiProductUpdateSchema.safeParse({ isActive: true }).success, true)
  assert.equal(hajiProductUpdateSchema.safeParse({ pendingQuota: 0 }).success, false)
})

await t('katalog publik: peta eksplisit tanpa kolom kuota mentah; available = total − pending − booked (tak negatif); priced mengikuti cache', async () => {
  const p = await prisma.hajiProduct.create({ data: { name: `${tag} kat`, hajiType: 'reguler', year: 2028, totalQuota: 10, pendingQuota: 3, bookedQuota: 4 } })
  created.push(p.id)
  const c = toCatalogHaji(p, 0)
  assert.equal(c.available, 3); assert.equal(c.priced, false); assert.equal(hajiPriced(1), true); assert.equal(toCatalogHaji(p, 5_000_000).price, 5_000_000)
  for (const k of ['totalQuota', 'pendingQuota', 'bookedQuota', 'isActive', 'createdAt']) assert.ok(!(k in c), `${k} tak boleh ada di respons publik`)
  assert.equal(hajiAvailable({ totalQuota: 2, pendingQuota: 2, bookedQuota: 2 }), 0)
})

console.log('== penjaga sumber ==')

await t('wiring: route [id] punya GET/PUT/DELETE (DELETE lewat deleteOrDeactivateHaji), route biaya Haji tipis, POST membuat produk tanpa titik harga, booking memetakan ItemNotBookableError → 422, cron memanggil agregator (mesin harga) yang memuat Haji', () => {
  const byId = readFileSync('app/api/v1/admin/products/haji/[id]/route.ts', 'utf8')
  for (const v of ['GET', 'PUT', 'DELETE']) assert.match(byId, new RegExp(`export async function ${v}\\(`))
  assert.match(byId, /deleteOrDeactivateHaji\(id\)/); assert.match(byId, /requireManager\(\)/)
  for (const f of ['costs/route.ts', 'costs/[costId]/route.ts', 'costs/simulate/route.ts']) {
    const src = readFileSync(`app/api/v1/admin/products/haji/[id]/${f}`, 'utf8')
    assert.match(src, /createCostComponentHandlers\('haji'\)/, f); assert.ok(src.split('\n').length <= 10, f); assert.doesNotMatch(src, /prisma|productCost/i, f)
  }
  assert.doesNotMatch(readFileSync('app/api/v1/admin/products/haji/route.ts', 'utf8'), /price: 0/) // produk baru TANPA titik harga (belum berharga) — kolom harga sudah dihapus
  const bk = readFileSync('app/api/v1/bookings/route.ts', 'utf8')
  assert.match(bk, /error instanceof ItemNotBookableError\) return NextResponse\.json\(err\(error\.message\), \{ status: 422 \}\)/)
  assert.ok(bk.indexOf('ItemNotBookableError)') < bk.indexOf("includes('insufficient')"), '422 dicek sebelum pemetaan 409')
  const cron = readFileSync('lib/cron/exchangeRateJob.ts', 'utf8')
  // Daftar refresh kini satu (lib/pricing/refreshAll.ts, Fase 0 harga terpadu): cron memakai agregator, Haji ada di dalamnya.
  assert.match(cron, /refreshAllPricingCaches\(updatedCurrencies\)/)
  assert.match(readFileSync('lib/pricing/refreshAll.ts', 'utf8'), /repriceAll\(currencies\)/)
  assert.match(readFileSync('lib/pricing/engine/owners/index.ts', 'utf8'), /haji: hajiOwner/) // Fase 1: agregator = mesin harga, pemilik Haji terdaftar di registry
  assert.match(readFileSync('lib/pricing/costComponentOwners.ts', 'utf8'), /haji: \{\s*productType: 'haji'/)
  const cat = readFileSync('app/api/v1/catalog/haji/route.ts', 'utf8')
  assert.match(cat, /toCatalogHaji/); assert.doesNotMatch(cat, /\.\.\.p\b/, 'katalog tak boleh menyebar baris DB mentah')
  assert.match(readFileSync('lib/haji/delete.ts', 'utf8'), /P2003/)
})

await t('UI Haji (Fase 4): halaman edit memakai panel Komponen Biaya Haji, punya Simpan (PUT), Hapus/Nonaktifkan (DELETE) dan saklar Aktif; daftar menautkan ke halaman edit; tak ada input harga', () => {
  const dir = 'app/[locale]/admin/(protected)/products/haji'
  const edit = readFileSync(`${dir}/[id]/page.tsx`, 'utf8')
  assert.match(edit, /<CostComponentsPanel[\s\S]*?apiBase=\{`\/api\/v1\/admin\/products\/haji\/\$\{id\}\/costs`\}/)
  // Simpan/hapus/aktif kini lewat EditPage + useEditEntity (PUT/DELETE satu pintu yang memeriksa respons; docs/arsitektur-admin-editor.md §5).
  assert.match(edit, /<EditPage\b/); assert.match(edit, /useEditEntity</); assert.match(edit, /e\.save\(/); assert.match(edit, /e\.remove\(/)
  assert.match(edit, /Nonaktifkan produk/); assert.match(edit, /Hapus produk/); assert.match(edit, /active=\{form\.isActive\}/)
  assert.doesNotMatch(edit, /name="price"|form\.price|price: Number\(form/, 'harga bukan masukan')
  const list = readFileSync(`${dir}/page.tsx`, 'utf8')
  assert.match(list, /admin\/products\/haji\/\$\{h\.id\}/); assert.match(list, /Kelola/)
  assert.doesNotMatch(list, /price: \+form|form\.price/, 'form buat tak boleh mengirim harga')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.pricePoint.deleteMany({ where: { ownerType: 'haji', ownerId: { in: created } } })
await prisma.productCost.deleteMany({ where: { productType: 'haji', productId: { in: created } } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } }) // FK Restrict (ADR-0003): vendor pilihan harus hilang sebelum vendor
await prisma.hajiProduct.deleteMany({ where: { id: { in: created } } })
await prisma.vendor.deleteMany({ where: { id: vendor.id } })
await prisma.exchangeRate.deleteMany({ where: { source: SRC } })
await prisma.pricingRule.deleteMany({ where: { productType: { in: ['haji', 'package'] } } })
if (savedRules.length) await prisma.pricingRule.createMany({ data: savedRules.map(({ productType, defaultMarginPercent, roundingIncrement }) => ({ productType, defaultMarginPercent, roundingIncrement })) })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
