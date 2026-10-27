import type { PrismaClient } from '@prisma/client'

// Uji migrasi LAMA (sebelum kontraksi harga Fase 5) membangun DB "pra-migrasi" yang masih punya kolom harga lama, sedangkan klien Prisma proyek sudah tidak mengenalnya.
// Agar fixture lewat ORM tetap bisa dibuat, kolom lama diberi DEFAULT di DB pra-migrasi (tak mengubah semantik migrasi yang diuji); nilai khusus diisi lewat `setLegacy`.
export const LEGACY_DEFAULTS_SQL = `
ALTER TABLE flight_schedules ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE hotel_room_schedules ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE hotel_services ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE transport_pricing ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE muthowif_service_price ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE haji_products ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE packages ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE tour_packages ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE visa_products ALTER COLUMN "price" SET DEFAULT 0;
ALTER TABLE catering_options ALTER COLUMN "pricePerPersonRegular" SET DEFAULT 0, ALTER COLUMN "pricePerPersonRamadan" SET DEFAULT 0, ALTER COLUMN "pricePerPersonHajj" SET DEFAULT 0;
`

/** Isi kolom lama (yang sudah tak ada di klien Prisma) lewat SQL mentah. `durationFeeRules` dikirim sebagai JSON. */
export async function setLegacy(db: PrismaClient, table: string, id: string, values: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(values)
  const set = keys.map((k, i) => `"${k}" = $${i + 1}${k === 'durationFeeRules' || k === 'exchangeRateIdsUsed' || k === 'vendorIdsUsed' ? '::jsonb' : ''}`).join(', ')
  const args = keys.map(k => (typeof values[k] === 'object' && values[k] !== null ? JSON.stringify(values[k]) : values[k]))
  await db.$executeRawUnsafe(`UPDATE "${table}" SET ${set} WHERE "id" = $${keys.length + 1}`, ...args, id)
}
