import { Prisma } from '@prisma/client'
import type { CheckoutCart } from '@/lib/validators/checkout'
import { cartInput } from '@/lib/validators/checkout'
import { detectSeason } from '@/lib/utils/season'
import { withBookingCode } from '@/lib/utils/bookingCode'
import { prepareBooking, writeBooking } from '@/lib/booking/create'
import { issueInvoice } from '@/lib/invoice/issue'
import { isDeletedAccount } from '@/lib/customers/query'
import { retrySerializable } from '@/lib/booking/serializable'
import { hasActiveBankAccount } from '@/lib/invoice/banks'
import { UNPAID_ACTIVE } from '@/lib/booking/expire'

/**
 * Pesan dari checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5; keranjang §10.7 — satu produk = keranjang satu entri) — satu-satunya jalur `POST /bookings`.
 * Resolusi + aturan visa di luar transaksi, lalu kuota + item + snapshot + invoice di dalam — mesin yang SAMA dengan penerbitan draf admin (lib/booking/create.ts).
 * Tanggal acuan & musim DITURUNKAN dari item (D1), bukan dari klien. Invoice terbit LANGSUNG bersama booking (K6-c); data jamaah diisi sesudahnya (D3).
 * Galat dilempar apa adanya (aturan visa, item tak dapat dijual, kuota, InvoiceError) — dipetakan oleh route.
 */
/** Akun pemesan terhapus (UU PDP) atau nonaktif di antara cek sesi dan commit — dipetakan route ke 409. */
export class CheckoutAccountError extends Error {}
/** Belum ada rekening aktif: invoice yang terbit tak punya tujuan transfer, jadi pesanan pelanggan ditolak (evaluasi 2026-11-14 K3) — route → 409. */
export class CheckoutNoBankError extends Error { override name = 'CheckoutNoBankError' }
/** SEC-221: akun sudah memiliki `MAX_UNPAID_CHECKOUTS` pesanan hidup tanpa pembayaran/bukti — pesanan lama dibatalkan dulu. Route → 409. */
export class CheckoutUnpaidLimitError extends Error { override name = 'CheckoutUnpaidLimitError' }

/** SEC-221 (pemilik 2026-11-15): maksimal pesanan hidup yang BELUM ada pembayaran/bukti per akun. Pesanan yang sudah berbukti/berbayar tak dihitung. */
export const MAX_UNPAID_CHECKOUTS = 5

export async function placeCheckout(userId: string, cart: CheckoutCart, dueDays: number): Promise<{ id: string; bookingCode: string }> {
  const prepared = await prepareBooking(cartInput(cart))
  return retrySerializable(() => withBookingCode(async (tx, bookingCode) => {
    // Akun dibaca ulang di dalam kunci barisnya, setara `publishDraft`: akun yang dihapus (UU PDP) atau dinonaktifkan sesudah sesi diperiksa
    // tak boleh menerima booking terbit. Penghapusan akun mengunci baris pengguna yang sama (lib/account/deletion.ts), jadi keduanya terserialkan.
    const owner = await tx.$queryRaw<Array<{ email: string; isActive: boolean }>>( // Prisma ORM tak punya SELECT … FOR SHARE
      Prisma.sql`SELECT "email", "isActive" FROM "users" WHERE "id" = ${userId} FOR SHARE`,
    )
    if (!owner[0] || isDeletedAccount(owner[0].email) || !owner[0].isActive) throw new CheckoutAccountError('Akun tidak aktif')
    // Diperiksa di dalam transaksi yang sama dengan penerbitan invoice (rekening dibekukan di sana): rekening yang dinonaktifkan sebelum commit ikut terlihat.
    if (!(await hasActiveBankAccount(tx))) throw new CheckoutNoBankError('Belum ada rekening aktif')
    // SEC-221: batas pesanan belum dibayar per akun, dihitung di dalam transaksi (pembuat booking diserialkan `withBookingCode`), jadi permintaan serentak tak bisa melewatinya.
    const unpaid = await tx.booking.count({ where: { userId, ...UNPAID_ACTIVE } })
    if (unpaid >= MAX_UNPAID_CHECKOUTS) throw new CheckoutUnpaidLimitError('Terlalu banyak pesanan belum dibayar')
    const bk = await tx.booking.create({
      data: { bookingCode, userId, status: 'active', season: 'regular', totalAmount: 0 },
    })
    await writeBooking(tx, prepared, bk.id)
    const dated = await tx.booking.findUniqueOrThrow({ where: { id: bk.id }, select: { departureDate: true } })
    if (dated.departureDate) await tx.booking.update({ where: { id: bk.id }, data: { season: await detectSeason(dated.departureDate, tx) } })
    await issueInvoice(tx, bk.id, { dueDays, byUserId: null })
    return tx.booking.findUniqueOrThrow({ where: { id: bk.id }, select: { id: true, bookingCode: true } })
  }, { isolationLevel: 'Serializable' }))
}
