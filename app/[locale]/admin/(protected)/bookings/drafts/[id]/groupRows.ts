import { groupLabel } from '@/lib/booking/groups'
import type { ItemRow } from './ItemRows'
import { visaRowsFromSlots, type VisaSlot } from './visaRows'

// Rombongan di editor draf & revisi admin (docs/arsitektur-booking-engine-v2.md §10.8, 11d-2a). MURNI (tanpa React) supaya bisa diuji (scripts/test-group-rows.ts).
// Rombongan = indeks; slot jamaah dan baris produk menunjuknya lewat `group` (kosong = semua jamaah). Satu rombongan tidak pernah disimpan — tanpa rombongan = perilaku lama.

/** Rombongan di editor: `id` = rombongan tersimpan (revisi), `label` kosong = "Rombongan A/B/…", `plannedTravelDate` kosong = ikut tiket. */
export type GroupDraft = { id?: string; label: string; plannedTravelDate: string }

/** Ringkasan rombongan untuk baris produk: nama tampil + ukuran (jumlah slot jamaah) + total jamaah. `null` = tanpa rombongan. */
export type Grouping = { names: string[]; sizes: number[]; total: number }

export function grouping(groups: readonly GroupDraft[], slots: ReadonlyArray<{ group?: number }>): Grouping | null {
  if (groups.length < 2) return null
  const sizes = groups.map((_, g) => slots.filter(s => s.group === g).length)
  return { names: groups.map((g, i) => groupLabel(g.label.trim() || null, i)), sizes, total: slots.length }
}

/** Bentuk kirim (draf/revisi): nama dipangkas, isian kosong dibuang. */
export const groupsInput = (groups: readonly GroupDraft[]) => groups.map(g => ({
  ...(g.id && { id: g.id }), ...(g.label.trim() && { label: g.label.trim() }), ...(g.plannedTravelDate && { plannedTravelDate: g.plannedTravelDate }),
}))

/**
 * Mulai berrombongan: semua slot ke rombongan pertama, baris Visa ikut rombongan pertama, produk lain untuk semua; rombongan kedua mendapat `second` slot baru
 * (draf: 1 slot kosong; revisi: 0 — admin memindahkan jamaah lama ke sana).
 */
export function startGroups<T extends VisaSlot>(slots: readonly T[], rows: readonly ItemRow[], second: T[]): { groups: GroupDraft[]; slots: T[]; rows: ItemRow[] } {
  return {
    groups: [{ label: '', plannedTravelDate: '' }, { label: '', plannedTravelDate: '' }],
    slots: [...slots.map(s => ({ ...s, group: 0 })), ...second.map(s => ({ ...s, group: 1 }))],
    rows: rows.map(r => ({ ...r, group: r.module === 'visa' ? 0 : undefined })),
  }
}

/** Geser rujukan rombongan sesudah rombongan `g` dihapus: rujukan ke `g` → `to` (undefined = semua), sesudahnya turun satu. */
const shift = (group: number | undefined, g: number, to: number | undefined) => (group === undefined ? undefined : group === g ? to : group > g ? group - 1 : group)

/**
 * Hapus rombongan `g`. Draf (`dropSlots`): slot jamaahnya ikut terhapus (jumlah jamaah berkurang). Revisi: jamaahnya pindah ke rombongan pertama yang tersisa.
 * Produk rombongan itu menjadi "semua"; baris Visa ikut jamaahnya (draf: dihapus bersama slotnya). Tinggal satu rombongan → rombongan ditiadakan.
 */
export function removeGroup<T extends VisaSlot>(groups: readonly GroupDraft[], slots: readonly T[], rows: readonly ItemRow[], g: number, dropSlots: boolean): { groups: GroupDraft[]; slots: T[]; rows: ItemRow[] } {
  const rest = groups.filter((_, i) => i !== g)
  const to = dropSlots ? undefined : 0
  let nextSlots = (dropSlots ? slots.filter(s => s.group !== g || s.locked) : slots).map(s => ({ ...s, group: shift(s.group, g, s.group === g ? 0 : to) }))
  const visaKeys = new Set(nextSlots.flatMap(s => (s.row ? [s.row] : [])))
  let nextRows = rows.flatMap(r => {
    if (r.module === 'visa') {
      if (dropSlots && r.group === g && !visaKeys.has(r.key)) return []
      return [{ ...r, group: shift(r.group, g, 0) }]
    }
    return [{ ...r, group: shift(r.group, g, undefined) }]
  })
  if (rest.length < 2) {
    nextSlots = nextSlots.map(s => ({ ...s, group: undefined }))
    nextRows = nextRows.map(r => ({ ...r, group: undefined }))
    return { groups: [], slots: nextSlots, rows: nextRows }
  }
  return { groups: rest, slots: nextSlots, rows: nextRows }
}

/**
 * Draf: ubah ukuran rombongan `g` menjadi `n` (≥ jumlah slot bervisa/terkunci di dalamnya). Menambah = slot kosong baru; mengurangi = slot TANPA visa dari belakang.
 */
export function resizeGroup<T extends VisaSlot>(slots: readonly T[], g: number, n: number, make: () => T): T[] {
  const inGroup = slots.filter(s => s.group === g)
  const fixed = inGroup.filter(s => s.row || s.visaProductId || s.locked).length
  const want = Math.max(1, fixed, n)
  if (want >= inGroup.length) return [...slots, ...Array.from({ length: want - inGroup.length }, () => ({ ...make(), group: g }))]
  let drop = inGroup.length - want
  const out: T[] = []
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i]!
    if (drop > 0 && s.group === g && !s.row && !s.visaProductId && !s.locked) { drop--; continue }
    out.unshift(s)
  }
  return out
}

/** Nilai pilihan "Semua jamaah" (ChoiceSelect menganggap nilai kosong = belum memilih). */
export const ALL_GROUPS = 'all'
/** Pilihan rombongan untuk kolom baris: "Semua jamaah" (kecuali baris Visa — visa melekat ke orang) + nama rombongan. Nilai = indeks sebagai teks. */
export function groupChoices(names: readonly string[], allowAll: boolean): Array<{ id: string; label: string }> {
  return [...(allowAll ? [{ id: ALL_GROUPS, label: 'Semua jamaah' }] : []), ...names.map((label, i) => ({ id: String(i), label }))]
}
/** Nilai pilihan ↔ indeks rombongan. */
export const groupValue = (group: number | undefined) => (group === undefined ? ALL_GROUPS : String(group))
export const groupFromValue = (v: string) => (v === ALL_GROUPS || v === '' ? undefined : Number(v))

/**
 * Revisi: pindahkan slot `i` ke rombongan `group`. Jamaah bervisa membawa visanya → baris Visa disusun ulang dari slot (per produk, lama tinggal, rombongan);
 * baris produk lain tidak berubah.
 */
export function moveSlot<T extends VisaSlot>(slots: readonly T[], rows: readonly ItemRow[], i: number, group: number | undefined): { slots: T[]; rows: ItemRow[] } {
  const moved = slots.map((s, j) => (j === i ? { ...s, group } : s))
  if (!slots[i]?.row) return { slots: moved, rows: [...rows] }
  const v = visaRowsFromSlots(moved.map(s => ({ ...s, row: undefined })))
  return { slots: v.slots, rows: [...v.rows, ...rows.filter(r => r.module !== 'visa')] }
}
