import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { calendarDateOf } from '@/lib/time'
import { prisma } from '@/lib/db'
import { DepartureError, type DepartureFailure } from './departures'
import { departureWarnings, type DepartureWarnings, type PeriodRule } from './warnings'

// Bersama route admin keberangkatan paket: kode galat → status + teks admin, dan pemuat peringatan editor.

const FAILURE: Record<DepartureFailure, [number, string]> = {
  packageNotFound: [404, 'Paket tidak ditemukan'],
  departureNotFound: [404, 'Keberangkatan tidak ditemukan'],
  departureDuplicate: [409, 'Paket ini sudah punya keberangkatan pada tanggal itu'],
  departurePast: [422, 'Tanggal keberangkatan sudah lewat'],
  departureSeatsBelowSold: [409, 'Total kursi tidak boleh lebih kecil dari kursi yang sudah ditahan dan terjual'],
  departureDateLocked: [409, 'Tanggal tidak bisa diubah karena keberangkatan ini sudah dipesan — buat keberangkatan baru'],
}

export function departureFailureResponse(e: unknown): NextResponse | null {
  if (!(e instanceof DepartureError)) return null
  const [status, message] = FAILURE[e.code]
  return NextResponse.json(err(message), { status })
}

/** Peringatan editor untuk satu paket: periode tiket/hotel `included` dan malam hotel vs durasi. */
export async function loadDepartureWarnings(packageId: string, departures: ReadonlyArray<{ id: string; departureDate: string; isActive: boolean }>): Promise<DepartureWarnings> {
  const p = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    select: {
      durationDays: true,
      hotelMakkahMode: true, includedHotelMakkahNights: true, includedHotelMakkahSchedule: { select: { period: { select: { periodStart: true, periodEnd: true, hotel: { select: { name: true } } } } } },
      hotelMadinahMode: true, includedHotelMadinahNights: true, includedHotelMadinahSchedule: { select: { period: { select: { periodStart: true, periodEnd: true, hotel: { select: { name: true } } } } } },
      flightMode: true, includedFlightSchedule: { select: { departureFrom: true, departureTo: true, route: { select: { origin: true, destination: true } } } },
    },
  })
  const periods: PeriodRule[] = []
  let nights = 0
  for (const [slot, mode, n, s] of [['Makkah', p.hotelMakkahMode, p.includedHotelMakkahNights, p.includedHotelMakkahSchedule], ['Madinah', p.hotelMadinahMode, p.includedHotelMadinahNights, p.includedHotelMadinahSchedule]] as const) {
    if (mode !== 'included' || !s) continue
    nights += n ?? 0
    periods.push({ label: `hotel ${slot} ${s.period.hotel.name}`, from: calendarDateOf(s.period.periodStart), to: calendarDateOf(s.period.periodEnd), covers: 'stay' })
  }
  const f = p.flightMode === 'included' ? p.includedFlightSchedule : null
  if (f) periods.push({ label: `tiket ${f.route.origin}–${f.route.destination}`, from: calendarDateOf(f.departureFrom), to: calendarDateOf(f.departureTo), covers: 'departure' })
  return departureWarnings({ durationDays: p.durationDays, includedNights: nights, periods, departures })
}
