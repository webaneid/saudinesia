import type { Prisma } from '@prisma/client'
import { ItemNotBookableError, tagItem } from './errors'
import { sealNewPilgrim } from '@/lib/pilgrims/bookingLink'
import { packageLines, type PackageResolved } from './packageItem'
import { assignMembers, memberProblem, type MemberAssignment, type MemberPilgrim } from './members'
import { isGrouped, targetSize } from './groups'
import { calendarDateOf, dbDateOf } from '@/lib/time'
import type { BookingItemInput } from '@/lib/validators/booking'
import type { BookingInput } from './create'
import { computeCateringBookingPrice } from '@/lib/pricing/computeCateringPrice'
import type { TourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import {
  compositeLines, lineFromPoint, lineTotalSell, peekCost, sumSell, takePoint, takeVisaTier, writeSnapshots,
  type CompositePart, type ItemMeta, type PendingItem, type SnapshotLine,
} from '@/lib/pricing/engine/snapshot'

// Hari probe kalau jamaah tidak memilih durasi spesifik — sama alasan dengan DEFAULT_PROBE_DAY di lib/pricing/engine/owners/visa.ts (bukan hardcode angka bisnis).
const DEFAULT_DURATION_PROBE_DAY = 1

/** Paket ziarah yang sudah di-resolve SEBELUM transaksi (breakdown + kuota kendaraan), urut sesuai kemunculannya di `items`. */
export type TourPackageResolved = { breakdown: TourPackageBreakdown; transportQuotaId: string | null }

const day = (d: string | Date): string => {
  const iso = typeof d === 'string' ? d.slice(0, 10) : calendarDateOf(d) // tanggal kalender (`z.string().date()` atau `@db.Date`)
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
}

type Item<T extends BookingItemInput['itemType']> = Extract<BookingItemInput, { itemType: T }>

/**
 * SEMUA item booking (+ visa per jamaah) ditulis di sini: harga dibaca SEKALI dari titik harga (`engine/snapshot`), dipakai membentuk baris item DAN dibekukan ke
 * `price_snapshots`; total yang dikembalikan = Σ snapshot yang baru ditulis (invarian I4 docs/arsitektur-harga-terpadu.md §17). Tak ada angka harga dari klien.
 * Dipanggil di dalam transaksi booking; melempar `ItemNotBookableError` (422) untuk item yang belum/tak bisa dijual — transaksi (termasuk kuota yang sudah ditahan) dibatalkan.
 * Lem sementara menunggu perombakan booking engine: yang bertahan hanyalah kontrak `price_snapshots` + `engine/snapshot.ts`.
 */
export async function writeBookingItems(
  tx: Prisma.TransactionClient, bookingId: string, data: BookingInput, tourResolved: readonly TourPackageResolved[], packageResolved: readonly PackageResolved[] = [],
  /** Diisi metadata item yang ditulis, URUT `data.items` lalu visa per jamaah (revisi memakai id baris baru untuk harga khusus). */
  written?: ItemMeta[],
  /** Pesan baru: anggota paket/haji + visa paket dibagi di sini. Revisi: `false` — `lib/booking/revise.ts` menyelaraskannya atas SEMUA item sesudah ditulis. */
  opts: { assignMembers?: boolean } = {},
): Promise<number> {
  const pending: PendingItem[] = []
  const add = (meta: PendingItem['meta'], lines: SnapshotLine[]) => pending.push({ meta, lines })
  let tourIdx = 0
  let packageIdx = 0
  // Baris paket/haji yang ditulis — anggotanya dibagi `assignMembers` (lib/booking/members.ts); visa paket ikut ke anggota, harganya sudah di baris paket (§10.2).
  const packageRows: Array<{ key: string; numPeople: number; visaProductId: string | null; name: string; group?: number }> = []
  const hajiRows: Array<{ key: string; numPeople: number; group?: number }> = []
  // Rencana tanggal berangkat visa (D1): bawaan = tiket pergi paling awal di booking ini (tiket mandiri atau paket bertiket) — per rombongan bila berrombongan (§10.8).
  const flightDates: Array<{ date: string; group?: number }> = []

  // Rombongan (§10.8): baris rombongan ditulis dulu; item dan jamaah menunjuknya (FK komposit menjamin booking yang sama). Tanpa rombongan → semua NULL.
  const grouped = isGrouped(data)
  const groupIds: string[] = []
  for (const [i, g] of (data.groups ?? []).entries()) {
    const row = await tx.bookingGroup.create({
      data: { bookingId, position: i + 1, label: g.label ?? null, plannedTravelDate: g.plannedTravelDate ? dbDateOf(g.plannedTravelDate) : null }, select: { id: true },
    })
    groupIds.push(row.id)
  }
  const gid = (x: { group?: number }): string | null => (x.group === undefined ? null : (groupIds[x.group] ?? null))

  for (const [itemIndex, item] of data.items.entries()) {
    try {
      switch (item.itemType) {
        case 'hotel': {
          const sch = await tx.hotelRoomSchedule.findUniqueOrThrow({
            where: { id: item.hotelRoomScheduleId },
            select: { isActive: true, period: { select: { isActive: true, periodStart: true, periodEnd: true, hotel: { select: { name: true, isActive: true } } } }, roomType: { select: { name: true } } }, // 404 bila jadwal tak ada
          })
          // Kamar/periode/hotel yang dinonaktifkan (mis. hapus-aman karena dirujuk) tidak dijual lagi — sama dengan tiket pesawat. Item lama yang tak diubah di revisi tak ditulis ulang.
          if (!sch.isActive || !sch.period.isActive || !sch.period.hotel.isActive) throw new ItemNotBookableError('Kamar hotel ini tidak dijual lagi')
          // Tanggal menginap harus berada di periode harga jadwal yang dipilih (jadwal periode murah tak boleh dipakai untuk tanggal musim ramai).
          if (new Date(item.checkIn) < sch.period.periodStart || new Date(item.checkOut) > sch.period.periodEnd) {
            throw new ItemNotBookableError('Tanggal menginap di luar periode harga kamar yang dipilih')
          }
          const point = await takePoint(tx, 'hotel', item.hotelRoomScheduleId, '', 'kamar hotel')
          const label = `${sch.period.hotel.name} — ${sch.roomType.name}`
          const line = lineFromPoint(point, { description: label, qty: item.nights * item.numRooms, unit: 'room_night' })
          const row = await tx.bookingHotel.create({
            data: {
              bookingId, groupId: gid(item), hotelRoomScheduleId: item.hotelRoomScheduleId,
              checkIn: new Date(item.checkIn), checkOut: new Date(item.checkOut),
              nights: item.nights, numRooms: item.numRooms, numGuests: grouped ? targetSize(data, item.group) : (data.totalPilgrims ?? data.pilgrims.length),
              pricePerNight: point.sellIdr, totalPrice: lineTotalSell(line),
            },
          })
          add({ itemType: 'hotel', itemId: row.id, label, detail: `${day(item.checkIn)} – ${day(item.checkOut)} · ${item.nights} malam · ${item.numRooms} kamar`, qty: item.numRooms }, [line])
          break
        }
        case 'transport': {
          const quota = await tx.transportQuota.findUniqueOrThrow({
            where: { id: item.transportQuotaId },
            select: { pricingId: true, travelDate: true, pricing: { select: { trip: { select: { name: true } }, vehicle: { select: { name: true } } } } },
          })
          const point = await takePoint(tx, 'transport', quota.pricingId, '', 'transport')
          const label = `${quota.pricing.trip.name} (${quota.pricing.vehicle.name})`
          const line = lineFromPoint(point, { description: label, qty: 1, unit: 'vehicle' })
          const row = await tx.bookingTransport.create({
            data: {
              bookingId, groupId: gid(item), transportQuotaId: item.transportQuotaId,
              travelDate: quota.travelDate,
              numPassengers: item.numPassengers,
              unitPrice: point.sellIdr, totalPrice: lineTotalSell(line),
              pickupDetail: item.pickupDetail ?? null,
              dropoffDetail: item.dropoffDetail ?? null,
            },
          })
          add({ itemType: 'transport', itemId: row.id, label, detail: `${day(quota.travelDate)} · ${item.numPassengers} penumpang`, qty: item.numPassengers }, [line])
          break
        }
        case 'muthowif': {
          // muthowifId TIDAK diisi — admin assign belakangan (docs/arsitektur-muthowif.md §9).
          const service = await tx.muthowifServicePrice.findFirstOrThrow({ select: { id: true } })
          const point = await takePoint(tx, 'muthowif', service.id, '', 'layanan muthowif')
          const line = lineFromPoint(point, { description: 'Layanan Muthowif', qty: item.numDays * item.numPeople, unit: 'person_day' })
          const row = await tx.bookingMuthowif.create({
            data: {
              bookingId, groupId: gid(item), muthowifId: null,
              startDate: new Date(item.startDate), endDate: new Date(item.endDate),
              numDays: item.numDays, numPeople: item.numPeople, totalPrice: lineTotalSell(line),
            },
          })
          add({ itemType: 'muthowif', itemId: row.id, label: 'Layanan Muthowif', detail: `${day(item.startDate)} – ${day(item.endDate)} · ${item.numDays} hari · ${item.numPeople} orang`, qty: item.numPeople }, [line])
          break
        }
        case 'catering': {
          // Harga dihitung server-side dari titik harga musim pada tanggal mulai; opsi nonaktif / belum berharga → 422.
          const { point } = await computeCateringBookingPrice({
            cateringOptionId: item.cateringOptionId, startDate: new Date(item.startDate), numDays: item.numDays, numPeople: item.numPeople,
          }, tx)
          const option = await tx.cateringOption.findUniqueOrThrow({ where: { id: item.cateringOptionId }, select: { name: true } })
          const line = lineFromPoint(point, { description: option.name, qty: item.numDays * item.numPeople, unit: 'person_day' })
          const row = await tx.bookingCatering.create({
            data: {
              bookingId, groupId: gid(item), cateringOptionId: item.cateringOptionId,
              startDate: new Date(item.startDate), endDate: new Date(item.endDate),
              numDays: item.numDays, numPeople: item.numPeople, totalPrice: lineTotalSell(line),
            },
          })
          add({ itemType: 'catering', itemId: row.id, label: option.name, detail: `${day(item.startDate)} – ${day(item.endDate)} · ${item.numDays} hari · ${item.numPeople} orang`, qty: item.numPeople }, [line])
          break
        }
        case 'tourPackage': {
          const { breakdown, transportQuotaId } = tourResolved[tourIdx++]!
          const tour = await tx.tourPackage.findUniqueOrThrow({ where: { id: item.tourPackageId }, select: { name: true } })
          const lines = await tourPackageLines(tx, item, tour.name, breakdown, transportQuotaId)
          const totalPrice = sumSell(lines)
          if (!(totalPrice > 0)) throw new ItemNotBookableError('Harga paket ziarah belum ditetapkan')
          let tourDate: Date
          if (transportQuotaId) {
            tourDate = (await tx.transportQuota.findUniqueOrThrow({ where: { id: transportQuotaId }, select: { travelDate: true } })).travelDate
          } else {
            const d = item.tourDate ?? data.departureDate
            if (!d) throw new ItemNotBookableError('Tanggal paket ziarah wajib diisi')
            tourDate = new Date(d)
          }
          const row = await tx.bookingTourPackage.create({
            data: {
              bookingId, groupId: gid(item), tourPackageId: item.tourPackageId, transportQuotaId,
              tourDate, numPeople: item.numPeople, totalPrice,
              // hanya bermakna (dan hanya menahan kuota) pada mode user_choice — selain itu null, supaya release/confirm kuota tak menyentuh kuota yang tak pernah ditahan
              chosenHotelRoomScheduleId: breakdown.hotelMode === 'user_choice' ? item.chosenHotelRoomScheduleId ?? null : null,
              chosenHotelNumRooms: breakdown.hotelMode === 'user_choice' ? item.chosenHotelNumRooms ?? null : null,
            },
          })
          add({ itemType: 'tourPackage', itemId: row.id, label: tour.name, detail: `${day(tourDate)} · ${item.numPeople} orang`, qty: item.numPeople }, lines)
          break
        }
        case 'haji': {
          const haji = await tx.hajiProduct.findUniqueOrThrow({ where: { id: item.hajiProductId }, select: { name: true } })
          const lines = await compositeLines(tx, { ownerType: 'haji', ownerId: item.hajiProductId, what: 'produk haji', label: haji.name, multiplier: item.numPersons })
          const totalPrice = sumSell(lines)
          if (!(totalPrice > 0)) throw new ItemNotBookableError('Harga produk haji belum ditetapkan')
          const row = await tx.bookingHaji.create({
            data: { bookingId, groupId: gid(item), hajiProductId: item.hajiProductId, numPersons: item.numPersons, totalPrice },
          })
          hajiRows.push({ key: row.id, numPeople: item.numPersons, group: item.group })
          add({ itemType: 'haji', itemId: row.id, label: haji.name, detail: `${item.numPersons} orang`, qty: item.numPersons }, lines)
          break
        }
        case 'flight': {
          const sch = await tx.flightSchedule.findUnique({
            where: { id: item.flightScheduleId },
            select: { isActive: true, departureFrom: true, departureTo: true, route: { select: { origin: true, destination: true } } },
          })
          if (!sch || !sch.isActive) throw new ItemNotBookableError('Jadwal tiket pesawat tidak tersedia')
          // Tanggal terbang harus di periode harga/kuota jadwal yang dipilih (jadwal periode murah tak boleh dipakai di luar periodenya).
          if (item.departureDate < calendarDateOf(sch.departureFrom) || item.departureDate > calendarDateOf(sch.departureTo)) {
            throw new ItemNotBookableError(`Tanggal terbang di luar periode jadwal tiket (${day(sch.departureFrom)} – ${day(sch.departureTo)})`)
          }
          const point = await takePoint(tx, 'flight', item.flightScheduleId, '', 'tiket pesawat')
          flightDates.push({ date: item.departureDate, group: item.group })
          const label = `Tiket ${sch.route.origin} → ${sch.route.destination}`
          const line = lineFromPoint(point, { description: label, qty: item.numPassengers, unit: 'person' })
          const row = await tx.bookingFlight.create({
            data: {
              bookingId, groupId: gid(item), flightScheduleId: item.flightScheduleId, departureDate: dbDateOf(item.departureDate),
              numPassengers: item.numPassengers, unitPrice: point.sellIdr, totalPrice: lineTotalSell(line),
            },
          })
          add({ itemType: 'flight', itemId: row.id, label, detail: `${day(item.departureDate)} · ${item.numPassengers} penumpang`, qty: item.numPassengers }, [line])
          break
        }
        case 'package': {
          const r = packageResolved[packageIdx++]!
          const lines = await packageLines(tx, item.packageId, r, item.numPeople)
          const totalPrice = sumSell(lines)
          if (!(totalPrice > 0)) throw new ItemNotBookableError('Harga paket umroh belum ditetapkan')
          const row = await tx.bookingPackage.create({
            data: {
              bookingId, groupId: gid(item), packageId: item.packageId, departureDate: dbDateOf(r.departureDate), returnDate: dbDateOf(r.returnDate),
              numPeople: item.numPeople, flightScheduleId: r.flightScheduleId, choices: r.choices as Prisma.InputJsonValue, totalPrice,
            },
          })
          packageRows.push({ key: row.id, numPeople: item.numPeople, visaProductId: r.visaProductId, name: r.name, group: item.group })
          if (r.flightScheduleId) flightDates.push({ date: r.departureDate, group: item.group })
          add({ itemType: 'package', itemId: row.id, label: r.name, detail: `${day(r.departureDate)} – ${day(r.returnDate)} · ${item.numPeople} orang`, qty: item.numPeople }, lines)
          break
        }
      }
    } catch (e) {
      tagItem(e, itemIndex) // editor baris menunjuk baris yang gagal
    }
  }

  // ── Pilgrims + Visa applications ───────────────────────────────────────────────────────────────────────────────────
  // visaProductId opsional per jamaah (docs/arsitektur-booking.md §6 Step 6a): tanpa visa = tanpa VisaApplication dan tanpa sumbangan harga. Harga visa = tier
  // titik harga yang memuat lama tinggal (harga manual menang); modal/jejak kurs-vendor beku ada di `price_snapshots`.
  // Rencana berangkat visa per jamaah: tiket paling awal yang berlaku untuknya (rombongannya atau untuk semua), selain itu rencana rombongan / booking.
  const plannedTravelOf = (group: number | undefined): Date | null => {
    const dates = flightDates.filter(f => group === undefined || f.group === undefined || f.group === group).map(f => f.date).sort()
    const travel = dates[0] ?? (group !== undefined ? data.groups?.[group]?.plannedTravelDate : undefined) ?? data.plannedTravelDate
    return travel ? dbDateOf(travel) : null
  }
  const assign = opts.assignMembers ?? true
  const members = assign ? assignByGroup(data, packageRows, hajiRows, grouped) : null
  for (const [i, p] of data.pilgrims.entries()) {
    const member = members ? members[i] : undefined
    const plannedTravelDate = plannedTravelOf(p.group)
    const fromPackage = (member?.package && packageRows.find(r => r.key === member.package)?.visaProductId) || undefined
    // Revisi: jamaah yang sudah ada hanya mendapat visa baru (data pribadinya tak disentuh). Jamaah baru: NIK/paspor disegel (docs/arsitektur-jamaah.md §5.3).
    const pilgrim = p.pilgrimId
      ? { id: p.pilgrimId }
      : await createPilgrim(tx, bookingId, p.visaProductId ?? fromPackage ?? null, p.fieldValues ?? {}, { bookingPackageId: member?.package ?? null, bookingHajiId: member?.haji ?? null, groupId: gid(p) })
    if (!p.visaProductId) {
      if (fromPackage) {
        const vp = await tx.visaProduct.findUnique({ where: { id: fromPackage }, select: { visaType: true } })
        if (!vp) throw new ItemNotBookableError('Produk visa paket tidak tersedia')
        // Tanpa baris harga: visa ini sudah dibayar lewat baris paket (Σ snapshot tetap = total).
        await tx.visaApplication.create({ data: { bookingPilgrimId: pilgrim.id, visaProductId: fromPackage, visaType: vp.visaType, status: 'pending_documents', plannedTravelDate } })
      }
      continue
    }

    const visaProduct = await tx.visaProduct.findUnique({ where: { id: p.visaProductId }, select: { name: true, visaType: true, isActive: true } })
    if (!visaProduct || !visaProduct.isActive) throw new ItemNotBookableError('Produk visa tidak tersedia')
    const point = await takeVisaTier(tx, p.visaProductId, p.selectedDurationDays ?? DEFAULT_DURATION_PROBE_DAY, 'visa')
    const label = /visa/i.test(visaProduct.name) ? visaProduct.name : `Visa ${visaProduct.name}`
    const line = lineFromPoint(point, { description: label, qty: 1, unit: 'person' })
    const application = await tx.visaApplication.create({
      data: {
        bookingPilgrimId: pilgrim.id,
        visaProductId: p.visaProductId,
        visaType: visaProduct.visaType, // fallback/display, lihat docs/arsitektur-visa.md §2
        status: 'pending_documents',
        selectedDurationDays: p.selectedDurationDays ?? null,
        plannedTravelDate,
      },
    })
    add({ itemType: 'visa', itemId: application.id, label, detail: p.selectedDurationDays ? `${p.selectedDurationDays} hari` : '', qty: 1 }, [line])
  }

  if (written) written.push(...pending.map(x => x.meta))
  return writeSnapshots(tx, bookingId, pending)
}

/**
 * Baris satu paket ziarah: harga dasar = titik harga paket (komponen + bagian `included` + penyesuaian), ditambah pilihan pilgrim (mode `user_choice`) yang
 * harganya dibaca dari titik harga sub-modul. Pilihan di luar daftar opsi paket ditolak (dulu diam-diam bernilai 0 padahal kuotanya ikut tertahan).
 */
const blankMember = (p: BookingInput['pilgrims'][number]): MemberPilgrim => ({ key: '', ownVisa: !!p.visaProductId, packageVisa: null, currentPackage: null, currentHaji: null })

/**
 * Anggota Paket Umroh/Haji (lib/booking/members.ts). Tanpa rombongan, atau semua paket/haji untuk SEMUA jamaah → dibagi atas seluruh jamaah (perilaku lama).
 * Paket/haji per rombongan → dibagi di dalam rombongannya sendiri. Campuran "semua" + "per rombongan" ditolak (satu jamaah tak dapat memegang dua paket).
 */
function assignByGroup(
  data: BookingInput, packageRows: ReadonlyArray<{ key: string; numPeople: number; visaProductId: string | null; name: string; group?: number }>,
  hajiRows: ReadonlyArray<{ key: string; numPeople: number; group?: number }>, grouped: boolean,
): MemberAssignment[] {
  const check = (r: ReturnType<typeof assignMembers>): MemberAssignment[] => {
    if (!r.ok) throw new ItemNotBookableError(memberProblem(r, k => packageRows.find(x => x.key === k)?.name ?? 'paket'))
    return r.members
  }
  const rows = [...packageRows, ...hajiRows]
  if (!grouped || rows.every(r => r.group === undefined)) return check(assignMembers(packageRows, hajiRows, data.pilgrims.map(blankMember)))
  if (rows.some(r => r.group === undefined)) throw new ItemNotBookableError('Paket Umroh/Haji untuk semua jamaah tidak dapat digabung dengan paket per rombongan — pilih rombongan untuk setiap paket')
  const out: MemberAssignment[] = data.pilgrims.map(() => ({ package: null, haji: null }))
  for (let g = 0; g < (data.groups?.length ?? 0); g++) {
    const idx = data.pilgrims.flatMap((p, i) => (p.group === g ? [i] : []))
    const got = check(assignMembers(packageRows.filter(r => r.group === g), hajiRows.filter(r => r.group === g), idx.map(i => blankMember(data.pilgrims[i]!))))
    idx.forEach((pi, k) => { out[pi] = got[k]! })
  }
  return out
}

/** Jamaah booking baru: NIK/paspor (peran `nik`/`passport_number`) DISEGEL — `fieldValues` hanya menyimpan samaran. Isian tak valid → 422. */
async function createPilgrim(
  tx: Prisma.TransactionClient, bookingId: string, visaProductId: string | null, values: Record<string, unknown>,
  links: { bookingPackageId: string | null; bookingHajiId: string | null; groupId: string | null },
) {
  const sealed = await sealNewPilgrim(tx, visaProductId, values)
  if (!sealed.ok) throw new ItemNotBookableError(Object.values(sealed.errors)[0] ?? 'Data jamaah tidak valid')
  return tx.bookingPilgrim.create({ data: { bookingId, fieldValues: sealed.values as Prisma.InputJsonValue, ...sealed.columns, ...links }, select: { id: true } })
}

async function tourPackageLines(
  tx: Prisma.TransactionClient, item: Item<'tourPackage'>, name: string, breakdown: TourPackageBreakdown, transportQuotaId: string | null,
): Promise<SnapshotLine[]> {
  const parts: CompositePart[] = []
  if (breakdown.transportMode === 'included' && breakdown.includedTransportPricingId && (breakdown.includedTransportPrice ?? 0) > 0) {
    const pricingId = breakdown.includedTransportPricingId
    parts.push({
      lineKey: 'kendaraan-termasuk', description: `Kendaraan: ${breakdown.includedVehicleName ?? 'termasuk paket'}`, qty: 1, unit: 'vehicle',
      unitSellIdr: breakdown.includedTransportPrice!, unitCostIdr: await peekCost(tx, 'transport', pricingId),
      ref: { ownerType: 'transport', ownerId: pricingId, variantKey: '' },
    })
  }
  if (breakdown.hotelMode === 'included') {
    for (const h of breakdown.hotels) {
      parts.push({
        lineKey: `hotel-termasuk:${h.id}`, description: `Hotel: ${h.hotelName} — ${h.roomTypeName}`, qty: h.nights * h.numRooms, unit: 'room_night',
        unitSellIdr: h.pricePerNight, unitCostIdr: await peekCost(tx, 'hotel', h.hotelRoomScheduleId),
        ref: { ownerType: 'hotel', ownerId: h.hotelRoomScheduleId, variantKey: '' },
      })
    }
  }
  const lines = await compositeLines(tx, { ownerType: 'tour_package', ownerId: item.tourPackageId, what: 'paket ziarah', label: name, multiplier: 1, parts })

  if (breakdown.transportMode === 'user_choice' && transportQuotaId) {
    const quota = await tx.transportQuota.findUniqueOrThrow({ where: { id: transportQuotaId }, select: { pricingId: true } })
    const option = breakdown.vehicleOptions.find(v => v.transportPricingId === quota.pricingId)
    if (!option) throw new ItemNotBookableError('Kendaraan yang dipilih tidak tersedia untuk paket ini')
    const point = await takePoint(tx, 'transport', quota.pricingId, '', 'kendaraan pilihan')
    lines.push(lineFromPoint(point, { lineKey: 'kendaraan-pilihan', description: `Kendaraan pilihan: ${option.vehicleName}`, qty: 1, unit: 'vehicle' }))
  }
  if (breakdown.hotelMode === 'user_choice' && item.chosenHotelRoomScheduleId && item.chosenHotelNumRooms) {
    const option = breakdown.hotelOptions.find(o => o.hotelRoomScheduleId === item.chosenHotelRoomScheduleId)
    if (!option) throw new ItemNotBookableError('Hotel yang dipilih tidak tersedia untuk paket ini')
    const point = await takePoint(tx, 'hotel', item.chosenHotelRoomScheduleId, '', 'hotel pilihan')
    lines.push(lineFromPoint(point, {
      lineKey: 'hotel-pilihan', description: `Hotel pilihan: ${option.hotelName} — ${option.roomTypeName}`, qty: option.nights * item.chosenHotelNumRooms, unit: 'room_night',
    }))
  }
  return lines
}
