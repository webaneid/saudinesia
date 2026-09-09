// Sentinel productType/productId untuk field manifest generik yang TIDAK terikat produk apa pun
// (mis. checkout Transport-only) — docs/arsitektur-booking.md §6 Step 6a. ManifestFieldRequirement
// tidak meng-enforce productId sebagai FK sungguhan (lihat komentar model di prisma/schema.prisma),
// jadi sentinel string ini aman dipakai tanpa baris produk nyata di belakangnya.
export const CORE_MANIFEST_PRODUCT_TYPE = 'core'
export const CORE_MANIFEST_PRODUCT_ID = 'default'
