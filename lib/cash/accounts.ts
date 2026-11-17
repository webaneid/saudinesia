import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

type Tx = Prisma.TransactionClient

// Akun kas (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1) — SATU-SATUNYA penulis `cash_accounts`. Akun dibuat saat PERTAMA dipakai (bukti diunggah ke rekening itu —
// termasuk bukti yang kemudian ditolak — atau admin memilihnya saat verifikasi), sehingga rekening yang belum pernah dipakai tetap dapat dihapus di Pengaturan Invoice;
// yang sudah dipakai terikat FK Restrict → hanya bisa dinonaktifkan (SEC-238, diterima).

export const CASH_MAIN = 'cash:main'

/** Pilihan akun kas di formulir admin: `bank:<BankAccount.id>`, `qris:<QrisAccount.id>` (Fase 8), atau `cash`. */
export type CashTarget = { kind: 'bank'; bankAccountId: string } | { kind: 'qris'; qrisAccountId: string } | { kind: 'cash' }

export function parseCashTarget(v: string): CashTarget | null {
  if (v === 'cash') return { kind: 'cash' }
  const m = /^(bank|qris):([0-9a-f-]{36})$/.exec(v)
  if (!m) return null
  return m[1] === 'bank' ? { kind: 'bank', bankAccountId: m[2]! } : { kind: 'qris', qrisAccountId: m[2]! }
}

/** Nilai pilihan formulir untuk akun kas tersimpan (kebalikan `parseCashTarget`); '' bila tak dikenali. */
export function cashTargetValue(a: { kind: string; bankAccountId: string | null; qrisAccountId: string | null } | null): string {
  if (!a) return ''
  if (a.kind === 'cash') return 'cash'
  if (a.kind === 'bank' && a.bankAccountId) return `bank:${a.bankAccountId}`
  if (a.kind === 'qris' && a.qrisAccountId) return `qris:${a.qrisAccountId}`
  return ''
}

/** Akun kas untuk sebuah akun QRIS (dibuat bila belum ada; pola `ensureBankCashAccount`). null = QRIS tak ada / nonaktif (bila `requireActive`). */
export async function ensureQrisCashAccount(tx: Tx, qrisAccountId: string, opts: { requireActive?: boolean } = {}): Promise<string | null> {
  const q = await tx.qrisAccount.findUnique({ where: { id: qrisAccountId }, select: { id: true, name: true, isActive: true, cashAccount: { select: { id: true } } } })
  if (!q || (opts.requireActive && !q.isActive)) return null
  if (q.cashAccount) return q.cashAccount.id
  await tx.cashAccount.createMany({ data: [{ kind: 'qris', qrisAccountId: q.id, name: `QRIS ${q.name}`.slice(0, 200) }], skipDuplicates: true }) // aman serentak (lihat ensureBankCashAccount)
  return (await tx.cashAccount.findUniqueOrThrow({ where: { qrisAccountId: q.id }, select: { id: true } })).id
}

/** Akun kas untuk sebuah rekening (dibuat bila belum ada). Rekening harus ada; `requireActive` untuk pilihan baru dari admin. null = rekening tak ada / nonaktif. */
export async function ensureBankCashAccount(tx: Tx, bankAccountId: string, opts: { requireActive?: boolean } = {}): Promise<string | null> {
  const bank = await tx.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, bankName: true, accountNumber: true, isActive: true, cashAccount: { select: { id: true } } } })
  if (!bank || (opts.requireActive && !bank.isActive)) return null
  if (bank.cashAccount) return bank.cashAccount.id
  // INSERT … ON CONFLICT DO NOTHING lalu baca: dua transaksi serentak untuk rekening yang sama tak membuat dua akun. Bukan `upsert` — Prisma dapat melempar
  // P2002 pada upsert serentak, dan galat di dalam transaksi interaktif membatalkan seluruh transaksi (dulu sesekali gagal di uji serentak).
  await tx.cashAccount.createMany({ data: [{ kind: 'bank', bankAccountId: bank.id, name: `${bank.bankName} ${bank.accountNumber}`.slice(0, 200) }], skipDuplicates: true })
  return (await tx.cashAccount.findUniqueOrThrow({ where: { bankAccountId: bank.id }, select: { id: true } })).id
}

/** Akun sistem (kas tunai, gateway) berkunci `systemKey` — dibuat sekali, aman serentak (lihat ensureBankCashAccount). */
async function ensureSystemAccount(tx: Tx, systemKey: string, kind: 'cash' | 'gateway', name: string): Promise<string> {
  await tx.cashAccount.createMany({ data: [{ kind, systemKey, name }], skipDuplicates: true })
  return (await tx.cashAccount.findUniqueOrThrow({ where: { systemKey }, select: { id: true } })).id
}

/** Akun Kas tunai (satu). */
export async function ensureMainCashAccount(tx: Tx): Promise<string> {
  return ensureSystemAccount(tx, CASH_MAIN, 'cash', 'Kas tunai')
}

/** Akun kas sebuah gateway (Fase 9: saldo di iPaymu/Xendit; ditarik ke rekening = transfer antar akun, Fase 12). Hanya uang masuk pembayaran + MDR keluar. */
export async function ensureGatewayCashAccount(tx: Tx, gateway: 'ipaymu' | 'xendit'): Promise<string> {
  const key = `gateway:${gateway}`
  return ensureSystemAccount(tx, key, 'gateway', gateway === 'ipaymu' ? 'iPaymu' : 'Xendit')
}

/** `incoming` = uang masuk (verifikasi pembayaran); target QRIS untuk uang keluar → null (ditolak sebagai akun tak sah). */
export async function resolveCashTarget(tx: Tx, target: CashTarget, opts: { incoming?: boolean } = {}): Promise<string | null> {
  if (target.kind === 'cash') return ensureMainCashAccount(tx)
  if (target.kind === 'qris') return opts.incoming ? ensureQrisCashAccount(tx, target.qrisAccountId, { requireActive: true }) : null
  return ensureBankCashAccount(tx, target.bankAccountId, { requireActive: true })
}

/** Rekening yang dipilih pelanggan (baris snapshot invoice) → akun kas; null bila rekening sudah tak ada (admin memilih saat verifikasi). */
export async function cashAccountForSnapshot(tx: Tx, dest: { bankName: string; accountNumber: string }): Promise<string | null> {
  const bank = await tx.bankAccount.findUnique({ where: { bankName_accountNumber: { bankName: dest.bankName, accountNumber: dest.accountNumber } }, select: { id: true } })
  return bank ? ensureBankCashAccount(tx, bank.id) : null
}

/**
 * Pilihan akun untuk formulir admin (rekening aktif + kas tunai; QRIS aktif hanya bila `incoming` — uang MASUK lewat QRIS. Uang keluar (refund, vendor) tak dibayar
 * dari QRIS: saldo merchant mengendap ke rekening). Hanya nama dan nomor rekening — bukan data pribadi.
 */
export async function cashTargetOptions(opts: { incoming?: boolean } = {}, db: Pick<Tx, 'bankAccount' | 'qrisAccount'> = prisma): Promise<Array<{ value: string; label: string }>> {
  const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }]
  const [banks, qris] = await Promise.all([
    db.bankAccount.findMany({ where: { isActive: true }, orderBy: order, take: 50, select: { id: true, bankName: true, accountNumber: true, accountHolder: true } }),
    opts.incoming ? db.qrisAccount.findMany({ where: { isActive: true }, orderBy: order, take: 50, select: { id: true, name: true } }) : Promise.resolve([]),
  ])
  return [
    ...banks.map(b => ({ value: `bank:${b.id}`, label: `${b.bankName} ${b.accountNumber} a.n. ${b.accountHolder}` })),
    ...qris.map(q => ({ value: `qris:${q.id}`, label: `QRIS ${q.name}` })),
    { value: 'cash', label: 'Kas tunai' },
  ]
}
