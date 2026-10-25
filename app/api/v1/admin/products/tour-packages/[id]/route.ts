import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { refreshTourPackagePriceCache } from '@/lib/pricing/refreshTourPackagePriceCache'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'

// transportTripId/includedTransportPricingId nullable eksplisit — admin bisa MELEPAS (kirim
// null), bukan cuma "tidak diubah". transportMode/hotelMode adalah pemilih 3-mode (included/
// user_choice/none) — docs/arsitektur-ziarah.md §12.
const updateSchema = z.object({
  name:                      z.string().min(1).optional(),
  description:               richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  isActive:                  z.boolean().optional(),
  transportMode:             z.enum(['included', 'user_choice', 'none']).optional(),
  transportTripId:           z.string().min(1).nullable().optional(),
  includedTransportPricingId: z.string().min(1).nullable().optional(),
  hotelMode:                 z.enum(['included', 'user_choice', 'none']).optional(),
})

// Field yang mempengaruhi harga jual paket dasar (docs/arsitektur-ziarah.md §12.4) — perubahan
// salah satu ini WAJIB memicu refresh cache (menutup gap §11.10, digeneralisasi ke semua field
// terkait mode, bukan cuma transportTripId).
const PRICE_AFFECTING_FIELDS = ['transportMode', 'transportTripId', 'includedTransportPricingId', 'hotelMode'] as const

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const pkg = await prisma.tourPackage.findUnique({
      where: { id },
      include: {
        transportTrip: { include: { pricing: { where: { isActive: true }, include: { vehicle: true } } } },
        includedTransportPricing: { include: { vehicle: true } },
        sites: { include: { tourismSite: true }, orderBy: { order: 'asc' } },
        hotels: { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
        hotelOptions: { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
      },
    })
    if (!pkg) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(pkg))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const data: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.description !== undefined) data.description = emptyToNull(parsed.data.description)

    // includedTransportPricingId — snapshot harga SERVER-SIDE ke includedTransportPrice saat
    // dikunci (sama prinsip TourPackageHotel.pricePerNight, §10.10). Kalau dilepas (null),
    // includedTransportPrice ikut null-kan.
    if (parsed.data.includedTransportPricingId !== undefined) {
      if (parsed.data.includedTransportPricingId === null) {
        data.includedTransportPrice = null
      } else {
        const pricing = await prisma.transportPricing.findUniqueOrThrow({
          where: { id: parsed.data.includedTransportPricingId },
          select: { price: true },
        })
        data.includedTransportPrice = pricing.price
      }
    }

    const pkg = await prisma.tourPackage.update({ where: { id }, data })

    const priceAffected = PRICE_AFFECTING_FIELDS.some(f => f in parsed.data)
    if (priceAffected) {
      await refreshTourPackagePriceCache(id)
    }

    return NextResponse.json(ok(pkg))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Paket ziarah tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tour-packages/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Tidak ada DELETE — dipakai histori BookingTourPackage, nonaktifkan via isActive.
