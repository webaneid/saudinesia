import type { Prisma } from '@prisma/client'

/** Dipanggil pembatalan booking (pelanggan/admin) DI DALAM kuncinya: pembayaran online yang menunggu (Fase 9) tak lagi bisa dipakai. Uang yang terlanjur
 *  masuk tetap dicatat oleh sinkronisasi gateway (K9-4) dan dikembalikan lewat refund. */
export async function expireAwaitingPayments(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  await tx.payment.updateMany({ where: { bookingId, status: 'awaiting' }, data: { status: 'expired' } })
}
