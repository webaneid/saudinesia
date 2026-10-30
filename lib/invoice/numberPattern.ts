// Murni — pola nomor invoice (docs/arsitektur-booking-engine-v2.md §6). Dipakai validasi, pratinjau di halaman setelan, dan penerbitan (lib/invoice/numbering.ts).
export const NUMBER_TOKENS = ['{PREFIX}', '{YYYY}', '{YY}', '{MM}', '{SEQ}'] as const
export const NUMBER_PATTERN_MAX = 60
export const NUMBER_PREFIX_RE = /^[A-Za-z0-9._/-]{0,12}$/
const LITERAL_RE = /^[A-Za-z0-9._/-]*$/

/** Pesan galat bila pola tak sah, `null` bila sah. Aturan: hanya token yang dikenal + huruf/angka/`. _ / -`; tepat satu {SEQ}; bila nomor diulang tiap tahun wajib ada {YYYY} atau {YY} (kalau tidak nomor bentrok antartahun). */
export function numberPatternError(pattern: string, resetYearly: boolean): string | null {
  if (pattern.length === 0 || pattern.length > NUMBER_PATTERN_MAX) return `Pola nomor 1–${NUMBER_PATTERN_MAX} karakter`
  const literals = NUMBER_TOKENS.reduce((acc, t) => acc.split(t).join('\u0000'), pattern).split('\u0000').join('')
  if (/[{}]/.test(literals)) return 'Pola nomor memuat token yang tidak dikenal (yang tersedia: {PREFIX} {YYYY} {YY} {MM} {SEQ})'
  if (!LITERAL_RE.test(literals)) return 'Pola nomor hanya boleh huruf, angka, titik, garis bawah, garis miring, dan tanda hubung'
  if (pattern.split('{SEQ}').length !== 2) return 'Pola nomor harus memuat {SEQ} tepat satu kali'
  if (resetYearly && !pattern.includes('{YYYY}') && !pattern.includes('{YY}')) return 'Nomor diulang tiap tahun — pola harus memuat {YYYY} atau {YY}'
  return null
}

export type NumberParts = { prefix: string; year: number; month: number; seq: number; padding: number }
/** Nomor invoice dari pola: `{PREFIX}-{YYYY}-{SEQ}` + (INV, 2026, 7, padding 4) → `INV-2026-0007`. Urut yang melebihi lebar tetap utuh (tak dipotong). */
export function formatInvoiceNumber(pattern: string, p: NumberParts): string {
  return pattern
    .split('{PREFIX}').join(p.prefix)
    .split('{YYYY}').join(String(p.year).padStart(4, '0'))
    .split('{YY}').join(String(p.year % 100).padStart(2, '0'))
    .split('{MM}').join(String(p.month).padStart(2, '0'))
    .split('{SEQ}').join(String(p.seq).padStart(p.padding, '0'))
}
