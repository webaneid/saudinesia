import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { withAdminPrices } from '@/lib/pricing/engine/adminRead'
import { canViewCost } from '@/lib/pricing/policy'

// price TIDAK ada di sini secara sengaja — cache dari computeTourPackageBreakdown()
// (docs/arsitektur-ziarah.md §8.3), diisi lewat endpoint costs, bukan manual. Mode
// kendaraan/hotel (included/user_choice/none, §12) sengaja TIDAK diisi di create — dikonfigurasi
// belakangan di package builder, sama pola dengan situs/hotel/komponen biaya yang ditambah
// setelah paket dibuat, bukan saat create.
const createSchema = z.object({
  name:        z.string().min(1),
  description: richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  isActive:    z.boolean().default(true),
})

export async function GET() {
  try {
    const session = await requireManager()
    const packages = await withAdminPrices('tour_package', await prisma.tourPackage.findMany({
      include: {
        transportTrip: { select: { id: true, name: true, origin: true, destination: true } },
        includedTransportPricing: { include: { vehicle: true } },
        sites: { include: { tourismSite: true }, orderBy: { order: 'asc' } },
        _count: { select: { sites: true } },
      },
      orderBy: { createdAt: 'desc' },
    }), { includeCost: canViewCost(session.role) })
    return NextResponse.json(ok(packages))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const pkg = await prisma.tourPackage.create({ data: { ...parsed.data, description: emptyToNull(parsed.data.description) } })
    return NextResponse.json(ok(pkg), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
