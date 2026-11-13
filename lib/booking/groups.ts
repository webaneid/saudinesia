import type { BookingItemInput } from '@/lib/validators/booking'
import type { BookingInput } from './create'
import { ItemNotBookableError } from './errors'
import { groupLabel } from './groupNames'

// Rombongan dalam satu booking (docs/arsitektur-booking-engine-v2.md §10.8, Fase 11d). MURNI — dipakai mesin pesan (create/lineItems/ruleContext).
// Booking tanpa `groups` = satu rombongan (perilaku lama, tak ada yang berubah). Dengan `groups` (≥ 2): jamaah dibagi ke rombongan, item menunjuk satu
// rombongan atau semua (K11d-2 = a), dan jumlah orang item = ukuran sasarannya (diturunkan, bukan dari masukan).

export const isGrouped = (data: Pick<BookingInput, 'groups'>): boolean => (data.groups?.length ?? 0) > 0

/** Ukuran setiap rombongan (jumlah jamaah yang menunjuknya), atau `groupSizes` bila `pilgrims` hanya sebagian (revisi menulis subset). */
export function groupSizes(data: Pick<BookingInput, 'groups' | 'pilgrims' | 'groupSizes'>): number[] {
  if (data.groupSizes) return data.groupSizes
  const sizes = Array.from({ length: data.groups?.length ?? 0 }, () => 0)
  for (const p of data.pilgrims) if (p.group !== undefined && p.group < sizes.length) sizes[p.group]!++
  return sizes
}

/** Jumlah orang sasaran item: rombongannya, atau seluruh jamaah (`totalPilgrims` bila `pilgrims` sebagian) bila item untuk semua. */
export function targetSize(data: Pick<BookingInput, 'groups' | 'pilgrims' | 'groupSizes' | 'totalPilgrims'>, group: number | undefined): number {
  return group === undefined ? (data.totalPilgrims ?? data.pilgrims.length) : (groupSizes(data)[group] ?? 0)
}

/**
 * Rencana berangkat visa untuk jamaah rombongan `group` (§10.8 butir 4): tiket paling awal yang berlaku untuknya (tiket rombongannya ∪ tiket untuk semua),
 * selain itu rencana rombongan, selain itu rencana booking. Satu aturan untuk pesan baru (lib/booking/lineItems.ts) dan revisi (lib/booking/revise.ts).
 */
export function plannedTravelFor(
  flights: ReadonlyArray<{ date: string; group?: number }>, group: number | undefined, groups: BookingInput['groups'], fallback: string | undefined,
): string | undefined {
  const dates = flights.filter(f => group === undefined || f.group === undefined || f.group === group).map(f => f.date).sort()
  return dates[0] ?? (group !== undefined ? groups?.[group]?.plannedTravelDate : undefined) ?? fallback
}

// Nama tampilan rombongan ada di groupNames.ts (bebas galat berkode — dipakai komponen klien admin); diteruskan dari sini untuk pemakai lama.
export { groupLabel, groupMark } from './groupNames'

/** Teks bawaan dalam bahasa halaman (halaman jamaah); tanpa ini = Indonesia (admin, invoice, ZIP). Nama yang diberi pemesan tak diterjemahkan. */
export type GroupNames = { all: string; unnamed: (mark: string) => string }

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
    if (data.items.some(i => i.group !== undefined) || data.pilgrims.some(p => p.group !== undefined)) throw new ItemNotBookableError('groupUnknown')
    return data
  }
  if (n < 2) throw new ItemNotBookableError('groupNeedsTwo')
  if (data.pilgrims.some(p => p.group === undefined || p.group < 0 || p.group >= n)) throw new ItemNotBookableError('groupEveryPilgrim')
  if (data.items.some(i => i.group !== undefined && (i.group < 0 || i.group >= n))) throw new ItemNotBookableError('groupItemUnknown')
  const full = { ...data, totalPilgrims: data.pilgrims.length, groupSizes: undefined } // ukuran dihitung dari jamaah LENGKAP, bukan masukan
  const sizes = groupSizes(full)
  const empty = sizes.findIndex(s => s === 0)
  if (empty >= 0) throw new ItemNotBookableError('groupEmpty', { group: groupLabel(data.groups![empty]!.label, empty) })
  return { ...full, items: data.items.map(i => setPeople(i, targetSize(full, i.group))) }
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

/** Nama bagian untuk item yang berlaku bagi semua jamaah (booking berrombongan). */
export const ALL_PILGRIMS_LABEL = 'Semua jamaah'

export type GroupView = {
  /** Nama tampilan rombongan item/jamaah; `null`/tak dikenal = "Semua jamaah". */
  name: (groupId: string | null | undefined) => string
  /** Urutan tampil: semua jamaah = 0, lalu posisi rombongan (1, 2, …). */
  rank: (groupId: string | null | undefined) => number
}

/**
 * Pembaca nama rombongan untuk TAMPILAN (detail booking, invoice, ZIP dokumen — §10.8, 11d-2b). Nama selalu dirender dari `booking_groups.label` saat baca,
 * tidak pernah dibekukan di snapshot. `null` = booking tanpa rombongan (tampilan lama, tanpa subjudul).
 */
export function groupView(groups: ReadonlyArray<{ id: string; label: string | null; position: number }>, names?: GroupNames): GroupView | null {
  if (groups.length === 0) return null
  const sorted = [...groups].sort((a, b) => a.position - b.position)
  const index = new Map(sorted.map((g, i) => [g.id, i]))
  return {
    name: id => { const i = id ? index.get(id) : undefined; return i === undefined ? (names?.all ?? ALL_PILGRIMS_LABEL) : groupLabel(sorted[i]!.label, i, names?.unnamed) },
    rank: id => { const i = id ? index.get(id) : undefined; return i === undefined ? 0 : i + 1 },
  }
}
