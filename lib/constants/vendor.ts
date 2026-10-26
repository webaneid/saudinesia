// Konstanta vendor (ADR-0003, docs/arsitektur-vendor.md). Kategori SISTEM dibuat oleh migrasi `20261026120000_vendor_single_flow_expand`;
// slug di sini HARUS sama dengan yang di-seed migrasi (dijaga scripts/test-vendor-model.ts). Kategori lain dikelola admin di database.

export const VENDOR_CATEGORY_SLUGS = {
  hotel: 'hotel',
  transport: 'transport',
  airline: 'airline',
  visa: 'visa',
  catering: 'catering',
  guide: 'guide',
  tourOperator: 'tour-operator',
  internal: 'internal',
  other: 'other',
} as const

export type VendorCategorySlug = (typeof VENDOR_CATEGORY_SLUGS)[keyof typeof VENDOR_CATEGORY_SLUGS]

/** Kategori sistem: nama tampilan awal + urutan (sama dengan seed migrasi). */
export const SYSTEM_VENDOR_CATEGORIES: ReadonlyArray<{ slug: VendorCategorySlug; name: string; sortOrder: number }> = [
  { slug: 'hotel',         name: 'Hotel',                 sortOrder: 10 },
  { slug: 'transport',     name: 'Transportasi / Bus',    sortOrder: 20 },
  { slug: 'airline',       name: 'Maskapai',              sortOrder: 30 },
  { slug: 'visa',          name: 'Visa / Syarikah',       sortOrder: 40 },
  { slug: 'catering',      name: 'Katering',              sortOrder: 50 },
  { slug: 'guide',         name: 'Muthowif / Pemandu',    sortOrder: 60 },
  { slug: 'tour-operator', name: 'Operator Tur / Ziarah', sortOrder: 70 },
  { slug: 'internal',      name: 'Internal',              sortOrder: 80 },
  { slug: 'other',         name: 'Lainnya',               sortOrder: 90 },
]

/** Vendor sistem (`Vendor.systemKey`) — dibuat migrasi, tak dapat dihapus/dinonaktifkan. */
export const SYSTEM_VENDOR_KEYS = { saudinesia: 'saudinesia' } as const

/**
 * Konteks pemakaian picker → kategori yang disaring SEBAGAI TAMPILAN (null = semua vendor). Server tidak memaksa kategori: yang ditegakkan
 * hanya vendor ada dan aktif (ADR-0003 poin 5).
 */
export const VENDOR_CONTEXT_CATEGORIES = {
  flight: [VENDOR_CATEGORY_SLUGS.airline],
  hotel: [VENDOR_CATEGORY_SLUGS.hotel],
  transport: [VENDOR_CATEGORY_SLUGS.transport],
  visa: [VENDOR_CATEGORY_SLUGS.visa],
  muthowif: [VENDOR_CATEGORY_SLUGS.internal],
  costComponent: null,
} as const satisfies Record<string, readonly VendorCategorySlug[] | null>

export type VendorContext = keyof typeof VENDOR_CONTEXT_CATEGORIES

/** Kunci keunikan nama vendor — HARUS identik dengan SQL migrasi: lower(regexp_replace(btrim(name), '\s+', ' ', 'g')). */
export const vendorNameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

/** Slug kategori dari nama: huruf kecil, tanpa aksen, non-alfanumerik → '-'. Kosong → string kosong (pemanggil menolak). */
export const slugifyCategoryName = (name: string): string =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
