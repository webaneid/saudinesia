import type { CashComponent, CashDirection } from '@prisma/client'
import { prisma } from '@/lib/db'
import { periodBounds } from '@/lib/reports/profit'
import { cashAccountsList } from '@/lib/cash/query'

// Arus kas & saldo per tanggal (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12a). Baca saja, HANYA dari `cash_entries` (penulis: lib/cash/ledger.ts).
// Periode = hari kalender zona aplikasi (`periodBounds`). Invarian: saldo awal + masuk − keluar = saldo akhir, per akun dan total (dijaga scripts/test-cash-book.ts).

export type FlowFilter = { from: string; to: string; account?: string }
export type AccountFlow = { id: string; name: string; openingIdr: number; inIdr: number; outIdr: number; closingIdr: number }
export type ComponentFlow = { direction: CashDirection; component: CashComponent; amountIdr: number }
export type CashFlow = { from: string; to: string; accounts: AccountFlow[]; components: ComponentFlow[]; openingIdr: number; inIdr: number; outIdr: number; closingIdr: number }

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const idr = (c: number) => c / 100

/** Saldo (sen) per akun dari semua entri SEBELUM `ts` — `ts` = batas hari dari `periodBounds`. */
async function balancesBefore(ts: Date, account?: string): Promise<Map<string, number>> {
  const rows = await prisma.cashEntry.groupBy({ by: ['cashAccountId', 'direction'], where: { entryDate: { lt: ts }, ...(account ? { cashAccountId: account } : {}) }, _sum: { amountIdr: true } })
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.cashAccountId, (m.get(r.cashAccountId) ?? 0) + (r.direction === 'in' ? 1 : -1) * cents(r._sum.amountIdr))
  return m
}

/** Saldo awal (awal hari `from`) dan akhir (akhir hari `to`) per akun, zona aplikasi. Dipakai Buku Kas dan Arus Kas. */
export async function balancesAround(f: FlowFilter): Promise<{ opening: Map<string, number>; closing: Map<string, number> }> {
  const { fromTs, toTs } = periodBounds(f.from, f.to)
  const [opening, closing] = await Promise.all([balancesBefore(fromTs, f.account), balancesBefore(toTs, f.account)])
  return { opening, closing }
}

export async function cashFlow(f: FlowFilter): Promise<CashFlow> {
  const { fromTs, toTs } = periodBounds(f.from, f.to)
  const where = { entryDate: { gte: fromTs, lt: toTs }, ...(f.account ? { cashAccountId: f.account } : {}) }
  const [{ opening, closing }, perAccount, perComponent, accounts] = await Promise.all([
    balancesAround(f),
    prisma.cashEntry.groupBy({ by: ['cashAccountId', 'direction'], where, _sum: { amountIdr: true } }),
    prisma.cashEntry.groupBy({ by: ['direction', 'component'], where, _sum: { amountIdr: true } }),
    cashAccountsList(),
  ])
  const sum = (id: string, d: CashDirection) => cents(perAccount.find(r => r.cashAccountId === id && r.direction === d)?._sum.amountIdr)
  const list = accounts.filter(a => !f.account || a.id === f.account).map(a => {
    const o = opening.get(a.id) ?? 0, i = sum(a.id, 'in'), x = sum(a.id, 'out')
    return { id: a.id, name: a.name, openingIdr: idr(o), inIdr: idr(i), outIdr: idr(x), closingIdr: idr(closing.get(a.id) ?? 0) }
  })
  const components = perComponent
    .map(r => ({ direction: r.direction, component: r.component, amountIdr: idr(cents(r._sum.amountIdr)) }))
    .sort((a, b) => (a.direction === b.direction ? b.amountIdr - a.amountIdr : a.direction === 'in' ? -1 : 1))
  const total = (k: 'openingIdr' | 'inIdr' | 'outIdr' | 'closingIdr') => idr(list.reduce((s, a) => s + Math.round(a[k] * 100), 0))
  return { from: f.from, to: f.to, accounts: list, components, openingIdr: total('openingIdr'), inIdr: total('inIdr'), outIdr: total('outIdr'), closingIdr: total('closingIdr') }
}
