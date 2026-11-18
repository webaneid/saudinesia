// Harga jual manual PER KOMPONEN BIAYA (docs/arsitektur-harga-terpadu.md §22, Fase C1) terhadap DATABASE SUNGGUHAN.
// Dibuktikan: tiap komponen punya titik harga `cost_component` (modal = HPP, otomatis = rekomendasi margin); harga manual komponen menggantikan rekomendasinya
// dan total produk mengikuti Σ komponen; rekomendasi tetap murni margin; harga manual TOTAL tetap menang; snapshot Σ = total; hapus komponen/produk
// membersihkan titik komponen (dan tak menyentuh komponen produk lain); Visa tak ikut; penjaga sumber.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { clearManualSell, getPricePoint, PRICE_OWNERS, PriceInputError, repriceAll, repriceOwner, setManualCost, setManualSell } from '@/lib/pricing/engine'
import { computeCostComponents } from '@/lib/pricing/costComponents'
import { compositeLines, lineTotalRecommended, sumSell } from '@/lib/pricing/engine/snapshot'
import { createCostComponentHandlers } from '@/lib/pricing/costComponentHandlers'
import { deleteOrDeactivateHaji } from '@/lib/haji/delete'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const tag = `ccp${Date.now()}`
const who = 'test-cost-component'
const H = createCostComponentHandlers('haji', { authorize: async () => undefined })
const req = (body: unknown) => new Request('http://test.local/x', { method: 'POST', body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ictx = (id: string, costId: string) => ({ params: Promise.resolve({ id, costId }) })

const savedRules = await prisma.pricingRule.findMany({ where: { productType: 'haji' } })
await prisma.pricingRule.deleteMany({ where: { productType: 'haji' } })
await prisma.pricingRule.create({ data: { productType: 'haji', defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
const created: string[] = []
const mkHaji = async () => { const p = await prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'khusus', year: 2027, totalQuota: 10 } }); created.push(p.id); return p }
async function addComponent(hajiId: string, name: string, cost: number): Promise<string> {
  const res = await H.collectionPOST(req({ costComponent: name, vendorId: vendor.id, currency: 'IDR', cost }), ctx(hajiId))
  assert.equal(res.status, 201, `buat komponen ${name}`)
  return ((await res.json()) as { data: { id: string } }).data.id
}
const sell = async (type: 'haji' | 'cost_component', id: string) => (await getPricePoint(type, id))?.sellIdr ?? null

// Haji: Kereta Cepat modal 1.000.000 → rekomendasi 1.200.000; Hotel modal 500.000 → 600.000 (margin 20 %, bulat 50.000). Total 1.800.000.
const haji = await mkHaji()
const kereta = await addComponent(haji.id, 'Kereta Cepat', 1_000_000)
const hotel = await addComponent(haji.id, 'Hotel', 500_000)

await t('komponen baru punya titik harga cost_component: modal = HPP, otomatis = rekomendasi margin; produk = Σ', async () => {
  const p = await getPricePoint('cost_component', kereta)
  assert.ok(p, 'titik komponen ada')
  assert.equal(p!.costIdr, 1_000_000); assert.equal(p!.autoSellIdr, 1_200_000); assert.equal(p!.sellIdr, 1_200_000); assert.equal(p!.mode, 'auto')
  assert.equal(await sell('cost_component', hotel), 600_000)
  assert.equal(await sell('haji', haji.id), 1_800_000)
})

await t('harga manual komponen → total produk ikut (Σ harga berlaku), rekomendasi tetap murni margin', async () => {
  await setManualSell({ ownerType: 'cost_component', ownerId: kereta, sellIdr: 1_100_000, note: 'nego vendor', byUserId: who })
  const p = await getPricePoint('cost_component', kereta)
  assert.equal(p!.mode, 'manual'); assert.equal(p!.sellIdr, 1_100_000); assert.equal(p!.autoSellIdr, 1_200_000)
  const h = await getPricePoint('haji', haji.id)
  assert.equal(h!.sellIdr, 1_700_000, 'produk dihitung ulang otomatis sesudah harga komponen berubah')
  assert.equal(h!.mode, 'auto')
  assert.equal(h!.costIdr, 1_500_000)
  const r = await computeCostComponents('haji', haji.id)
  assert.equal(r.totalSellPrice, 1_700_000); assert.equal(r.totalAutoSellPrice, 1_800_000)
  const k = r.components.find(c => c.costId === kereta)!
  assert.equal(k.sellPrice, 1_100_000); assert.equal(k.autoSellPrice, 1_200_000); assert.equal(k.mode, 'manual')
  const change = await prisma.priceChange.findFirst({ where: { ownerType: 'cost_component', ownerId: kereta, kind: 'manual_set' } })
  assert.ok(change, 'perubahan tercatat di price_changes')
  // harga komponen BOLEH di atas rekomendasi juga (peringatan hanya mengingatkan)
  await setManualSell({ ownerType: 'cost_component', ownerId: hotel, sellIdr: 700_000, byUserId: who })
  assert.equal(await sell('haji', haji.id), 1_800_000)
  await clearManualSell({ ownerType: 'cost_component', ownerId: hotel, byUserId: who })
  assert.equal(await sell('haji', haji.id), 1_700_000)
})

await t('snapshot: baris komponen = harga berlaku (mode manual) + rekomendasi margin; Σ = total, tanpa baris penyesuaian', async () => {
  const lines = await compositeLines(prisma, { ownerType: 'haji', ownerId: haji.id, what: 'haji', label: 'Haji', multiplier: 2 })
  const k = lines.find(l => l.lineKey === `komponen:${kereta}`)!
  assert.equal(k.unitSellIdr, 1_100_000); assert.equal(k.recommendedUnitSellIdr, 1_200_000); assert.equal(k.mode, 'manual')
  assert.deepEqual(k.ref, { ownerType: 'cost_component', ownerId: kereta, variantKey: '' })
  assert.equal(lines.some(l => l.lineKey.startsWith('penyesuaian')), false)
  assert.equal(sumSell(lines), 3_400_000)
  assert.equal(lines.reduce((s, l) => s + lineTotalRecommended(l), 0), 3_600_000)
})

await t('harga manual TOTAL produk tetap menang: baris penyesuaian = selisih, rekomendasi tetap Σ margin', async () => {
  await setManualSell({ ownerType: 'haji', ownerId: haji.id, sellIdr: 2_000_000, byUserId: who })
  const lines = await compositeLines(prisma, { ownerType: 'haji', ownerId: haji.id, what: 'haji', label: 'Haji', multiplier: 2 })
  assert.equal(sumSell(lines), 4_000_000)
  const gap = lines.find(l => l.lineKey === 'penyesuaian')!
  assert.equal(gap.unitSellIdr, 300_000)
  assert.equal(lines.reduce((s, l) => s + lineTotalRecommended(l), 0), 3_600_000, 'harga manual tak pernah menjadi rekomendasi')
  // komponen kembali ke rekomendasi: otomatis produk naik, jual tetap manual total
  await clearManualSell({ ownerType: 'cost_component', ownerId: kereta, byUserId: who })
  const h = await getPricePoint('haji', haji.id)
  assert.equal(h!.sellIdr, 2_000_000); assert.equal(h!.autoSellIdr, 1_800_000)
  await clearManualSell({ ownerType: 'haji', ownerId: haji.id, byUserId: who })
  assert.equal(await sell('haji', haji.id), 1_800_000)
})

await t('ubah modal komponen: rekomendasi komponen ikut, harga manualnya bertahan; repriceAll tak menghapusnya', async () => {
  await setManualSell({ ownerType: 'cost_component', ownerId: kereta, sellIdr: 1_100_000, byUserId: who })
  const res = await H.itemPUT(new Request('http://test.local/x', { method: 'PUT', body: JSON.stringify({ cost: 2_000_000 }) }), ictx(haji.id, kereta))
  assert.equal(res.status, 200)
  const p = await getPricePoint('cost_component', kereta)
  assert.equal(p!.costIdr, 2_000_000); assert.equal(p!.autoSellIdr, 2_400_000); assert.equal(p!.sellIdr, 1_100_000, 'harga manual tak ditimpa')
  assert.equal(await sell('haji', haji.id), 1_700_000)
  await repriceAll()
  assert.equal(await sell('cost_component', kereta), 1_100_000)
  assert.equal(await sell('haji', haji.id), 1_700_000)
})

await t('hapus komponen lewat URL produk lain: ditolak 404 dan titik komponen tetap; lewat produknya sendiri: titik ikut terhapus', async () => {
  const other = await mkHaji()
  const wrong = await H.itemDELETE(new Request('http://test.local/x', { method: 'DELETE' }), ictx(other.id, kereta))
  assert.equal(wrong.status, 404)
  assert.ok(await getPricePoint('cost_component', kereta), 'titik komponen produk lain tak tersentuh')
  const ok = await H.itemDELETE(new Request('http://test.local/x', { method: 'DELETE' }), ictx(haji.id, kereta))
  assert.equal(ok.status, 200)
  assert.equal(await getPricePoint('cost_component', kereta), null)
  assert.equal(await sell('haji', haji.id), 600_000)
})

await t('hapus produk Haji: titik harga komponennya ikut terhapus', async () => {
  const h2 = await mkHaji()
  const c = await addComponent(h2.id, 'Visa', 300_000)
  await setManualSell({ ownerType: 'cost_component', ownerId: c, sellIdr: 400_000, byUserId: who })
  const r = await deleteOrDeactivateHaji(h2.id)
  assert.deepEqual(r, { found: true, deleted: true })
  assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'cost_component', ownerId: c } }), 0)
  assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'haji', ownerId: h2.id } }), 0)
})

await t('Visa (juga memakai ProductCost) tidak menjadi pemilik cost_component; komponen yang hilang disapu', async () => {
  const visa = await prisma.productCost.create({ data: { productType: 'visa', productId: `${tag}-visa`, vendorId: vendor.id, costComponent: 'individu', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost: 100 }] as never } })
  try {
    const ids = await PRICE_OWNERS.cost_component.listIds()
    assert.equal(ids.includes(visa.id), false)
    assert.ok(ids.includes(hotel))
    assert.deepEqual(await PRICE_OWNERS.cost_component.existing([visa.id]), [])
    assert.deepEqual(await PRICE_OWNERS.cost_component.parent!(visa.id), null)
    await repriceOwner('cost_component', visa.id) // pemilik tak ada → tak ada titik dibuat
    assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'cost_component', ownerId: visa.id } }), 0)
  } finally {
    await prisma.productCost.delete({ where: { id: visa.id } })
  }
})

await t('ditolak: modal manual komponen (modal milik Komponen Biaya), harga manual atas ProductCost Visa / id tak dikenal', async () => {
  await assert.rejects(() => setManualCost({ ownerType: 'cost_component', ownerId: hotel, costIdr: 1, byUserId: who }), (e: unknown) => e instanceof PriceInputError && /HPP/.test(e.message))
  const visa = await prisma.productCost.create({ data: { productType: 'visa', productId: `${tag}-visa2`, vendorId: vendor.id, costComponent: 'individu', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost: 100 }] as never } })
  try {
    await assert.rejects(() => setManualSell({ ownerType: 'cost_component', ownerId: visa.id, sellIdr: 5_000, byUserId: who }), (e: unknown) => e instanceof PriceInputError && /tidak ditemukan/i.test(e.message))
    await assert.rejects(() => setManualSell({ ownerType: 'cost_component', ownerId: '00000000-0000-4000-8000-000000000000', sellIdr: 5_000, byUserId: who }), (e: unknown) => e instanceof PriceInputError)
    assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'cost_component', ownerId: visa.id } }), 0)
  } finally { await prisma.productCost.delete({ where: { id: visa.id } }) }
})

await t('komponen tanpa kurs: dilewati selama otomatis, TETAP ikut total bila berharga manual (modal produk jadi belum lengkap)', async () => {
  const h3 = await mkHaji()
  await addComponent(h3.id, 'Lokal', 1_000_000)
  const res = await H.collectionPOST(req({ costComponent: 'Tanpa Kurs', vendorId: vendor.id, currency: 'QQQ', cost: 10 }), ctx(h3.id))
  assert.equal(res.status, 201)
  const nr = ((await res.json()) as { data: { id: string } }).data.id
  assert.equal(await sell('haji', h3.id), 1_200_000, 'tanpa kurs dan tanpa harga manual: tak ikut')
  await setManualSell({ ownerType: 'cost_component', ownerId: nr, sellIdr: 250_000, byUserId: who })
  const h = await getPricePoint('haji', h3.id)
  assert.equal(h!.sellIdr, 1_450_000); assert.equal(h!.costIdr, null, 'modal belum lengkap')
  const lines = await compositeLines(prisma, { ownerType: 'haji', ownerId: h3.id, what: 'haji', label: 'Haji', multiplier: 1 })
  const l = lines.find(x => x.lineKey === `komponen:${nr}`)!
  assert.equal(l.unitCostIdr, null); assert.equal(l.unitSellIdr, 250_000); assert.equal(l.recommendedUnitSellIdr, 250_000)
  assert.equal(sumSell(lines), 1_450_000)
})

await t('penjaga sumber: setiap penghapus ProductCost komposit membersihkan titik cost_component', () => {
  for (const f of ['lib/admin/productDelete.ts', 'lib/haji/delete.ts', 'lib/pricing/costComponentHandlers.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /productCost\.deleteMany/, f)
    assert.match(src, /ownerType: 'cost_component'/, `${f} wajib menghapus titik harga komponen`)
  }
  const order = Object.keys(PRICE_OWNERS)
  for (const c of ['package', 'tour_package', 'haji']) assert.ok(order.indexOf('cost_component') < order.indexOf(c), `cost_component dihitung sebelum ${c}`)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
const costIds = (await prisma.productCost.findMany({ where: { productType: 'haji', productId: { in: created } }, select: { id: true } })).map(c => c.id)
await prisma.pricePoint.deleteMany({ where: { OR: [{ ownerType: 'haji', ownerId: { in: created } }, { ownerType: 'cost_component', ownerId: { in: [...costIds, kereta, hotel] } }] } })
await prisma.priceChange.deleteMany({ where: { byUserId: who } })
await prisma.productCost.deleteMany({ where: { productType: 'haji', productId: { in: created } } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await prisma.hajiProduct.deleteMany({ where: { id: { in: created } } })
await prisma.vendor.deleteMany({ where: { id: vendor.id } })
await prisma.pricingRule.deleteMany({ where: { productType: 'haji' } })
if (savedRules.length) await prisma.pricingRule.createMany({ data: savedRules.map(({ productType, defaultMarginPercent, roundingIncrement }) => ({ productType, defaultMarginPercent, roundingIncrement })) })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
