import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { quotaAdapters } from '@/lib/quota/adapters'
import { PaymentAmountError, resolveVerifiedAmount } from './confirmAmount'
import { paymentLimits } from './limits'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { resolveCashTarget, type CashTarget } from '@/lib/cash/accounts'
import { postEntries, splitPaymentCredit } from '@/lib/cash/ledger'

// Konfirmasi / penolakan pembayaran oleh admin (satu-satunya pemroses). Dalam SATU transaksi yang mengunci baris booking, status payment/booking DIBACA ULANG di dalam kunci: konfirmasi/penolakan
// ganda atau paralel (dua admin, dobel klik) tak boleh menimpa jumlah yang sudah final, menjalankan konfirmasi kuota dua kali, menghidupkan booking yang sudah batal, atau membuka penyesuaian total
// pada booking yang pernah dibayar. Hanya payment `pending` pada booking `active` yang dapat diproses.
// Pembayaran bertahap (Fase 7a F3, §10.7 P1–P3): setiap konfirmasi MENAMBAH terbayar; kursi (kuota → booked, `confirmedAt`) dikonfirmasi SEKALI,
// saat terbayar terverifikasi pertama kali mencapai ambang DP (`paymentLimits`, DP 0% = pembayaran pertama berapa pun). Pembayaran sesudahnya hanya menambah terbayar.

// Fase 7b-1: konfirmasi MEMOSTING uang masuk ke buku kas (lib/cash/ledger.ts) di transaksi yang sama — akun kas = pilihan admin (`cashAccount`) atau rekening tujuan bukti.
// Fase 7b-3: `uniqueCode` = transfer ini MEMUAT kode unik invoice (admin menilai dari mutasi). Nilai kode dibaca dari invoice (beku), bukan dari klien;
// `amount` tetap kredit tagihan (diterima − kode), kode diposting `in`/`kode_unik` (pemasukan lain, D9 — bukan kelebihan bayar).
export type ProcessInput = { action: 'confirm' | 'reject'; amount?: number | null; notes?: string | null; cashAccount?: CashTarget | null; uniqueCode?: boolean; byUserId: string }
export type ProcessResult =
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'needs_account' }
  | { kind: 'done'; userId: string; bookingId: string; code: string; seatConfirmed: boolean; balance: number }

export async function processPayment(paymentId: string, input: ProcessInput): Promise<ProcessResult> {
  // Setelan dibaca SEBELUM transaksi (SEC-212: tak boleh menyentuh klien global di dalam callback transaksi).
  const { minimumFirstPaymentPercent } = await getInvoiceSettings()
  return prisma.$transaction(async (tx) => {
    const head = await tx.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } })
    if (!head) return { kind: 'not_found' }
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${head.bookingId} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: head.bookingId }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true, invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true, uniqueCode: true } }, payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } }, refunds: billRefunds } })
    if (payment.status !== 'pending' || booking.status !== 'active') return { kind: 'conflict' }
    let seatConfirmed = false
    let balance = 0

    if (input.action === 'confirm') {
      // Tanpa invoice tak ada tagihan yang pasti (pajak tak diketahui) — jangan menebak 0; sejak Fase 6a setiap booking terbit punya invoice.
      if (!booking.invoice) return { kind: 'conflict' }
      // Patokan = TAGIHAN (subtotal + pajak ditambahkan, lib/invoice/bill.ts) dikurangi yang SUDAH terverifikasi; terbayar dibaca di dalam kunci.
      const before = billOf(booking)
      const verified = resolveVerifiedAmount(before.balance, payment.claimedAmountIdr === null ? null : Number(payment.claimedAmountIdr), { amount: input.amount, notes: input.notes })
      // Akun kas penerima: pilihan admin menang; selain itu rekening yang dipilih pelanggan. Tanpa keduanya (bukti lama / rekening sudah dihapus) admin wajib memilih.
      const cashAccountId = input.cashAccount ? await resolveCashTarget(tx, input.cashAccount, { incoming: true }) : payment.destinationCashAccountId
      if (!cashAccountId) return { kind: 'needs_account' }
      const now = new Date()
      const uniqueCodeIdr = input.uniqueCode ? (booking.invoice.uniqueCode ?? 0) : 0
      // D11 (§2 baris aturan verifikasi): diterima < nominal pelanggan + kode → kode tak "sampai"; seluruh yang diterima mengkredit tagihan. Ditolak, bukan diubah diam-diam.
      if (uniqueCodeIdr > 0 && payment.claimedAmountIdr !== null && Math.round(verified * 100) < Math.round(Number(payment.claimedAmountIdr) * 100)) {
        throw new PaymentAmountError('Diterima kurang dari nominal + kode unik — kode tidak sampai; lepas centang kode unik')
      }
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'confirmed', amount: verified, uniqueCodeIdr, notes: input.notes ?? null, confirmedById: input.byUserId, confirmedAt: now, destinationCashAccountId: cashAccountId } })
      await postEntries(tx, { refType: 'payment', refId: payment.id, direction: 'in', cashAccountId, entryDate: payment.transferredAt ?? now, bookingId: booking.id, createdById: input.byUserId },
        [...splitPaymentCredit({ amount: verified, balanceBefore: before.balance, grandTotal: before.grandTotal, taxAdded: before.taxAdded }), { component: 'kode_unik', amountIdr: uniqueCodeIdr }])
      const after = paymentLimits({ grandTotal: before.grandTotal, paid: before.paid + verified }, minimumFirstPaymentPercent)
      balance = after.balance
      if (booking.confirmedAt === null && after.dpMet) {
        seatConfirmed = true
        await tx.booking.update({ where: { id: booking.id }, data: { confirmedAt: new Date(), confirmedById: input.byUserId } })
        // Loop generik via adapter registry (docs/arsitektur-booking.md §6 Step 1) — tidak mungkin lagi ada tipe yang "terlupa" seperti insiden Muthowif kemarin.
        // Hanya baris yang kuotanya BELUM dikonfirmasi (status per baris), lalu ditandai — konfirmasi ganda tak pernah memindahkan kuota dua kali.
        const pending = <T extends { quotaConfirmed: boolean }>(rows: T[]) => rows.filter(r => !r.quotaConfirmed)
        for (const h of pending(booking.hotels)) { await quotaAdapters.hotel.confirm(tx, h); await tx.bookingHotel.update({ where: { id: h.id }, data: { quotaConfirmed: true } }) }
        for (const t of pending(booking.transports)) { await quotaAdapters.transport.confirm(tx, t); await tx.bookingTransport.update({ where: { id: t.id }, data: { quotaConfirmed: true } }) }
        for (const tp of pending(booking.tourPackages)) { await quotaAdapters.tourPackage.confirm(tx, tp); await tx.bookingTourPackage.update({ where: { id: tp.id }, data: { quotaConfirmed: true } }) }
        for (const bm of pending(booking.muthowif)) { await quotaAdapters.muthowif.confirm(tx, bm); await tx.bookingMuthowif.update({ where: { id: bm.id }, data: { quotaConfirmed: true } }) }
        for (const bh of pending(booking.haji)) { await quotaAdapters.haji.confirm(tx, bh); await tx.bookingHaji.update({ where: { id: bh.id }, data: { quotaConfirmed: true } }) }
        for (const bf of pending(booking.flights)) { await quotaAdapters.flight.confirm(tx, bf); await tx.bookingFlight.update({ where: { id: bf.id }, data: { quotaConfirmed: true } }) }
        for (const bp of pending(booking.packages)) { await quotaAdapters.package.confirm(tx, bp); await tx.bookingPackage.update({ where: { id: bp.id }, data: { quotaConfirmed: true } }) }
      }
    } else {
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'rejected', notes: input.notes ?? null } })
      // Status tampilan kembali "menunggu pembayaran" dengan sendirinya (turunan: tak ada lagi payment `pending`) — tak ada kolom yang diubah di booking.
    }
    return { kind: 'done', userId: booking.userId, bookingId: booking.id, code: booking.bookingCode, seatConfirmed, balance }
  })
}
