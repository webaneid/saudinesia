import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ItemNotBookableError } from './errors'
import type { BookingItemInput } from '@/lib/validators/booking'
import { computePackageBreakdown, perPersonShare, type PackageBreakdown } from '@/lib/pricing/computePackagePrice'
import { computeCateringBookingPrice } from '@/lib/pricing/computeCateringPrice'
import { compositeLines, lineFromPoint, peekCost, takePoint, takeVisaTier, type CompositePart, type SnapshotLine } from '@/lib/pricing/engine/snapshot'
import { calendarDateOf, daysBetween, dbDateOf, type CalendarDate } from '@/lib/time'
import { packageReturnDate } from '@/lib/packages/dates'

// Item Paket Umroh (docs/arsitektur-booking-engine-v2.md §10.2): dijual PER ORANG (P1), satu item booking yang di invoice diurai satu baris per komponen × jumlah orang (P2),
// tanggal = KEBERANGKATAN yang dikelola admin (K1, docs/arsitektur-paket-umroh.md §8 — menggantikan tanggal bebas P3); pulang = berangkat + durasi paket − 1. Resolusi (validasi pilihan + tanggal + cakupan aturan) dilakukan SEKALI sebelum transaksi; harga dibaca di dalam transaksi.

type PackageInput = Extract<BookingItemInput, { itemType: 'package' }>
export type PackageChoices = PackageInput['choices']

export type PackageResolved = {
  name: string
  breakdown: PackageBreakdown
  departureId: string
  departureDate: CalendarDate
  returnDate: CalendarDate
  /** Kursi tiket yang ditahan (included atau dipilih), null bila paket tanpa tiket. */
  flightScheduleId: string | null
  /** Visa paket (included atau dipilih) — jamaah tanpa visa sendiri dipasangkan ke sini. */
  visaProductId: string | null
  /** Pilihan yang BERLAKU (hanya komponen `user_choice`), disimpan di BookingPackage.choices. */
  choices: PackageChoices
  /** Komponen yang dimuat DAN ditagih paket — dipakai aturan visa (lib/booking/rules.ts); sama dengan syarat penagihan di `packageLines`. */
  coverage: { flight: boolean; hotelMakkah: boolean; hotelMadinah: boolean; transport: { tripId: string; category: string } | null; muthowif: boolean; catering: boolean }
}

type Choice = 'hotel_makkah' | 'hotel_madinah' | 'transport' | 'visa' | 'flight' | 'catering'
const notApplicable = (choice: Choice) => new ItemNotBookableError('itemChoiceNotApplicable', { choice })
const notInOptions = (choice: Choice) => new ItemNotBookableError('itemChoiceNotOffered', { choice })

export async function resolvePackageItem(item: PackageInput): Promise<PackageResolved> {
  const pkg = await prisma.package.findUnique({ where: { id: item.packageId }, select: { name: true, isActive: true, durationDays: true } })
  if (!pkg || !pkg.isActive) throw new ItemNotBookableError('itemPackageUnavailable')
  if (!pkg.durationDays) throw new ItemNotBookableError('itemPackageNoDuration')
  if (!item.departureId) throw new ItemNotBookableError('itemPackageDepartureMissing') // baris lama sebelum K1 (revisi)
  // Keberangkatan milik paket ITU (id paket lain = tidak tersedia). Aktif dan belum lewat diperiksa SAAT KURSI DITAHAN (lib/quota, di dalam kunci) — hanya untuk
  // item baru/diganti, sehingga item lama yang keberangkatannya sudah lewat/dinonaktifkan tetap bisa ikut revisi booking.
  const dep = await prisma.packageDeparture.findUnique({ where: { id: item.departureId }, select: { packageId: true, departureDate: true } })
  if (!dep || dep.packageId !== item.packageId) throw new ItemNotBookableError('itemPackageDepartureUnavailable')
  const departureDate = calendarDateOf(dep.departureDate)
  const returnDate = packageReturnDate(departureDate, pkg.durationDays)
  const b = await computePackageBreakdown(item.packageId)
  const c = item.choices
  if (b.muthowifMode === 'user_choice') throw new ItemNotBookableError('itemPackageMuthowifChoice')

  // Pilihan hanya berlaku untuk komponen `user_choice` dan harus ada di daftar opsi paket (dulu diam-diam bernilai 0 di Paket Ziarah — §12).
  const pick = <T,>(mode: string, value: T | undefined, what: Choice, ok: (v: T) => boolean): T | undefined => {
    if (value === undefined) return undefined
    if (mode !== 'user_choice') throw notApplicable(what)
    if (!ok(value)) throw notInOptions(what)
    return value
  }
  const choices: PackageChoices = {
    hotelMakkahScheduleId: pick(b.hotelMakkahMode, c.hotelMakkahScheduleId, 'hotel_makkah', v => b.hotelMakkahOptions.some(o => o.hotelRoomScheduleId === v)),
    hotelMadinahScheduleId: pick(b.hotelMadinahMode, c.hotelMadinahScheduleId, 'hotel_madinah', v => b.hotelMadinahOptions.some(o => o.hotelRoomScheduleId === v)),
    transportPricingId: pick(b.transportMode, c.transportPricingId, 'transport', v => b.vehicleOptions.some(o => o.transportPricingId === v)),
    visaProductId: pick(b.visaMode, c.visaProductId, 'visa', v => b.visaOptions.some(o => o.visaProductId === v)),
    flightScheduleId: pick(b.flightMode, c.flightScheduleId, 'flight', v => b.flightOptions.some(o => o.flightScheduleId === v)),
    cateringOptionId: pick(b.cateringMode, c.cateringOptionId, 'catering', v => b.cateringOptions.some(o => o.cateringOptionId === v)),
  }
  for (const k of Object.keys(choices) as Array<keyof PackageChoices>) if (choices[k] === undefined) delete choices[k]

  const flightScheduleId = b.flightMode === 'included' ? b.includedFlightScheduleId : (choices.flightScheduleId ?? null)
  if (flightScheduleId) {
    const s = await prisma.flightSchedule.findUnique({ where: { id: flightScheduleId }, select: { isActive: true, departureFrom: true, departureTo: true } })
    if (!s || !s.isActive) throw new ItemNotBookableError('itemPackageFlightUnavailable')
    if (departureDate < calendarDateOf(s.departureFrom) || departureDate > calendarDateOf(s.departureTo)) {
      throw new ItemNotBookableError('itemPackageDepartureOutside', { fromDate: calendarDateOf(s.departureFrom), toDate: calendarDateOf(s.departureTo) })
    }
  }

  // Tanggal menginap harus di periode harga setiap hotel yang dipakai (sama dengan item hotel mandiri — SEC-126: jadwal periode murah tak boleh dipakai di musim lain).
  // Urutan kota belum ada di template, jadi seluruh rentang berangkat–pulang harus tercakup periode tiap hotel.
  const hotelIds = [
    b.hotelMakkahMode === 'included' ? b.hotelMakkah?.scheduleId : choices.hotelMakkahScheduleId,
    b.hotelMadinahMode === 'included' ? b.hotelMadinah?.scheduleId : choices.hotelMadinahScheduleId,
  ].filter((x): x is string => !!x)
  if (hotelIds.length > 0) {
    const periods = await prisma.hotelRoomSchedule.findMany({ where: { id: { in: hotelIds } }, select: { period: { select: { periodStart: true, periodEnd: true, hotel: { select: { name: true } } } } } })
    for (const { period } of periods) {
      if (departureDate < calendarDateOf(period.periodStart) || returnDate > calendarDateOf(period.periodEnd)) {
        throw new ItemNotBookableError('itemPackageStayOutside', { hotel: period.hotel.name, fromDate: calendarDateOf(period.periodStart), toDate: calendarDateOf(period.periodEnd) })
      }
    }
  }

  // Visa paket (included atau dipilih) harus aktif — sama dengan visa yang dipilih jamaah sendiri (SEC-127).
  const visaProductId = b.visaMode === 'included' ? b.includedVisaProductId : (choices.visaProductId ?? null)
  if (visaProductId && !(await prisma.visaProduct.findUnique({ where: { id: visaProductId }, select: { isActive: true } }))?.isActive) {
    throw new ItemNotBookableError('itemPackageVisaUnavailable')
  }

  const hotelMakkah = (b.hotelMakkahMode === 'included' && b.hotelMakkah != null) || choices.hotelMakkahScheduleId !== undefined
  const hotelMadinah = (b.hotelMadinahMode === 'included' && b.hotelMadinah != null) || choices.hotelMadinahScheduleId !== undefined
  // Muthowif/katering `included` dihitung hanya bila ikut ditagih (harga > 0) — syarat yang sama dengan `packageLines` (pola SEC-124).
  const muthowif = b.muthowifMode === 'included' && (b.includedMuthowifPrice ?? 0) > 0
  const catering = (b.cateringMode === 'included' && !!b.includedCateringOptionId && (b.includedCateringPrice ?? 0) > 0) || choices.cateringOptionId !== undefined
  const transport = b.transportMode === 'included' && b.includedTripId
    ? { tripId: b.includedTripId, category: b.includedTripCategory ?? '' }
    : choices.transportPricingId && b.transportTripId ? { tripId: b.transportTripId, category: b.tripCategory ?? '' } : null

  return {
    name: pkg.name, breakdown: b, departureId: item.departureId, departureDate, returnDate,
    flightScheduleId,
    visaProductId,
    choices,
    coverage: { flight: flightScheduleId != null, hotelMakkah, hotelMadinah, transport, muthowif, catering },
  }
}

/**
 * Baris snapshot satu item paket: harga dasar = titik harga `package` (per orang, harga manual menang lewat baris penyesuaian), diurai per Komponen Biaya dan per komponen
 * `included` × jumlah orang, ditambah pilihan `user_choice` yang dibaca dari titik harga sub-modul (kendaraan pilihan = satu kendaraan, bukan per orang).
 */
export async function packageLines(tx: Prisma.TransactionClient, packageId: string, r: PackageResolved, numPeople: number): Promise<SnapshotLine[]> {
  const b = r.breakdown
  const parts: CompositePart[] = []
  for (const [slot, mode, h] of [['Makkah', b.hotelMakkahMode, b.hotelMakkah], ['Madinah', b.hotelMadinahMode, b.hotelMadinah]] as const) {
    if (mode !== 'included' || !h) continue
    const cost = await peekCost(tx, 'hotel', h.scheduleId)
    parts.push({
      lineKey: `hotel-${slot.toLowerCase()}-termasuk`, description: `Hotel ${slot}: ${h.hotelName} — ${h.roomTypeName} (${h.nights} malam, ${h.occupancy} orang/kamar)`, qty: 1, unit: 'person',
      unitSellIdr: h.totalPrice, unitCostIdr: cost == null ? null : cost * h.nights / Math.max(1, h.occupancy), ref: { ownerType: 'hotel', ownerId: h.scheduleId, variantKey: '' },
    })
  }
  if (b.transportMode === 'included' && b.includedTransportPricingId && b.includedTransportPerPerson && b.includedTransportPrice) {
    const cost = await peekCost(tx, 'transport', b.includedTransportPricingId)
    parts.push({
      lineKey: 'kendaraan-termasuk', description: `Transport: ${b.includedVehicleName ?? 'kendaraan paket'}`, qty: 1, unit: 'person',
      unitSellIdr: b.includedTransportPerPerson, unitCostIdr: cost == null ? null : cost * b.includedTransportPerPerson / b.includedTransportPrice,
      ref: { ownerType: 'transport', ownerId: b.includedTransportPricingId, variantKey: '' },
    })
  }
  if (b.muthowifMode === 'included' && (b.includedMuthowifPrice ?? 0) > 0) {
    parts.push({ lineKey: 'muthowif-termasuk', description: 'Layanan Muthowif', qty: 1, unit: 'person', unitSellIdr: b.includedMuthowifPrice!, unitCostIdr: null, ref: null })
  }
  if (b.visaMode === 'included' && b.includedVisaProductId && (b.includedVisaPrice ?? 0) > 0) {
    parts.push({ lineKey: 'visa-termasuk', description: b.includedVisaName ?? 'Visa', qty: 1, unit: 'person', unitSellIdr: b.includedVisaPrice!, unitCostIdr: null, ref: { ownerType: 'visa', ownerId: b.includedVisaProductId, variantKey: '' } })
  }
  if (b.flightMode === 'included' && b.includedFlightScheduleId && (b.includedFlightPrice ?? 0) > 0) {
    parts.push({
      lineKey: 'tiket-termasuk', description: `Tiket pesawat ${b.includedFlightLabel ?? ''}`.trim(), qty: 1, unit: 'person',
      unitSellIdr: b.includedFlightPrice!, unitCostIdr: await peekCost(tx, 'flight', b.includedFlightScheduleId), ref: { ownerType: 'flight', ownerId: b.includedFlightScheduleId, variantKey: '' },
    })
  }
  if (b.cateringMode === 'included' && b.includedCateringOptionId && (b.includedCateringPrice ?? 0) > 0) {
    parts.push({
      lineKey: 'katering-termasuk', description: `Katering: ${b.includedCateringName ?? 'menu paket'} (${b.includedCateringNumDays ?? 0} hari)`, qty: 1, unit: 'person',
      unitSellIdr: b.includedCateringPrice!, unitCostIdr: null, ref: null,
    })
  }
  const lines = await compositeLines(tx, { ownerType: 'package', ownerId: packageId, what: 'umrahPackage', label: r.name, multiplier: numPeople, parts })

  // ── pilihan pelanggan (user_choice) — harga hidup dari titik harga sub-modul ──
  const c = r.choices
  for (const [slot, id, options] of [['Makkah', c.hotelMakkahScheduleId, b.hotelMakkahOptions], ['Madinah', c.hotelMadinahScheduleId, b.hotelMadinahOptions]] as const) {
    if (!id) continue
    const o = options.find(x => x.hotelRoomScheduleId === id)!
    const p = await takePoint(tx, 'hotel', id, '', slot === 'Makkah' ? 'chosenHotelMakkah' : 'chosenHotelMadinah')
    lines.push({
      ...lineFromPoint(p, { lineKey: `hotel-${slot.toLowerCase()}-pilihan`, description: `Hotel ${slot} pilihan: ${o.hotelName} — ${o.roomTypeName} (${o.nights} malam, ${o.occupancy} orang/kamar)`, qty: numPeople, unit: 'person' }),
      unitSellIdr: perPersonShare(o.nights * p.sellIdr, o.occupancy),
      recommendedUnitSellIdr: perPersonShare(o.nights * (p.autoSellIdr && p.autoSellIdr > 0 ? p.autoSellIdr : p.sellIdr), o.occupancy),
      unitCostIdr: p.costIdr == null ? null : p.costIdr * o.nights / Math.max(1, o.occupancy), // pembagi sama dengan perPersonShare (SEC-128)
    })
  }
  if (c.visaProductId) {
    const name = b.visaOptions.find(o => o.visaProductId === c.visaProductId)!.name
    const days = Math.max(1, daysBetween(r.departureDate, r.returnDate))
    lines.push(lineFromPoint(await takeVisaTier(tx, c.visaProductId, days, 'chosenVisa'), { lineKey: 'visa-pilihan', description: `Visa pilihan: ${name}`, qty: numPeople, unit: 'person' }))
  }
  if (c.flightScheduleId) {
    const label = b.flightOptions.find(o => o.flightScheduleId === c.flightScheduleId)!.label
    lines.push(lineFromPoint(await takePoint(tx, 'flight', c.flightScheduleId, '', 'chosenFlight'), { lineKey: 'tiket-pilihan', description: `Tiket pesawat pilihan: ${label}`, qty: numPeople, unit: 'person' }))
  }
  if (c.transportPricingId) {
    const name = b.vehicleOptions.find(o => o.transportPricingId === c.transportPricingId)!.vehicleName
    lines.push(lineFromPoint(await takePoint(tx, 'transport', c.transportPricingId, '', 'chosenVehicle'), { lineKey: 'kendaraan-pilihan', description: `Kendaraan pilihan: ${name}`, qty: 1, unit: 'vehicle' }))
  }
  if (c.cateringOptionId) {
    const o = b.cateringOptions.find(x => x.cateringOptionId === c.cateringOptionId)!
    const { point } = await computeCateringBookingPrice({ cateringOptionId: o.cateringOptionId, startDate: dbDateOf(r.departureDate), numDays: o.numDays, numPeople }, tx)
    lines.push(lineFromPoint(point, { lineKey: 'katering-pilihan', description: `Katering pilihan: ${o.name} (${o.numDays} hari)`, qty: o.numDays * numPeople, unit: 'person_day' }))
  }
  return lines
}
