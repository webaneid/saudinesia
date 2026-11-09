import type { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'
import { prisma } from '@/lib/db'
import { siteOrigin } from '@/lib/seo/site'
import { availableCatalogs } from '@/lib/catalog/availability'

// Dibaca dari DB (hotel & muthowif aktif): harus dirender saat REQUEST. Tanpa ini Next meng-prerender sitemap saat
// `next build` — gagal di image Docker (tidak ada database saat build) dan, kalaupun berhasil, isinya membeku pada
// data saat build sehingga hotel baru tidak pernah masuk.
export const dynamic = 'force-dynamic'


export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteOrigin()
  // Beranda + hanya katalog yang punya produk aktif (docs/arsitektur-frontend-publik.md §7 V5).
  const available = await availableCatalogs()
  const CATALOG_PATHS = ['', ...available]

  const staticEntries: MetadataRoute.Sitemap = routing.locales.flatMap((locale) =>
    CATALOG_PATHS.map((path) => ({
      url: `${baseUrl}/${locale}${path ? `/${path}` : ''}`,
      lastModified: new Date(),
    }))
  )

  const [hotels, muthowifs] = await Promise.all([
    prisma.hotel.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.muthowif.findMany({ where: { isActive: true }, select: { id: true } }),
  ])

  const dynamicEntries: MetadataRoute.Sitemap = routing.locales.flatMap((locale) => [
    ...hotels.map((h) => ({ url: `${baseUrl}/${locale}/hotels/${h.id}`, lastModified: new Date() })),
    ...muthowifs.map((m) => ({ url: `${baseUrl}/${locale}/muthowif/${m.id}`, lastModified: new Date() })),
  ])

  return [...staticEntries, ...dynamicEntries]
}
