import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/db'

// Dibaca dari DB (hotel & muthowif aktif): harus dirender saat REQUEST. Tanpa ini Next meng-prerender sitemap saat
// `next build` — gagal di image Docker (tidak ada database saat build) dan, kalaupun berhasil, isinya membeku pada
// data saat build sehingga hotel baru tidak pernah masuk.
export const dynamic = 'force-dynamic'

const LOCALES = ['id', 'en'] as const

const CATALOG_PATHS = [
  '', 'hotels', 'transport', 'visa', 'muthowif', 'packages', 'tours', 'catering', 'haji', 'flight',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://saudinesia.com').replace(/\/$/, '')

  const staticEntries: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    CATALOG_PATHS.map((path) => ({
      url: `${baseUrl}/${locale}${path ? `/${path}` : ''}`,
      lastModified: new Date(),
    }))
  )

  const [hotels, muthowifs] = await Promise.all([
    prisma.hotel.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.muthowif.findMany({ where: { isActive: true }, select: { id: true } }),
  ])

  const dynamicEntries: MetadataRoute.Sitemap = LOCALES.flatMap((locale) => [
    ...hotels.map((h) => ({ url: `${baseUrl}/${locale}/hotels/${h.id}`, lastModified: new Date() })),
    ...muthowifs.map((m) => ({ url: `${baseUrl}/${locale}/muthowif/${m.id}`, lastModified: new Date() })),
  ])

  return [...staticEntries, ...dynamicEntries]
}
