import { prisma } from '@/lib/db'
import type { BookingInput } from './create'
import type { PackageResolved } from './packageItem'
import type { TourPackageResolved } from './lineItems'
import { evaluateVisaRules, type BookingCoverage, type RuleViolation } from './rules'
import { groupLabel, isGrouped, scopeToGroup } from './groups'

// Pemuat konteks untuk lib/booking/rules.ts (fungsi aturannya sendiri murni). Komponen booking = item mandiri + isi Paket Umroh + isi Paket Ziarah yang ditagih.

type City = 'makkah' | 'madinah'
const isCity = (c: string): c is City => c === 'makkah' || c === 'madinah'

export async function bookingCoverage(data: BookingInput, packages: readonly PackageResolved[], tours: readonly TourPackageResolved[]): Promise<BookingCoverage> {
  const quotaIds = [
    ...data.items.flatMap(i => (i.itemType === 'transport' ? [i.transportQuotaId] : [])),
    ...tours.flatMap(t => (t.transportQuotaId ? [t.transportQuotaId] : [])),
  ]
  // Hotel Paket Ziarah dihitung HANYA bila benar-benar ditagih: mode included berhotel, atau pilihan user_choice yang ada di daftar opsi DAN berjumlah kamar —
  // sama dengan syarat penagihan di lineItems.ts (SEC-124: dulu id hotel sembarang tanpa kamar sudah "memenuhi" aturan tanpa membayar hotel).
  const tourItems = data.items.filter(i => i.itemType === 'tourPackage')
  const tourHotelSchedules = tourItems.flatMap((i, idx) => {
    const b = tours[idx]?.breakdown
    if (!b) return []
    if (b.hotelMode === 'included') return b.hotels.map(h => h.hotelRoomScheduleId)
    const chosen = b.hotelMode === 'user_choice' && !!i.chosenHotelNumRooms && b.hotelOptions.some(o => o.hotelRoomScheduleId === i.chosenHotelRoomScheduleId)
    return chosen && i.chosenHotelRoomScheduleId ? [i.chosenHotelRoomScheduleId] : []
  })
  // Kota hotel dibaca dari DB (`Hotel.city`), bukan dari klien.
  const scheduleIds = [...new Set([...data.items.flatMap(i => (i.itemType === 'hotel' ? [i.hotelRoomScheduleId] : [])), ...tourHotelSchedules])]
  const [quotas, schedules] = await Promise.all([
    quotaIds.length > 0
      ? prisma.transportQuota.findMany({ where: { id: { in: quotaIds } }, select: { pricing: { select: { trip: { select: { id: true, category: true } } } } } })
      : [],
    scheduleIds.length > 0
      ? prisma.hotelRoomSchedule.findMany({ where: { id: { in: scheduleIds } }, select: { period: { select: { hotel: { select: { city: true } } } } } })
      : [],
  ])
  const cities = new Set<City>(schedules.map(s => s.period.hotel.city).filter(isCity))
  for (const p of packages) {
    if (p.coverage.hotelMakkah) cities.add('makkah')
    if (p.coverage.hotelMadinah) cities.add('madinah')
  }
  return {
    flight: data.items.some(i => i.itemType === 'flight') || packages.some(p => p.coverage.flight),
    hotelCities: [...cities],
    transports: [
      ...quotas.map(q => ({ tripId: q.pricing.trip.id, category: q.pricing.trip.category ?? '' })),
      ...packages.flatMap(p => (p.coverage.transport ? [p.coverage.transport] : [])),
    ],
    muthowif: data.items.some(i => i.itemType === 'muthowif') || packages.some(p => p.coverage.muthowif),
    tour: tourItems.length > 0,
    catering: data.items.some(i => i.itemType === 'catering') || packages.some(p => p.coverage.catering),
  }
}

/**
 * Pelanggaran aturan visa untuk booking ini. Visa yang dievaluasi = visa yang dipilih jamaah sendiri DAN visa yang DIPILIH pelanggan di Paket (`user_choice`, SEC-125:
 * paket serba-pilihan tidak "berisi semuanya"). Visa `included` paket tidak dievaluasi — bundel yang dikurasi admin (D5).
 * Aturan sepenuhnya dari produk visa — tak ada pelonggaran per pelanggan (docs/rencana-visa-produk.md §2.3).
 */
export async function visaRuleViolations(data: BookingInput, packages: readonly PackageResolved[], tours: readonly TourPackageResolved[]): Promise<RuleViolation[]> {
  if (!isGrouped(data)) return violationsIn(data, packages, tours)
  // Berrombongan (§10.8, K11d-1 = a): setiap rombongan dinilai atas itemnya sendiri + item untuk semua — tiket rombongan A tak memenuhi Visa Plus rombongan B.
  const out: RuleViolation[] = []
  for (const [g, group] of (data.groups ?? []).entries()) {
    const scoped = scopeToGroup(data, packages, tours, g)
    const name = groupLabel(group.label, g)
    for (const v of await violationsIn(scoped.data, scoped.packages, scoped.tours)) out.push({ ...v, message: `${name}: ${v.message}` })
  }
  return out
}

async function violationsIn(data: BookingInput, packages: readonly PackageResolved[], tours: readonly TourPackageResolved[]): Promise<RuleViolation[]> {
  const ids = [...new Set([...data.pilgrims.flatMap(p => (p.visaProductId ? [p.visaProductId] : [])), ...packages.flatMap(p => (p.choices.visaProductId ? [p.choices.visaProductId] : []))])]
  if (ids.length === 0) return []
  const [visas, coverage] = await Promise.all([
    prisma.visaProduct.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, requiredComponents: true } }),
    bookingCoverage(data, packages, tours),
  ])
  return evaluateVisaRules(visas.map(v => ({ visaProductId: v.id, visaName: v.name, requiredComponents: v.requiredComponents })), coverage)
}
