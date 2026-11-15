import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

type Tx = Prisma.TransactionClient

// Akun kas (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1) — SATU-SATUNYA penulis `cash_accounts`. Akun dibuat saat PERTAMA dipakai (bukti diunggah ke rekening itu —
// termasuk bukti yang kemudian ditolak — atau admin memilihnya saat verifikasi), sehingga rekening yang belum pernah dipakai tetap dapat dihapus di Pengaturan Invoice;
// yang sudah dipakai terikat FK Restrict → hanya bisa dinonaktifkan (SEC-238, diterima).

export const CASH_MAIN = 'cash:main'

/** Pilihan akun kas di formulir admin: `bank:<BankAccount.id>` atau `cash`. */
export type CashTarget = { kind: 'bank'; bankAccountId: string } | { kind: 'cash' }

export function parseCashTarget(v: string): CashTarget | null {
  if (v === 'cash') return { kind: 'cash' }
  const m = /^bank:([0-9a-f-]{36})$/.exec(v)
  return m ? { kind: 'bank', bankAccountId: m[1]! } : null
}

/** Akun kas untuk sebuah rekening (dibuat bila belum ada). Rekening harus ada; `requireActive` untuk pilihan baru dari admin. null = rekening tak ada / nonaktif. */
export async function ensureBankCashAccount(tx: Tx, bankAccountId: string, opts: { requireActive?: boolean } = {}): Promise<string | null> {
  const bank = await tx.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, bankName: true, accountNumber: true, isActive: true, cashAccount: { select: { id: true } } } })
  if (!bank || (opts.requireActive && !bank.isActive)) return null
  if (bank.cashAccount) return bank.cashAccount.id
  const row = await tx.cashAccount.upsert({ // upsert: dua transaksi serentak untuk rekening yang sama tak membuat dua akun
    where: { bankAccountId: bank.id },
    create: { kind: 'bank', bankAccountId: bank.id, name: `${bank.bankName} ${bank.accountNumber}`.slice(0, 200) },
    update: {},
    select: { id: true },
  })
  return row.id
}

/** Akun Kas tunai (satu). */
export async function ensureMainCashAccount(tx: Tx): Promise<string> {
  const row = await tx.cashAccount.upsert({ where: { systemKey: CASH_MAIN }, create: { kind: 'cash', systemKey: CASH_MAIN, name: 'Kas tunai' }, update: {}, select: { id: true } })
  return row.id
}

export async function resolveCashTarget(tx: Tx, target: CashTarget): Promise<string | null> {
  return target.kind === 'cash' ? ensureMainCashAccount(tx) : ensureBankCashAccount(tx, target.bankAccountId, { requireActive: true })
}

/** Rekening yang dipilih pelanggan (baris snapshot invoice) → akun kas; null bila rekening sudah tak ada (admin memilih saat verifikasi). */
export async function cashAccountForSnapshot(tx: Tx, dest: { bankName: string; accountNumber: string }): Promise<string | null> {
  const bank = await tx.bankAccount.findUnique({ where: { bankName_accountNumber: { bankName: dest.bankName, accountNumber: dest.accountNumber } }, select: { id: true } })
  return bank ? ensureBankCashAccount(tx, bank.id) : null
}

/** Pilihan akun untuk formulir verifikasi admin (rekening aktif + kas tunai). Hanya nama dan nomor rekening — bukan data pribadi. */
export async function cashTargetOptions(db: Pick<Tx, 'bankAccount'> = prisma): Promise<Array<{ value: string; label: string }>> {
  const banks = await db.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 50, select: { id: true, bankName: true, accountNumber: true, accountHolder: true } })
  return [...banks.map(b => ({ value: `bank:${b.id}`, label: `${b.bankName} ${b.accountNumber} a.n. ${b.accountHolder}` })), { value: 'cash', label: 'Kas tunai' }]
}
