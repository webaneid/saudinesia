import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getPaymentConfig } from '@/lib/constants/payment'
import type { BankSnapshot } from './issue'

type Db = Pick<Prisma.TransactionClient, 'bankAccount'>

// Rekening tujuan bayar: yang DIBEKUKAN di invoice. Invoice yang terbit saat belum ada rekening membekukan daftar kosong; tanpa cadangan ini
// jamaah tidak akan pernah melihat rekening walau admin sudah menambahkannya. Daftar kosong berarti tak ada yang dibekukan, jadi rekening aktif saat ini dipakai.
export async function payableBanks(snapshot: BankSnapshot[], db: Db = prisma): Promise<BankSnapshot[]> {
  if (snapshot.length > 0) return snapshot
  const live = await db.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 20 })
  return live.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountHolder, branch: b.branch }))
}

/**
 * Rekening tujuan bayar SATU booking (halaman jamaah dan route unggah bukti memakai fungsi yang sama): yang dibekukan di invoice dengan cadangan
 * rekening aktif; booking lama tanpa invoice memakai rekening env lama. Daftar kosong = pelanggan tak punya tujuan transfer (evaluasi 2026-11-14 K3).
 */
export async function bookingPayTo(invoice: { bankSnapshot: unknown } | null, db: Db = prisma): Promise<BankSnapshot[]> {
  if (invoice) return payableBanks(invoice.bankSnapshot as BankSnapshot[], db)
  return getPaymentConfig().banks.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountName, branch: null }))
}

/** Ada rekening aktif untuk pesanan BARU — checkout dan keranjang pelanggan ditolak tanpa ini (K3). Draf admin hanya diingatkan. */
export async function hasActiveBankAccount(db: Db = prisma): Promise<boolean> {
  return (await db.bankAccount.count({ where: { isActive: true } })) > 0
}
