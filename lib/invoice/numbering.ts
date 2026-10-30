import type { Prisma } from '@prisma/client'
import { dateInApp } from '@/lib/time'
import { formatInvoiceNumber } from '@/lib/invoice/numberPattern'

type Tx = Prisma.TransactionClient

/**
 * Alokasikan nomor invoice BERIKUTNYA di dalam transaksi penerbitan (docs/arsitektur-booking-engine-v2.md §6): urut TANPA LOMPAT — penghitung dinaikkan di transaksi yang sama,
 * jadi rollback ikut membatalkan kenaikannya; dua penerbitan bersamaan diserialkan oleh kunci baris `INSERT … ON CONFLICT DO UPDATE`. Kunci penghitung = tahun zona aplikasi bila
 * nomor diulang tiap tahun, selain itu 'all'.
 */
export async function allocateInvoiceNumber(tx: Tx, at: Date = new Date()): Promise<{ number: string; seq: number; key: string }> {
  const s = await tx.invoiceSettings.findUniqueOrThrow({ where: { id: 'global' }, select: { numberPrefix: true, numberPattern: true, numberPadding: true, numberResetYearly: true } })
  const today = dateInApp(at) // YYYY-MM-DD zona aplikasi
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const key = s.numberResetYearly ? String(year) : 'all'
  // $queryRaw: Prisma ORM tak punya "naikkan atau buat" atomik dengan nilai kembalian.
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO invoice_sequences ("key", "lastNumber", "updatedAt") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = invoice_sequences."lastNumber" + 1, "updatedAt" = now()
    RETURNING "lastNumber"`
  const seq = rows[0]!.lastNumber
  return { number: formatInvoiceNumber(s.numberPattern, { prefix: s.numberPrefix, year, month, seq, padding: s.numberPadding }), seq, key }
}
