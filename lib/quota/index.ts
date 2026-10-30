// All quota helpers MUST be called inside prisma.$transaction() to prevent race conditions.
import { ItemNotBookableError } from '@/lib/booking/errors'
import type { Prisma } from '@prisma/client'
import { formatCalendarDate } from '@/lib/time'

type Tx = Prisma.TransactionClient

export async function reserveHotelQuota(tx: Tx, hotelRoomScheduleId: string, rooms: number): Promise<void> {
  const schedule = await tx.hotelRoomSchedule.findUniqueOrThrow({
    where: { id: hotelRoomScheduleId },
    select: { totalQuota: true, pendingQuota: true, bookedQuota: true },
  })
  const available = schedule.totalQuota - schedule.pendingQuota - schedule.bookedQuota
  if (available < rooms) throw new Error(`Hotel quota insufficient: need ${rooms}, have ${available}`)
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

export async function releaseHotelQuota(tx: Tx, hotelRoomScheduleId: string, rooms: number): Promise<void> {
  await tx.hotelRoomSchedule.update({
    where: { id: hotelRoomScheduleId },
    data: { pendingQuota: { decrement: rooms } },
  })
}

export async function reserveTransportQuota(tx: Tx, quotaId: string, seats: number): Promise<void> {
  const quota = await tx.transportQuota.findUniqueOrThrow({
    where: { id: quotaId },
    select: { totalSeats: true, pendingSeats: true, bookedSeats: true },
  })
  const available = quota.totalSeats - quota.pendingSeats - quota.bookedSeats
  if (available < seats) throw new Error(`Transport quota insufficient: need ${seats}, have ${available}`)
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

export async function releaseTransportQuota(tx: Tx, quotaId: string, seats: number): Promise<void> {
  await tx.transportQuota.update({
    where: { id: quotaId },
    data: { pendingSeats: { decrement: seats } },
  })
}

// Kursi tiket: dipanggil POST /bookings (item `flight` dan Paket Umroh bertiket); confirm/release lewat lib/quota/adapters/flight.ts (§10.2 booking engine v2).
export async function reserveFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  const schedule = await tx.flightSchedule.findUnique({
    where: { id: scheduleId },
    select: { totalSeats: true, pendingSeats: true, bookedSeats: true, isActive: true },
  })
  // Jadwal tak ada / nonaktif = item tak dapat dijual (422), bukan galat server — dicek sebelum kursi ditahan.
  if (!schedule || !schedule.isActive) throw new ItemNotBookableError('Jadwal tiket pesawat tidak tersedia')
  const available = schedule.totalSeats - schedule.pendingSeats - schedule.bookedSeats
  if (available < seats) throw new Error(`Flight quota insufficient: need ${seats}, have ${available}`)
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

export async function releaseFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  await tx.flightSchedule.update({
    where: { id: scheduleId },
    data: { pendingSeats: { decrement: seats } },
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
  if (available < people) throw new Error('Muthowif capacity insufficient for selected dates')
  await tx.muthowifAvailability.update({
    where: { muthowifId_date: { muthowifId, date } },
    data: { pendingCount: { increment: people } },
  })
}

export async function releaseMuthowifQuota(tx: Tx, muthowifId: string, date: Date, people: number): Promise<void> {
  await tx.muthowifAvailability.update({
    where: { muthowifId_date: { muthowifId, date } },
    data: { pendingCount: { decrement: people } },
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
    // Sertakan tanggal spesifik yang penuh — menutup Gap #7 (docs/arsitektur-muthowif.md §7):
    // dulu pesan generik tanpa bilang hari mana, reservasi tetap all-or-nothing tapi user
    // sekarang tahu persisnya kenapa gagal. Kata "insufficient"/"capacity" dipertahankan
    // (pola sama fungsi reserve* lain di file ini) supaya cocok dengan pattern-match di
    // app/api/v1/bookings/route.ts yang mem-forward pesan ini apa adanya sebagai 409.
    const dateLabel = formatCalendarDate(date)
    throw new Error(`Muthowif pool capacity insufficient for ${dateLabel}: need ${people}, have ${Math.max(available, 0)}`)
  }
  await tx.muthowifPoolAvailability.update({
    where: { date },
    data: { pendingCount: { increment: people } },
  })
}

export async function releasePoolMuthowifQuota(tx: Tx, date: Date, people: number): Promise<void> {
  await tx.muthowifPoolAvailability.update({
    where: { date },
    data: { pendingCount: { decrement: people } },
  })
}

export async function confirmPoolMuthowifQuota(tx: Tx, date: Date, people: number): Promise<void> {
  await tx.muthowifPoolAvailability.update({
    where: { date },
    data: { pendingCount: { decrement: people }, bookedCount: { increment: people } },
  })
}
