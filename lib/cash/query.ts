import type { CashComponent, CashDirection, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { periodBounds } from '@/lib/reports/profit'

// Pembaca buku kas untuk staf (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1). Baca saja — penulis hanya lib/cash/ledger.ts. Periode = hari kalender zona aplikasi
// (`periodBounds`: awal hari WIB s.d. awal hari sesudah `to`); kolom `entryDate` bertipe timestamptz, jadi batas boleh diikat sebagai `Date`.

export type CashBookFilter = { from: string; to: string; account?: string; direction?: CashDirection; component?: CashComponent }
export type CashBookRow = { id: string; entryDate: string; direction: CashDirection; component: CashComponent; amountIdr: number; account: string; bookingId: string | null; bookingCode: string | null; refType: string }
export type CashAccountSummary = { id: string; name: string; inIdr: number; outIdr: number; balanceIdr: number }

function where(f: CashBookFilter): Prisma.CashEntryWhereInput {
  const { fromTs, toTs } = periodBounds(f.from, f.to)
  return { entryDate: { gte: fromTs, lt: toTs }, ...(f.account ? { cashAccountId: f.account } : {}), ...(f.direction ? { direction: f.direction } : {}), ...(f.component ? { component: f.component } : {}) }
}

const accountName = (a: { name: string; bankAccount: { bankName: string; accountNumber: string } | null }) => a.bankAccount ? `${a.bankAccount.bankName} ${a.bankAccount.accountNumber}` : a.name

export async function cashAccountsList(): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.cashAccount.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, bankAccount: { select: { bankName: true, accountNumber: true } } } })
  return rows.map(a => ({ id: a.id, name: accountName(a) }))
}

export async function cashBookEntries(f: CashBookFilter, page: number, limit: number): Promise<{ rows: CashBookRow[]; total: number }> {
  const w = where(f)
  const [total, entries] = await Promise.all([
    prisma.cashEntry.count({ where: w }),
    prisma.cashEntry.findMany({ where: w, orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, include: { cashAccount: { select: { name: true, bankAccount: { select: { bankName: true, accountNumber: true } } } } } }),
  ])
  const ids = [...new Set(entries.map(e => e.bookingId).filter((x): x is string => !!x))]
  const codes = new Map((await prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true, bookingCode: true } })).map(b => [b.id, b.bookingCode]))
  return {
    total,
    rows: entries.map(e => ({ id: e.id, entryDate: e.entryDate.toISOString(), direction: e.direction, component: e.component, amountIdr: Number(e.amountIdr), account: accountName(e.cashAccount), bookingId: e.bookingId, bookingCode: e.bookingId ? codes.get(e.bookingId) ?? null : null, refType: e.refType })),
  }
}

/** Ringkasan per akun: masuk/keluar DALAM periode (mengikuti filter arah/komponen) dan saldo SEPANJANG WAKTU (semua entri). */
export async function cashBookSummary(f: CashBookFilter): Promise<{ accounts: CashAccountSummary[]; inIdr: number; outIdr: number }> {
  const [period, all, accounts] = await Promise.all([
    prisma.cashEntry.groupBy({ by: ['cashAccountId', 'direction'], where: where(f), _sum: { amountIdr: true } }),
    prisma.cashEntry.groupBy({ by: ['cashAccountId', 'direction'], ...(f.account ? { where: { cashAccountId: f.account } } : {}), _sum: { amountIdr: true } }),
    cashAccountsList(),
  ])
  const sum = (rows: typeof period, id: string, d: CashDirection) => Number(rows.find(r => r.cashAccountId === id && r.direction === d)?._sum.amountIdr ?? 0)
  const list = accounts.filter(a => !f.account || a.id === f.account).map(a => ({ id: a.id, name: a.name, inIdr: sum(period, a.id, 'in'), outIdr: sum(period, a.id, 'out'), balanceIdr: Math.round((sum(all, a.id, 'in') - sum(all, a.id, 'out')) * 100) / 100 }))
  return { accounts: list, inIdr: list.reduce((s, a) => s + a.inIdr, 0), outIdr: list.reduce((s, a) => s + a.outIdr, 0) }
}
