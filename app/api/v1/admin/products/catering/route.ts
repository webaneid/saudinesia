import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { cateringOptionCreateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'

function authError(e: unknown): NextResponse | null {
  return e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')
    ? NextResponse.json(err('Forbidden'), { status: 403 })
    : null
}

export async function GET() {
  try {
    await requireManager()
    return NextResponse.json(ok(await prisma.cateringOption.findMany()))
  } catch (e) {
    const a = authError(e); if (a) return a
    console.error('[admin/products/catering/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = cateringOptionCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const c = await prisma.cateringOption.create({
      data: { ...parsed.data, description: emptyToNull(parsed.data.description) },
    })
    return NextResponse.json(ok(c), { status: 201 })
  } catch (e) {
    const a = authError(e); if (a) return a
    console.error('[admin/products/catering/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
