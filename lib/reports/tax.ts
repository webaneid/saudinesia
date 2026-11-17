import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { periodBounds } from '@/lib/reports/profit'
import { paginate, type ListParams, type PageMeta } from '@/lib/table/pagination'

// Laporan PPN (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12c, K12-3). Baca saja.
// - DITAGIHKAN: invoice yang TERBIT dalam periode (`invoices.issuedAt`, batas hari zona aplikasi) — PPN ditambahkan + PPN di dalam harga, nilai invoice TERKINI
//   (revisi/penyesuaian sudah menghitung ulang pajaknya, `retaxInvoice`). Booking batal/hangus dipisah, tak masuk total.
// - DITERIMA: uang yang MASUK dalam periode menurut buku kas (`cash_entries`, penulis lib/cash/ledger.ts): entri `ppn` (PPN ditambahkan) + bagian PPN di dalam
//   harga yang dihitung PROPORSIONAL dari entri `pokok` (pokok × PPN termasuk ÷ subtotal — buku kas tak memecahnya), dikurangi bagian PPN refund yang dibayar
//   dalam periode (refund × seluruh PPN ÷ tagihan). Komposisi = invoice terkini; refund yang sebenarnya mengembalikan kelebihan bayar ikut dihitung proporsional
//   (perkiraan, dijelaskan di halaman). Angka resmi pajak tetap urusan akuntan (K4).

export type TaxBucket = { count: number; addedIdr: number; includedIdr: number; totalIdr: number }
export type TaxReceived = { addedIdr: number; includedIdr: number; grossIdr: number; refundIdr: number; netIdr: number }
export type TaxInvoiceRow = {
  bookingId: string; bookingCode: string; invoiceNumber: string; issuedAt: Date; status: BookingStatus
  subtotalIdr: number; addedIdr: number; includedIdr: number; receivedIdr: number
}
export type TaxSummary = { from: string; to: string; billed: TaxBucket; billedVoid: TaxBucket; received: TaxReceived }

const VOID: BookingStatus[] = ['cancelled', 'expired']
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100)
const idr = (c: number) => c / 100

/** PPN diterima per booking (sen) dari entri buku kas yang cocok `entryDate`. Satu groupBy + satu baca invoice — tanpa N+1. */
async function receivedByBooking(where: { entryDate: { gte?: Date; lt: Date }; bookingId?: { in: string[] } }): Promise<Map<string, { added: number; included: number; refund: number }>> {
  const groups = await prisma.cashEntry.groupBy({
    by: ['bookingId', 'component', 'direction'],
    where: { ...where, bookingId: where.bookingId ?? { not: null }, component: { in: ['ppn', 'pokok', 'refund'] } },
    _sum: { amountIdr: true },
  })
  const ids = [...new Set(groups.map(g => g.bookingId).filter((v): v is string => !!v))]
  if (ids.length === 0) return new Map()
  const books = await prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true, totalAmount: true, invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } } } })
  const comp = new Map(books.map(b => [b.id, { subtotal: cents(b.totalAmount), added: cents(b.invoice?.taxAddedIdr), included: cents(b.invoice?.taxIncludedIdr) }]))
  const sums = new Map(groups.map(g => [`${g.bookingId}|${g.component}|${g.direction}`, cents(g._sum.amountIdr)])) // satu Map — bukan find per booking (O(n²))
  const out = new Map<string, { added: number; included: number; refund: number }>()
  for (const id of ids) {
    const sum = (component: 'ppn' | 'pokok' | 'refund', direction: 'in' | 'out') => sums.get(`${id}|${component}|${direction}`) ?? 0
    const c = comp.get(id) ?? { subtotal: 0, added: 0, included: 0 }
    const grand = c.subtotal + c.added
    out.set(id, {
      added: sum('ppn', 'in'),
      included: c.subtotal > 0 ? Math.round(sum('pokok', 'in') * c.included / c.subtotal) : 0,
      refund: grand > 0 ? Math.round(sum('refund', 'out') * (c.added + c.included) / grand) : 0,
    })
  }
  return out
}

export async function taxSummary(from: string, to: string): Promise<TaxSummary> {
  const { fromTs, toTs } = periodBounds(from, to)
  const issued = { issuedAt: { gte: fromTs, lt: toTs } }
  const [live, dead, received] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...issued, booking: { status: { notIn: VOID } } }, _count: true, _sum: { taxAddedIdr: true, taxIncludedIdr: true } }),
    prisma.invoice.aggregate({ where: { ...issued, booking: { status: { in: VOID } } }, _count: true, _sum: { taxAddedIdr: true, taxIncludedIdr: true } }),
    receivedByBooking({ entryDate: { gte: fromTs, lt: toTs } }),
  ])
  const bucket = (a: typeof live): TaxBucket => {
    const added = cents(a._sum.taxAddedIdr), included = cents(a._sum.taxIncludedIdr)
    return { count: a._count, addedIdr: idr(added), includedIdr: idr(included), totalIdr: idr(added + included) }
  }
  let added = 0, included = 0, refund = 0
  for (const r of received.values()) { added += r.added; included += r.included; refund += r.refund }
  return { from, to, billed: bucket(live), billedVoid: bucket(dead), received: { addedIdr: idr(added), includedIdr: idr(included), grossIdr: idr(added + included), refundIdr: idr(refund), netIdr: idr(added + included - refund) } }
}

/** Invoice terbit dalam periode (terbaru dulu) + PPN diterima bersih s.d. AKHIR periode (rekonsiliasi tagih vs terima). `params` = halaman; ekspor memakai limit besar. */
export async function taxInvoices(from: string, to: string, params: ListParams): Promise<{ items: TaxInvoiceRow[]; meta: PageMeta }> {
  const { fromTs, toTs } = periodBounds(from, to)
  const where = { issuedAt: { gte: fromTs, lt: toTs } }
  const page = await paginate(params, () => prisma.invoice.count({ where }), ({ skip, take }) => prisma.invoice.findMany({
    where, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip, take,
    select: { number: true, issuedAt: true, taxAddedIdr: true, taxIncludedIdr: true, booking: { select: { id: true, bookingCode: true, status: true, totalAmount: true } } },
  }))
  const got = page.items.length ? await receivedByBooking({ entryDate: { lt: toTs }, bookingId: { in: page.items.map(i => i.booking.id) } }) : new Map()
  return {
    meta: page.meta,
    items: page.items.map(i => {
      const r = got.get(i.booking.id)
      return {
        bookingId: i.booking.id, bookingCode: i.booking.bookingCode, invoiceNumber: i.number, issuedAt: i.issuedAt, status: i.booking.status,
        subtotalIdr: Number(i.booking.totalAmount), addedIdr: Number(i.taxAddedIdr), includedIdr: Number(i.taxIncludedIdr),
        receivedIdr: r ? idr(r.added + r.included - r.refund) : 0,
      }
    }),
  }
}
