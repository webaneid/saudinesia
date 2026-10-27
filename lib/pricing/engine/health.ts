import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GLOBAL_RULE_KEY } from '../pricingHelpers'
import { PRICE_OWNER_TYPES, priceOwner } from './owners'
import { toView } from './view'
import type { PriceOwnerType, PriceView } from './types'

// KESEHATAN MARGIN (docs/arsitektur-harga-terpadu.md §6, §16): titik harga yang perlu perhatian pemilik/manajer. Tidak memblokir apa pun — hanya menampakkan.
//  loss      jual < modal (rugi) — termasuk harga manual di bawah modal atau modal naik karena kurs/vendor
//  thin      untung% < ambang `PricingRule.warnBelowPercent` (0 = nonaktif)
//  no_cost   modal belum diisi / belum lengkap → untung tak bisa dinyatakan (TIDAK untuk pemilik manual-only: katering/layanan hotel — modalnya memang opsional)
//  unpriced  jual = 0 (belum berharga: tak dapat dipesan)

export type HealthIssue = 'loss' | 'thin' | 'no_cost' | 'unpriced'
export const HEALTH_ISSUES: readonly HealthIssue[] = ['loss', 'thin', 'no_cost', 'unpriced']
export type HealthFilter = 'issues' | 'all' | HealthIssue

export type HealthRow = PriceView & { label: string; href: string | null; issues: HealthIssue[] }
export type HealthResult = {
  rows: HealthRow[]
  total: number
  page: number
  pageSize: number
  counts: Record<HealthIssue, number> & { all: number }
  warnBelowPercent: number
}

type RawRow = {
  id: string; ownerType: string; ownerId: string; variantKey: string; unit: string
  costIdr: Prisma.Decimal | null; sellIdr: Prisma.Decimal; manualSellIdr: Prisma.Decimal | null
  loss: boolean; thin: boolean; no_cost: boolean; unpriced: boolean
}

const MANUAL_ONLY_TYPES = PRICE_OWNER_TYPES.filter(t => priceOwner(t).manualOnly)

export async function marginHealth(opts: { filter?: HealthFilter; ownerType?: PriceOwnerType; page?: number; pageSize?: number } = {}): Promise<HealthResult> {
  const filter = opts.filter ?? 'issues'
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 25)))
  const rule = await prisma.pricingRule.findUnique({ where: { productType: GLOBAL_RULE_KEY }, select: { warnBelowPercent: true } })
  const warn = rule ? Number(rule.warnBelowPercent) : 0

  // Kolom dibandingkan dengan kolom (sell < cost) — Prisma ORM tidak bisa mengekspresikannya, dan filter/hitungan harus terjadi di DB agar halaman tetap berbatas.
  const flags = Prisma.sql`
    (p."costIdr" IS NOT NULL AND p."sellIdr" < p."costIdr") AS loss,
    (${warn} > 0 AND p."costIdr" IS NOT NULL AND p."costIdr" > 0 AND p."sellIdr" >= p."costIdr" AND (p."sellIdr" - p."costIdr") / p."costIdr" * 100 < ${warn}) AS thin,
    (p."costIdr" IS NULL AND p."ownerType" <> ALL (${MANUAL_ONLY_TYPES})) AS no_cost,
    (p."sellIdr" = 0) AS unpriced`
  const typeFilter = opts.ownerType && PRICE_OWNER_TYPES.includes(opts.ownerType) ? Prisma.sql`p."ownerType" = ${opts.ownerType}` : Prisma.sql`TRUE`
  const issueSql: Record<HealthIssue, Prisma.Sql> = {
    loss: Prisma.sql`f.loss`, thin: Prisma.sql`f.thin`, no_cost: Prisma.sql`f.no_cost`, unpriced: Prisma.sql`f.unpriced`,
  }
  const any = Prisma.sql`(f.loss OR f.thin OR f.no_cost OR f.unpriced)`
  const where = filter === 'all' ? Prisma.sql`TRUE` : filter === 'issues' ? any : issueSql[filter]

  const base = Prisma.sql`FROM (SELECT p.*, ${flags} FROM "price_points" p WHERE ${typeFilter}) f`
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`SELECT f.* ${base} WHERE ${where} ORDER BY f.loss DESC, f.unpriced DESC, f.thin DESC, f.no_cost DESC, f."ownerType", f."ownerId", f."variantKey" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<Array<{ all: bigint; shown: bigint; loss: bigint; thin: bigint; no_cost: bigint; unpriced: bigint }>>`
      SELECT count(*) AS "all", count(*) FILTER (WHERE ${where}) AS shown, count(*) FILTER (WHERE f.loss) AS loss, count(*) FILTER (WHERE f.thin) AS thin,
             count(*) FILTER (WHERE f.no_cost) AS no_cost, count(*) FILTER (WHERE f.unpriced) AS unpriced ${base}`,
  ])
  const c = countRows[0]
  const counts = { all: Number(c?.all ?? 0), loss: Number(c?.loss ?? 0), thin: Number(c?.thin ?? 0), no_cost: Number(c?.no_cost ?? 0), unpriced: Number(c?.unpriced ?? 0) }

  // Nama + tautan editor per tipe (satu query per tipe, bukan per baris).
  const idsByType = new Map<PriceOwnerType, string[]>()
  for (const r of rows) {
    const t = r.ownerType as PriceOwnerType
    idsByType.set(t, [...(idsByType.get(t) ?? []), r.ownerId])
  }
  const described = new Map<string, { label: string; href: string }>()
  for (const [t, ids] of idsByType) {
    for (const [id, d] of await priceOwner(t).describe([...new Set(ids)])) described.set(`${t}:${id}`, d)
  }

  return {
    rows: rows.map(r => {
      const d = described.get(`${r.ownerType}:${r.ownerId}`)
      const issues = HEALTH_ISSUES.filter(i => (i === 'no_cost' ? r.no_cost : r[i]))
      return { ...toView(r), label: d?.label ?? '(produk tidak ditemukan)', href: d?.href ?? null, issues }
    }),
    total: Number(c?.shown ?? 0),
    page, pageSize, counts, warnBelowPercent: warn,
  }
}
