import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { postEntries, reverseEntries } from '@/lib/cash/ledger'
import { parseCashTarget, resolveCashTarget } from '@/lib/cash/accounts'
import { paginate, type ListParams, type PageMeta } from '@/lib/table/pagination'

type Tx = Prisma.TransactionClient

// Pencairan bagi hasil ke Platform Provider (Fase 13e-1, docs/arsitektur-bagi-hasil.md §5e) — SATU-SATUNYA penulis `revenue_share_payouts` dan entri kas `bagi_hasil`.
// Satu pencairan = baris beku + entri `out`/`bagi_hasil` (refType `revenue_share_payout`) dalam SATU transaksi; batal = `voidedAt` + pembalik, sekali (pola lib/cash/transfers.ts).
// Jumlah ≤ saldo Platform Provider (Σ hak − Σ pencairan berlaku), dinilai di bawah advisory lock pencairan supaya dua pencatatan serentak tak sama-sama lolos.
// Peran dijaga route (`requirePayoutRecorder`: superadmin klien, bukan akun Platform Provider). Catatan = teks staf tentang transfer usaha (tanpa data pelanggan).

export type PayoutFailure = 'future_date' | 'too_old' | 'bad_cash_account' | 'recipient_unavailable' | 'recipient_changed' | 'duplicate' | 'over_balance' | 'not_found' | 'already_void'
export type PayoutResult<T> = { ok: true; value: T } | { ok: false; kind: PayoutFailure; balanceIdr?: number }

const FUTURE_SLACK_MS = 5 * 60_000
const MAX_PAST_MS = 366 * 24 * 3_600_000
const PAYOUT_LOCK = 'revenue_share_payout'
const cents = (x: number | Prisma.Decimal | null | undefined): number => Math.round(Number(x ?? 0) * 100)

/** Saldo Platform Provider (rupiah) = Σ hak tercatat − Σ pencairan yang tidak dibatalkan. Bisa negatif (refund sesudah pencairan menurunkan hak). */
export async function providerBalance(db: Pick<Tx, 'revenueShareEntry' | 'revenueSharePayout'> = prisma): Promise<{ entitledIdr: number; paidOutIdr: number; balanceIdr: number }> {
  const [e, p] = await Promise.all([
    db.revenueShareEntry.aggregate({ _sum: { amountIdr: true } }),
    db.revenueSharePayout.aggregate({ where: { voidedAt: null }, _sum: { amountIdr: true } }),
  ])
  const ent = cents(e._sum.amountIdr), paid = cents(p._sum.amountIdr)
  return { entitledIdr: ent / 100, paidOutIdr: paid / 100, balanceIdr: (ent - paid) / 100 }
}

export type PayoutInput = { amount: number; paidAt: Date; cashAccount: string; recipientAccountId: string; recipientVersion: Date; note: string | null }

export async function createPayout(input: PayoutInput, byUserId: string, now = new Date()): Promise<PayoutResult<{ id: string }>> {
  const t = input.paidAt.getTime()
  if (t > now.getTime() + FUTURE_SLACK_MS) return { ok: false, kind: 'future_date' }
  if (t < now.getTime() - MAX_PAST_MS) return { ok: false, kind: 'too_old' }
  const target = parseCashTarget(input.cashAccount)
  if (!target || target.kind === 'qris') return { ok: false, kind: 'bad_cash_account' } // QRIS hanya untuk uang MASUK
  return prisma.$transaction(async tx => {
    // Kunci global pencairan (dalam transaksi): saldo dibaca dan pencairan ditulis tanpa diselipi pencairan lain. Prisma ORM tak punya advisory lock.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${PAYOUT_LOCK}))`)
    // Rekening tujuan dikunci FOR SHARE (hapus rekening memegang FOR UPDATE) lalu dibaca: harus ada dan aktif. Prisma ORM tak punya SELECT … FOR SHARE.
    const acc = await tx.$queryRaw<Array<{ bankName: string; accountNumber: string; accountHolder: string; isActive: boolean; updatedAt: Date }>>(
      Prisma.sql`SELECT "bankName", "accountNumber", "accountHolder", "isActive", "updatedAt" FROM "platform_provider_bank_accounts" WHERE "id" = ${input.recipientAccountId} FOR SHARE`,
    )
    if (!acc[0] || !acc[0].isActive) return { ok: false, kind: 'recipient_unavailable' } as const
    // Rekening berubah sejak formulir dimuat → tolak: uang ditransfer ke nomor yang DILIHAT pencatat, dan salinan beku harus sama dengan itu (SEC-292).
    if (acc[0].updatedAt.getTime() !== input.recipientVersion.getTime()) return { ok: false, kind: 'recipient_changed' } as const
    // Kirim ulang (klik ganda, retry jaringan, dua tab) membawa isi persis sama — termasuk waktu bayar dari formulir — → tolak, jangan cairkan dua kali (SEC-294).
    const same = await tx.revenueSharePayout.findFirst({ where: { voidedAt: null, amountIdr: input.amount, recipientAccountId: input.recipientAccountId, paidAt: input.paidAt }, select: { id: true } })
    if (same) return { ok: false, kind: 'duplicate' } as const
    const { balanceIdr } = await providerBalance(tx)
    if (cents(input.amount) > cents(balanceIdr)) return { ok: false, kind: 'over_balance', balanceIdr } as const
    // Semua aturan dinilai sebelum akun kas dibuat (pola SEC-268): penolakan tak meninggalkan akun kas baru.
    const cashAccountId = await resolveCashTarget(tx, target)
    if (!cashAccountId) return { ok: false, kind: 'bad_cash_account' } as const
    const row = await tx.revenueSharePayout.create({
      data: {
        amountIdr: input.amount, paidAt: input.paidAt, cashAccountId, recipientAccountId: input.recipientAccountId,
        recipientBankName: acc[0].bankName, recipientNumber: acc[0].accountNumber, recipientHolder: acc[0].accountHolder, note: input.note, createdById: byUserId,
      },
      select: { id: true },
    })
    await postEntries(tx, { refType: 'revenue_share_payout', refId: row.id, direction: 'out', cashAccountId, entryDate: input.paidAt, bookingId: null, createdById: byUserId }, [{ component: 'bagi_hasil', amountIdr: input.amount }])
    return { ok: true, value: { id: row.id } } as const
  })
}

/** Batalkan pencairan: tandai batal + balik entrinya (tanggal pembalik = sekarang). Baris dikunci dulu; batal dua kali → `already_void`. */
export async function voidPayout(id: string, reason: string, byUserId: string, now = new Date()): Promise<PayoutResult<null>> {
  return prisma.$transaction(async tx => {
    // FOR UPDATE: dua pembatalan serentak berurutan. Prisma ORM tak punya penguncian baris.
    const rows = await tx.$queryRaw<Array<{ voidedAt: Date | null }>>(Prisma.sql`SELECT "voidedAt" FROM "revenue_share_payouts" WHERE "id" = ${id} FOR UPDATE`)
    if (!rows[0]) return { ok: false, kind: 'not_found' } as const
    if (rows[0].voidedAt) return { ok: false, kind: 'already_void' } as const
    await tx.revenueSharePayout.update({ where: { id }, data: { voidedAt: now, voidedById: byUserId, voidReason: reason }, select: { id: true } })
    await reverseEntries(tx, { refType: 'revenue_share_payout', refId: id }, { createdById: byUserId, entryDate: now })
    return { ok: true, value: null } as const
  })
}

// ── baca ─────────────────────────────────────────────────────────────────────────────────────────
const accountLabel = (a: { name: string; bankAccount: { bankName: string; accountNumber: string } | null }) => a.bankAccount ? `${a.bankAccount.bankName} ${a.bankAccount.accountNumber}` : a.name
const CASH = { select: { name: true, bankAccount: { select: { bankName: true, accountNumber: true } } } } as const

export type PayoutRow = { id: string; paidAt: string; amountIdr: number; from: string; to: string; voided: boolean }
export type PayoutDetail = PayoutRow & { note: string | null; createdById: string; createdAt: string; voidedAt: string | null; voidedById: string | null; voidReason: string | null }

export async function listPayouts(f: { status?: 'active' | 'void' }, params: ListParams): Promise<{ items: PayoutRow[]; meta: PageMeta }> {
  const where: Prisma.RevenueSharePayoutWhereInput = f.status === 'active' ? { voidedAt: null } : f.status === 'void' ? { voidedAt: { not: null } } : {}
  const { items, meta } = await paginate(params, () => prisma.revenueSharePayout.count({ where }),
    range => prisma.revenueSharePayout.findMany({ where, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], ...range, include: { cashAccount: CASH } }))
  return { meta, items: items.map(r => ({ id: r.id, paidAt: r.paidAt.toISOString(), amountIdr: Number(r.amountIdr), from: accountLabel(r.cashAccount), to: `${r.recipientBankName} ${r.recipientNumber} a.n. ${r.recipientHolder}`, voided: r.voidedAt !== null })) }
}

export async function getPayout(id: string): Promise<PayoutDetail | null> {
  const r = await prisma.revenueSharePayout.findUnique({ where: { id }, include: { cashAccount: CASH } })
  if (!r) return null
  return {
    id: r.id, paidAt: r.paidAt.toISOString(), amountIdr: Number(r.amountIdr), from: accountLabel(r.cashAccount), to: `${r.recipientBankName} ${r.recipientNumber} a.n. ${r.recipientHolder}`,
    voided: r.voidedAt !== null, note: r.note, createdById: r.createdById, createdAt: r.createdAt.toISOString(), voidedAt: r.voidedAt?.toISOString() ?? null, voidedById: r.voidedById, voidReason: r.voidReason,
  }
}
