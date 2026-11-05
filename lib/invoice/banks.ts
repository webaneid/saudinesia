import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { BankSnapshot } from './issue'

type Db = Pick<Prisma.TransactionClient, 'bankAccount'>

// Rekening tujuan bayar: yang DIBEKUKAN di invoice. Invoice yang terbit saat belum ada rekening membekukan daftar kosong; tanpa cadangan ini
// jamaah tidak akan pernah melihat rekening walau admin sudah menambahkannya. Daftar kosong berarti tak ada yang dibekukan, jadi rekening aktif saat ini dipakai.
export async function payableBanks(snapshot: BankSnapshot[], db: Db = prisma): Promise<BankSnapshot[]> {
  if (snapshot.length > 0) return snapshot
  const live = await db.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 20 })
  return live.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountHolder, branch: b.branch }))
}
