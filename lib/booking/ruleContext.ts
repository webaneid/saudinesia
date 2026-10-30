import { prisma } from '@/lib/db'
import type { BookingInput } from './create'
import type { PackageResolved } from './packageItem'
import type { TourPackageResolved } from './lineItems'
import { evaluateVisaRules, type BookingCoverage, type RuleViolation } from './rules'

// Pemuat konteks untuk lib/booking/rules.ts (fungsi aturannya sendiri murni). Komponen booking = item mandiri + isi Paket Umroh + kendaraan Paket Ziarah.

export async function bookingCoverage(data: BookingInput, packages: readonly PackageResolved[], tours: readonly TourPackageResolved[]): Promise<BookingCoverage> {
  const quotaIds = [
    ...data.items.flatMap(i => (i.itemType === 'transport' ? [i.transportQuotaId] : [])),
    ...tours.flatMap(t => (t.transportQuotaId ? [t.transportQuotaId] : [])),
  ]
  const quotas = quotaIds.length > 0
    ? await prisma.transportQuota.findMany({ where: { id: { in: quotaIds } }, select: { pricing: { select: { trip: { select: { id: true, category: true } } } } } })
    : []
  // Hotel Paket Ziarah dihitung HANYA bila benar-benar ditagih: mode included berhotel, atau pilihan user_choice yang ada di daftar opsi DAN berjumlah kamar —
  // sama dengan syarat penagihan di lineItems.ts (SEC-124: dulu id hotel sembarang tanpa kamar sudah "memenuhi" aturan tanpa membayar hotel).
  const tourItems = data.items.filter(i => i.itemType === 'tourPackage')
  const tourHotel = tourItems.some((i, idx) => {
    const b = tours[idx]?.breakdown
    if (!b) return false
    if (b.hotelMode === 'included') return b.hotels.length > 0
    return b.hotelMode === 'user_choice' && !!i.chosenHotelNumRooms && b.hotelOptions.some(o => o.hotelRoomScheduleId === i.chosenHotelRoomScheduleId)
  })
  return {
    flight: data.items.some(i => i.itemType === 'flight') || packages.some(p => p.coverage.flight),
    hotel: data.items.some(i => i.itemType === 'hotel') || packages.some(p => p.coverage.hotel) || tourHotel,
    transports: [
      ...quotas.map(q => ({ tripId: q.pricing.trip.id, category: q.pricing.trip.category ?? '' })),
      ...packages.flatMap(p => (p.coverage.transport ? [p.coverage.transport] : [])),
    ],
  }
}

/**
 * Pelanggaran aturan visa untuk booking ini. Visa yang dievaluasi = visa yang dipilih jamaah sendiri DAN visa yang DIPILIH pelanggan di Paket (`user_choice`, SEC-125:
 * paket serba-pilihan tidak "berisi semuanya"). Visa `included` paket tidak dievaluasi — bundel yang dikurasi admin (D5).
 * Pelonggaran dibaca dari akun PEMILIK booking (bukan dari klien).
 */
export async function visaRuleViolations(data: BookingInput, ownerUserId: string, packages: readonly PackageResolved[], tours: readonly TourPackageResolved[]): Promise<RuleViolation[]> {
  const ids = [...new Set([...data.pilgrims.flatMap(p => (p.visaProductId ? [p.visaProductId] : [])), ...packages.flatMap(p => (p.choices.visaProductId ? [p.choices.visaProductId] : []))])]
  if (ids.length === 0) return []
  const [visas, owner, coverage] = await Promise.all([
    prisma.visaProduct.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, requiredComponents: true } }),
    prisma.user.findUnique({ where: { id: ownerUserId }, select: { allowVisaWithoutBundle: true } }),
    bookingCoverage(data, packages, tours),
  ])
  return evaluateVisaRules(visas.map(v => ({ visaProductId: v.id, visaName: v.name, requiredComponents: v.requiredComponents })), coverage, owner?.allowVisaWithoutBundle ?? false)
}
