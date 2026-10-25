import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'

const createSchema = z.object({
  name:        z.string().min(1),
  city:        z.string().optional(),
  description: richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  gmapsUrl:    z.string().url().optional().or(z.literal('')),
  isActive:    z.boolean().default(true),
})

export async function GET() {
  try {
    await requireManager()
    return NextResponse.json(ok(await prisma.tourismSite.findMany({ orderBy: { name: 'asc' } })))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tourism-sites/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { gmapsUrl, ...rest } = parsed.data
    const site = await prisma.tourismSite.create({ data: { ...rest, description: emptyToNull(rest.description), gmapsUrl: gmapsUrl || null } })
    return NextResponse.json(ok(site), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tourism-sites/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
