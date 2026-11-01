import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { calendarDateOf, dbDateOf, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { dropPolymorphic } from '@/lib/admin/productDelete'
import { getPricePoint, repriceOwner } from '@/lib/pricing/engine'
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

export type RoomPriceInput = { roomTypeId: string; cost: number; totalQuota: number }
/** Isi periode: vendor + mata uang SATU untuk semua tipe kamar (§11.1) dan harga modal + kuota per tipe kamar. */
export type PeriodPrices = { vendorId: string; currency: string; rooms: RoomPriceInput[] }
export type PeriodInput = { periodStart: CalendarDate; periodEnd: CalendarDate; prices?: PeriodPrices }
export type PeriodPatch = { periodStart?: CalendarDate; periodEnd?: CalendarDate; isActive?: boolean; prices?: PeriodPrices }

/** Rentang tanggal sah + tak tumpang tindih; untuk periode yang ADA juga: booking hidup yang memakai kamarnya tetap di dalam rentang baru. */
async function checkDates(tx: Tx, hotelId: string, start: CalendarDate, end: CalendarDate, active: boolean, existing?: { id: string; periodStart: Date; periodEnd: Date; scheduleIds: string[] }): Promise<void> {
  assertRange(start, end)
  if (active) await assertNoOverlap(tx, hotelId, start, end, existing?.id)
  if (!existing || existing.scheduleIds.length === 0) return
  if (start === calendarDateOf(existing.periodStart) && end === calendarDateOf(existing.periodEnd)) return
  const ids = existing.scheduleIds
  // Aturan mesin pesan (lib/booking/lineItems.ts): checkIn ≥ periodStart dan checkOut ≤ periodEnd.
  const outside = await tx.bookingHotel.count({
    where: { hotelRoomScheduleId: { in: ids }, booking: LIVE_BOOKING, OR: [{ checkIn: { lt: dbDateOf(start) } }, { checkOut: { gt: dbDateOf(end) } }] },
  })
  const tours = await tx.bookingTourPackage.count({
    where: { chosenHotelRoomScheduleId: { in: ids }, booking: LIVE_BOOKING, OR: [{ tourDate: { lt: dbDateOf(start) } }, { tourDate: { gt: dbDateOf(end) } }] },
  })
  if (outside + tours > 0) throw new HotelPeriodError(409, `${outside + tours} booking memakai kamar periode ini di luar tanggal baru — ubah atau batalkan booking itu dulu`)
}

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

/** Tulis isi periode (dalam transaksi pemanggil). Kuota total tak boleh di bawah kamar yang sudah dipesan. Tipe kamar yang tak dikirim dibiarkan (hapus lewat `removeRoom`). */
async function writePrices(tx: Tx, periodId: string, prices: PeriodPrices): Promise<string[]> {
  const used = new Map((await tx.hotelRoomSchedule.findMany({ where: { periodId }, select: { roomTypeId: true, pendingQuota: true, bookedQuota: true, roomType: { select: { name: true } } } }))
    .map(s => [s.roomTypeId, s]))
  const out: string[] = []
  for (const room of prices.rooms) {
    const u = used.get(room.roomTypeId)
    if (u && room.totalQuota < u.pendingQuota + u.bookedQuota) throw new HotelPeriodError(409, `Kuota ${u.roomType.name} tidak boleh di bawah ${u.pendingQuota + u.bookedQuota} kamar yang sudah dipesan`)
    out.push(await writeRoom(tx, periodId, prices.vendorId, prices.currency, room))
  }
  return out
}

const reprice = async (ids: string[]) => { for (const id of ids) await repriceOwner('hotel', id) } // mesin harga punya transaksi sendiri → sesudah commit

/** Periode baru beserta isinya (opsional) dalam SATU transaksi. Ditolak bila tumpang tindih periode aktif lain. */
export async function createPeriod(hotelId: string, input: PeriodInput): Promise<{ id: string }> {
  if (input.prices) await assertVendorUsable(input.prices.vendorId)
  const { id, ids } = await prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    await checkDates(tx, hotelId, input.periodStart, input.periodEnd, true)
    const { id } = await tx.hotelPricePeriod.create({ data: { hotelId, periodStart: dbDateOf(input.periodStart), periodEnd: dbDateOf(input.periodEnd) }, select: { id: true } })
    return { id, ids: input.prices ? await writePrices(tx, id, input.prices) : [] }
  })
  await reprice(ids)
  return { id }
}

/** Ubah periode: tanggal, status aktif, dan/atau isinya — SATU transaksi. Ditolak bila tumpang tindih, atau booking hidup memakai kamarnya di luar rentang baru. */
export async function updatePeriod(hotelId: string, periodId: string, patch: PeriodPatch): Promise<void> {
  if (patch.prices) await assertVendorUsable(patch.prices.vendorId)
  const ids = await prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    const p = await periodOf(tx, hotelId, periodId)
    const start = patch.periodStart ?? calendarDateOf(p.periodStart)
    const end = patch.periodEnd ?? calendarDateOf(p.periodEnd)
    const active = patch.isActive ?? p.isActive
    await checkDates(tx, hotelId, start, end, active, { id: p.id, periodStart: p.periodStart, periodEnd: p.periodEnd, scheduleIds: p.schedules.map(s => s.id) })
    await tx.hotelPricePeriod.update({ where: { id: periodId }, data: { periodStart: dbDateOf(start), periodEnd: dbDateOf(end), isActive: active } })
    return patch.prices ? writePrices(tx, periodId, patch.prices) : []
  })
  await reprice(ids)
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

/**
 * Duplikat periode = periode BARU beserta isinya. Formulir admin mengirim tanggal baru + isi (diisi dari sumber, boleh diubah) → ditulis dalam satu transaksi;
 * tanpa `prices` isi disalin dari sumber di server (semua tipe kamar AKTIF: kuota total — terpakai mulai 0 —, biaya modal, vendor pilihan). Sesudahnya harga jual
 * dihitung ulang dan harga jual MANUAL sumber disalin untuk tipe kamar yang sama lewat `setManualSell` (tercatat di `price_changes`).
 */
export async function duplicatePeriod(hotelId: string, periodId: string, input: PeriodInput, byUserId: string): Promise<{ id: string }> {
  if (input.prices) await assertVendorUsable(input.prices.vendorId)
  const { id, ids, label, sourceByRoomType } = await prisma.$transaction(async tx => {
    await lockHotel(tx, hotelId)
    const src = await periodOf(tx, hotelId, periodId)
    await checkDates(tx, hotelId, input.periodStart, input.periodEnd, true)
    const created = await tx.hotelPricePeriod.create({ data: { hotelId, periodStart: dbDateOf(input.periodStart), periodEnd: dbDateOf(input.periodEnd) } })
    const ids: string[] = []
    if (input.prices) ids.push(...await writePrices(tx, created.id, input.prices))
    else {
      for (const s of src.schedules.filter(x => x.isActive)) {
        const copy = await tx.hotelRoomSchedule.create({ data: { periodId: created.id, roomTypeId: s.roomTypeId, totalQuota: s.totalQuota } })
        const costs = await tx.productCost.findMany({ where: { productType: 'hotel', productId: s.id, isActive: true } })
        for (const c of costs) {
          await tx.productCost.create({ data: { productType: 'hotel', productId: copy.id, costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, costTiers: c.costTiers ?? Prisma.JsonNull } })
        }
        const prefs = await tx.preferredVendor.findMany({ where: { productType: 'hotel', productId: s.id } })
        for (const v of prefs) await tx.preferredVendor.create({ data: { productType: 'hotel', productId: copy.id, costComponent: v.costComponent, vendorId: v.vendorId } })
        ids.push(copy.id)
      }
    }
    return {
      id: created.id, ids,
      label: `${formatCalendarDate(calendarDateOf(src.periodStart))} – ${formatCalendarDate(calendarDateOf(src.periodEnd))}`,
      sourceByRoomType: new Map(src.schedules.filter(x => x.isActive).map(x => [x.roomTypeId, x.id])),
    }
  })
  await reprice(ids)
  const created = await prisma.hotelRoomSchedule.findMany({ where: { id: { in: ids } }, select: { id: true, roomTypeId: true } })
  for (const c of created) {
    const from = sourceByRoomType.get(c.roomTypeId)
    const point = from ? await getPricePoint('hotel', from) : null // pembaca mesin harga — kolom harga manual hanya disentuh mesin
    const sell = point?.mode === 'manual' ? point.sellIdr : undefined
    if (sell) await setManualSell({ ownerType: 'hotel', ownerId: c.id, byUserId, sellIdr: sell, note: `Disalin dari periode ${label}` })
  }
  return { id }
}
