import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const addSchema = z.object({
  tourismSiteId: z.string().min(1),
  order:         z.coerce.number().int().min(0).default(0),
})
const removeSchema = z.object({
  tourismSiteId: z.string().min(1),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId } = await params
    const parsed = addSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const existing = await prisma.tourPackageSite.findUnique({
      where: { tourPackageId_tourismSiteId: { tourPackageId, tourismSiteId: parsed.data.tourismSiteId } },
    })
    if (existing) return NextResponse.json(err('Situs ini sudah ada di paket'), { status: 409 })

    const site = await prisma.tourPackageSite.create({
      data: { tourPackageId, tourismSiteId: parsed.data.tourismSiteId, order: parsed.data.order },
      include: { tourismSite: true },
    })
    return NextResponse.json(ok(site), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/sites/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId } = await params
    const parsed = removeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    await prisma.tourPackageSite.delete({
      where: { tourPackageId_tourismSiteId: { tourPackageId, tourismSiteId: parsed.data.tourismSiteId } },
    })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/sites/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
