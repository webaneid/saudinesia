import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getPresignedUrl } from '@/lib/storage/minio'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const querySchema = z.object({
  language: z.string().optional(),
})

// Showcase-only — jamaah tidak lagi pilih muthowif spesifik saat booking, roster di sini murni
// untuk trust/marketing (docs/arsitektur-muthowif.md §9). Harga di meta — satu harga flat,
// cache dari HPP (docs/arsitektur-muthowif.md §10), tidak lagi per-season.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })
    const { language } = parsed.data

    const guides = await prisma.muthowif.findMany({
      where: {
        isActive: true,
        ...(language && { languages: { array_contains: language } }),
      },
      orderBy: { rating: 'desc' },
    })

    const data = await Promise.all(guides.map(async (g) => ({
      id: g.id, name: g.name, bio: g.bio,
      photoUrl: g.photoKey ? await getPresignedUrl(g.photoKey, 3600).catch(() => null) : null,
      languages: g.languages, rating: Number(g.rating), dailyCapacity: g.dailyCapacity,
    })))

    const servicePrice = await prisma.muthowifServicePrice.findFirst()
    const pricePerDay = servicePrice ? Number(servicePrice.price) : 0

    return NextResponse.json(ok(data, { total: data.length, pricePerDay }))
  } catch (error) {
    console.error('[catalog/muthowif]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
