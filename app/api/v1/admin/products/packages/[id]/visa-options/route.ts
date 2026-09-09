import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

// Opsi visa untuk mode user_choice (docs/arsitektur-paket-umroh.md §3) — kurasi manual, harga live
// dari VisaProduct.price, tidak masuk harga jual paket dasar.
const createSchema = z.object({ visaProductId: z.string().min(1) })
const removeSchema = z.object({ visaProductId: z.string().min(1) })

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: packageId } = await params
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const existing = await prisma.packageVisaOption.findUnique({
      where: { packageId_visaProductId: { packageId, visaProductId: parsed.data.visaProductId } },
    })
    if (existing) return NextResponse.json(err('Opsi visa ini sudah ada'), { status: 409 })

    const created = await prisma.packageVisaOption.create({ data: { packageId, ...parsed.data } })
    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/visa-options/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: packageId } = await params
    const parsed = removeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    await prisma.packageVisaOption.delete({
      where: { packageId_visaProductId: { packageId, visaProductId: parsed.data.visaProductId } },
    })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/visa-options/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
