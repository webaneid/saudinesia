// Nama tampilan rombongan (docs/arsitektur-booking-engine-v2.md §10.8). MURNI dan TANPA impor galat berkode — komponen klien (GroupsBox admin)
// mengimpornya; `groups.ts` meneruskannya. Galat berkode (`lib/errors/api.ts`) memuat katalog pesan dan khusus server.

/** Nama tampilan rombongan: nama dari pemesan, selain itu "Rombongan A/B/…" (posisi 0 → A; lewat Z → nomor). */
export function groupLabel(label: string | null | undefined, index: number, unnamed: (mark: string) => string = m => `Rombongan ${m}`): string {
  if (label) return label
  return unnamed(groupMark(index))
}

/** Penanda rombongan tanpa nama: posisi 0 → "A" … 25 → "Z", sesudahnya nomor. */
export const groupMark = (index: number): string => (index < 26 ? String.fromCharCode(65 + index) : String(index + 1))
