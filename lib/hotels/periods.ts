import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { calendarDateOf, dbDateOf, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { dropPolymorphic } from '@/lib/admin/productDelete'
import { repriceOwner } from '@/lib/pricing/engine'
import { setManualSell } from '@/lib/pricing/engine/manual'
import { assertVendorUsable } from '@/lib/vendors/integrity'

// PERIODE HARGA HOTEL — satu-satunya penulis `hotel_price_periods` / `hotel_room_schedules` (+ biaya/vendor/titik harga per jadwal) untuk editor hotel
// (docs/arsitektur-hotel.md §12). Route hanya mem-parse Zod lalu memanggil fungsi di sini. Setiap fungsi memastikan periode MILIK hotel di URL (§12.1 G3) dan
// menulis di bawah kunci baris hotel (penulisan periode satu hotel berurutan → cek tumpang tindih tak bisa didahului permintaan serentak).

type Tx = Prisma.TransactionClient

/** Galat yang ditampilkan ke admin apa adanya (status HTTP + pesan). */
export class HotelPeriodError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) { super(message); this.name = 'HotelPeriodError' }
}

// Hotel punya satu komponen HPP tetap "kamar" (§10.4) dengan satu tier datar.
const COMPONENT_KAMAR = 'kamar'
const FLAT_TIER = { minDays: 0, maxDays: 9999 }
/** Status booking yang masih memakai kamar (draf belum menulis item; batal/hangus sudah melepas). */
const LIVE_BOOKING = { status: { in: ['active', 'completed'] as const } } satisfies Prisma.BookingWhereInput

// Kunci baris hotel: Prisma ORM tak punya SELECT … FOR UPDATE.
async function lockHotel(tx: Tx, hotelId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "hotels" WHERE id = ${hotelId} FOR UPDATE`
  if (rows.length === 0) throw new HotelPeriodError(404, 'Hotel tidak ditemukan')
}

async function periodOf(tx: Tx, hotelId: string, periodId: string) {
  const p = await tx.hotelPricePeriod.findUnique({ where: { id: periodId }, include: { schedules: { select: { id: true, roomTypeId: true, totalQuota: true, isActive: true } } } })
  if (!p || p.hotelId !== hotelId) throw new HotelPeriodError(404, 'Periode harga hotel tidak ditemukan')
  return p
}

async function assertNoOverlap(tx: Tx, hotelId: string, start: CalendarDate, end: CalendarDate, exceptId?: string): Promise<void> {
  const clash = await tx.hotelPricePeriod.findFirst({
    where: { hotelId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}), periodStart: { lte: dbDateOf(end) }, periodEnd: { gte: dbDateOf(start) } },
    select: { periodStart: true, periodEnd: true },
  })
  if (clash) throw new HotelPeriodError(409, `Tumpang tindih dengan periode ${formatCalendarDate(calendarDateOf(clash.periodStart))} – ${formatCalendarDate(calendarDateOf(clash.periodEnd))}`)
}

function assertRange(start: CalendarDate, end: CalendarDate): void {
  if (end < start) throw new HotelPeriodError(400, 'Tanggal akhir periode harus sama atau setelah tanggal mulai')
}

/** Rujukan yang mencegah hapus fisik jadwal kamar — sama dengan `deleteHotel` (lib/admin/productDelete.ts), termasuk FK `SET NULL` yang diam-diam mengosongkan riwayat. */
async function referenceCount(db: Tx, scheduleIds: string[]): Promise<number> {
  if (scheduleIds.length === 0) return 0
  const sched = { hotelRoomScheduleId: { in: scheduleIds } }
  const counts = await Promise.all([
    db.bookingHotel.count({ where: sched }),
    db.bookingTourPackage.count({ where: { chosenHotelRoomScheduleId: { in: scheduleIds } } }),
    db.packageHotelOption.count({ where: sched }),
    db.package.count({ where: { OR: [{ includedHotelMakkahScheduleId: { in: scheduleIds } }, { includedHotelMadinahScheduleId: { in: scheduleIds } }] } }),
    db.tourPackageHotel.count({ where: sched }),
    db.tourPackageHotelOption.count({ where: sched }),
  ])
  return counts.reduce((a, b) => a + b, 0)
}

/** Periode baru (tanggal saja; harga diisi di grid). Ditolak bila tumpang tindih periode aktif lain. */
export async function createPeriod(hotelId: string, range: { periodStart: CalendarDate; periodEnd: CalendarDate }): Promise<{ id: string }> {
  assertRange(range.periodStart, range.periodEnd)
  return prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    await assertNoOverlap(tx, hotelId, range.periodStart, range.periodEnd)
    return tx.hotelPricePeriod.create({ data: { hotelId, periodStart: dbDateOf(range.periodStart), periodEnd: dbDateOf(range.periodEnd) }, select: { id: true } })
  })
}

export type PeriodPatch = { periodStart?: CalendarDate; periodEnd?: CalendarDate; isActive?: boolean }

/** Ubah tanggal / status aktif. Ditolak bila tumpang tindih periode aktif lain, atau bila booking yang hidup memakai kamar periode ini di luar rentang baru. */
export async function updatePeriod(hotelId: string, periodId: string, patch: PeriodPatch): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    const p = await periodOf(tx, hotelId, periodId)
    const start = patch.periodStart ?? calendarDateOf(p.periodStart)
    const end = patch.periodEnd ?? calendarDateOf(p.periodEnd)
    const active = patch.isActive ?? p.isActive
    assertRange(start, end)
    if (active) await assertNoOverlap(tx, hotelId, start, end, periodId)
    const ids = p.schedules.map(s => s.id)
    if (ids.length > 0 && (start !== calendarDateOf(p.periodStart) || end !== calendarDateOf(p.periodEnd))) {
      // Aturan mesin pesan (lib/booking/lineItems.ts): checkIn ≥ periodStart dan checkOut ≤ periodEnd.
      const outside = await tx.bookingHotel.count({
        where: { hotelRoomScheduleId: { in: ids }, booking: LIVE_BOOKING, OR: [{ checkIn: { lt: dbDateOf(start) } }, { checkOut: { gt: dbDateOf(end) } }] },
      })
      const tours = await tx.bookingTourPackage.count({
        where: { chosenHotelRoomScheduleId: { in: ids }, booking: LIVE_BOOKING, OR: [{ tourDate: { lt: dbDateOf(start) } }, { tourDate: { gt: dbDateOf(end) } }] },
      })
      if (outside + tours > 0) throw new HotelPeriodError(409, `${outside + tours} booking memakai kamar periode ini di luar tanggal baru — ubah atau batalkan booking itu dulu`)
    }
    await tx.hotelPricePeriod.update({ where: { id: periodId }, data: { periodStart: dbDateOf(start), periodEnd: dbDateOf(end), isActive: active } })
  })
}

export type DeleteResult = { deleted: true } | { deleted: false; message: string }

/** Hapus-aman periode: dirujuk → dinonaktifkan; tidak → dihapus beserta jadwal kamar dan baris polimorfiknya (biaya, vendor, titik harga) dalam satu transaksi. */
export async function deletePeriod(hotelId: string, periodId: string): Promise<DeleteResult> {
  return prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    const p = await periodOf(tx, hotelId, periodId)
    const ids = p.schedules.map(s => s.id)
    const refs = await referenceCount(tx, ids)
    if (refs > 0) {
      await tx.hotelPricePeriod.update({ where: { id: periodId }, data: { isActive: false } })
      return { deleted: false, message: `Periode dipakai di ${refs} booking/paket — dinonaktifkan, bukan dihapus. Bisa diaktifkan kembali.` }
    }
    await dropPolymorphic(tx, 'hotel', ids)
    await tx.hotelPricePeriod.delete({ where: { id: periodId } }) // jadwal kamar ikut (CASCADE)
    return { deleted: true }
  })
}

/** Hapus satu tipe kamar dari periode (hapus-aman yang sama per jadwal). */
export async function removeRoom(hotelId: string, periodId: string, scheduleId: string): Promise<DeleteResult> {
  return prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    const p = await periodOf(tx, hotelId, periodId)
    if (!p.schedules.some(s => s.id === scheduleId)) throw new HotelPeriodError(404, 'Tipe kamar tidak ada di periode ini')
    const refs = await referenceCount(tx, [scheduleId])
    if (refs > 0) {
      await tx.hotelRoomSchedule.update({ where: { id: scheduleId }, data: { isActive: false } })
      return { deleted: false, message: `Kamar dipakai di ${refs} booking/paket — dinonaktifkan, bukan dihapus.` }
    }
    await dropPolymorphic(tx, 'hotel', [scheduleId])
    await tx.hotelRoomSchedule.delete({ where: { id: scheduleId } })
    return { deleted: true }
  })
}

export type RoomPriceInput = { roomTypeId: string; cost: number; totalQuota: number }

async function writeRoom(tx: Tx, periodId: string, vendorId: string, currency: string, room: RoomPriceInput): Promise<string> {
  const schedule = await tx.hotelRoomSchedule.upsert({
    where: { periodId_roomTypeId: { periodId, roomTypeId: room.roomTypeId } },
    create: { periodId, roomTypeId: room.roomTypeId, totalQuota: room.totalQuota },
    update: { totalQuota: room.totalQuota, isActive: true },
  })
  const costTiers = [{ ...FLAT_TIER, cost: room.cost }]
  const scope = { productType: 'hotel', productId: schedule.id, costComponent: COMPONENT_KAMAR }
  const existing = await tx.productCost.findFirst({ where: scope, select: { id: true } })
  if (existing) await tx.productCost.update({ where: { id: existing.id }, data: { vendorId, currency, costTiers, isActive: true } })
  else await tx.productCost.create({ data: { ...scope, vendorId, currency, costTiers } })
  await tx.preferredVendor.upsert({ where: { productType_productId_costComponent: scope }, create: { ...scope, vendorId }, update: { vendorId } })
  return schedule.id
}

/** Simpan harga semua tipe kamar satu periode (vendor + mata uang sama, §11.1) dalam SATU transaksi, lalu hitung ulang harga jual. Kuota total tak boleh di bawah yang sudah terpakai. */
export async function savePeriodPrices(hotelId: string, periodId: string, input: { vendorId: string; currency: string; rooms: RoomPriceInput[] }): Promise<string[]> {
  await assertVendorUsable(input.vendorId)
  const ids = await prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    await periodOf(tx, hotelId, periodId)
    const used = new Map((await tx.hotelRoomSchedule.findMany({ where: { periodId }, select: { roomTypeId: true, pendingQuota: true, bookedQuota: true, roomType: { select: { name: true } } } }))
      .map(s => [s.roomTypeId, s]))
    const out: string[] = []
    for (const room of input.rooms) {
      const u = used.get(room.roomTypeId)
      if (u && room.totalQuota < u.pendingQuota + u.bookedQuota) throw new HotelPeriodError(409, `Kuota ${u.roomType.name} tidak boleh di bawah ${u.pendingQuota + u.bookedQuota} kamar yang sudah dipesan`)
      out.push(await writeRoom(tx, periodId, input.vendorId, input.currency, room))
    }
    return out
  })
  for (const id of ids) await repriceOwner('hotel', id)
  return ids
}

/**
 * Duplikat periode: periode baru (tanggal dari admin) berisi semua tipe kamar AKTIF sumber — kuota total (terpakai mulai 0), biaya modal (vendor, mata uang, nominal),
 * vendor pilihan — dalam satu transaksi; lalu harga jual dihitung ulang dan harga jual MANUAL sumber disalin lewat `setManualSell` (tercatat di `price_changes`).
 */
export async function duplicatePeriod(hotelId: string, periodId: string, range: { periodStart: CalendarDate; periodEnd: CalendarDate }, byUserId: string): Promise<{ id: string }> {
  assertRange(range.periodStart, range.periodEnd)
  const { id, map, label } = await prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    const src = await periodOf(tx, hotelId, periodId)
    await assertNoOverlap(tx, hotelId, range.periodStart, range.periodEnd)
    const created = await tx.hotelPricePeriod.create({ data: { hotelId, periodStart: dbDateOf(range.periodStart), periodEnd: dbDateOf(range.periodEnd) } })
    const map: Array<[string, string]> = [] // [jadwal sumber, jadwal baru]
    for (const s of src.schedules.filter(x => x.isActive)) {
      const copy = await tx.hotelRoomSchedule.create({ data: { periodId: created.id, roomTypeId: s.roomTypeId, totalQuota: s.totalQuota } })
      const costs = await tx.productCost.findMany({ where: { productType: 'hotel', productId: s.id, isActive: true } })
      for (const c of costs) {
        await tx.productCost.create({ data: { productType: 'hotel', productId: copy.id, costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, costTiers: c.costTiers ?? Prisma.JsonNull } })
      }
      const prefs = await tx.preferredVendor.findMany({ where: { productType: 'hotel', productId: s.id } })
      for (const v of prefs) await tx.preferredVendor.create({ data: { productType: 'hotel', productId: copy.id, costComponent: v.costComponent, vendorId: v.vendorId } })
      map.push([s.id, copy.id])
    }
    return { id: created.id, map, label: `${formatCalendarDate(calendarDateOf(src.periodStart))} – ${formatCalendarDate(calendarDateOf(src.periodEnd))}` }
  })
  const manual = new Map((await prisma.pricePoint.findMany({ where: { ownerType: 'hotel', ownerId: { in: map.map(([s]) => s) }, variantKey: '', manualSellIdr: { not: null } }, select: { ownerId: true, manualSellIdr: true } }))
    .map(p => [p.ownerId, Number(p.manualSellIdr)]))
  for (const [from, to] of map) {
    await repriceOwner('hotel', to)
    const sell = manual.get(from)
    if (sell) await setManualSell({ ownerType: 'hotel', ownerId: to, byUserId, sellIdr: sell, note: `Disalin dari periode ${label}` })
  }
  return { id }
}
