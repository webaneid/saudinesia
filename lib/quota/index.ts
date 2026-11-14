// All quota helpers MUST be called inside prisma.$transaction() to prevent race conditions.
import { ItemNotBookableError, QuotaExhaustedError } from '@/lib/booking/errors'
import type { Prisma } from '@prisma/client'
import { calendarDateOf, todayInApp } from '@/lib/time'

type Tx = Prisma.TransactionClient

export async function reserveHotelQuota(tx: Tx, hotelRoomScheduleId: string, rooms: number): Promise<void> {
  const schedule = await tx.hotelRoomSchedule.findUniqueOrThrow({
    where: { id: hotelRoomScheduleId },
    select: { totalQuota: true, pendingQuota: true, bookedQuota: true },
  })
  const available = schedule.totalQuota - schedule.pendingQuota - schedule.bookedQuota
  if (available < rooms) throw new QuotaExhaustedError('quotaHotel', { need: rooms, have: available })
  await tx.hotelRoomSchedule.update({
    where: { id: hotelRoomScheduleId },
    data: { pendingQuota: { increment: rooms } },
  })
}

export async function confirmHotelQuota(tx: Tx, hotelRoomScheduleId: string, rooms: number): Promise<void> {
  await tx.hotelRoomSchedule.update({
    where: { id: hotelRoomScheduleId },
    data: { pendingQuota: { decrement: rooms }, bookedQuota: { increment: rooms } },
  })
}

// release*: `confirmed` = booking sudah dikonfirmasi → kuotanya sudah pindah ke `booked*` (lihat confirm*), jadi yang dilepas `booked*`, bukan `pending*` (bug lama: selalu `pending*`,
// sehingga membatalkan booking terkonfirmasi membuat pending minus dan kursi/kamar tak pernah kembali — docs/arsitektur-booking-engine-v2.md §10.4 6b.3).
export async function releaseHotelQuota(tx: Tx, hotelRoomScheduleId: string, rooms: number, confirmed = false): Promise<void> {
  await tx.hotelRoomSchedule.update({
    where: { id: hotelRoomScheduleId },
    data: confirmed ? { bookedQuota: { decrement: rooms } } : { pendingQuota: { decrement: rooms } },
  })
}

export async function reserveTransportQuota(tx: Tx, quotaId: string, seats: number): Promise<void> {
  const quota = await tx.transportQuota.findUniqueOrThrow({
    where: { id: quotaId },
    select: { totalSeats: true, pendingSeats: true, bookedSeats: true },
  })
  const available = quota.totalSeats - quota.pendingSeats - quota.bookedSeats
  if (available < seats) throw new QuotaExhaustedError('quotaTransport', { need: seats, have: available })
  await tx.transportQuota.update({
    where: { id: quotaId },
    data: { pendingSeats: { increment: seats } },
  })
}

export async function confirmTransportQuota(tx: Tx, quotaId: string, seats: number): Promise<void> {
  await tx.transportQuota.update({
    where: { id: quotaId },
    data: { pendingSeats: { decrement: seats }, bookedSeats: { increment: seats } },
  })
}

export async function releaseTransportQuota(tx: Tx, quotaId: string, seats: number, confirmed = false): Promise<void> {
  await tx.transportQuota.update({
    where: { id: quotaId },
    data: confirmed ? { bookedSeats: { decrement: seats } } : { pendingSeats: { decrement: seats } },
  })
}

// Kursi tiket: dipanggil POST /bookings (item `flight` dan Paket Umroh bertiket); confirm/release lewat lib/quota/adapters/flight.ts (§10.2 booking engine v2).
export async function reserveFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  const schedule = await tx.flightSchedule.findUnique({
    where: { id: scheduleId },
    select: { totalSeats: true, pendingSeats: true, bookedSeats: true, isActive: true },
  })
  // Jadwal tak ada / nonaktif = item tak dapat dijual (422), bukan galat server — dicek sebelum kursi ditahan.
  if (!schedule || !schedule.isActive) throw new ItemNotBookableError('itemFlightUnavailable')
  const available = schedule.totalSeats - schedule.pendingSeats - schedule.bookedSeats
  if (available < seats) throw new QuotaExhaustedError('quotaFlight', { need: seats, have: available })
  await tx.flightSchedule.update({
    where: { id: scheduleId },
    data: { pendingSeats: { increment: seats } },
  })
}

export async function confirmFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  await tx.flightSchedule.update({
    where: { id: scheduleId },
    data: { pendingSeats: { decrement: seats }, bookedSeats: { increment: seats } },
  })
}

export async function releaseFlightQuota(tx: Tx, scheduleId: string, seats: number, confirmed = false): Promise<void> {
  await tx.flightSchedule.update({
    where: { id: scheduleId },
    data: confirmed ? { bookedSeats: { decrement: seats } } : { pendingSeats: { decrement: seats } },
  })
}

// ── Kursi keberangkatan Paket Umroh (K1, docs/arsitektur-paket-umroh.md §8) ─────────────────────────────────────────────
// Baris dikunci `FOR UPDATE` (Prisma ORM tak punya penguncian baris) supaya sisa kursi dibaca ulang di dalam kunci; ditahan → dikonfirmasi → dilepas
// mengikuti status per baris item (`quotaConfirmed`). Tabel `package_departures` selain kolom kursi hanya ditulis lib/packages/departures.ts.

/** `expectedDate` = tanggal yang dibaca saat item di-resolve; berbeda di dalam kunci (admin mengubahnya sebelum pesanan pertama) → tolak, jangan simpan salinan basi. */
export async function reservePackageDepartureQuota(tx: Tx, departureId: string, seats: number, expectedDate?: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ totalSeats: number; pendingSeats: number; bookedSeats: number; isActive: boolean; departureDate: Date }>>`
    SELECT "totalSeats", "pendingSeats", "bookedSeats", "isActive", "departureDate" FROM "package_departures" WHERE "id" = ${departureId} FOR UPDATE`
  const d = rows[0]
  if (!d || !d.isActive) throw new ItemNotBookableError('itemPackageDepartureUnavailable')
  if (expectedDate !== undefined && calendarDateOf(d.departureDate) !== expectedDate) throw new ItemNotBookableError('itemPackageDepartureUnavailable')
  // Hanya item baru/diganti yang menahan kursi — di sinilah keberangkatan lewat ditolak (item lama tetap boleh ikut revisi).
  if (calendarDateOf(d.departureDate) < todayInApp()) throw new ItemNotBookableError('itemPackageDeparturePast')
  const available = d.totalSeats - d.pendingSeats - d.bookedSeats
  if (available < seats) throw new QuotaExhaustedError('quotaPackageDeparture', { need: seats, have: Math.max(0, available) })
  await tx.packageDeparture.update({ where: { id: departureId }, data: { pendingSeats: { increment: seats } } })
}

export async function confirmPackageDepartureQuota(tx: Tx, departureId: string, seats: number): Promise<void> {
  await tx.packageDeparture.update({ where: { id: departureId }, data: { pendingSeats: { decrement: seats }, bookedSeats: { increment: seats } } })
}

export async function releasePackageDepartureQuota(tx: Tx, departureId: string, seats: number, confirmed = false): Promise<void> {
  await tx.packageDeparture.update({
    where: { id: departureId },
    data: confirmed ? { bookedSeats: { decrement: seats } } : { pendingSeats: { decrement: seats } },
  })
}

export async function reserveMuthowifQuota(tx: Tx, muthowifId: string, date: Date, people: number): Promise<void> {
  const avail = await tx.muthowifAvailability.upsert({
    where: { muthowifId_date: { muthowifId, date } },
    create: { muthowifId, date, pendingCount: 0, bookedCount: 0 },
    update: {},
    select: { pendingCount: true, bookedCount: true, muthowif: { select: { dailyCapacity: true } } },
  })
  const available = avail.muthowif.dailyCapacity - avail.pendingCount - avail.bookedCount
  if (available < people) throw new QuotaExhaustedError('quotaMuthowif')
  await tx.muthowifAvailability.update({
    where: { muthowifId_date: { muthowifId, date } },
    data: { pendingCount: { increment: people } },
  })
}

export async function releaseMuthowifQuota(tx: Tx, muthowifId: string, date: Date, people: number, confirmed = false): Promise<void> {
  await tx.muthowifAvailability.update({
    where: { muthowifId_date: { muthowifId, date } },
    data: confirmed ? { bookedCount: { decrement: people } } : { pendingCount: { decrement: people } },
  })
}

// Individual-level (per muthowifId) — dipakai dari alur assignment admin, bukan booking creation
// lagi. Menutup Gap #1 KRITIS di level individu (docs/arsitektur-muthowif.md §9.4).
export async function confirmMuthowifQuota(tx: Tx, muthowifId: string, date: Date, people: number): Promise<void> {
  await tx.muthowifAvailability.update({
    where: { muthowifId_date: { muthowifId, date } },
    data: { pendingCount: { decrement: people }, bookedCount: { increment: people } },
  })
}

// Pool-level — kapasitas GABUNGAN semua muthowif aktif, dicek/direservasi saat booking dibuat
// (bukan per-orang, karena muthowif spesifik belum ditentukan). Kapasitas dihitung live dari
// SUM(dailyCapacity WHERE isActive), tidak disimpan. docs/arsitektur-muthowif.md §9.2-§9.4.
export async function reservePoolMuthowifQuota(tx: Tx, date: Date, people: number): Promise<void> {
  const capacitySum = await tx.muthowif.aggregate({
    where: { isActive: true },
    _sum: { dailyCapacity: true },
  })
  const totalCapacity = capacitySum._sum.dailyCapacity ?? 0

  const pool = await tx.muthowifPoolAvailability.upsert({
    where: { date },
    create: { date, pendingCount: 0, bookedCount: 0 },
    update: {},
    select: { pendingCount: true, bookedCount: true },
  })
  const available = totalCapacity - pool.pendingCount - pool.bookedCount
  if (available < people) {
    // Sertakan tanggal spesifik yang penuh — menutup Gap #7 (docs/arsitektur-muthowif.md §7). Galat kuota = `QuotaExhaustedError` berkode
    // (I6b): dipetakan ke 409 lewat `instanceof` (lib/booking/simulate.ts), tanggal dikirim sebagai tanggal kalender dan diformat sesuai bahasa.
    throw new QuotaExhaustedError('quotaMuthowifDate', { travelDate: calendarDateOf(date), need: people, have: Math.max(available, 0) })
  }
  await tx.muthowifPoolAvailability.update({
    where: { date },
    data: { pendingCount: { increment: people } },
  })
}

export async function releasePoolMuthowifQuota(tx: Tx, date: Date, people: number, confirmed = false): Promise<void> {
  await tx.muthowifPoolAvailability.update({
    where: { date },
    data: confirmed ? { bookedCount: { decrement: people } } : { pendingCount: { decrement: people } },
  })
}

export async function confirmPoolMuthowifQuota(tx: Tx, date: Date, people: number): Promise<void> {
  await tx.muthowifPoolAvailability.update({
    where: { date },
    data: { pendingCount: { decrement: people }, bookedCount: { increment: people } },
  })
}
