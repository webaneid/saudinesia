import type { BookingItemInput } from '@/lib/validators/booking'
import type { BookingInput } from './create'
import { ItemNotBookableError } from './errors'

// Rombongan dalam satu booking (docs/arsitektur-booking-engine-v2.md §10.8, Fase 11d). MURNI — dipakai mesin pesan (create/lineItems/ruleContext).
// Booking tanpa `groups` = satu rombongan (perilaku lama, tak ada yang berubah). Dengan `groups` (≥ 2): jamaah dibagi ke rombongan, item menunjuk satu
// rombongan atau semua (K11d-2 = a), dan jumlah orang item = ukuran sasarannya (diturunkan, bukan dari masukan).

export const isGrouped = (data: Pick<BookingInput, 'groups'>): boolean => (data.groups?.length ?? 0) > 0

/** Ukuran setiap rombongan (jumlah jamaah yang menunjuknya). */
export function groupSizes(data: Pick<BookingInput, 'groups' | 'pilgrims'>): number[] {
  const sizes = Array.from({ length: data.groups?.length ?? 0 }, () => 0)
  for (const p of data.pilgrims) if (p.group !== undefined && p.group < sizes.length) sizes[p.group]!++
  return sizes
}

/** Jumlah orang sasaran item: rombongannya, atau seluruh jamaah bila item untuk semua. */
export function targetSize(data: Pick<BookingInput, 'groups' | 'pilgrims'>, group: number | undefined): number {
  return group === undefined ? data.pilgrims.length : (groupSizes(data)[group] ?? 0)
}

/** Nama tampilan rombongan: nama dari pemesan, selain itu "Rombongan A/B/…" (posisi 0 → A; lewat Z → nomor). */
export function groupLabel(label: string | null | undefined, index: number): string {
  if (label) return label
  return index < 26 ? `Rombongan ${String.fromCharCode(65 + index)}` : `Rombongan ${index + 1}`
}

function setPeople(item: BookingItemInput, n: number): BookingItemInput {
  switch (item.itemType) {
    case 'transport': case 'flight': return { ...item, numPassengers: n }
    case 'muthowif': case 'catering': case 'tourPackage': case 'package': return { ...item, numPeople: n }
    case 'haji': return { ...item, numPersons: n }
    case 'hotel': return item // tamu hotel = ukuran sasaran (lineItems), jumlah kamar bebas
  }
}

/**
 * Periksa bentuk rombongan dan turunkan jumlah orang setiap item dari ukuran sasarannya. Tanpa rombongan → masukan dikembalikan apa adanya
 * (rujukan rombongan tanpa `groups` ditolak). Bentuk tak sah → `ItemNotBookableError` (422) — skema draf sudah menolaknya lebih awal dengan pesan per kolom.
 */
export function normalizeGroups(data: BookingInput): BookingInput {
  const n = data.groups?.length ?? 0
  if (n === 0) {
    if (data.items.some(i => i.group !== undefined) || data.pilgrims.some(p => p.group !== undefined)) throw new ItemNotBookableError('Rombongan tidak dikenal')
    return data
  }
  if (n < 2) throw new ItemNotBookableError('Rombongan dipakai bila lebih dari satu')
  if (data.pilgrims.some(p => p.group === undefined || p.group < 0 || p.group >= n)) throw new ItemNotBookableError('Setiap jamaah harus masuk satu rombongan')
  if (data.items.some(i => i.group !== undefined && (i.group < 0 || i.group >= n))) throw new ItemNotBookableError('Rombongan item tidak dikenal')
  const sizes = groupSizes(data)
  const empty = sizes.findIndex(s => s === 0)
  if (empty >= 0) throw new ItemNotBookableError(`${groupLabel(data.groups![empty]!.label, empty)} belum punya jamaah`)
  return { ...data, totalPilgrims: data.pilgrims.length, items: data.items.map(i => setPeople(i, targetSize(data, i.group))) }
}

/**
 * Isi booking yang berlaku untuk rombongan `g`: item rombongan itu + item untuk semua, jamaah rombongan itu; `packages`/`tours` (hasil resolusi berurutan
 * menurut kemunculan item jenisnya) disaring sejalan. Dipakai aturan Visa Plus per rombongan (K11d-1 = a).
 */
export function scopeToGroup<P, T>(data: BookingInput, packages: readonly P[], tours: readonly T[], g: number): { data: BookingInput; packages: P[]; tours: T[] } {
  const items: BookingItemInput[] = []
  const pk: P[] = []
  const tr: T[] = []
  let pi = 0
  let ti = 0
  for (const item of data.items) {
    const inScope = item.group === undefined || item.group === g
    if (item.itemType === 'package') { const r = packages[pi++]; if (inScope && r !== undefined) pk.push(r) }
    if (item.itemType === 'tourPackage') { const r = tours[ti++]; if (inScope && r !== undefined) tr.push(r) }
    if (inScope) items.push(item)
  }
  return { data: { ...data, items, pilgrims: data.pilgrims.filter(p => p.group === g) }, packages: pk, tours: tr }
}
