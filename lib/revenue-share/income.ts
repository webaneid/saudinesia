import { Prisma, type BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { addMonths, getAppTimezone, startOfDayInApp } from '@/lib/time'
import { escapeLike } from '@/lib/utils/search'
import { paginate, type ListParams, type PageMeta } from '@/lib/table/pagination'
import { bookingSharePotentials, type ShareRule } from './potential'

// Pendapatan Platform Provider (Fase 13e-2, docs/arsitektur-bagi-hasil.md §5e) — SATU modul baca (tak menulis apa pun) untuk halaman Pendapatan dan CSV-nya.
// Hak = `revenue_share_entries` (bertanda: refund/revisi bisa negatif), dicairkan = pencairan BERLAKU, potensi = `bookingSharePotentials` (rumus yang sama dengan
// `bookingSharePotential`). Rincian bagi hasil = internal: pemanggil wajib superadmin. Tanpa data pribadi (hanya kode booking/invoice).

const cents = (x: number | Prisma.Decimal | null | undefined): number => Math.round(Number(x ?? 0) * 100)
const pad = (n: number) => String(n).padStart(2, '0')

export type MonthRow = { month: string; entitledIdr: number; paidOutIdr: number; balanceEndIdr: number }
export type YearIncome = { year: number; openingIdr: number; months: MonthRow[]; entitledIdr: number; paidOutIdr: number; closingIdr: number }

/** Batas satu bulan kalender di zona aplikasi sebagai instan [awal, akhir). */
export function monthBounds(year: number, month: number, tz: string = getAppTimezone()): { start: Date; end: Date } {
  const first = `${year}-${pad(month)}-01`
  return { start: startOfDayInApp(first, tz), end: startOfDayInApp(addMonths(first, 1), tz) }
}

/**
 * Ringkasan satu tahun per bulan (zona aplikasi): hak masuk menurut `createdAt` entri, dicairkan menurut `paidAt` pencairan yang tidak dibatalkan, saldo akhir
 * bulan kumulatif (saldo awal tahun + Σ hak − Σ dicairkan). SQL mentah karena Prisma ORM tak bisa mengelompokkan per bulan di zona tertentu; zona dikirim sebagai
 * parameter, kolom keduanya `timestamptz` → `AT TIME ZONE` langsung menghasilkan waktu setempat.
 */
export async function monthlyIncome(year: number): Promise<YearIncome> {
  const tz = getAppTimezone()
  const { start } = monthBounds(year, 1, tz)
  const { end } = monthBounds(year, 12, tz)
  // Satu snapshot (RepeatableRead, berurutan di `tx`): entri/pencairan yang masuk di tengah tak membuat saldo awal + hak − dicairkan ≠ saldo akhir (SEC-297).
  const { entriesBefore, payoutsBefore, entryMonths, payoutMonths } = await prisma.$transaction(async tx => ({
    entriesBefore: await tx.revenueShareEntry.aggregate({ where: { createdAt: { lt: start } }, _sum: { amountIdr: true } }),
    payoutsBefore: await tx.revenueSharePayout.aggregate({ where: { voidedAt: null, paidAt: { lt: start } }, _sum: { amountIdr: true } }),
    entryMonths: await tx.$queryRaw<Array<{ m: string; s: Prisma.Decimal }>>(Prisma.sql`
      SELECT to_char("createdAt" AT TIME ZONE ${tz}, 'MM') AS m, SUM("amountIdr") AS s
      FROM "revenue_share_entries" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1`),
    payoutMonths: await tx.$queryRaw<Array<{ m: string; s: Prisma.Decimal }>>(Prisma.sql`
      SELECT to_char("paidAt" AT TIME ZONE ${tz}, 'MM') AS m, SUM("amountIdr") AS s
      FROM "revenue_share_payouts" WHERE "voidedAt" IS NULL AND "paidAt" >= ${start} AND "paidAt" < ${end} GROUP BY 1`),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  const ent = new Map(entryMonths.map(r => [r.m, cents(r.s)]))
  const out = new Map(payoutMonths.map(r => [r.m, cents(r.s)]))
  const opening = cents(entriesBefore._sum.amountIdr) - cents(payoutsBefore._sum.amountIdr)
  let running = opening, totalIn = 0, totalOut = 0
  const months: MonthRow[] = []
  for (let m = 1; m <= 12; m++) {
    const key = pad(m)
    const i = ent.get(key) ?? 0, o = out.get(key) ?? 0
    running += i - o; totalIn += i; totalOut += o
    months.push({ month: `${year}-${key}`, entitledIdr: i / 100, paidOutIdr: o / 100, balanceEndIdr: running / 100 })
  }
  return { year, openingIdr: opening / 100, months, entitledIdr: totalIn / 100, paidOutIdr: totalOut / 100, closingIdr: running / 100 }
}

export const INCOME_STATUSES = ['active', 'completed', 'cancelled', 'expired'] as const satisfies readonly BookingStatus[]
/** Tahun pertama yang punya data bagi hasil (entri hak ATAU pencairan berlaku — pencairan boleh berwaktu bayar sebelum entri pertama); tanpa data → null. */
export async function firstIncomeYear(): Promise<Date | null> {
  const [e, p] = await Promise.all([
    prisma.revenueShareEntry.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.revenueSharePayout.findFirst({ where: { voidedAt: null }, orderBy: { paidAt: 'asc' }, select: { paidAt: true } }),
  ])
  const ts = [e?.createdAt, p?.paidAt].filter((d): d is Date => d instanceof Date)
  return ts.length ? new Date(Math.min(...ts.map(d => d.getTime()))) : null
}

export type IncomeStatus = (typeof INCOME_STATUSES)[number]
export const isIncomeStatus = (v: unknown): v is IncomeStatus => typeof v === 'string' && (INCOME_STATUSES as readonly string[]).includes(v)

export type BookingIncomeRow = {
  bookingId: string; bookingCode: string; invoiceNumber: string; issuedAt: string; status: BookingStatus
  rule: ShareRule | null; potentialIdr: number; entitledIdr: number; entitledPct: number | null; final: boolean
}

/** Booking yang invoicenya membekukan aturan bagi hasil (draf tak punya invoice → tak ikut). */
function incomeWhere(f: { status?: IncomeStatus; q?: string }): Prisma.BookingWhereInput {
  return {
    invoice: { revenueSharePercent: { not: null } },
    ...(f.status ? { status: f.status } : {}),
    ...(f.q ? { bookingCode: { contains: escapeLike(f.q), mode: 'insensitive' } } : {}),
  }
}

/** Potensi vs hak per booking, berhalaman (urut terbit terbaru, tie-breaker id). */
export async function bookingIncome(f: { status?: IncomeStatus; q?: string }, params: ListParams): Promise<{ items: BookingIncomeRow[]; meta: PageMeta }> {
  const where = incomeWhere(f)
  const { items, meta } = await paginate(params, () => prisma.booking.count({ where }),
    range => prisma.booking.findMany({
      where, orderBy: [{ invoice: { issuedAt: 'desc' } }, { id: 'desc' }], ...range,
      select: { id: true, bookingCode: true, status: true, invoice: { select: { number: true, issuedAt: true } } },
    }))
  const ids = items.map(b => b.id)
  const [potentials, sums] = await Promise.all([
    bookingSharePotentials(prisma, ids),
    prisma.revenueShareEntry.groupBy({ by: ['bookingId'], where: { bookingId: { in: ids } }, _sum: { amountIdr: true } }),
  ])
  const entitled = new Map(sums.map(s => [s.bookingId, cents(s._sum.amountIdr)]))
  return {
    meta,
    items: items.map(b => {
      const p = potentials.get(b.id) ?? { rule: null, potentialIdr: 0 }
      const e = entitled.get(b.id) ?? 0
      const pot = cents(p.potentialIdr)
      return {
        bookingId: b.id, bookingCode: b.bookingCode, invoiceNumber: b.invoice?.number ?? '', issuedAt: b.invoice?.issuedAt.toISOString() ?? '', status: b.status,
        rule: p.rule, potentialIdr: pot / 100, entitledIdr: e / 100, entitledPct: pot > 0 ? Math.round((e / pot) * 1000) / 10 : null, final: b.status === 'completed',
      }
    }),
  }
}
