// Mesin harga terpadu (docs/arsitektur-harga-terpadu.md §4, §14). Satu tipe titik harga untuk semua yang dijual.

export type PriceOwnerType = 'visa' | 'flight' | 'hotel' | 'transport' | 'muthowif' | 'package' | 'tour_package' | 'haji' | 'catering' | 'hotel_service'
export type PriceUnit = 'person' | 'room_night' | 'vehicle' | 'person_day' | 'package' | 'service'

/** Hasil hitung satu varian dari modal (belum disimpan). */
export type ResolvedVariant = {
  variantKey: string
  unit: PriceUnit
  /** MODAL (HPP, rupiah). null = modal belum diisi / belum lengkap. */
  costIdr: number | null
  /** Harga otomatis (modal × margin dibulatkan). null = tak bisa dihitung (tak ada modal) → harga yang sudah ada dipertahankan. */
  autoSellIdr: number | null
  /** Harga jual manual dari sumber lama (override tier JSON). undefined = jangan sentuh nilai tersimpan. */
  manualSellIdr?: number | null
  marginPctUsed: number | null
  roundingUsed: number | null
  fxRateIds: string[]
  vendorIds: string[]
}

/** Keadaan titik harga setelah disimpan — masukan untuk penulisan ganda ke kolom lama. */
export type StoredVariant = { variantKey: string; sellIdr: number; costIdr: number | null }

export type PriceOwner = {
  ownerType: PriceOwnerType
  /** Satuan harga bawaan titik tunggal (""); varian lain membawa satuannya sendiri. */
  unit: PriceUnit
  /** Varian yang boleh DIBUAT lewat harga manual saat titiknya belum ada (mis. "" untuk produk berharga tunggal). Varian turunan (tier Visa) tidak termasuk. */
  creatableVariants: ReadonlyArray<{ key: string; unit: PriceUnit }>
  /** Harga seluruhnya diisi admin (katering, layanan hotel): tidak ada perhitungan dari modal — hitung-ulang tak menyentuhnya; modal opsional diisi manual. */
  manualOnly?: boolean
  /** Modal/jualnya membaca titik harga modul lain (hotel, kendaraan, visa, tiket) → ikut dihitung ulang pada setiap putaran kurs dan dihitung SETELAH modul dasar. */
  dependsOnOthers: boolean
  /** Varian yang tak lagi dihasilkan `resolve` dihapus (tier Visa yang dibuang). */
  prunes: boolean
  /** Id yang dihitung ulang massal (cron kurs / ubah margin). */
  listIds: () => Promise<string[]>
  /** Nama tampilan + tautan editor (tanpa locale) — dipakai Kesehatan Margin dan PriceCard. */
  describe: (ids: string[]) => Promise<Map<string, { label: string; href: string }>>
  /** Subset `ids` yang masih ada — untuk menyapu titik harga yatim. */
  existing: (ids: string[]) => Promise<string[]>
  resolve: (id: string) => Promise<ResolvedVariant[]>
  /** Harga lama di kolom cache, dipungut bila belum ada titik harga dan modal kosong ("jual tanpa modal"). null = tak ada. */
  adoptLegacy: (id: string) => Promise<number | null>
  /** Penulisan ganda ke kolom lama agar pembaca lama tetap jalan (dihapus di Fase 5). */
  writeLegacy: (tx: import('@prisma/client').Prisma.TransactionClient, id: string, stored: StoredVariant[]) => Promise<void>
}

/** Pembaca: satu titik harga + turunannya. `profitIdr` null bila modal belum lengkap. */
export type PriceView = {
  ownerType: PriceOwnerType
  ownerId: string
  variantKey: string
  unit: PriceUnit
  costIdr: number | null
  sellIdr: number
  profitIdr: number | null
  marginPct: number | null
  mode: 'auto' | 'manual'
  /** Harga hasil rumus (modal × margin) — null bila tak ada (modal kosong / pemilik manual-only). Admin saja. */
  autoSellIdr: number | null
  manualNote: string | null
  manualAt: Date | null
}
