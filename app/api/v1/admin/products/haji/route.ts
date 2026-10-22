import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { hajiProductCreateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'

export async function GET() {
  try {
    await requireManager()
    return NextResponse.json(ok(await prisma.hajiProduct.findMany({ orderBy: { year: 'asc' } })))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/haji/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = hajiProductCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { description, ...d } = parsed.data
    const p = await prisma.hajiProduct.create({
      data: { ...d, description: emptyToNull(description), priceLabel: 'per orang', images: [] },
    })
    return NextResponse.json(ok(p), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/haji/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
