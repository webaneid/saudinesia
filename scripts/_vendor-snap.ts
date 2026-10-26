// SEMENTARA: rekam kondisi vendor/biaya/harga untuk perbandingan sebelum/sesudah migrasi (tidak di-commit).
import { writeFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { computeSellPrice } from '@/lib/pricing/computeSellPrice'
await assertThrowawayDb()
const rows = async (q: string) => (await prisma.$queryRawUnsafe(q)) as Record<string, unknown>[]
const out: Record<string, unknown> = {}
for (const t of ['vendors', 'product_costs', 'preferred_vendors', 'exchange_rates', 'visa_products', 'flight_schedules', 'hotel_room_schedules', 'transport_pricing', 'packages', 'tour_packages', 'haji_products']) {
  try { out[`count.${t}`] = Number((await rows(`select count(*)::int as n from ${t}`))[0]!.n) } catch { out[`count.${t}`] = 'n/a' }
}
out.vendors_legacy = await rows(`select id, name, category, country, "contactInfo", "addressId", "isActive" from vendors order by id`)
out.costs = await rows(`select id, "productType", "productId", "vendorId", "costComponent", currency, "costTiers", "isActive" from product_costs order by id`)
out.preferred = await rows(`select id, "productType", "productId", "costComponent", "vendorId" from preferred_vendors order by id`)
const pairs = (out.costs as Array<{ productType: string; productId: string }>).map((c) => `${c.productType}|${c.productId}`)
const prices: Record<string, unknown> = {}
for (const key of [...new Set(pairs)].sort()) {
  const [type, id] = key.split('|') as [string, string]
  for (const days of [1, 9, 30]) prices[`${key}@${days}`] = await computeSellPrice(type, id, days)
}
out.computeSellPrice = prices
writeFileSync(process.argv[2]!, JSON.stringify(out, null, 1)); console.log('snapshot', process.argv[2], Object.keys(prices).length, 'harga')
await prisma.$disconnect(); process.exit(0)
