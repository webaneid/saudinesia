import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isRecordNotFound } from '@/lib/admin/errors'
import type { ProviderBankAccountInput } from '@/lib/validators/revenueShare'
import { auditView, changedFields, maskAccountNumber, writeAudit } from '@/lib/invoice/audit'

// Rekening penerimaan Platform Provider (Fase 13e-1, docs/arsitektur-bagi-hasil.md §5e) — SATU-SATUNYA penulis `platform_provider_bank_accounts`.
// Ditulis hanya oleh akun Platform Provider (dijaga route lewat `requirePlatformProvider`). Hapus aman: dipakai pencairan → dinonaktifkan (rekening beku di pencairan).
// Setiap perubahan menulis jejak append-only `settings_audit` (entitas `platform_provider_account`, nomor disamarkan) di transaksi yang sama (SEC-292):
// rekening ini mengarahkan uang keluar perusahaan. Jejak hanya di DB (tak ditampilkan ke klien), jadi identitas akun Platform Provider tak bocor.

export type ProviderBankAccount = { id: string; bankName: string; accountNumber: string; accountHolder: string; isActive: boolean; payoutCount: number; updatedAt: string }

const SELECT = { id: true, bankName: true, accountNumber: true, accountHolder: true, isActive: true, updatedAt: true, _count: { select: { payouts: true } } } as const
const view = (r: { id: string; bankName: string; accountNumber: string; accountHolder: string; isActive: boolean; updatedAt: Date; _count: { payouts: number } }): ProviderBankAccount =>
  ({ id: r.id, bankName: r.bankName, accountNumber: r.accountNumber, accountHolder: r.accountHolder, isActive: r.isActive, payoutCount: r._count.payouts, updatedAt: r.updatedAt.toISOString() })
const fields = (a: { bankName: string; accountNumber: string; accountHolder: string; isActive: boolean }) => ({ bankName: a.bankName, accountNumber: a.accountNumber, accountHolder: a.accountHolder, isActive: a.isActive })
const masked = (f: Record<string, unknown>) => ('accountNumber' in f && Array.isArray(f.accountNumber) ? { ...f, accountNumber: f.accountNumber.map(v => maskAccountNumber(String(v))) } : f)

export class ProviderAccountError extends Error {
  constructor(public readonly status: 404 | 409, message: string) { super(message); this.name = 'ProviderAccountError' }
}
const duplicate = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'

/** Daftar rekening (master data kecil: maks. 100). `activeOnly` untuk pilihan tujuan pencairan. */
export async function listProviderAccounts(opts: { activeOnly?: boolean } = {}): Promise<ProviderBankAccount[]> {
  const rows = await prisma.platformProviderBankAccount.findMany({ where: opts.activeOnly ? { isActive: true } : {}, orderBy: [{ isActive: 'desc' }, { bankName: 'asc' }, { id: 'asc' }], take: 100, select: SELECT })
  return rows.map(view)
}

export async function getProviderAccount(id: string): Promise<ProviderBankAccount | null> {
  const r = await prisma.platformProviderBankAccount.findUnique({ where: { id }, select: SELECT })
  return r ? view(r) : null
}

export async function createProviderAccount(input: ProviderBankAccountInput, staffId: string): Promise<ProviderBankAccount> {
  try {
    return await prisma.$transaction(async tx => {
      const row = await tx.platformProviderBankAccount.create({ data: { bankName: input.bankName, accountNumber: input.accountNumber, accountHolder: input.accountHolder, isActive: input.isActive ?? true }, select: SELECT })
      await writeAudit(tx, staffId, 'platform_provider_account', row.id, 'create', auditView('platform_provider_account', fields(row)))
      return view(row)
    })
  } catch (e) {
    if (duplicate(e)) throw new ProviderAccountError(409, 'Rekening dengan bank dan nomor ini sudah ada')
    throw e
  }
}

/** Ubah rekening. Rekening yang SUDAH dipakai pencairan tetap boleh diubah — pencairan menyimpan salinan beku tujuan saat dibayar, dan pencatat
 *  pencairan mengirim versi rekening yang dilihatnya (berubah → 409). Baris dikunci FOR UPDATE: pencatatan yang sedang memegang FOR SHARE selesai dulu. */
export async function updateProviderAccount(id: string, input: Partial<ProviderBankAccountInput>, staffId: string): Promise<ProviderBankAccount> {
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "platform_provider_bank_accounts" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
      const before = await tx.platformProviderBankAccount.findUnique({ where: { id }, select: SELECT })
      if (!before) throw new ProviderAccountError(404, 'Rekening tidak ditemukan')
      const row = await tx.platformProviderBankAccount.update({ where: { id }, data: input, select: SELECT })
      const diff = changedFields(fields(before), fields(row))
      if (Object.keys(diff).length > 0) {
        const action = Object.keys(diff).length === 1 && 'isActive' in diff ? 'toggle' : 'update'
        await writeAudit(tx, staffId, 'platform_provider_account', id, action, masked(diff) as Prisma.InputJsonValue)
      }
      return view(row)
    })
  } catch (e) {
    if (isRecordNotFound(e)) throw new ProviderAccountError(404, 'Rekening tidak ditemukan')
    if (duplicate(e)) throw new ProviderAccountError(409, 'Rekening dengan bank dan nomor ini sudah ada')
    throw e
  }
}

/** Hapus aman: belum pernah dipakai pencairan → hapus sungguhan; selain itu dinonaktifkan (FK Restrict menjaga riwayat). */
export async function removeProviderAccount(id: string, staffId: string): Promise<{ deleted: boolean; message?: string }> {
  return prisma.$transaction(async tx => {
    // Kunci baris: pencatatan pencairan memegang FOR SHARE atas rekening yang sama → hapus tak pernah balapan dengan rujukan baru (FK Restrict → 500).
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "platform_provider_bank_accounts" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    const r = await tx.platformProviderBankAccount.findUnique({ where: { id }, select: SELECT })
    if (!r) throw new ProviderAccountError(404, 'Rekening tidak ditemukan')
    if (r._count.payouts > 0) {
      await tx.platformProviderBankAccount.update({ where: { id }, data: { isActive: false } })
      if (r.isActive) await writeAudit(tx, staffId, 'platform_provider_account', id, 'toggle', { isActive: [true, false] })
      return { deleted: false, message: 'Rekening sudah dipakai pencairan — dinonaktifkan (riwayat pencairan tetap utuh). Aktifkan kembali lewat saklar status.' }
    }
    await tx.platformProviderBankAccount.delete({ where: { id } })
    await writeAudit(tx, staffId, 'platform_provider_account', id, 'delete', auditView('platform_provider_account', fields(r)))
    return { deleted: true }
  })
}
