import type { CashComponent, CashDirection, Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

// Buku kas (docs/arsitektur-booking-engine-v2.md §3.5, §10.10 Fase 7b-1) — SATU-SATUNYA penulis `cash_entries`. Append-only (trigger DB): tidak ada UPDATE/DELETE,
// koreksi = entri pembalik. Posting idempoten lewat UNIQUE (refType, refId, component): memosting ulang sumber yang sama melempar P2002, bukan menggandakan uang.
// Dipanggil HANYA di dalam transaksi pemilik sumbernya (verifikasi pembayaran, refund dibayar, pengeluaran vendor), sesudah baris sumber dikunci.

export type CashRefType = 'payment' | 'refund' | 'cost_actual' | 'transfer_out' | 'transfer_in' | 'revenue_share_payout' // transfer: dua sumber per baris cash_transfers (UNIQUE refType+refId+komponen); pencairan bagi hasil (13e-1)
export type CashLine = { component: CashComponent; amountIdr: number }

const cents = (n: number) => Math.round(n * 100)

/** Pecah kredit pembayaran menjadi pokok + PPN mengikuti komposisi tagihan (PPN ditambahkan ÷ tagihan), dan bagian di atas sisa tagihan menjadi `kelebihan`. Sen dihitung bulat; sisa pembulatan ke pokok. */
export function splitPaymentCredit(input: { amount: number; balanceBefore: number; grandTotal: number; taxAdded: number }): CashLine[] {
  const total = cents(input.amount)
  const credit = Math.min(total, Math.max(cents(input.balanceBefore), 0))
  const excess = total - credit
  const grand = cents(input.grandTotal)
  const ppn = grand > 0 ? Math.round(credit * cents(input.taxAdded) / grand) : 0
  return ([['pokok', credit - ppn], ['ppn', ppn], ['kelebihan', excess]] as const)
    .filter(([, v]) => v > 0)
    .map(([component, v]) => ({ component, amountIdr: v / 100 }))
}

export async function postEntries(tx: Tx, src: { refType: CashRefType; refId: string; direction: CashDirection; cashAccountId: string; entryDate: Date; bookingId: string | null; createdById: string | null }, lines: CashLine[]): Promise<number> {
  const rows = lines.filter(l => cents(l.amountIdr) > 0)
  if (rows.length === 0) return 0
  await tx.cashEntry.createMany({
    data: rows.map(l => ({ entryDate: src.entryDate, direction: src.direction, amountIdr: l.amountIdr, component: l.component, cashAccountId: src.cashAccountId, refType: src.refType, refId: src.refId, bookingId: src.bookingId, createdById: src.createdById })),
  })
  return rows.length
}

/** Membalik SEMUA entri sebuah sumber (mis. pengeluaran vendor dibatalkan): satu entri `koreksi` berlawanan arah per entri asal. Idempoten (reversesEntryId unik). */
export async function reverseEntries(tx: Tx, src: { refType: CashRefType; refId: string }, by: { createdById: string | null; entryDate: Date }): Promise<number> {
  const originals = await tx.cashEntry.findMany({ where: { refType: src.refType, refId: src.refId, reversedBy: null }, orderBy: { id: 'asc' } })
  for (const e of originals) {
    await tx.cashEntry.create({ data: { entryDate: by.entryDate, direction: e.direction === 'in' ? 'out' : 'in', amountIdr: e.amountIdr, component: 'koreksi', cashAccountId: e.cashAccountId, refType: 'reversal', refId: e.id, bookingId: e.bookingId, reversesEntryId: e.id, createdById: by.createdById } })
  }
  return originals.length
}
