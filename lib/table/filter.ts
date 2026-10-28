// Murni (tanpa Prisma/next/*) — dipakai FilterSelect (klien) dan tes. Satu tempat untuk aturan "autocomplete" dan tautan filter.
import { buildListHref } from '@/lib/table/pagination'

export type FilterOption = { value: string; label: string }

/** Pilihan yang cocok dengan teks ketikan (tak peka huruf, cocok di mana saja pada label). Teks kosong = semua pilihan. */
export function filterOptions(options: readonly FilterOption[], query: string): FilterOption[] {
  const q = query.trim().toLowerCase()
  return q ? options.filter(o => o.label.toLowerCase().includes(q)) : [...options]
}

/** Tautan hasil memilih satu nilai filter: param lain dipertahankan, halaman kembali ke 1, nilai kosong ("Semua") membuang param. */
export function filterHref(base: string, query: Record<string, string | number | undefined>, param: string, value: string): string {
  return buildListHref(base, { ...query, [param]: value || undefined, page: 1 })
}
