import { Prisma } from '@prisma/client'
import { addDays, dbDateOf, todayInApp } from '@/lib/time'
import { formatAddressLine } from '@/lib/address/format'
import { paymentDeadlineFor } from '@/lib/booking/lifecycle'
import { allocateInvoiceNumber } from './numbering'
import { computeTax, type TaxRuleInput, type TaxResult } from './tax'
import { SETTINGS_ID } from './settings'

// Penerbitan invoice (docs/arsitektur-booking-engine-v2.md §10.4 Fase 6a) — SATU-SATUNYA penulis tabel `invoices`. Dipanggil di transaksi yang SAMA dengan penerbitan booking
// (terbit draf admin, `POST /bookings` jamaah): rollback membatalkan nomor (tanpa lompat), pajak, dan jatuh tempo bersama-sama.

type Tx = Prisma.TransactionClient

export type CompanySnapshot = { name: string | null; taxId: string | null; address: string | null; phone: string | null; email: string | null; website: string | null }
export type BankSnapshot = { bankName: string; accountNumber: string; accountHolder: string; branch: string | null }

export class InvoiceError extends Error {
  constructor(message: string) { super(message); this.name = 'InvoiceError' }
}

/** Aturan pajak yang berlaku (aktif, bertarif > 0), urut tampil. */
export async function activeTaxRules(db: Pick<Tx, 'taxRule'>): Promise<TaxRuleInput[]> {
  const rows = await db.taxRule.findMany({ where: { isActive: true, ratePercent: { gt: 0 } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  return rows.map(r => ({ name: r.name, ratePercent: Number(r.ratePercent), basisPercent: Number(r.basisPercent), mode: r.mode }))
}

/** Pajak untuk subtotal tertentu dengan aturan terkini — pratinjau draf memakai ini tanpa menerbitkan apa pun. */
export async function taxFor(db: Pick<Tx, 'taxRule'>, subtotalIdr: number): Promise<TaxResult> {
  return computeTax(subtotalIdr, await activeTaxRules(db))
}

/**
 * Terbitkan invoice untuk booking yang baru terbit. `dueDays` = hari sejak tanggal invoice (saran, D4). Menulis juga `Booking.paymentDeadline` (akhir hari jatuh tempo, dipakai
 * pengingat sampai Fase 7) — kolom itu kini HANYA ditulis di sini. Booking yang sudah punya invoice → galat (satu booking = satu invoice, D18).
 */
export async function issueInvoice(tx: Tx, bookingId: string, opts: { dueDays: number; byUserId: string | null; now?: Date }): Promise<{ id: string; number: string }> {
  const now = opts.now ?? new Date()
  if (!Number.isInteger(opts.dueDays) || opts.dueDays < 0 || opts.dueDays > 365) throw new InvoiceError('Jatuh tempo harus 0–365 hari')
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, totalAmount: true, invoice: { select: { id: true } } } })
  if (booking.status === 'draft') throw new InvoiceError('Draf belum terbit — invoice diterbitkan saat booking terbit')
  if (booking.invoice) throw new InvoiceError('Booking ini sudah punya invoice')

  const s = await tx.invoiceSettings.findUniqueOrThrow({
    where: { id: SETTINGS_ID },
    include: { companyAddress: { include: { province: true, regency: true, district: true, village: true } } },
  })
  const tax = await taxFor(tx, Number(booking.totalAmount))
  const banks = await tx.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  const company: CompanySnapshot = {
    name: s.companyName, taxId: s.companyTaxId, address: formatAddressLine(s.companyAddress) || null, phone: s.companyPhone, email: s.companyEmail, website: s.companyWebsite,
  }
  const bankSnapshot: BankSnapshot[] = banks.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountHolder, branch: b.branch }))

  const { number, seq, key } = await allocateInvoiceNumber(tx, now)
  const invoiceDate = todayInApp(now)
  const inv = await tx.invoice.create({
    data: {
      bookingId, number, sequenceKey: key, sequence: seq, issuedAt: now,
      invoiceDate: dbDateOf(invoiceDate), dueDate: dbDateOf(addDays(invoiceDate, opts.dueDays)),
      taxLines: tax.lines as Prisma.InputJsonValue, taxAddedIdr: tax.addedIdr, taxIncludedIdr: tax.includedIdr,
      companySnapshot: company as Prisma.InputJsonValue, bankSnapshot: bankSnapshot as Prisma.InputJsonValue,
      termsDoc: s.termsDoc, footerNoteDoc: s.footerNoteDoc, issuedById: opts.byUserId,
    },
    select: { id: true, number: true },
  }).catch((e: unknown) => {
    // Nomor hasil pola baru sama dengan nomor lama (mis. awalan/lebar diubah) → setiap penerbitan akan menabrak nomor yang sama: galat jelas, bukan 500 diam.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && JSON.stringify(e.meta?.target ?? '').includes('number')) {
      console.error(`[invoice] nomor ${number} sudah dipakai — periksa pola nomor di Pengaturan Invoice`)
      throw new InvoiceError('Nomor invoice berikutnya bentrok dengan nomor lama — periksa pola nomor di Pengaturan Invoice')
    }
    throw e
  })
  await tx.booking.update({ where: { id: bookingId }, data: { paymentDeadline: paymentDeadlineFor(now, opts.dueDays) } })
  return inv
}

/** Aturan pajak yang DIBEKUKAN di invoice (tarif, dasar, mode) — dipakai menghitung ulang jumlahnya bila subtotal berubah. */
export const frozenTaxRules = (lines: unknown): TaxRuleInput[] =>
  (Array.isArray(lines) ? lines : []).map(l => {
    const x = l as TaxRuleInput
    return { name: x.name, ratePercent: Number(x.ratePercent), basisPercent: Number(x.basisPercent), mode: x.mode }
  })

/**
 * Subtotal booking berubah (penyesuaian/diskon total) → JUMLAH pajak dihitung ulang dengan aturan BEKU invoice (bukan aturan terkini): tarif yang berlaku saat terbit
 * tetap dipakai, tetapi dasarnya mengikuti tagihan sekarang. Dipanggil di transaksi yang sama dengan perubahan `Booking.totalAmount`. Booking tanpa invoice → tak ada yang diubah.
 */
export async function retaxInvoice(tx: Tx, bookingId: string): Promise<void> {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { totalAmount: true, invoice: { select: { id: true, taxLines: true } } } })
  if (!b.invoice) return
  const tax = computeTax(Number(b.totalAmount), frozenTaxRules(b.invoice.taxLines))
  await tx.invoice.update({ where: { id: b.invoice.id }, data: { taxLines: tax.lines as Prisma.InputJsonValue, taxAddedIdr: tax.addedIdr, taxIncludedIdr: tax.includedIdr } })
}

