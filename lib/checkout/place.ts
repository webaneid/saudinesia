import { Prisma } from '@prisma/client'
import type { CheckoutInput } from '@/lib/validators/checkout'
import { checkoutInput } from '@/lib/validators/checkout'
import { detectSeason } from '@/lib/utils/season'
import { withBookingCode } from '@/lib/utils/bookingCode'
import { prepareBooking, writeBooking } from '@/lib/booking/create'
import { issueInvoice } from '@/lib/invoice/issue'
import { isDeletedAccount } from '@/lib/customers/query'
import { retrySerializable } from '@/lib/booking/serializable'

/**
 * Pesan dari checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5) — satu-satunya jalur `POST /bookings`.
 * Resolusi + aturan visa di luar transaksi, lalu kuota + item + snapshot + invoice di dalam — mesin yang SAMA dengan penerbitan draf admin (lib/booking/create.ts).
 * Tanggal acuan & musim DITURUNKAN dari item (D1), bukan dari klien. Invoice terbit LANGSUNG bersama booking (K6-c); data jamaah diisi sesudahnya (D3).
 * Galat dilempar apa adanya (aturan visa, item tak dapat dijual, kuota, InvoiceError) — dipetakan oleh route.
 */
/** Akun pemesan terhapus (UU PDP) atau nonaktif di antara cek sesi dan commit — dipetakan route ke 409. */
export class CheckoutAccountError extends Error {}

export async function placeCheckout(userId: string, data: CheckoutInput, dueDays: number): Promise<{ id: string; bookingCode: string }> {
  const prepared = await prepareBooking(checkoutInput(data))
  return retrySerializable(() => withBookingCode(async (tx, bookingCode) => {
    // Akun dibaca ulang di dalam kunci barisnya, setara `publishDraft`: akun yang dihapus (UU PDP) atau dinonaktifkan sesudah sesi diperiksa
    // tak boleh menerima booking terbit. Penghapusan akun mengunci baris pengguna yang sama (lib/account/deletion.ts), jadi keduanya terserialkan.
    const owner = await tx.$queryRaw<Array<{ email: string; isActive: boolean }>>( // Prisma ORM tak punya SELECT … FOR SHARE
      Prisma.sql`SELECT "email", "isActive" FROM "users" WHERE "id" = ${userId} FOR SHARE`,
    )
    if (!owner[0] || isDeletedAccount(owner[0].email) || !owner[0].isActive) throw new CheckoutAccountError('Akun tidak aktif')
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
