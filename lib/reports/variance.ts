import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { periodBounds, ReportInputError } from './profit'
import { APP_TIMEZONE } from '@/lib/time'

// LAPORAN SELISIH HPP vs AKTUAL (docs/arsitektur-harga-terpadu.md §20, 7D): di mana modal rencana (snapshot, HPP awal) meleset dari uang yang benar-benar keluar (cost_actuals).
// Dasar periode = tanggal PESANAN menurut WIB (sama dengan laporan untung §19), SEMUA status (uang yang sudah keluar tetap biaya walau pesanan batal). SQL ber-parameter ($queryRaw: agregat
// per irisan atas dua tabel). Aturan: selisih (aktual − rencana) HANYA dari baris LUNAS; baris belum lunas dilaporkan terpisah (rencana vs terbayar sejauh ini); pengeluaran tanpa rencana
// (modal tak diketahui) atau tanpa rujukan baris dihitung sebagai belanja saja. Pengeluaran yang dibatalkan (void) tak pernah dihitung.

export type VarianceParams = { from: string; to: string }
const money = (x: number | null | undefined): number => Math.round((x ?? 0) * 100) / 100

const utcText = (d: Date): string => d.toISOString().slice(0, 23).replace('T', ' ')
function base(p: VarianceParams) {
  const { fromTs, toTs } = periodBounds(p.from, p.to)
  return Prisma.sql`
    WITH b AS (
      SELECT bk."id", bk."bookingCode", bk."createdAt" FROM "bookings" bk
      WHERE bk."createdAt" >= ${utcText(fromTs)}::timestamp AND bk."createdAt" < ${utcText(toTs)}::timestamp
    ), act AS (
      SELECT a."id", a."snapshotId", a."bookingId", a."vendorId", a."component", a."amountIdr"::float8 AS amount, a."isSettled", a."varianceNote"
      FROM "cost_actuals" a JOIN b ON b."id" = a."bookingId" WHERE a."voidedAt" IS NULL
    ), ln AS (
      SELECT s."id" AS snapshot_id, s."itemType" AS item_type, s."description", s."totalCostIdr"::float8 AS plan, b."id" AS booking_id, b."bookingCode" AS booking_code, b."createdAt" AS created_at,
        COALESCE((SELECT SUM(x.amount) FROM act x WHERE x."snapshotId" = s."id"), 0)::float8 AS actual,
        COALESCE((SELECT bool_or(x."isSettled") FROM act x WHERE x."snapshotId" = s."id"), false) AS settled,
        (SELECT string_agg(x."varianceNote", ' | ') FROM act x WHERE x."snapshotId" = s."id" AND x."varianceNote" IS NOT NULL) AS notes
      FROM "price_snapshots" s JOIN b ON b."id" = s."bookingId"
      WHERE s."totalCostIdr" IS NOT NULL AND EXISTS (SELECT 1 FROM act x WHERE x."snapshotId" = s."id")
    )`
}

type SliceAgg = { lines: number; plan: number; actual: number }
export type VarianceSlice = { lines: number; planIdr: number; actualIdr: number; varianceIdr: number }
const slice = (r: SliceAgg): VarianceSlice => ({ lines: r.lines, planIdr: money(r.plan), actualIdr: money(r.actual), varianceIdr: money(r.actual - r.plan) })

export type VarianceReport = {
  params: VarianceParams
  summary: {
    settled: VarianceSlice & { overrunLines: number; savingLines: number; onPlanLines: number }
    partial: { lines: number; planIdr: number; paidIdr: number }
    /** Belanja yang tak bisa dibandingkan: rencana tak diketahui atau tanpa rujukan baris. */
    spendWithoutPlanIdr: number
    totalSpendIdr: number
  }
  byProduct: Array<VarianceSlice & { itemType: string }>
  byMonth: Array<VarianceSlice & { month: string }>
  /** Belanja (uang keluar) per vendor yang DIBAYAR — bukan vendor rencana. */
  spendByVendor: Array<{ vendorId: string; label: string; spendIdr: number; entries: number }>
  spendByComponent: Array<{ component: string; spendIdr: number; entries: number }>
}
export type VarianceLineRow = {
  snapshotId: string; bookingId: string; bookingCode: string; createdAt: string; itemType: string; description: string
  planIdr: number; actualIdr: number; varianceIdr: number; settled: boolean; notes: string | null
}

export async function getVarianceReport(p: VarianceParams): Promise<VarianceReport> {
  const b = base(p)
  const run = <T,>(tail: Prisma.Sql) => prisma.$queryRaw<T[]>(Prisma.sql`${b} ${tail}`)
  const [settled, partial, spend, byProduct, byMonth, byVendor, byComponent] = await Promise.all([
    run<SliceAgg & { overrun: number; saving: number; onplan: number }>(Prisma.sql`
      SELECT COUNT(*)::int AS lines, COALESCE(SUM(plan), 0)::float8 AS plan, COALESCE(SUM(actual), 0)::float8 AS actual,
        COUNT(*) FILTER (WHERE actual - plan > 0.004)::int AS overrun, COUNT(*) FILTER (WHERE actual - plan < -0.004)::int AS saving, COUNT(*) FILTER (WHERE ABS(actual - plan) <= 0.004)::int AS onplan
      FROM ln WHERE settled`),
    run<{ lines: number; plan: number; paid: number }>(Prisma.sql`SELECT COUNT(*)::int AS lines, COALESCE(SUM(plan), 0)::float8 AS plan, COALESCE(SUM(actual), 0)::float8 AS paid FROM ln WHERE NOT settled`),
    run<{ total: number; without_plan: number }>(Prisma.sql`
      SELECT COALESCE(SUM(a.amount), 0)::float8 AS total,
        COALESCE(SUM(a.amount) FILTER (WHERE a."snapshotId" IS NULL OR NOT EXISTS (SELECT 1 FROM ln WHERE ln.snapshot_id = a."snapshotId")), 0)::float8 AS without_plan
      FROM act a`),
    run<SliceAgg & { item_type: string }>(Prisma.sql`SELECT item_type, COUNT(*)::int AS lines, COALESCE(SUM(plan), 0)::float8 AS plan, COALESCE(SUM(actual), 0)::float8 AS actual FROM ln WHERE settled GROUP BY item_type ORDER BY ABS(SUM(actual) - SUM(plan)) DESC, item_type`),
    run<SliceAgg & { month: string }>(Prisma.sql`SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TIMEZONE}), 'YYYY-MM') AS month, COUNT(*)::int AS lines, COALESCE(SUM(plan), 0)::float8 AS plan, COALESCE(SUM(actual), 0)::float8 AS actual FROM ln WHERE settled GROUP BY 1 ORDER BY 1`),
    run<{ vendor_id: string; spend: number; entries: number }>(Prisma.sql`SELECT a."vendorId" AS vendor_id, SUM(a.amount)::float8 AS spend, COUNT(*)::int AS entries FROM act a GROUP BY 1 ORDER BY SUM(a.amount) DESC, 1`),
    run<{ component: string; spend: number; entries: number }>(Prisma.sql`SELECT a."component" AS component, SUM(a.amount)::float8 AS spend, COUNT(*)::int AS entries FROM act a GROUP BY 1 ORDER BY SUM(a.amount) DESC, 1`),
  ])
  const vendors = byVendor.length ? await prisma.vendor.findMany({ where: { id: { in: byVendor.map(v => v.vendor_id) } }, select: { id: true, name: true } }) : []
  const names = new Map(vendors.map(v => [v.id, v.name]))
  const s = settled[0]!
  return {
    params: p,
    summary: {
      settled: { ...slice(s), overrunLines: s.overrun, savingLines: s.saving, onPlanLines: s.onplan },
      partial: { lines: partial[0]!.lines, planIdr: money(partial[0]!.plan), paidIdr: money(partial[0]!.paid) },
      spendWithoutPlanIdr: money(spend[0]!.without_plan), totalSpendIdr: money(spend[0]!.total),
    },
    byProduct: byProduct.map(r => ({ itemType: r.item_type, ...slice(r) })),
    byMonth: byMonth.map(r => ({ month: r.month, ...slice(r) })),
    spendByVendor: byVendor.map(r => ({ vendorId: r.vendor_id, label: names.get(r.vendor_id) ?? 'Vendor', spendIdr: money(r.spend), entries: r.entries })),
    spendByComponent: byComponent.map(r => ({ component: r.component, spendIdr: money(r.spend), entries: r.entries })),
  }
}

/** Baris rencana beserta aktualnya, urut selisih terbesar (mutlak) dulu. `onlyVariance` = hanya yang LUNAS dengan selisih ≠ 0. */
export async function getVarianceLines(p: VarianceParams, page: number, limit: number, onlyVariance = false): Promise<{ rows: VarianceLineRow[]; total: number }> {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new ReportInputError('Halaman/batas tidak valid')
  const b = base(p)
  const where = onlyVariance ? Prisma.sql`WHERE settled AND ABS(actual - plan) > 0.004` : Prisma.empty
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<Array<{ snapshot_id: string; booking_id: string; booking_code: string; created_at: Date; item_type: string; description: string; plan: number; actual: number; settled: boolean; notes: string | null }>>(Prisma.sql`
      ${b} SELECT * FROM ln ${where} ORDER BY ABS(actual - plan) DESC, booking_code, description, snapshot_id LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`${b} SELECT COUNT(*)::int AS n FROM ln ${where}`),
  ])
  return {
    total: count[0]!.n,
    rows: rows.map(r => ({
      snapshotId: r.snapshot_id, bookingId: r.booking_id, bookingCode: r.booking_code, createdAt: r.created_at.toISOString(), itemType: r.item_type, description: r.description,
      planIdr: money(r.plan), actualIdr: money(r.actual), varianceIdr: money(r.actual - r.plan), settled: r.settled, notes: r.notes,
    })),
  }
}
