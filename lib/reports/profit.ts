import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getAppTimezone, daysBetween, endOfDayExclusiveInApp, isCalendarDate, startOfDayInApp, todayInApp } from '@/lib/time'

// LAPORAN UNTUNG dari snapshot harga (docs/arsitektur-harga-terpadu.md §19, Fase 6). Semua angka berasal dari `price_snapshots` (beku saat dipesan — tak bergeser oleh kurs/harga
// sesudahnya) + `payments`/`refunds`. SQL mentah ber-parameter ($queryRaw): Prisma ORM tidak mengekspresikan agregat per irisan + rasio dibayar per booking dalam satu kueri;
// semua nilai masuk lewat parameter terikat (tak ada penyambungan string dari masukan).
//
// Aturan (dijaga scripts/test-report-profit.ts dengan angka dihitung tangan):
//  - Dasar periode = tanggal PESANAN menurut WIB. Cakupan "recognized" = confirmed|active|completed; "with_pending" menambah awaiting_payment|payment_review. `cancelled` tak pernah masuk
//    penjualan/untung (uang yang ditahan dari pembatalan dilaporkan terpisah).
//  - Untung = Σ jual − Σ modal HANYA dari baris yang modalnya diketahui; jual tanpa modal dilaporkan terpisah (`sellUnknownCost`) dan menjadi "cakupan modal".
//    Baris `penyesuaian*` (selisih harga manual/diskon) bermodal 0 — modalnya ada di baris komponen. Pengecualian: sisa data lama (migrasi Fase 4: itemType booking yang itemId-nya BUKAN baris `booking_adjustments`) = modal tak diketahui —
//    dibedakan dari struktur, bukan dari label teks bebas yang bisa diketik staf.
//  - Terealisasi per booking = jual × rasio, rasio = clamp((Σ payment confirmed − Σ refund approved|paid) ÷ total, 0..1).

export class ReportInputError extends Error {
  constructor(message: string) { super(message); this.name = 'ReportInputError' }
}

export type ReportScope = 'recognized' | 'with_pending'
export type ReportParams = { from: string; to: string; scope: ReportScope }

const STATUSES: Record<ReportScope, string[]> = {
  recognized: ['confirmed', 'active', 'completed'],
  with_pending: ['confirmed', 'active', 'completed', 'awaiting_payment', 'payment_review'],
}
const MAX_RANGE_DAYS = 366 * 5

const money = (x: number | null | undefined): number => Math.round((x ?? 0) * 100) / 100

/** Batas periode menurut ZONA APLIKASI (lib/time): [from 00:00, to+1 hari 00:00). Tanggal tak sah / terbalik / terlalu panjang → ReportInputError. */
export function periodBounds(from: string, to: string): { fromTs: Date; toTs: Date } {
  const shape = /^\d{4}-\d{2}-\d{2}$/
  if (!shape.test(from) || !shape.test(to)) throw new ReportInputError('Tanggal harus berformat YYYY-MM-DD')
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new ReportInputError('Tanggal tidak valid')
  if (daysBetween(from, to) < 0) throw new ReportInputError('Tanggal akhir tidak boleh sebelum tanggal awal')
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw new ReportInputError('Rentang laporan maksimal 5 tahun')
  return { fromTs: startOfDayInApp(from), toTs: endOfDayExclusiveInApp(to) }
}

/** `bookings.createdAt` adalah `timestamp` TANPA zona (nilai UTC dari Prisma): batas dikirim sebagai teks UTC + cast `::timestamp` — jangan mengikat `Date` (driver mengubahnya ke zona sesi server). */
const utcText = (d: Date): string => d.toISOString().slice(0, 23).replace('T', ' ')

/** CTE dasar: `b` = booking dalam periode (+ uang masuk/keluar), `l` = baris snapshot-nya dengan modal (null = tak diketahui) dan rasio dibayar. */
function base(p: ReportParams) {
  const { fromTs, toTs } = periodBounds(p.from, p.to)
  return Prisma.sql`
    WITH b AS (
      SELECT bk."id", bk."bookingCode", bk."createdAt", bk."status"::text AS status, bk."totalAmount"::float8 AS total,
        COALESCE((SELECT SUM(py."amount") FROM "payments" py WHERE py."bookingId" = bk."id" AND py."status" = 'confirmed'), 0)::float8 AS paid,
        COALESCE((SELECT SUM(rf."amount") FROM "refunds" rf WHERE rf."bookingId" = bk."id" AND rf."status" IN ('approved', 'paid')), 0)::float8 AS refunded
      FROM "bookings" bk
      WHERE bk."createdAt" >= ${utcText(fromTs)}::timestamp AND bk."createdAt" < ${utcText(toTs)}::timestamp AND bk."status"::text = ANY(${STATUSES[p.scope]}::text[])
    ), l AS (
      SELECT b."id" AS booking_id, b."createdAt" AS created_at, s."itemType" AS item_type, s."vendorIds" AS vendor_ids, s."totalSellIdr"::float8 AS sell,
        CASE WHEN s."totalCostIdr" IS NOT NULL THEN s."totalCostIdr"::float8
             WHEN s."lineKey" LIKE 'penyesuaian%' AND (s."itemType" <> 'booking' OR EXISTS (SELECT 1 FROM "booking_adjustments" ba WHERE ba."id" = s."itemId")) THEN 0::float8
        END AS cost,
        CASE WHEN b.total > 0 THEN LEAST(1, GREATEST(0, (b.paid - b.refunded) / b.total)) ELSE 0 END AS ratio
      FROM "price_snapshots" s JOIN b ON b."id" = s."bookingId"
    )`
}

/** Agregat standar satu irisan (kolom `l`). */
const AGG = Prisma.sql`
  COALESCE(SUM(sell), 0)::float8 AS sell,
  COALESCE(SUM(cost), 0)::float8 AS cost,
  COALESCE(SUM(sell) FILTER (WHERE cost IS NOT NULL), 0)::float8 AS sell_known,
  COALESCE(SUM(sell) FILTER (WHERE cost IS NULL), 0)::float8 AS sell_unknown,
  COALESCE(SUM(sell * ratio), 0)::float8 AS realized_sell,
  COALESCE(SUM((sell - cost) * ratio) FILTER (WHERE cost IS NOT NULL), 0)::float8 AS realized_profit`

/** Untung teridentifikasi sebuah booking negatif (jual baris bermodal < modalnya). Dipakai di HAVING atas kolom `l` (atau `l.` pada kueri per-booking). */
const LOSS = Prisma.sql`COALESCE(SUM(sell) FILTER (WHERE cost IS NOT NULL), 0) - COALESCE(SUM(cost), 0) < -0.004`
const LOSS_L = Prisma.sql`COALESCE(SUM(l.sell) FILTER (WHERE l.cost IS NOT NULL), 0) - COALESCE(SUM(l.cost), 0) < -0.004`

type Agg = { sell: number; cost: number; sell_known: number; sell_unknown: number; realized_sell: number; realized_profit: number }
export type Figures = {
  /** Σ jual semua baris. */
  sellIdr: number
  /** Σ modal baris yang modalnya diketahui. */
  costKnownIdr: number
  /** Jual baris yang modalnya TIDAK diketahui (untungnya tak dapat diklaim). */
  sellUnknownCostIdr: number
  /** Untung teridentifikasi = jual baris bermodal − modalnya. */
  profitIdr: number
  /** Untung ÷ jual baris bermodal (%); null bila belum ada baris bermodal. */
  marginPct: number | null
  /** Bagian penjualan yang modalnya diketahui (%); null bila tak ada penjualan. */
  costCoveragePct: number | null
  realizedSellIdr: number
  realizedProfitIdr: number
}
const figures = (a: Agg): Figures => {
  const profit = a.sell_known - a.cost
  return {
    sellIdr: money(a.sell), costKnownIdr: money(a.cost), sellUnknownCostIdr: money(a.sell_unknown), profitIdr: money(profit),
    marginPct: a.sell_known > 0 ? Math.round((profit / a.sell_known) * 1000) / 10 : null,
    costCoveragePct: a.sell > 0 ? Math.round((a.sell_known / a.sell) * 1000) / 10 : null,
    realizedSellIdr: money(a.realized_sell), realizedProfitIdr: money(a.realized_profit),
  }
}

export type ProfitReport = {
  params: ReportParams
  summary: Figures & { bookings: number; paidIdr: number; refundedIdr: number; /** Pesanan yang untung teridentifikasinya negatif (di bawah HPP — mis. diskon melampaui margin). */ lossBookings: number }
  /** Uang ditahan dari booking yang dibatalkan pada periode yang sama (bayar terkonfirmasi − refund disetujui/dibayar, tak negatif). */
  cancelledRetained: { bookings: number; retainedIdr: number }
  byProduct: Array<Figures & { itemType: string }>
  byVendor: Array<Figures & { vendorId: string | null; label: string; kind: 'vendor' | 'multi' | 'none' }>
  byMonth: Array<Figures & { month: string }>
}
export type BookingProfitRow = Figures & { id: string; bookingCode: string; createdAt: string; status: string; totalIdr: number; paidIdr: number; refundedIdr: number; realizedRatio: number }

/** Ringkasan + irisan (produk, vendor, bulan). */
export async function getProfitReport(p: ReportParams): Promise<ProfitReport> {
  const b = base(p)
  const run = <T,>(tail: Prisma.Sql) => prisma.$queryRaw<T[]>(Prisma.sql`${b} ${tail}`)
  const bounds = periodBounds(p.from, p.to)
  const [sum, cash, byProduct, byVendor, byMonth, cancelled, loss] = await Promise.all([
    run<Agg>(Prisma.sql`SELECT ${AGG} FROM l`),
    run<{ bookings: number; paid: number; refunded: number }>(Prisma.sql`SELECT COUNT(*)::int AS bookings, COALESCE(SUM(paid), 0)::float8 AS paid, COALESCE(SUM(refunded), 0)::float8 AS refunded FROM b`),
    run<Agg & { item_type: string }>(Prisma.sql`SELECT item_type, ${AGG} FROM l GROUP BY item_type ORDER BY SUM(sell) DESC, item_type`),
    run<Agg & { bucket: string }>(Prisma.sql`
      SELECT CASE WHEN jsonb_array_length(vendor_ids) = 1 THEN vendor_ids->>0 WHEN jsonb_array_length(vendor_ids) > 1 THEN '__multi' ELSE '__none' END AS bucket, ${AGG}
      FROM l GROUP BY 1 ORDER BY SUM(sell) DESC, 1`),
    run<Agg & { month: string }>(Prisma.sql`SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE ${getAppTimezone()}), 'YYYY-MM') AS month, ${AGG} FROM l GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<Array<{ bookings: number; retained: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS bookings, COALESCE(SUM(GREATEST(0, x.paid - x.refunded)), 0)::float8 AS retained FROM (
        SELECT COALESCE((SELECT SUM(py."amount") FROM "payments" py WHERE py."bookingId" = bk."id" AND py."status" = 'confirmed'), 0)::float8 AS paid,
               COALESCE((SELECT SUM(rf."amount") FROM "refunds" rf WHERE rf."bookingId" = bk."id" AND rf."status" IN ('approved', 'paid')), 0)::float8 AS refunded
        FROM "bookings" bk WHERE bk."createdAt" >= ${utcText(bounds.fromTs)}::timestamp AND bk."createdAt" < ${utcText(bounds.toTs)}::timestamp AND bk."status"::text = 'cancelled') x
      WHERE x.paid > 0`),
    run<{ n: number }>(Prisma.sql`SELECT COUNT(*)::int AS n FROM (SELECT booking_id FROM l GROUP BY booking_id HAVING ${LOSS}) x`),
  ])

  const vendorIds = byVendor.map(r => r.bucket).filter(k => !k.startsWith('__'))
  const vendors = vendorIds.length ? await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(vendors.map(v => [v.id, v.name]))

  return {
    params: p,
    summary: { ...figures(sum[0]!), bookings: cash[0]!.bookings, paidIdr: money(cash[0]!.paid), refundedIdr: money(cash[0]!.refunded), lossBookings: loss[0]!.n },
    cancelledRetained: { bookings: cancelled[0]!.bookings, retainedIdr: money(cancelled[0]!.retained) },
    byProduct: byProduct.map(r => ({ itemType: r.item_type, ...figures(r) })),
    byVendor: byVendor.map(r => r.bucket === '__multi'
      ? { vendorId: null, kind: 'multi' as const, label: 'Beberapa vendor (baris campuran)', ...figures(r) }
      : r.bucket === '__none'
        ? { vendorId: null, kind: 'none' as const, label: 'Vendor tak tercatat', ...figures(r) }
        : { vendorId: r.bucket, kind: 'vendor' as const, label: nameOf.get(r.bucket) ?? 'Vendor (sudah dihapus)', ...figures(r) }),
    byMonth: byMonth.map(r => ({ month: r.month, ...figures(r) })),
  }
}

/** Daftar booking (terbaru dulu) dengan angka masing-masing; berhalaman. `limit` ≤ 10.000 (ekspor). */
export async function getBookingProfitRows(p: ReportParams, page: number, limit: number, onlyLoss = false): Promise<{ rows: BookingProfitRow[]; total: number }> {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new ReportInputError('Halaman/batas tidak valid')
  const b = base(p)
  const having = onlyLoss ? Prisma.sql`HAVING ${LOSS_L}` : Prisma.empty
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<Array<Agg & { id: string; booking_code: string; created_at: Date; status: string; total: number; paid: number; refunded: number; ratio: number }>>(Prisma.sql`
      ${b}
      SELECT b."id", b."bookingCode" AS booking_code, b."createdAt" AS created_at, b.status, b.total, b.paid, b.refunded,
        CASE WHEN b.total > 0 THEN LEAST(1, GREATEST(0, (b.paid - b.refunded) / b.total)) ELSE 0 END::float8 AS ratio,
        COALESCE(SUM(l.sell), 0)::float8 AS sell, COALESCE(SUM(l.cost), 0)::float8 AS cost,
        COALESCE(SUM(l.sell) FILTER (WHERE l.cost IS NOT NULL), 0)::float8 AS sell_known, COALESCE(SUM(l.sell) FILTER (WHERE l.cost IS NULL), 0)::float8 AS sell_unknown,
        COALESCE(SUM(l.sell * l.ratio), 0)::float8 AS realized_sell, COALESCE(SUM((l.sell - l.cost) * l.ratio) FILTER (WHERE l.cost IS NOT NULL), 0)::float8 AS realized_profit
      FROM b LEFT JOIN l ON l.booking_id = b."id"
      GROUP BY b."id", b."bookingCode", b."createdAt", b.status, b.total, b.paid, b.refunded
      ${having}
      ORDER BY b."createdAt" DESC, b."id"
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    onlyLoss
      ? prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`${b} SELECT COUNT(*)::int AS n FROM (SELECT booking_id FROM l GROUP BY booking_id HAVING ${LOSS}) x`)
      : prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`${b} SELECT COUNT(*)::int AS n FROM b`),
  ])
  return {
    total: count[0]!.n,
    rows: rows.map(r => ({
      id: r.id, bookingCode: r.booking_code, createdAt: r.created_at.toISOString(), status: r.status,
      totalIdr: money(r.total), paidIdr: money(r.paid), refundedIdr: money(r.refunded), realizedRatio: Math.round(r.ratio * 10000) / 10000,
      ...figures(r),
    })),
  }
}

/** Periode bawaan: tanggal 1 bulan ini s/d hari ini (zona aplikasi). */
export function defaultPeriod(now = new Date()): { from: string; to: string } {
  const today = todayInApp(now)
  return { from: `${today.slice(0, 8)}01`, to: today }
}
