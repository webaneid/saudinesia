import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { refreshPackagePriceCache } from '@/lib/pricing/refreshPackagePriceCache'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'

const modeEnum = z.enum(['included', 'user_choice', 'none'])

// Semua *Id nullable eksplisit — admin bisa MELEPAS (kirim null), bukan cuma "tidak diubah".
// *Mode adalah pemilih 3-mode (included/user_choice/none) per komponen — docs/arsitektur-paket-umroh.md §3.
const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  description: richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  priceLabel:  z.string().nullable().optional(),
  highlights:  z.array(z.string()).optional(),
  isActive:    z.boolean().optional(),
  isFeatured:  z.boolean().optional(),

  hotelMakkahMode:               modeEnum.optional(),
  includedHotelMakkahScheduleId: z.string().min(1).nullable().optional(),
  includedHotelMakkahNights:     z.number().int().min(1).nullable().optional(),
  includedHotelMakkahNumRooms:   z.number().int().min(1).nullable().optional(),

  hotelMadinahMode:               modeEnum.optional(),
  includedHotelMadinahScheduleId: z.string().min(1).nullable().optional(),
  includedHotelMadinahNights:     z.number().int().min(1).nullable().optional(),
  includedHotelMadinahNumRooms:   z.number().int().min(1).nullable().optional(),

  transportMode:              modeEnum.optional(),
  transportTripId:            z.string().min(1).nullable().optional(),
  includedTransportPricingId: z.string().min(1).nullable().optional(),

  muthowifMode: modeEnum.optional(),

  visaMode:              modeEnum.optional(),
  includedVisaProductId: z.string().min(1).nullable().optional(),

  flightMode:               modeEnum.optional(),
  flightRouteId:            z.string().min(1).nullable().optional(),
  includedFlightScheduleId: z.string().min(1).nullable().optional(),

  cateringMode:              modeEnum.optional(),
  includedCateringOptionId:  z.string().min(1).nullable().optional(),
  includedCateringNumPeople: z.number().int().min(1).nullable().optional(),
  includedCateringNumDays:   z.number().int().min(1).nullable().optional(),
})

// Field yang mempengaruhi harga jual paket dasar (docs/arsitektur-paket-umroh.md §5) — perubahan
// salah satu ini WAJIB memicu refresh cache.
const PRICE_AFFECTING_FIELDS = [
  'hotelMakkahMode', 'includedHotelMakkahScheduleId', 'includedHotelMakkahNights', 'includedHotelMakkahNumRooms',
  'hotelMadinahMode', 'includedHotelMadinahScheduleId', 'includedHotelMadinahNights', 'includedHotelMadinahNumRooms',
  'transportMode', 'transportTripId', 'includedTransportPricingId',
  'muthowifMode',
  'visaMode', 'includedVisaProductId',
  'flightMode', 'flightRouteId', 'includedFlightScheduleId',
  'cateringMode', 'includedCateringOptionId', 'includedCateringNumPeople', 'includedCateringNumDays',
] as const

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const pkg = await prisma.package.findUnique({
      where: { id },
      include: {
        transportTrip: { include: { pricing: { where: { isActive: true }, include: { vehicle: true } } } },
        includedTransportPricing: { include: { vehicle: true } },
        includedHotelMakkahSchedule: { include: { period: { include: { hotel: true } }, roomType: true } },
        includedHotelMadinahSchedule: { include: { period: { include: { hotel: true } }, roomType: true } },
        hotelOptions: { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
        includedVisaProduct: true,
        visaOptions: { include: { visaProduct: true } },
        flightRoute: { include: { schedules: { where: { isActive: true } } } },
        includedFlightSchedule: { include: { route: true } },
        includedCateringOption: true,
        cateringOptions: { include: { cateringOption: true } },
      },
    })
    if (!pkg) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(pkg))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/GET]', e)
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

    // Hotel Makkah — snapshot server-side ke includedHotelMakkahPrice (pola sama
    // TourPackageHotel.pricePerNight, docs/arsitektur-ziarah.md §10.10).
    if (parsed.data.includedHotelMakkahScheduleId !== undefined) {
      if (parsed.data.includedHotelMakkahScheduleId === null) {
        data.includedHotelMakkahPrice = null
      } else {
        const sched = await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: parsed.data.includedHotelMakkahScheduleId }, select: { price: true } })
        data.includedHotelMakkahPrice = sched.price
      }
    }
    // Hotel Madinah — sama pola
    if (parsed.data.includedHotelMadinahScheduleId !== undefined) {
      if (parsed.data.includedHotelMadinahScheduleId === null) {
        data.includedHotelMadinahPrice = null
      } else {
        const sched = await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: parsed.data.includedHotelMadinahScheduleId }, select: { price: true } })
        data.includedHotelMadinahPrice = sched.price
      }
    }
    // Transport
    if (parsed.data.includedTransportPricingId !== undefined) {
      if (parsed.data.includedTransportPricingId === null) {
        data.includedTransportPrice = null
      } else {
        const pricing = await prisma.transportPricing.findUniqueOrThrow({ where: { id: parsed.data.includedTransportPricingId }, select: { price: true } })
        data.includedTransportPrice = pricing.price
      }
    }
    // Visa
    if (parsed.data.includedVisaProductId !== undefined) {
      if (parsed.data.includedVisaProductId === null) {
        data.includedVisaPrice = null
      } else {
        const visa = await prisma.visaProduct.findUniqueOrThrow({ where: { id: parsed.data.includedVisaProductId }, select: { price: true } })
        data.includedVisaPrice = visa.price
      }
    }
    // Tiket Pesawat
    if (parsed.data.includedFlightScheduleId !== undefined) {
      if (parsed.data.includedFlightScheduleId === null) {
        data.includedFlightPrice = null
      } else {
        const sched = await prisma.flightSchedule.findUniqueOrThrow({ where: { id: parsed.data.includedFlightScheduleId }, select: { price: true } })
        data.includedFlightPrice = sched.price
      }
    }

    // Muthowif — singleton, tidak ada id untuk dipilih. Auto-snapshot dari harga singleton HANYA
    // saat pertama kali dinyalakan ke 'included' dan belum ada nilai tersimpan — supaya tidak
    // menimpa nilai yang sudah pernah diedit admin (docs/arsitektur-paket-umroh.md §4).
    if (parsed.data.muthowifMode === 'included') {
      const before = await prisma.package.findUniqueOrThrow({ where: { id }, select: { includedMuthowifPrice: true } })
      if (before.includedMuthowifPrice == null) {
        const singleton = await prisma.muthowifServicePrice.findFirst()
        data.includedMuthowifPrice = singleton ? singleton.price : 0
      }
    }

    // Katering — price = numPeople × numDays × pricePerPersonRegular, dihitung ulang kalau salah
    // satu dari 3 field ini disentuh.
    const cateringTouched = (['includedCateringOptionId', 'includedCateringNumPeople', 'includedCateringNumDays'] as const)
      .some(k => k in parsed.data)
    if (cateringTouched) {
      const before = await prisma.package.findUniqueOrThrow({
        where: { id },
        select: { includedCateringOptionId: true, includedCateringNumPeople: true, includedCateringNumDays: true },
      })
      const optionId = parsed.data.includedCateringOptionId !== undefined ? parsed.data.includedCateringOptionId : before.includedCateringOptionId
      const numPeople = parsed.data.includedCateringNumPeople !== undefined ? parsed.data.includedCateringNumPeople : before.includedCateringNumPeople
      const numDays = parsed.data.includedCateringNumDays !== undefined ? parsed.data.includedCateringNumDays : before.includedCateringNumDays
      if (optionId && numPeople && numDays) {
        const opt = await prisma.cateringOption.findUniqueOrThrow({ where: { id: optionId }, select: { pricePerPersonRegular: true } })
        data.includedCateringPrice = numPeople * numDays * Number(opt.pricePerPersonRegular)
      } else {
        data.includedCateringPrice = null
      }
    }

    const pkg = await prisma.package.update({ where: { id }, data })

    const priceAffected = PRICE_AFFECTING_FIELDS.some(f => f in parsed.data)
    if (priceAffected) {
      await refreshPackagePriceCache(id)
    }

    return NextResponse.json(ok(pkg))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Paket umroh tidak ditemukan'), { status: 404 })
    console.error('[admin/products/packages/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Tidak ada DELETE — nonaktifkan via isActive (pola sama TourPackage).
