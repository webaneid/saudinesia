import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { postEntries, reverseEntries } from '@/lib/cash/ledger'
import { ensureBankCashAccount, ensureMainCashAccount, CASH_MAIN } from '@/lib/cash/accounts'
import { paginate, type ListParams, type PageMeta } from '@/lib/table/pagination'

type Tx = Prisma.TransactionClient

// Transfer antar akun kas (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12b) — SATU-SATUNYA penulis `cash_transfers` dan entri `pindah_akun`/`biaya_transfer`.
// Satu transfer = baris `cash_transfers` + entri kas dalam SATU transaksi: sumber `transfer_out` (akun asal: keluar `pindah_akun` + `biaya_transfer`) dan
// `transfer_in` (akun tujuan: masuk `pindah_akun`). Tak pernah diubah/dihapus: batal = `voidedAt` + entri pembalik (koreksi) — ubah = batal lalu catat baru.
// Akun QRIS tak boleh dipakai (penanda uang masuk; uangnya mengendap di rekening penampung). Tujuan tak boleh rekening nonaktif atau akun gateway. Saldo tak diperiksa: buku kas belum memuat saldo sebelum sistem
// dipakai, jadi saldo negatif hanya diperingatkan di UI.

export type TransferFailure = 'same_account' | 'account_missing' | 'qris_account' | 'bad_destination' | 'future_date' | 'too_old' | 'not_found' | 'already_void'
export type TransferResult<T> = { ok: true; value: T } | { ok: false; kind: TransferFailure }
export type TransferRef = string // `account:<cash_accounts.id>` | `bank:<bank_accounts.id>` (rekening aktif yang belum berakun kas) | `cash`

const FUTURE_SLACK_MS = 5 * 60_000 // jam perangkat staf boleh sedikit di depan server
const MAX_PAST_MS = 366 * 24 * 3_600_000 // maks. ±1 tahun ke belakang: salah ketik tahun tak menggeser saldo awal semua periode Arus Kas (SEC-271)

/** Pilihan akun untuk formulir transfer (dengan saldo buku kas saat ini): akun kas yang ada (bukan QRIS; termasuk gateway dan rekening nonaktif yang masih bersaldo), rekening aktif yang belum
 *  berakun kas, dan Kas tunai bila belum ada. Hanya nama/nomor rekening perusahaan — bukan data pribadi. */
export type TransferAccountOption = { value: TransferRef; label: string; balanceIdr: number; canReceive: boolean } // canReceive=false: rekening nonaktif/gateway (hanya asal)

export async function transferAccountOptions(db: Pick<Tx, 'cashAccount' | 'bankAccount' | 'cashEntry'> = prisma): Promise<TransferAccountOption[]> {
  const [accounts, banks, sums] = await Promise.all([
    db.cashAccount.findMany({ where: { kind: { not: 'qris' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, kind: true, systemKey: true, bankAccount: { select: { bankName: true, accountNumber: true, isActive: true } } } }),
    db.bankAccount.findMany({ where: { isActive: true, cashAccount: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 50, select: { id: true, bankName: true, accountNumber: true } }),
    db.cashEntry.groupBy({ by: ['cashAccountId', 'direction'], _sum: { amountIdr: true } }),
  ])
  const balance = (id: string) => Math.round(sums.filter(r => r.cashAccountId === id).reduce((t, r) => t + (r.direction === 'in' ? 1 : -1) * Math.round(Number(r._sum.amountIdr ?? 0) * 100), 0)) / 100
  const opts: TransferAccountOption[] = accounts.map(a => ({
    value: `account:${a.id}`,
    label: a.bankAccount ? `${a.bankAccount.bankName} ${a.bankAccount.accountNumber}${a.bankAccount.isActive ? '' : ' (nonaktif)'}` : a.name,
    balanceIdr: balance(a.id),
    canReceive: a.kind !== 'gateway' && (a.bankAccount ? a.bankAccount.isActive : true),
  }))
  for (const b of banks) opts.push({ value: `bank:${b.id}`, label: `${b.bankName} ${b.accountNumber}`, balanceIdr: 0, canReceive: true })
  if (!accounts.some(a => a.systemKey === CASH_MAIN)) opts.push({ value: 'cash', label: 'Kas tunai', balanceIdr: 0, canReceive: true })
  return opts
}

/** Rujukan sebagai DATA tanpa menulis apa pun: akun kas yang ada (id + jenis + rekening aktif?) atau rekening/kas tunai yang belum berakun kas. */
type Resolved = { kind: 'existing'; id: string; accountKind: string; active: boolean } | { kind: 'new_bank'; bankAccountId: string } | { kind: 'new_cash' } | null

async function peekRef(tx: Tx, ref: TransferRef): Promise<Resolved> {
  if (ref === 'cash') {
    const a = await tx.cashAccount.findUnique({ where: { systemKey: CASH_MAIN }, select: { id: true } })
    return a ? { kind: 'existing', id: a.id, accountKind: 'cash', active: true } : { kind: 'new_cash' }
  }
  const m = /^(account|bank):([0-9a-f-]{36})$/.exec(ref)
  if (!m) return null
  if (m[1] === 'bank') {
    const b = await tx.bankAccount.findUnique({ where: { id: m[2]! }, select: { id: true, isActive: true, cashAccount: { select: { id: true } } } })
    if (!b || !b.isActive) return null
    return b.cashAccount ? { kind: 'existing', id: b.cashAccount.id, accountKind: 'bank', active: true } : { kind: 'new_bank', bankAccountId: b.id }
  }
  const a = await tx.cashAccount.findUnique({ where: { id: m[2]! }, select: { id: true, kind: true, bankAccount: { select: { isActive: true } } } })
  return a ? { kind: 'existing', id: a.id, accountKind: a.kind, active: a.bankAccount ? a.bankAccount.isActive : true } : null
}

/** Akun kas untuk rujukan yang SUDAH lolos semua aturan (baru di sini akun kas dibuat — penolakan tak pernah meninggalkan akun kas, SEC-268). */
async function materialize(tx: Tx, r: NonNullable<Resolved>): Promise<string> {
  if (r.kind === 'existing') return r.id
  if (r.kind === 'new_cash') return ensureMainCashAccount(tx)
  const id = await ensureBankCashAccount(tx, r.bankAccountId, { requireActive: true })
  if (!id) throw new Error('rekening berubah di tengah transaksi')
  return id
}

const sameAccount = (a: NonNullable<Resolved>, b: NonNullable<Resolved>) =>
  (a.kind === 'existing' && b.kind === 'existing' && a.id === b.id) || (a.kind === 'new_bank' && b.kind === 'new_bank' && a.bankAccountId === b.bankAccountId) || (a.kind === 'new_cash' && b.kind === 'new_cash')

export type TransferInput = { from: TransferRef; to: TransferRef; amount: number; fee: number; transferredAt: Date; note: string | null }

export async function createTransfer(input: TransferInput, byUserId: string, now = new Date()): Promise<TransferResult<{ id: string }>> {
  const t = input.transferredAt.getTime()
  if (t > now.getTime() + FUTURE_SLACK_MS) return { ok: false, kind: 'future_date' }
  if (t < now.getTime() - MAX_PAST_MS) return { ok: false, kind: 'too_old' }
  return prisma.$transaction(async tx => {
    // Semua aturan dinilai SEBELUM menulis apa pun (SEC-268): penolakan tak meninggalkan akun kas baru yang mengunci rekening dari penghapusan.
    const [from, to] = [await peekRef(tx, input.from), await peekRef(tx, input.to)]
    if (from?.kind === 'existing' && from.accountKind === 'qris') return { ok: false, kind: 'qris_account' } as const
    if (to?.kind === 'existing' && to.accountKind === 'qris') return { ok: false, kind: 'qris_account' } as const
    if (!from || !to) return { ok: false, kind: 'account_missing' } as const
    if (sameAccount(from, to)) return { ok: false, kind: 'same_account' } as const
    // Tujuan harus akun yang hidup: rekening nonaktif dan akun gateway hanya boleh DIKOSONGKAN (jadi asal), bukan diisi (SEC-271).
    if (to.kind === 'existing' && (!to.active || to.accountKind === 'gateway')) return { ok: false, kind: 'bad_destination' } as const
    const [fromId, toId] = [await materialize(tx, from), await materialize(tx, to)]
    const row = await tx.cashTransfer.create({
      data: { fromAccountId: fromId, toAccountId: toId, amountIdr: input.amount, feeIdr: input.fee, transferredAt: input.transferredAt, note: input.note, createdById: byUserId },
      select: { id: true },
    })
    const base = { entryDate: input.transferredAt, bookingId: null, createdById: byUserId }
    await postEntries(tx, { ...base, refType: 'transfer_out', refId: row.id, direction: 'out', cashAccountId: fromId }, [{ component: 'pindah_akun', amountIdr: input.amount }, { component: 'biaya_transfer', amountIdr: input.fee }])
    await postEntries(tx, { ...base, refType: 'transfer_in', refId: row.id, direction: 'in', cashAccountId: toId }, [{ component: 'pindah_akun', amountIdr: input.amount }])
    return { ok: true, value: { id: row.id } } as const
  })
}

/** Batalkan transfer: tandai batal + balik semua entrinya (tanggal pembalik = sekarang). Baris dikunci dulu; batal dua kali → `already_void`, tanpa entri ganda. */
export async function voidTransfer(id: string, reason: string | null, byUserId: string, now = new Date()): Promise<TransferResult<null>> {
  return prisma.$transaction(async tx => {
    // FOR UPDATE: dua pembatalan serentak berurutan; yang kedua membaca voidedAt terisi. Prisma ORM tak punya penguncian baris.
    const rows = await tx.$queryRaw<Array<{ voidedAt: Date | null }>>`SELECT "voidedAt" FROM cash_transfers WHERE id = ${id} FOR UPDATE`
    const row = rows[0]
    if (!row) return { ok: false, kind: 'not_found' } as const
    if (row.voidedAt) return { ok: false, kind: 'already_void' } as const
    await tx.cashTransfer.update({ where: { id }, data: { voidedAt: now, voidedById: byUserId, voidReason: reason }, select: { id: true } })
    const by = { createdById: byUserId, entryDate: now }
    await reverseEntries(tx, { refType: 'transfer_out', refId: id }, by)
    await reverseEntries(tx, { refType: 'transfer_in', refId: id }, by)
    return { ok: true, value: null } as const
  })
}

// ── baca ─────────────────────────────────────────────────────────────────────────────────────────
const accountLabel = (a: { name: string; bankAccount: { bankName: string; accountNumber: string } | null }) => a.bankAccount ? `${a.bankAccount.bankName} ${a.bankAccount.accountNumber}` : a.name
const ACCOUNT = { select: { id: true, name: true, bankAccount: { select: { bankName: true, accountNumber: true } } } } as const

export type TransferRow = { id: string; transferredAt: string; from: string; to: string; amountIdr: number; feeIdr: number; voided: boolean }
export type TransferDetail = TransferRow & { fromAccountId: string; toAccountId: string; note: string | null; createdById: string | null; createdAt: string; voidedAt: string | null; voidedById: string | null; voidReason: string | null }

/** Daftar transfer berhalaman (terbaru dulu, tie-breaker id); halaman di luar jangkauan dijepit oleh `paginate`. */
export async function listTransfers(f: { status?: 'active' | 'void' }, params: ListParams): Promise<{ items: TransferRow[]; meta: PageMeta }> {
  const where: Prisma.CashTransferWhereInput = f.status === 'active' ? { voidedAt: null } : f.status === 'void' ? { voidedAt: { not: null } } : {}
  const { items, meta } = await paginate(params, () => prisma.cashTransfer.count({ where }),
    range => prisma.cashTransfer.findMany({ where, orderBy: [{ transferredAt: 'desc' }, { id: 'desc' }], ...range, include: { fromAccount: ACCOUNT, toAccount: ACCOUNT } }))
  return { meta, items: items.map(r => ({ id: r.id, transferredAt: r.transferredAt.toISOString(), from: accountLabel(r.fromAccount), to: accountLabel(r.toAccount), amountIdr: Number(r.amountIdr), feeIdr: Number(r.feeIdr), voided: r.voidedAt !== null })) }
}

export async function getTransfer(id: string): Promise<TransferDetail | null> {
  const r = await prisma.cashTransfer.findUnique({ where: { id }, include: { fromAccount: ACCOUNT, toAccount: ACCOUNT } })
  if (!r) return null
  return {
    id: r.id, transferredAt: r.transferredAt.toISOString(), from: accountLabel(r.fromAccount), to: accountLabel(r.toAccount), fromAccountId: r.fromAccountId, toAccountId: r.toAccountId,
    amountIdr: Number(r.amountIdr), feeIdr: Number(r.feeIdr), voided: r.voidedAt !== null, note: r.note, createdById: r.createdById, createdAt: r.createdAt.toISOString(),
    voidedAt: r.voidedAt?.toISOString() ?? null, voidedById: r.voidedById, voidReason: r.voidReason,
  }
}
