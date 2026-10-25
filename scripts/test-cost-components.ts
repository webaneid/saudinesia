// Uji Komponen Biaya bersama (docs/arsitektur-komponen-biaya.md, Fase 1) terhadap DATABASE SUNGGUHAN: hitung per komponen, handler CRUD
// (lewat fungsi handler asli dengan `authorize` disuntik), penolakan (G1 lintas modul, G2 induk tak ada, G3 vendor ngawur), margin per tipe,
// dan penjaga bahwa route/hitung tidak lagi menyalin logika.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { computeCostComponents } from '@/lib/pricing/costComponents'
import { computePackageBreakdown } from '@/lib/pricing/computePackagePrice'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import { createCostComponentHandlers } from '@/lib/pricing/costComponentHandlers'
import { COST_OWNERS } from '@/lib/pricing/costComponentOwners'
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

const tag = `cc${Date.now()}`
const SRC = `CC_TEST_${tag}`
const authOk = async () => undefined
const asManager = async () => { throw new Error('Forbidden') }
const asAnon = async () => { throw new Error('Unauthorized') }
const pkgH = createCostComponentHandlers('package', { authorize: authOk })
const tourH = createCostComponentHandlers('tour_package', { authorize: authOk })

// ── fixture ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, category: 'package', country: 'Saudi Arabia' } })
const pkg = await prisma.package.create({ data: { name: `${tag} paket`, price: 0 } })
const tour = await prisma.tourPackage.create({ data: { name: `${tag} ziarah`, price: 0 } })
const stamp = new Date()
await prisma.exchangeRate.createMany({ data: [
  { fromCurrency: 'USD', toCurrency: 'IDR', midRate: 16000, spreadPercent: 2.5, sellRate: 16400, source: SRC, fetchedAt: new Date(stamp.getTime() + 1000) },
  { fromCurrency: 'SAR', toCurrency: 'IDR', midRate: 4250, spreadPercent: 2.5, sellRate: 4350, source: SRC, fetchedAt: new Date(stamp.getTime() + 1000) },
] })
// Aturan margin per tipe sengaja BERBEDA supaya salah-pakai tipe (G4) terdeteksi. Aturan yang sudah ada disimpan lalu dipulihkan.
const savedRules = await prisma.pricingRule.findMany({ where: { productType: { in: ['package', 'tour_package'] } } })
await prisma.pricingRule.deleteMany({ where: { productType: { in: ['package', 'tour_package'] } } })
await prisma.pricingRule.createMany({ data: [
  { productType: 'package', minMarginPercent: 25, roundingIncrement: 100000 },
  { productType: 'tour_package', minMarginPercent: 30, roundingIncrement: 50000 },
] })

const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const mkCost = (productType: string, productId: string, costComponent: string, currency: string, cost: number, extra: Record<string, unknown> = {}) =>
  prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent, currency, costTiers: flat(cost), ...extra } })
const req = (body?: unknown, raw?: string) => new Request('http://test.local/x', { method: 'POST', body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ictx = (id: string, costId: string) => ({ params: Promise.resolve({ id, costId }) })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as { success: boolean; data?: unknown; error?: string } })
const priceOf = async (kind: 'package' | 'tour') =>
  Number((kind === 'package' ? await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } }) : await prisma.tourPackage.findUniqueOrThrow({ where: { id: tour.id } })).price)

console.log('== hitung per komponen ==')

await t('margin PER KOMPONEN lalu dijumlah: IDR tanpa kurs, USD/SAR dikonversi, pembulatan per baris, tipe margin dihormati', async () => {
  await mkCost('package', pkg.id, 'Admin Fee', 'IDR', 150000)  // 150.000 ×1,25 = 187.500 → bulat 100.000 = 200.000
  await mkCost('package', pkg.id, 'Dokumen', 'USD', 25)       // 25×16.400 = 410.000 ×1,25 = 512.500 → 500.000
  await mkCost('package', pkg.id, 'Handling', 'SAR', 100)     // 100×4.350 = 435.000 ×1,25 = 543.750 → 500.000
  const r = await computeCostComponents('package', pkg.id)
  const by = Object.fromEntries(r.components.map((c) => [c.costComponent, c]))
  assert.equal(by['Admin Fee']!.hppRupiah, 150000); assert.equal(by['Admin Fee']!.sellPrice, 200000)
  assert.equal(by['Dokumen']!.hppRupiah, 410000); assert.equal(by['Dokumen']!.sellPrice, 500000)
  assert.equal(by['Handling']!.hppRupiah, 435000); assert.equal(by['Handling']!.sellPrice, 500000)
  assert.equal(r.totalSellPrice, 1200000, 'jumlah harga jual per komponen, bukan margin atas jumlah HPP')
  // margin atas jumlah HPP akan berbeda: (150.000+410.000+435.000)×1,25 = 1.243.750 → 1.200.000 pada kelipatan 100.000; angka per komponen dipilih supaya pembeda ada di tipe margin:
  await mkCost('tour_package', tour.id, 'Dokumen', 'USD', 25) // margin 30% / bulat 50.000: 410.000×1,3 = 533.000 → 550.000
  assert.equal((await computeCostComponents('tour_package', tour.id)).totalSellPrice, 550000, 'tipe tour_package memakai aturannya sendiri')
})

await t('komponen tanpa kurs dilewati (bukan error total), nonaktif dikecualikan, tier tak cocok dilewati, produk lain tak ikut', async () => {
  await mkCost('package', pkg.id, 'Tanpa Kurs', 'EUR', 10)
  await mkCost('package', pkg.id, 'Nonaktif', 'IDR', 999999, { isActive: false })
  await prisma.productCost.create({ data: { productType: 'package', productId: pkg.id, vendorId: vendor.id, costComponent: 'Tier Jauh', currency: 'IDR', costTiers: [{ minDays: 50, maxDays: 60, cost: 777777 }] } })
  const r = await computeCostComponents('package', pkg.id)
  assert.deepEqual(r.components.map((c) => c.costComponent).sort(), ['Admin Fee', 'Dokumen', 'Handling'])
  assert.equal(r.totalSellPrice, 1200000)
  assert.deepEqual((await computeCostComponents('package', randomUUID())), { components: [], totalSellPrice: 0 })
})

await t('breakdown paket memakai komponen bersama: componentsTotalSellPrice dan components identik dengan computeCostComponents', async () => {
  const b = await computePackageBreakdown(pkg.id), c = await computeCostComponents('package', pkg.id)
  assert.deepEqual(b.components, c.components); assert.equal(b.componentsTotalSellPrice, c.totalSellPrice)
  const tb = await computeTourPackageBreakdown(tour.id), tc = await computeCostComponents('tour_package', tour.id)
  assert.deepEqual(tb.components, tc.components); assert.equal(tb.componentsTotalSellPrice, tc.totalSellPrice)
})

console.log('== handler CRUD (kedua pemilik) ==')

for (const [label, h, kind, ownerId, ownerType] of [['package', pkgH, 'package', pkg.id, 'package'], ['tour_package', tourH, 'tour', tour.id, 'tour_package']] as const) {
  await t(`[${label}] POST membuat komponen (201), cache harga dihitung ulang; GET menampilkan baris dengan HPP/harga jual; PUT mengubah; DELETE menghapus — harga ikut`, async () => {
    await COST_OWNERS[ownerType].refresh(ownerId) // fixture menulis komponen langsung ke DB (tanpa refresh) — samakan cache dulu
    const before = await priceOf(kind)
    assert.ok(before > 0, 'cache harus terisi dari komponen fixture')
    const created = await json(await h.collectionPOST(req({ costComponent: 'Skenario', vendorId: vendor.id, currency: 'USD', cost: 10 }), ctx(ownerId)))
    assert.equal(created.status, 201)
    const costId = (created.body.data as { id: string }).id
    assert.equal(await prisma.productCost.count({ where: { id: costId, productType: ownerType, productId: ownerId } }), 1)
    const afterPost = await priceOf(kind); assert.ok(afterPost > before, `harga harus naik (${before} → ${afterPost})`)

    const list = await json(await h.collectionGET(req(), ctx(ownerId)))
    const row = (list.body.data as Array<{ id: string; costComponent: string; cost: number; vendorName: string; hppRupiah: number; sellPrice: number }>).find((r) => r.id === costId)!
    assert.equal(row.costComponent, 'Skenario'); assert.equal(row.cost, 10); assert.equal(row.vendorName, `${tag} vendor`)
    assert.equal(row.hppRupiah, 164000); assert.ok(row.sellPrice > 164000)

    assert.equal((await json(await h.itemPUT(req({ currency: 'IDR', cost: 99000 }), ictx(ownerId, costId)))).status, 200)
    assert.deepEqual((await prisma.productCost.findUniqueOrThrow({ where: { id: costId } })).costTiers, flat(99000))
    assert.notEqual(await priceOf(kind), afterPost)

    assert.equal((await json(await h.itemDELETE(req(), ictx(ownerId, costId)))).status, 200)
    assert.equal(await priceOf(kind), before, 'kembali ke harga semula setelah dihapus')
    assert.equal(await prisma.productCost.count({ where: { id: costId } }), 0)
  })

  await t(`[${label}] simulate memakai margin TIPE PEMILIK ini (G4) dan menolak parameter tak sah`, async () => {
    const sim = await json(await h.simulateGET(new Request('http://test.local/s?cost=25&currency=USD')))
    const expect = ownerType === 'package' ? 500000 : 550000
    assert.equal((sim.body.data as { sellPrice: number }).sellPrice, expect)
    for (const q of ['cost=0&currency=USD', 'cost=abc&currency=USD', 'currency=USD', 'cost=5']) {
      assert.equal((await json(await h.simulateGET(new Request(`http://test.local/s?${q}`)))).status, 400, q)
    }
  })
}

console.log('== penolakan ==')

await t('G1: komponen milik modul lain / produk lain TIDAK bisa diubah atau dihapus lewat URL ini → 404 dan data tak tersentuh', async () => {
  const foreign = await mkCost('tour_package', tour.id, 'Milik Ziarah', 'IDR', 50000)
  const otherPkg = await prisma.package.create({ data: { name: `${tag} lain`, price: 0 } })
  const own = await mkCost('package', otherPkg.id, 'Milik Paket Lain', 'IDR', 60000)
  for (const [h, id, costId] of [[pkgH, pkg.id, foreign.id], [pkgH, pkg.id, own.id], [tourH, tour.id, own.id]] as const) {
    assert.equal((await json(await h.itemPUT(req({ cost: 1 }), ictx(id, costId)))).status, 404)
    assert.equal((await json(await h.itemDELETE(req(), ictx(id, costId)))).status, 404)
  }
  assert.deepEqual((await prisma.productCost.findUniqueOrThrow({ where: { id: foreign.id } })).costTiers, flat(50000))
  assert.deepEqual((await prisma.productCost.findUniqueOrThrow({ where: { id: own.id } })).costTiers, flat(60000))
  await prisma.productCost.deleteMany({ where: { id: { in: [foreign.id, own.id] } } }); await prisma.package.delete({ where: { id: otherPkg.id } })
})

await t('G2: induk tak ada → 404 TANPA baris yatim; G3: vendor tak ada → 400 (POST dan PUT); komponen tak ada → 404', async () => {
  const ghost = randomUUID()
  assert.equal((await json(await pkgH.collectionPOST(req({ costComponent: 'Yatim', vendorId: vendor.id, currency: 'IDR', cost: 1 }), ctx(ghost)))).status, 404)
  assert.equal(await prisma.productCost.count({ where: { productId: ghost } }), 0, 'tak boleh ada baris yatim')
  assert.equal((await json(await pkgH.collectionPOST(req({ costComponent: 'V', vendorId: randomUUID(), currency: 'IDR', cost: 1 }), ctx(pkg.id)))).status, 400)
  const c = await mkCost('package', pkg.id, 'Uji PUT', 'IDR', 1000)
  assert.equal((await json(await pkgH.itemPUT(req({ vendorId: randomUUID() }), ictx(pkg.id, c.id)))).status, 400)
  assert.equal((await json(await pkgH.itemPUT(req({ cost: 5 }), ictx(pkg.id, randomUUID())))).status, 404)
  assert.equal((await json(await pkgH.itemDELETE(req(), ictx(pkg.id, randomUUID())))).status, 404)
  await prisma.productCost.delete({ where: { id: c.id } })
})

await t('input tak sah → 400: body rusak/kosong, cost 0/negatif/bukan angka, nama kosong, kolom liar (strict: productType/isActive tak bisa disusupkan)', async () => {
  const good = { costComponent: 'X', vendorId: vendor.id, currency: 'IDR', cost: 1 }
  const bads: unknown[] = [{ ...good, cost: 0 }, { ...good, cost: -5 }, { ...good, cost: 'abc' }, { ...good, costComponent: '  ' }, { ...good, productType: 'visa' }, { ...good, isActive: false }, { vendorId: vendor.id }, null]
  for (const b of bads) assert.equal((await json(await pkgH.collectionPOST(req(b), ctx(pkg.id)))).status, 400, JSON.stringify(b))
  assert.equal((await json(await pkgH.collectionPOST(req(undefined, 'xx'), ctx(pkg.id)))).status, 400)
  assert.equal((await json(await pkgH.collectionPOST(req(undefined, ''), ctx(pkg.id)))).status, 400)
  const c = await mkCost('package', pkg.id, 'Uji Strict', 'IDR', 1000)
  assert.equal((await json(await pkgH.itemPUT(req({ productType: 'visa' }), ictx(pkg.id, c.id)))).status, 400)
  assert.equal((await json(await pkgH.itemPUT(req(undefined, 'xx'), ictx(pkg.id, c.id)))).status, 400)
  assert.equal((await prisma.productCost.findUniqueOrThrow({ where: { id: c.id } })).productType, 'package')
  await prisma.productCost.delete({ where: { id: c.id } })
})

await t('otorisasi: setiap handler memanggil authorize() PERTAMA — manager/tanpa login → 403 dan tak ada efek samping', async () => {
  const before = await prisma.productCost.count({ where: { productId: pkg.id } })
  for (const bad of [asManager, asAnon]) {
    const h = createCostComponentHandlers('package', { authorize: bad })
    const good = { costComponent: 'Gelap', vendorId: vendor.id, currency: 'IDR', cost: 1 }
    const c = await mkCost('package', pkg.id, 'Dilindungi', 'IDR', 1000)
    for (const r of [await h.collectionGET(req(), ctx(pkg.id)), await h.collectionPOST(req(good), ctx(pkg.id)), await h.itemPUT(req({ cost: 9 }), ictx(pkg.id, c.id)),
                     await h.itemDELETE(req(), ictx(pkg.id, c.id)), await h.simulateGET(new Request('http://test.local/s?cost=1&currency=IDR'))]) {
      assert.equal(r.status, 403)
    }
    assert.deepEqual((await prisma.productCost.findUniqueOrThrow({ where: { id: c.id } })).costTiers, flat(1000))
    await prisma.productCost.delete({ where: { id: c.id } })
  }
  assert.equal(await prisma.productCost.count({ where: { productId: pkg.id } }), before)
})

await t('galat tak terduga → 500 tanpa membocorkan pesan internal (bukan 403 palsu)', async () => {
  const boom = createCostComponentHandlers('package', { authorize: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432') } })
  const origError = console.error; console.error = () => {}
  try {
    const r = await json(await boom.collectionGET(req(), ctx(pkg.id)))
    assert.equal(r.status, 500); assert.doesNotMatch(JSON.stringify(r.body), /ECONNREFUSED|10\.0\.0\.5/)
  } finally { console.error = origError }
})

console.log('== penjaga sumber ==')

await t('route modul hanya mengekspor ulang handler bersama; tak ada salinan logika biaya di route atau modul hitung', () => {
  const base = 'app/api/v1/admin/products'
  const files = ['packages', 'tour-packages'].flatMap((m) => [`${base}/${m}/[id]/costs/route.ts`, `${base}/${m}/[id]/costs/[costId]/route.ts`, `${base}/${m}/[id]/costs/simulate/route.ts`])
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /createCostComponentHandlers\('(package|tour_package)'\)/, f)
    assert.ok(src.split('\n').length <= 10, `${f} tidak boleh memuat logika sendiri`)
    assert.doesNotMatch(src, /prisma|requireSuperAdmin|productCost/i, f)
  }
  for (const f of ['lib/pricing/computePackagePrice.ts', 'lib/pricing/computeTourPackagePrice.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /computeCostComponents\('(package|tour_package)'/, f)
    assert.doesNotMatch(src, /productCost\.findMany|getLatestRate|roundToNearest/, `${f} tak boleh menghitung komponen sendiri`)
  }
  const handlers = readFileSync('lib/pricing/costComponentHandlers.ts', 'utf8')
  assert.ok(handlers.indexOf("await authorize()") > 0 && (handlers.match(/await authorize\(\)/g) ?? []).length === 5, 'kelima handler memanggil authorize()')
  assert.match(handlers, /requireSuperAdmin/); assert.match(handlers, /productType: owner\.productType, productId: id/)
})

await t('UI: halaman admin memakai panel bersama (tanpa salinan inline) dan route simulate lama tour-packages sudah dihapus (SEC-65)', () => {
  const dir = 'app/[locale]/admin/(protected)/products'
  for (const [file, base, cat] of [['packages/[id]/page.tsx', 'packages', 'package'], ['tour-packages/[id]/page.tsx', 'tour-packages', 'tour_package']] as const) {
    const src = readFileSync(`${dir}/${file}`, 'utf8')
    assert.match(src, /<CostComponentsPanel[\s\S]*?apiBase=\{`\/api\/v1\/admin\/products\/(packages|tour-packages)\/\$\{id\}\/costs`\}/, file)
    assert.ok(src.includes(`apiBase={\`/api/v1/admin/products/${base}/`) && src.includes(`vendorCategory="${cat}"`), `${file}: apiBase/vendorCategory salah modul`)
    assert.doesNotMatch(src, /handleSaveCost|costForm|setCostPreview|handleQuickAddVendor|settings\/vendors/, `${file}: tak boleh ada logika biaya/vendor inline`)
  }
  assert.ok(!readdirSync('app/api/v1/admin/products/tour-packages').includes('simulate'), 'route simulate lama harus hilang')
  const panel = readFileSync('components/admin/pricing/CostComponentsPanel.tsx', 'utf8')
  assert.match(panel, /\$\{apiBase\}\/simulate/); assert.match(panel, /forbidden/)
  for (const verb of ["'POST'", "'PUT'", "'DELETE'"]) assert.ok(panel.includes(verb) || panel.includes(verb.replace(/'/g, '')), `panel harus punya ${verb}`)
})

await t('registry: setiap pemilik terdaftar punya route tipis dan fungsi refresh', () => {
  const reg = readFileSync('lib/pricing/costComponentOwners.ts', 'utf8')
  for (const key of ['package', 'tour_package']) assert.match(reg, new RegExp(`${key}: \\{`))
  const dirs = readdirSync('app/api/v1/admin/products')
  assert.ok(dirs.includes('packages') && dirs.includes('tour-packages'))
  assert.ok(readFileSync(join('lib/pricing/refreshPackagePriceCache.ts'), 'utf8').includes('computePackageBreakdown'))
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.productCost.deleteMany({ where: { productId: { in: [pkg.id, tour.id] } } })
await prisma.package.deleteMany({ where: { id: pkg.id } }); await prisma.tourPackage.deleteMany({ where: { id: tour.id } })
await prisma.vendor.deleteMany({ where: { id: vendor.id } })
await prisma.exchangeRate.deleteMany({ where: { source: SRC } })
await prisma.pricingRule.deleteMany({ where: { productType: { in: ['package', 'tour_package'] } } })
if (savedRules.length) await prisma.pricingRule.createMany({ data: savedRules.map(({ productType, minMarginPercent, roundingIncrement }) => ({ productType, minMarginPercent, roundingIncrement })) })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
