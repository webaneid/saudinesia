// Pemeriksaan kewajaran kurs dari API publik sebelum disimpan (SEC-307). Murni — diuji scripts/test-exchange-rate-sanity.ts.
// Kurs tersimpan langsung menjadi HPP dan harga jual otomatis (harga manual tetap menang), jadi nilai rusak/anomali dari API
// TIDAK disimpan: kurs terakhir tetap dipakai dan cron mencatat peringatan.

/** Rentang longgar kurs ke IDR (kolom Decimal(12,4)); di luar ini pasti rusak. */
export const RATE_MIN = 1
export const RATE_MAX = 1_000_000
/** Lonjakan maksimum terhadap kurs tersimpan terakhir per pengambilan (cron 2× sehari). */
export const MAX_JUMP = 0.1
/**
 * Kurs tersimpan lebih tua dari ini → lonjakan diterima (dengan peringatan) sebagai patokan baru. Tanpa ini perubahan nyata > 10%
 * (krisis) membekukan kurs selamanya — API harus konsisten memberi level baru selama 3 hari penuh baru diterima.
 */
export const REBASE_AFTER_MS = 72 * 60 * 60 * 1000
/** SAR dipatok ke USD sejak 1986. */
export const SAR_USD_PEG = 3.75
export const PEG_TOLERANCE = 0.02

export type RateCheck = {
  from: string
  mid: unknown
  /** Kurs tengah tersimpan terakhir untuk pasangan ini (null = belum ada). */
  previous: { mid: number; fetchedAt: Date } | null
  now: Date
  /** Kurs tengah USD→IDR yang DITERIMA di pengambilan yang sama (untuk patokan SAR). */
  acceptedUsdMid?: number
}
export type RateVerdict =
  | { ok: true; rebased: boolean }
  | { ok: false; reason: 'invalid' | 'out_of_range' | 'jump' | 'peg'; detail: string }

export function assessExchangeRate(c: RateCheck): RateVerdict {
  const { mid } = c
  if (typeof mid !== 'number' || !Number.isFinite(mid) || mid <= 0) return { ok: false, reason: 'invalid', detail: String(mid) }
  if (mid < RATE_MIN || mid > RATE_MAX) return { ok: false, reason: 'out_of_range', detail: `${mid}` }

  if (c.from === 'SAR' && c.acceptedUsdMid !== undefined) {
    const implied = c.acceptedUsdMid / mid
    if (Math.abs(implied - SAR_USD_PEG) / SAR_USD_PEG > PEG_TOLERANCE)
      return { ok: false, reason: 'peg', detail: `USD/SAR tersirat ${implied.toFixed(3)}, patokan ${SAR_USD_PEG}` }
  }

  let rebased = false
  if (c.previous && c.previous.mid > 0) {
    const jump = Math.abs(mid / c.previous.mid - 1)
    if (jump > MAX_JUMP) {
      if (c.now.getTime() - c.previous.fetchedAt.getTime() <= REBASE_AFTER_MS)
        return { ok: false, reason: 'jump', detail: `${c.previous.mid} → ${mid} (${(jump * 100).toFixed(1)}%)` }
      rebased = true
    }
  }
  return { ok: true, rebased }
}
