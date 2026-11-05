import { prisma } from '@/lib/db'
import { paginate, type ListParams } from '@/lib/table/pagination'
import { calendarDateOf, dbDateOf, daysBetween, eachDay, todayInApp } from '@/lib/time'
import type { OpenQuotasInput } from '@/lib/validators/transportQuota'

// Penulis tunggal kuota tanggal transport dari admin (docs/arsitektur-transportasi.md §10). Penahanan kursi saat booking tetap di lib/quota (adapter).

export const MAX_QUOTA_RANGE_DAYS = 366

export class TransportQuotaError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422, message: string) { super(message) }
}

export type QuotaRow = {
  id: string; pricingId: string; vehicle: string; travelDate: string
  totalSeats: number; pendingSeats: number; bookedSeats: number; seatsLeft: number; used: boolean
}

/** Kuota satu trip dari hari ini ke depan (tanggal lampau tak lagi bisa dipesan). */
export async function listQuotas(tripId: string, pricingId: string | undefined, list: ListParams) {
  const where = { pricing: { tripId }, ...(pricingId ? { pricingId } : {}), travelDate: { gte: dbDateOf(todayInApp()) } }
  const page = await paginate(list, () => prisma.transportQuota.count({ where }), range => prisma.transportQuota.findMany({
    where, orderBy: [{ travelDate: 'asc' }, { id: 'asc' }], ...range,
    select: {
      id: true, pricingId: true, travelDate: true, totalSeats: true, pendingSeats: true, bookedSeats: true,
      pricing: { select: { vehicle: { select: { name: true } } } },
      _count: { select: { bookingTransports: true, bookingTourPackages: true } },
    },
  }))
  const items: QuotaRow[] = page.items.map(q => ({
    id: q.id, pricingId: q.pricingId, vehicle: q.pricing.vehicle.name, travelDate: calendarDateOf(q.travelDate),
    totalSeats: q.totalSeats, pendingSeats: q.pendingSeats, bookedSeats: q.bookedSeats, seatsLeft: q.totalSeats - q.pendingSeats - q.bookedSeats,
    used: q._count.bookingTransports + q._count.bookingTourPackages > 0,
  }))
  return { items, meta: page.meta }
}

/** Buka rentang tanggal untuk satu kendaraan. Tanggal yang sudah ada dilewati, bukan ditimpa: kursinya mungkin sudah diatur atau terpakai. */
export async function openQuotas(input: OpenQuotasInput): Promise<{ created: number; skipped: number }> {
  const { pricingId, from, to, totalSeats } = input
  if (to < from) throw new TransportQuotaError(422, 'Tanggal akhir tidak boleh sebelum tanggal mulai')
  if (from < todayInApp()) throw new TransportQuotaError(422, 'Tanggal yang sudah lewat tidak bisa dibuka')
  const days = daysBetween(from, to) + 1
  if (days > MAX_QUOTA_RANGE_DAYS) throw new TransportQuotaError(422, `Rentang maksimal ${MAX_QUOTA_RANGE_DAYS} hari sekali buka`)
  if (!(await prisma.transportPricing.findUnique({ where: { id: pricingId }, select: { id: true } }))) throw new TransportQuotaError(404, 'Kendaraan pada trip ini tidak ditemukan')
  const { count } = await prisma.transportQuota.createMany({
    data: [...eachDay(from, to)].map(d => ({ pricingId, travelDate: dbDateOf(d), totalSeats })),
    skipDuplicates: true,
  })
  return { created: count, skipped: days - count }
}

// $queryRaw: Prisma ORM tidak punya `SELECT … FOR UPDATE`. Kunci menahan penulis lain sampai transaksi selesai; booking yang menahan kursi bersamaan
// berjalan Serializable, jadi ia menunggu lalu gagal-ulang dengan angka terbaru, tidak bisa menyalip pemeriksaan di bawah.
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
async function lockQuota(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "transport_quotas" WHERE id = ${id} FOR UPDATE`
  if (rows.length === 0) throw new TransportQuotaError(404, 'Kuota tanggal tidak ditemukan')
}

/** Ubah jumlah kursi; tidak boleh di bawah kursi yang sudah ditahan atau terkonfirmasi. */
export async function updateQuotaSeats(id: string, totalSeats: number): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockQuota(tx, id)
    const q = await tx.transportQuota.findUniqueOrThrow({ where: { id }, select: { pendingSeats: true, bookedSeats: true } })
    const used = q.pendingSeats + q.bookedSeats
    if (totalSeats < used) throw new TransportQuotaError(409, `Kursi tidak bisa di bawah ${used} karena sudah terpakai booking`)
    await tx.transportQuota.update({ where: { id }, data: { totalSeats } })
  })
}

/** Hapus hanya bila tak pernah dirujuk booking. FK paket ziarah SET NULL tidak menolak hapus, jadi rujukannya dihitung eksplisit agar riwayat tak kosong diam-diam. */
export async function deleteQuota(id: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockQuota(tx, id)
    const refs = await tx.bookingTransport.count({ where: { transportQuotaId: id } }) + await tx.bookingTourPackage.count({ where: { transportQuotaId: id } })
    if (refs > 0) throw new TransportQuotaError(409, 'Tanggal ini sudah pernah dipesan sehingga tidak bisa dihapus. Kecilkan jumlah kursinya bila tidak ingin dijual lagi')
    await tx.transportQuota.delete({ where: { id } })
  })
}
