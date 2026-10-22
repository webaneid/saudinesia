import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'

// Harga TIDAK ada di sini secara sengaja — sekarang milik MuthowifServicePrice, satu layanan
// flat, bukan per-orang (docs/arsitektur-muthowif.md §9).
const createSchema = z.object({
  name:          z.string().min(1),
  bio:           richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  languages:     z.array(z.string()).default([]),
  dailyCapacity: z.coerce.number().int().positive().default(50),
  isActive:      z.boolean().default(true),
})

export async function GET() {
  try {
    await requireManager()
    return NextResponse.json(ok(await prisma.muthowif.findMany({ orderBy: { rating: 'desc' } })))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const m = await prisma.muthowif.create({ data: { ...parsed.data, bio: emptyToNull(parsed.data.bio) } })
    return NextResponse.json(ok(m), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/muthowif/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
