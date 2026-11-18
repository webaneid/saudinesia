import { Prisma, type RevenueShareBasis } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { RevenueShareSettingInput } from '@/lib/validators/revenueShare'

// Setelan bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md, Fase 13a) — SATU-SATUNYA penulis `revenue_share_settings` (append-only di DB).
// Versi terbaru = berlaku; tanpa baris = bawaan (5%, markup — keputusan pemilik Q2). Hanya akun Platform Provider (superadmin + isPlatformProvider,
// dibaca ulang di dalam transaksi) yang boleh menyimpan; versi basi → 409.

export const DEFAULT_REVENUE_SHARE: { percent: number; basis: RevenueShareBasis } = { percent: 5, basis: 'markup' }

/** Versi setelan. Tanpa nama penyimpan: akun Platform Provider adalah akun bayangan (tak terlihat oleh klien) — hanya Platform Provider yang bisa menyimpan. */
export type RevenueShareVersion = { id: string; percent: number; basis: RevenueShareBasis; note: string | null; createdAt: Date }
export type CurrentRevenueShare = { id: string | null; percent: number; basis: RevenueShareBasis; isDefault: boolean }

export class RevenueShareError extends Error {
  constructor(readonly status: 400 | 403 | 409, message: string) { super(message); this.name = 'RevenueShareError' }
}

type Db = Pick<typeof prisma, 'revenueShareSetting'>
const ORDER = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

export async function currentRevenueShare(db: Db = prisma): Promise<CurrentRevenueShare> {
  const row = await db.revenueShareSetting.findFirst({ orderBy: ORDER, select: { id: true, percent: true, basis: true } })
  return row ? { id: row.id, percent: Number(row.percent), basis: row.basis, isDefault: false } : { id: null, ...DEFAULT_REVENUE_SHARE, isDefault: true }
}

export async function revenueShareHistory(limit = 50): Promise<RevenueShareVersion[]> {
  const rows = await prisma.revenueShareSetting.findMany({ orderBy: ORDER, take: limit, select: { id: true, percent: true, basis: true, note: true, createdAt: true } })
  return rows.map(r => ({ id: r.id, percent: Number(r.percent), basis: r.basis, note: r.note, createdAt: r.createdAt }))
}

/** Aturan yang BERLAKU untuk harga dan invoice baru (Fase 13b): null bila belum ada akun Platform Provider aktif — tak ada bagi hasil tanpa penerimanya,
 *  jadi harga tidak dinaikkan dan invoice tidak membekukan apa pun. Akun dipasang lewat scripts/set-platform-provider.ts. */
export type EffectiveRevenueShare = { settingId: string | null; percent: number; basis: RevenueShareBasis }
export async function effectiveRevenueShare(db: Pick<typeof prisma, 'revenueShareSetting' | 'user'> = prisma): Promise<EffectiveRevenueShare | null> {
  const configured = await db.user.count({ where: { isPlatformProvider: true, isActive: true, role: 'superadmin' } })
  if (configured === 0) return null
  const c = await currentRevenueShare(db)
  return { settingId: c.id, percent: c.percent, basis: c.basis }
}

/** Kunci teks aturan berlaku — dibandingkan dengan aturan yang sudah diterapkan ke harga (lib/revenue-share/pricing.ts). */
export const revenueShareRuleKey = (r: EffectiveRevenueShare | null): string => (r ? `${r.percent}:${r.basis}` : 'none')

/**
 * Aturan untuk DIBEKUKAN di invoice yang sedang terbit (P4) — dipanggil HANYA lib/invoice/issue.ts di transaksi penerbitan. Yang dibekukan adalah aturan yang SUDAH
 * DITERAPKAN ke harga (`revenue_share_pricing_state`), bukan setelan terbaru: selama hitung ulang belum selesai, harga yang dijual masih memakai aturan lama, dan bagian
 * Platform Provider harus dihitung dengan aturan yang sama (SEC-279). Tanpa baris = belum pernah diterapkan = tanpa bagi hasil.
 */
export async function revenueShareForIssue(tx: Pick<Prisma.TransactionClient, 'revenueSharePricingState'>): Promise<EffectiveRevenueShare | null> {
  const s = await tx.revenueSharePricingState.findUnique({ where: { id: 'global' }, select: { percent: true, basis: true, settingId: true } })
  return s?.percent != null && s.basis ? { settingId: s.settingId, percent: Number(s.percent), basis: s.basis } : null
}

/** Ada akun Platform Provider aktif? (tab Informasi — hanya ya/tidak; akun bayangan tak pernah dibuka ke klien.) */
export async function platformProviderConfigured(): Promise<boolean> {
  return (await effectiveRevenueShare()) !== null
}

export async function saveRevenueShare(input: RevenueShareSettingInput, byUserId: string): Promise<CurrentRevenueShare> {
  return prisma.$transaction(async tx => {
    // Pelaku dibaca ulang (FOR SHARE) di dalam transaksi: penanda/peran yang dicabut di tengah jalan tak boleh lolos. Prisma ORM tak punya FOR SHARE.
    const actor = await tx.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`
      SELECT ("isPlatformProvider" AND "isActive" AND "role" = 'superadmin') AS ok FROM "users" WHERE "id" = ${byUserId} FOR SHARE`)
    if (!actor[0]?.ok) throw new RevenueShareError(403, 'Hanya akun Platform Provider yang dapat mengubah setelan bagi hasil')
    // Satu penyimpan pada satu waktu: kunci transaksi berkunci tetap (tabel append-only tak punya baris untuk dikunci). Prisma ORM tak punya advisory lock.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('revenue_share_settings'))`)
    const current = await currentRevenueShare(tx)
    if (current.id !== input.expectedId) throw new RevenueShareError(409, 'Setelan sudah diubah di tempat lain. Muat ulang halaman.')
    const note = input.note?.trim() || null
    if (current.percent === input.percent && current.basis === input.basis && !current.isDefault && !note) throw new RevenueShareError(400, 'Tidak ada perubahan untuk disimpan')
    await tx.revenueShareSetting.create({ data: { percent: input.percent, basis: input.basis, note, createdById: byUserId } })
    return currentRevenueShare(tx)
  })
}
