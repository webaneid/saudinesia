import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { repriceOwner } from '@/lib/pricing/engine'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { deleteTourPackage } from '@/lib/admin/productDelete'
import { sellPrice, sellPrices } from '@/lib/pricing/engine/read'

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
    // Kolom `price` sub-modul sudah dihapus (harga terpadu Fase 5): editor membaca `price` bersarang, jadi disematkan lagi dari titik harga.
    const [transport, hotel, self] = await Promise.all([
      sellPrices('transport', [...(pkg.transportTrip?.pricing.map(p => p.id) ?? []), ...(pkg.includedTransportPricingId ? [pkg.includedTransportPricingId] : [])]),
      sellPrices('hotel', [...pkg.hotels.map(h => h.hotelRoomScheduleId), ...pkg.hotelOptions.map(o => o.hotelRoomScheduleId)]),
      sellPrice('tour_package', id),
    ])
    const p = (m: Map<string, number>, row: { id: string }) => ({ ...row, price: m.get(row.id) ?? 0 })
    return NextResponse.json(ok({
      ...pkg, price: self,
      transportTrip: pkg.transportTrip && { ...pkg.transportTrip, pricing: pkg.transportTrip.pricing.map(x => p(transport, x)) },
      includedTransportPricing: pkg.includedTransportPricing && p(transport, pkg.includedTransportPricing),
      hotels: pkg.hotels.map(h => ({ ...h, hotelRoomSchedule: p(hotel, h.hotelRoomSchedule) })),
      hotelOptions: pkg.hotelOptions.map(o => ({ ...o, hotelRoomSchedule: p(hotel, o.hotelRoomSchedule) })),
    }))
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
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
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
        await prisma.transportPricing.findUniqueOrThrow({ where: { id: parsed.data.includedTransportPricingId }, select: { id: true } })
        data.includedTransportPrice = await sellPrice('transport', parsed.data.includedTransportPricingId)
      }
    }

    const pkg = await prisma.tourPackage.update({ where: { id }, data })

    const priceAffected = PRICE_AFFECTING_FIELDS.some(f => f in parsed.data)
    if (priceAffected) {
      await repriceOwner('tour_package', id)
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

// Hapus sungguhan hanya bila tak ada riwayat yang merujuk; selain itu nonaktif (lib/admin/productDelete.ts).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    return NextResponse.json(ok(await deleteTourPackage(id)))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Paket ziarah tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tour-packages/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
