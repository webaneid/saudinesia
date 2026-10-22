import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { addressSchema } from '@/lib/validators/address'
import { upsertAddress } from '@/lib/address/prepare'
import { z } from 'zod'

const updateSchema = z.object({
  name:             z.string().min(1).optional(),
  city:             z.enum(['makkah', 'madinah']).optional(),
  stars:            z.coerce.number().int().min(1).max(5).optional(),
  distanceToHaramM: z.coerce.number().int().min(0).optional(),
  description:      z.string().optional(),
  facilities:       z.array(z.string()).optional(),
  featuredImageKey: z.string().nullable().optional(),
  isActive:         z.boolean().optional(),
  address:          addressSchema.optional(), // docs/arsitektur-alamat.md §9
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    // Periode & jadwal kamar di-fetch terpisah lewat GET .../periods (docs/arsitektur-hotel.md §11.3).
    const hotel = await prisma.hotel.findUnique({
      where: { id },
      include: { address: { include: { province: true, regency: true, district: true, village: true } } },
    })
    if (!hotel) return NextResponse.json(err('Hotel tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(hotel))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Menutup Gap #2 (docs/arsitektur-hotel.md §8) — dulu `data: body` mentah tanpa validasi.
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { address, ...rest } = parsed.data

    const data: Record<string, unknown> = { ...rest }
    if (address) {
      const existing = await prisma.hotel.findUniqueOrThrow({ where: { id }, select: { addressId: true } })
      const result = await upsertAddress(existing.addressId, address)
      if (!result.ok) return NextResponse.json(err(result.message), { status: 400 })
      data.addressId = result.id
    }

    const hotel = await prisma.hotel.update({ where: { id }, data })
    return NextResponse.json(ok(hotel))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Hotel tidak ditemukan'), { status: 404 })
    console.error('[admin/products/hotels/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
