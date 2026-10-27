import { prisma } from '@/lib/db'
import type { MediaProductType } from './owners'
import { minioMediaStorage, type MediaStorage } from './storage'

// Penyedia foto untuk TAMPILAN (katalog publik + admin): satu query batch untuk banyak produk, URL presigned (bucket tetap private).
// Dipakai komponen tampilan dan halaman server; tak ada lagi pembuatan URL foto per-halaman.

export type ProductImageView = { id: string; url: string; cardUrl: string; alt: string | null; width: number | null; height: number | null; isFeatured: boolean }
export type ProductImages = { featured: ProductImageView | null; images: ProductImageView[] }
const TTL_SECONDS = 3600

export async function getProductImages(
  type: MediaProductType, productIds: string[], storage: MediaStorage = minioMediaStorage,
): Promise<Map<string, ProductImages>> {
  const out = new Map<string, ProductImages>(productIds.map(id => [id, { featured: null, images: [] }]))
  if (productIds.length === 0) return out
  const rows = await prisma.productImage.findMany({
    where: { productType: type, productId: { in: productIds } },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  })
  // Promise.all mempertahankan urutan baris (featured dulu, lalu sortOrder) — dorong ke hasil SETELAH semua URL siap.
  const views = await Promise.all(rows.map(async (r): Promise<[string, ProductImageView] | null> => {
    const url = await storage.url(r.key, TTL_SECONDS).catch(() => null)
    if (!url) return null // objek tak terbaca: lewati, jangan merusak halaman
    const cardUrl = r.cardKey ? (await storage.url(r.cardKey, TTL_SECONDS).catch(() => null)) ?? url : url
    return [r.productId, { id: r.id, url, cardUrl, alt: r.alt, width: r.width, height: r.height, isFeatured: r.isFeatured }]
  }))
  for (const v of views) if (v) out.get(v[0])!.images.push(v[1])
  for (const entry of out.values()) entry.featured = entry.images.find(i => i.isFeatured) ?? entry.images[0] ?? null
  return out
}

/** Pintasan untuk kartu daftar: id → URL kartu foto sampul (atau null). Satu query untuk semua id. */
export async function getFeaturedCardUrls(type: MediaProductType, productIds: string[], storage: MediaStorage = minioMediaStorage): Promise<Map<string, string | null>> {
  const all = await getProductImages(type, productIds, storage)
  return new Map([...all].map(([id, v]) => [id, v.featured?.cardUrl ?? null]))
}

/** Pintasan untuk halaman detail: id → URL tampilan foto sampul (atau null). */
export async function getFeaturedUrls(type: MediaProductType, productIds: string[], storage: MediaStorage = minioMediaStorage): Promise<Map<string, string | null>> {
  const all = await getProductImages(type, productIds, storage)
  return new Map([...all].map(([id, v]) => [id, v.featured?.url ?? null]))
}

/** Untuk kartu katalog: id → { url kartu sampul, alt } (atau tanpa entri bila belum ada foto). Satu query untuk semua id. */
export async function getFeaturedCards(type: MediaProductType, productIds: string[], storage: MediaStorage = minioMediaStorage): Promise<Map<string, { src: string; alt: string | null }>> {
  const all = await getProductImages(type, productIds, storage)
  const out = new Map<string, { src: string; alt: string | null }>()
  for (const [id, v] of all) if (v.featured) out.set(id, { src: v.featured.cardUrl, alt: v.featured.alt })
  return out
}
