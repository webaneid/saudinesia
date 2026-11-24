// Saklar "minta data jamaah" per produk (docs/arsitektur-data-jamaah.md §3.2) — murni, aman di klien.
// Daftar TUNGGAL jenis produk pemilik saklar; CHECK di migrasi `20261212090000_pilgrim_data_catalog` memakai daftar yang sama
// (dijaga scripts/test-pilgrim-data.ts). Tak ada baris di `product_pilgrim_data` = nilai bawaan jenisnya.

export const PILGRIM_DATA_OWNERS = {
  visa: { label: 'Visa', defaultEnabled: true },
  package: { label: 'Paket Umroh', defaultEnabled: true },
  haji: { label: 'Haji', defaultEnabled: true },
  tour_package: { label: 'Paket Ziarah', defaultEnabled: false },
  hotel: { label: 'Hotel', defaultEnabled: false },
  transport: { label: 'Transport', defaultEnabled: false },
  flight: { label: 'Pesawat', defaultEnabled: false },
  catering: { label: 'Katering', defaultEnabled: false },
  muthowif: { label: 'Muthowif', defaultEnabled: false },
} as const

export type PilgrimDataOwner = keyof typeof PILGRIM_DATA_OWNERS
export const PILGRIM_DATA_OWNER_TYPES = Object.keys(PILGRIM_DATA_OWNERS) as PilgrimDataOwner[]

export type ProductRef = { productType: PilgrimDataOwner; productId: string }
export const productRefKey = (r: { productType: string; productId: string }) => `${r.productType}:${r.productId}`
