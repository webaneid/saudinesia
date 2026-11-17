import { NextResponse } from 'next/server'

// Ekspor CSV laporan admin (Laporan Untung, Buku Kas, Arus Kas, PPN) — satu tempat untuk pengamanan sel dan header respons.
export const CSV_MAX_ROWS = 10_000

/** Satu sel CSV. Teks yang diawali = + - @ tab/CR bisa dibaca spreadsheet sebagai rumus (CSV injection) → diberi awalan '; angka murni tak diberi awalan. */
export function csvCell(v: string | number | null): string {
  if (v === null) return ''
  const s = String(v)
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Respons unduhan CSV (UTF-8, tak di-cache). `filename` dibentuk pemanggil dari nilai tervalidasi (tanggal YYYY-MM-DD), bukan teks bebas. */
export function csvResponse(head: string[], rows: Array<Array<string | number | null>>, filename: string): NextResponse {
  const lines = [head.join(','), ...rows.map(r => r.map(csvCell).join(','))]
  return new NextResponse(`${lines.join('\n')}\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
  })
}
