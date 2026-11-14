import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { calendarDateOf, dbDateOf, todayInApp, type CalendarDate } from '@/lib/time'
import type { DepartureCreateInput, DepartureUpdateInput } from '@/lib/validators/package'
import { packageReturnDate, seatsLeft } from './dates'

// Keberangkatan Paket Umroh (K1, docs/arsitektur-paket-umroh.md §8) — SATU-SATUNYA penulis tabel `package_departures`
// (kursi ditahan/terjual kelak hanya lewat lib/quota; dijaga scripts/test-package-departures.ts). Masukan sudah diparse
// lib/validators/package.ts; peran diperiksa di route. Galat berupa KODE (`DepartureError`), bukan kalimat.

export type DepartureFailure =
  | 'packageNotFound' | 'departureNotFound' | 'departureDuplicate' | 'departurePast' | 'departureSeatsBelowSold' | 'departureDateLocked'

export class DepartureError extends Error {
  override name = 'DepartureError'
  constructor(readonly code: DepartureFailure) { super(code) }
}

export type DepartureView = {
  id: string
  departureDate: CalendarDate
  /** Turunan durasi paket; null bila paket belum berdurasi. */
  returnDate: CalendarDate | null
  totalSeats: number
  pendingSeats: number
  bookedSeats: number
  seatsLeft: number
  isActive: boolean
  note: string | null
  /** Jumlah item booking yang merujuk — > 0 berarti tanggal terkunci dan hapus = nonaktif. */
  bookingCount: number
}

type Db = Prisma.TransactionClient | typeof prisma
type Row = { id: string; departureDate: Date; totalSeats: number; pendingSeats: number; bookedSeats: number; isActive: boolean; note: string | null; _count: { bookings: number } }

const SELECT = {
  id: true, departureDate: true, totalSeats: true, pendingSeats: true, bookedSeats: true, isActive: true, note: true,
  _count: { select: { bookings: true } },
} as const

function view(r: Row, durationDays: number | null): DepartureView {
  const departureDate = calendarDateOf(r.departureDate)
  return {
    id: r.id, departureDate, returnDate: durationDays ? packageReturnDate(departureDate, durationDays) : null,
    totalSeats: r.totalSeats, pendingSeats: r.pendingSeats, bookedSeats: r.bookedSeats, seatsLeft: seatsLeft(r),
    isActive: r.isActive, note: r.note, bookingCount: r._count.bookings,
  }
}

/** Semua keberangkatan satu paket (admin), urut tanggal. Paket tak ada → `packageNotFound`. */
export async function listDepartures(packageId: string, db: Db = prisma): Promise<DepartureView[]> {
  const pkg = await db.package.findUnique({ where: { id: packageId }, select: { durationDays: true } })
  if (!pkg) throw new DepartureError('packageNotFound')
  const rows = await db.packageDeparture.findMany({ where: { packageId }, select: SELECT, orderBy: [{ departureDate: 'asc' }, { id: 'asc' }] })
  return rows.map(r => view(r, pkg.durationDays))
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

export async function createDeparture(packageId: string, input: DepartureCreateInput): Promise<DepartureView> {
  if (input.departureDate < todayInApp()) throw new DepartureError('departurePast')
  try {
    return await prisma.$transaction(async tx => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, select: { durationDays: true } })
      if (!pkg) throw new DepartureError('packageNotFound')
      const row = await tx.packageDeparture.create({
        data: { packageId, departureDate: dbDateOf(input.departureDate), totalSeats: input.totalSeats, isActive: input.isActive ?? true, note: input.note || null },
        select: SELECT,
      })
      return view(row, pkg.durationDays)
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new DepartureError('departureDuplicate')
    throw e
  }
}

/**
 * Kunci baris keberangkatan MILIK paket itu (kursi dan tanggal dibaca ulang di dalam kunci) — id keberangkatan paket lain = tidak ditemukan.
 * `$queryRaw` karena Prisma ORM tak punya `FOR UPDATE`.
 */
async function lockDeparture(tx: Prisma.TransactionClient, packageId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "package_departures" WHERE "id" = ${id} AND "packageId" = ${packageId} FOR UPDATE`)
  return rows.length > 0
}

/**
 * Ubah keberangkatan. Total kursi tak boleh di bawah yang ditahan + terjual; tanggal hanya boleh diubah selama belum pernah dipesan
 * (booking menyimpan salinan tanggalnya) dan tak boleh ke masa lalu.
 */
export async function updateDeparture(packageId: string, id: string, input: DepartureUpdateInput): Promise<DepartureView> {
  try {
    return await prisma.$transaction(async tx => {
      if (!(await lockDeparture(tx, packageId, id))) throw new DepartureError('departureNotFound')
      const cur = await tx.packageDeparture.findUniqueOrThrow({ where: { id }, select: { ...SELECT, package: { select: { durationDays: true } } } })
      if (input.departureDate !== undefined && input.departureDate !== calendarDateOf(cur.departureDate)) {
        if (cur._count.bookings > 0) throw new DepartureError('departureDateLocked')
        if (input.departureDate < todayInApp()) throw new DepartureError('departurePast')
      }
      if (input.totalSeats !== undefined && input.totalSeats < cur.pendingSeats + cur.bookedSeats) throw new DepartureError('departureSeatsBelowSold')
      const row = await tx.packageDeparture.update({
        where: { id },
        data: {
          ...(input.departureDate !== undefined && { departureDate: dbDateOf(input.departureDate) }),
          ...(input.totalSeats !== undefined && { totalSeats: input.totalSeats }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.note !== undefined && { note: input.note || null }),
        },
        select: SELECT,
      })
      return view(row, cur.package.durationDays)
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new DepartureError('departureDuplicate')
    throw e
  }
}

export type DepartureDeleteResult = { deleted: true } | { deleted: false; bookingCount: number }

/** Hapus aman: belum pernah dipesan → dihapus; selain itu dinonaktifkan (booking dan invoice tak boleh yatim). */
export async function deleteOrDeactivateDeparture(packageId: string, id: string): Promise<DepartureDeleteResult> {
  try {
    return await deleteOrDeactivateInTx(packageId, id)
  } catch (e) {
    // Booking yang masuk di antara hitung dan hapus ditangkap FK Restrict (P2003) → jalur nonaktif (pola lib/haji/delete.ts).
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003')) throw e
    await prisma.packageDeparture.update({ where: { id }, data: { isActive: false } })
    return { deleted: false, bookingCount: await prisma.bookingPackage.count({ where: { departureId: id } }) }
  }
}

function deleteOrDeactivateInTx(packageId: string, id: string): Promise<DepartureDeleteResult> {
  return prisma.$transaction(async tx => {
    if (!(await lockDeparture(tx, packageId, id))) throw new DepartureError('departureNotFound')
    const bookingCount = await tx.bookingPackage.count({ where: { departureId: id } })
    if (bookingCount > 0) {
      await tx.packageDeparture.update({ where: { id }, data: { isActive: false } })
      return { deleted: false, bookingCount }
    }
    await tx.packageDeparture.delete({ where: { id } })
    return { deleted: true }
  })
}

/** Dipanggil penghapus paket (`lib/admin/productDelete.ts`) hanya untuk paket yang belum pernah dipesan — di transaksi penghapusannya. */
export async function dropDeparturesOf(tx: Prisma.TransactionClient, packageId: string): Promise<void> {
  await tx.packageDeparture.deleteMany({ where: { packageId } })
}

export type BookableDeparture = { id: string; departureDate: CalendarDate; returnDate: CalendarDate; seatsLeft: number }

/**
 * Keberangkatan yang bisa DIPILIH (checkout pelanggan, form booking admin): aktif, belum lewat, paket berdurasi; urut tanggal. Termasuk yang penuh (sisa 0) supaya
 * pelanggan melihatnya mati, bukan hilang. Hanya baca — kursi diperiksa ulang di dalam kunci saat ditahan (lib/quota). Tanpa catatan internal.
 */
export async function bookableDepartures(packageIds: readonly string[], db: Db = prisma): Promise<Map<string, BookableDeparture[]>> {
  const out = new Map<string, BookableDeparture[]>()
  if (packageIds.length === 0) return out
  const rows = await db.packageDeparture.findMany({
    where: { packageId: { in: [...packageIds] }, isActive: true, departureDate: { gte: dbDateOf(todayInApp()) }, package: { durationDays: { not: null } } },
    select: { id: true, packageId: true, departureDate: true, totalSeats: true, pendingSeats: true, bookedSeats: true, package: { select: { durationDays: true } } },
    orderBy: [{ departureDate: 'asc' }, { id: 'asc' }],
  })
  for (const r of rows) {
    const departureDate = calendarDateOf(r.departureDate)
    const list = out.get(r.packageId) ?? []
    list.push({ id: r.id, departureDate, returnDate: packageReturnDate(departureDate, r.package.durationDays!), seatsLeft: seatsLeft(r) })
    out.set(r.packageId, list)
  }
  return out
}
