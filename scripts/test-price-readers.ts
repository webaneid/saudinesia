// Fase 5 harga terpadu (docs/arsitektur-harga-terpadu.md §18): kolom harga lama SUDAH TIADA — `price_points` adalah satu-satunya sumber harga.
//
// Sejak kontraksi, penjaga pembaca lama (Fase 2: skema salinan tanpa kolom → tsc) tak lagi perlu: klien Prisma proyek sendiri tidak mengenal kolom itu, jadi `tsc`/`next build`
// menolak tiap pembaca/penulis baru. Yang tersisa untuk dijaga dengan tes adalah hal yang kompiler TIDAK lihat: skema, SQL mentah, JSON DTO, dan sisa-sisa kode kontraksi.
//
// Tak membutuhkan database.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 14).join('\n     ')}`) }
}
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
const model = (name: string): string => {
  const m = new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, 'm').exec(schema)
  assert.ok(m, `model ${name} tidak ditemukan`)
  return m[0]
}
const hasField = (name: string, field: string) => new RegExp(`^\\s+${field}\\s`, 'm').test(model(name))

const REMOVED: ReadonlyArray<[string, string]> = [
  ['VisaProduct', 'price'], ['VisaProduct', 'durationFeeRules'], ['FlightSchedule', 'price'], ['HotelRoomSchedule', 'price'], ['TransportPricing', 'price'],
  ['MuthowifServicePrice', 'price'], ['HajiProduct', 'price'], ['Package', 'price'], ['TourPackage', 'price'], ['HotelService', 'price'],
  ['CateringOption', 'pricePerPersonRegular'], ['CateringOption', 'pricePerPersonRamadan'], ['CateringOption', 'pricePerPersonHajj'],
  ['VisaApplication', 'hppSnapshotRupiah'], ['VisaApplication', 'sellPriceSnapshot'], ['VisaApplication', 'exchangeRateIdsUsed'], ['VisaApplication', 'vendorIdsUsed'],
  ['PricingRule', 'minMarginPercent'],
]

t('skema: 17 kolom harga/riwayat lama dan `minMarginPercent` tidak ada lagi; `defaultMarginPercent` ada', () => {
  for (const [m, f] of REMOVED) assert.ok(!hasField(m, f), `${m}.${f} masih ada di schema.prisma`)
  assert.ok(hasField('PricingRule', 'defaultMarginPercent'))
})

const code = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components')), join(root, 'instrumentation-node.ts')]
const read = (f: string) => readFileSync(f, 'utf8')

t('tidak ada sisa pembungkus `refresh*Cache` / kait penulisan ganda (`writeLegacy`/`adoptLegacy`) / `StoredVariant` di kode', () => {
  const offenders = code.filter(f => /refresh(Flight|Hotel|Transport|Muthowif|Visa|Package|TourPackage|Haji)[A-Za-z]*Cache|refreshAll(Flight|Hotel|Transport|Muthowif|Visa|Package|TourPackage|Haji)|writeLegacy|adoptLegacy|StoredVariant/.test(read(f)))
  assert.deepEqual(offenders.map(f => relative(root, f)), [])
})

t('SQL mentah tidak menyentuh kolom harga lama (kompiler tak melihat string SQL)', () => {
  const offenders = code.filter(f => {
    const src = read(f)
    return /\$(queryRaw|executeRaw)/.test(src) && /(flight_schedules|hotel_room_schedules|transport_pricing|muthowif_service_price|haji_products|"packages"|tour_packages|visa_products|hotel_services|catering_options)[\s\S]{0,80}\bprice\b|pricePerPerson|durationFeeRules|minMarginPercent/.test(src)
  })
  assert.deepEqual(offenders.map(f => relative(root, f)), [])
})

t('nama lama `minMarginPercent` tak muncul di kode aplikasi/skrip uji (rename ke defaultMarginPercent)', () => {
  const files = [...code, ...walk(join(root, 'scripts'))].filter(f => !f.endsWith('test-price-readers.ts') && !/migration\.ts$/.test(f) && !/test-(pricing-rule|price-points)-migration/.test(f))
  assert.deepEqual(files.filter(f => /minMarginPercent/.test(read(f))).map(f => relative(root, f)), [])
})

t('satu pintu hitung ulang: cron kurs & ubah aturan margin memakai refreshAllPricingCaches → repriceAll; komponen biaya memanggil mesin', () => {
  assert.match(read(join(root, 'lib/pricing/refreshAll.ts')), /repriceAll\(currencies\)/)
  assert.match(read(join(root, 'lib/cron/exchangeRateJob.ts')), /refreshAllPricingCaches\(updatedCurrencies\)/)
  assert.match(read(join(root, 'lib/pricing/costComponentOwners.ts')), /repriceOwner\('haji'/)
})

t('DTO admin bersarang yang kolom `price`-nya dihapus menyematkan harga dari titik harga (kompiler tak melihat include → JSON)', () => {
  const NESTED: ReadonlyArray<[string, RegExp]> = [
    ['app/api/v1/admin/products/transport/trips/route.ts', /sellPrices\('transport'/],
    ['app/api/v1/admin/products/transport/trips/[id]/route.ts', /sellPrices\('transport'/],
    ['app/api/v1/admin/products/hotels/[id]/periods/[periodId]/route.ts', /withSellPrice\('hotel'/],
    ['app/api/v1/admin/products/tour-packages/[id]/route.ts', /sellPrices\('transport'[\s\S]*sellPrices\('hotel'/],
    ['app/api/v1/admin/products/packages/[id]/route.ts', /sellPrices\('transport'[\s\S]*sellPrices\('hotel'[\s\S]*sellPrices\('flight'[\s\S]*visaPriceSummary/],
  ]
  for (const [f, re] of NESTED) assert.match(read(join(root, f)), re, `${f}: harga bersarang harus dari titik harga`)
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
