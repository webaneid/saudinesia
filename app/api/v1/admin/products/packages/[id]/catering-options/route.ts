import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

// Opsi katering untuk mode user_choice (docs/arsitektur-paket-umroh.md §3) — tiap baris simpan
// numPeople/numDays sendiri (mirip TourPackageHotel — harga bergantung multiplier), harga live
// dari CateringOption.pricePerPersonRegular × numPeople × numDays, tidak masuk harga jual dasar.
const createSchema = z.object({
  cateringOptionId: z.string().min(1),
  numPeople:        z.coerce.number().int().min(1),
  numDays:          z.coerce.number().int().min(1),
})
const removeSchema = z.object({ cateringOptionId: z.string().min(1) })

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: packageId } = await params
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const existing = await prisma.packageCateringOption.findUnique({
      where: { packageId_cateringOptionId: { packageId, cateringOptionId: parsed.data.cateringOptionId } },
    })
    if (existing) return NextResponse.json(err('Opsi katering ini sudah ada'), { status: 409 })

    const created = await prisma.packageCateringOption.create({ data: { packageId, ...parsed.data } })
    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/catering-options/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: packageId } = await params
    const parsed = removeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    await prisma.packageCateringOption.delete({
      where: { packageId_cateringOptionId: { packageId, cateringOptionId: parsed.data.cateringOptionId } },
    })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/catering-options/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
