import { cache } from 'react'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'

// Layanan publik tampil HANYA bila punya minimal satu produk aktif (docs/arsitektur-frontend-publik.md §7, arahan pemilik 2026-11-09).
// Satu sumber untuk menu, footer, beranda, tombol hero/CTA, sitemap, dan halaman katalog. Aturan per layanan = `where` daftar di halaman
// katalognya; tidak bergantung harga. Tanpa cache antar-permintaan: produk pertama yang diaktifkan langsung membuat layanannya tampil.

export const CATALOG_KEYS = ['packages', 'haji', 'visa', 'flight', 'hotels', 'transport', 'muthowif', 'tours', 'catering'] as const
export type CatalogKey = (typeof CATALOG_KEYS)[number]

export const isCatalogKey = (v: string): v is CatalogKey => (CATALOG_KEYS as readonly string[]).includes(v)

const HAS_PRODUCT: Record<CatalogKey, () => Promise<unknown>> = {
  packages:  () => prisma.package.findFirst({ where: { isActive: true }, select: { id: true } }),
  haji:      () => prisma.hajiProduct.findFirst({ where: { isActive: true }, select: { id: true } }),
  visa:      () => prisma.visaProduct.findFirst({ where: { isActive: true }, select: { id: true } }),
  flight:    () => prisma.flightSchedule.findFirst({ where: { isActive: true, route: { isActive: true } }, select: { id: true } }),
  hotels:    () => prisma.hotel.findFirst({ where: { isActive: true }, select: { id: true } }),
  transport: () => prisma.transportTrip.findFirst({ where: { isActive: true }, select: { id: true } }),
  muthowif:  () => prisma.muthowif.findFirst({ where: { isActive: true }, select: { id: true } }),
  tours:     () => prisma.tourPackage.findFirst({ where: { isActive: true }, select: { id: true } }),
  catering:  () => prisma.cateringOption.findFirst({ where: { isActive: true }, select: { id: true } }),
}

/** Layanan yang punya produk aktif. Sekali per permintaan (React `cache`). */
export const availableCatalogs = cache(async (): Promise<ReadonlySet<string>> => {
  const found = await Promise.all(CATALOG_KEYS.map(async key => [key, (await HAS_PRODUCT[key]()) !== null] as const))
  return new Set(found.filter(([, has]) => has).map(([key]) => key))
})

/** Tujuan tombol/menu (`packages`, `visa`, …) masih menuju layanan berproduk? Tujuan bukan katalog (beranda, daftar, `#catalog`) selalu boleh. */
export function targetAvailable(target: string, available: ReadonlySet<string>): boolean {
  return !isCatalogKey(target) || available.has(target)
}

/** Dipanggil di awal halaman katalog: layanan tanpa produk = 404, juga bila alamatnya diketik langsung (§7 V3). */
export async function requireCatalog(key: CatalogKey): Promise<void> {
  if (!(await availableCatalogs()).has(key)) notFound()
}
