import type { ItemRow } from './ItemRows'

// Visa sebagai BARIS produk (docs/rencana-visa-produk.md §2.2): admin memilih produk visa + lama tinggal + jumlah orang seperti produk lain, tetapi
// penyimpanannya TETAP per jamaah (`pilgrims[].visaProductId`/`selectedDurationDays` → satu pengajuan visa per orang). Baris Visa = tampilan kelompok atas
// slot jamaah; satu-satunya sumber kebenaran tetap slot. Modul ini murni (tanpa React) supaya pemetaan bisa diuji (scripts/test-visa-rows.ts).

/** Slot jamaah (draf: `{}` atau bervisa; revisi: jamaah lama/baru). `row` = kunci baris Visa pemiliknya (hanya di klien, dibuang sebelum dikirim). */
export type VisaSlot = {
  visaProductId?: string
  selectedDurationDays?: number
  /** Revisi: visa sudah diproses / jamaah memakai kartu tersimpan (R3) — visanya tak boleh diubah atau dilepas. */
  locked?: boolean
  /** Revisi: visa berasal dari Paket Umroh — diatur lewat baris paket, bukan baris Visa. */
  visaFromPackage?: boolean
  row?: string
}

let seq = 0
const newVisaRowKey = () => `v${Date.now().toString(36)}${(seq++).toString(36)}` // unik terhadap kunci baris ItemRows (awalan `r`)
const num = (v: string) => Math.max(0, Math.trunc(Number(v) || 0))
const daysOf = (row: ItemRow) => (num(row.f.extra.days ?? '') || undefined)
const untag = <T extends VisaSlot>(s: T): T => ({ ...s, row: undefined, visaProductId: undefined, selectedDurationDays: undefined })
const free = (s: VisaSlot) => !s.row && !s.visaProductId && !s.visaFromPackage && !s.locked

/** Baris Visa yang dikunci sebagian (revisi): jumlah anggota terkunci = batas bawah jumlah orang; produk/lama tinggal tak boleh diganti. */
export const lockedMembers = (slots: readonly VisaSlot[], rowKey: string) => slots.filter(s => s.row === rowKey && s.locked).length

/**
 * Slot → baris Visa: jamaah bervisa sendiri dikelompokkan per (produk, lama tinggal), urut kemunculan pertama. Mengembalikan baris dan slot yang sudah ditandai
 * pemiliknya. Visa paket tidak menjadi baris (sudah ada di baris paket).
 */
export function visaRowsFromSlots<T extends VisaSlot>(slots: readonly T[]): { rows: ItemRow[]; slots: T[] } {
  const keyOf = new Map<string, string>()
  const rows: ItemRow[] = []
  const tagged = slots.map(s => {
    if (!s.visaProductId || s.visaFromPackage) return { ...s, row: undefined }
    const group = `${s.visaProductId}|${s.selectedDurationDays ?? ''}`
    let key = keyOf.get(group)
    if (!key) {
      key = newVisaRowKey()
      keyOf.set(group, key)
      rows.push({ key, module: 'visa', f: { pick: s.visaProductId, start: '', end: '', people: '0', rooms: '1', extra: s.selectedDurationDays ? { days: String(s.selectedDurationDays) } : {} } })
    }
    return { ...s, row: key }
  })
  for (const r of rows) r.f.people = String(tagged.filter(s => s.row === r.key).length)
  return { rows, slots: tagged }
}

/**
 * Terapkan baris Visa ke slot: baris dihapus → anggotanya dilepas; produk/lama tinggal → semua anggota tak terkunci; jumlah naik → isi slot kosong dulu
 * (jamaah tanpa visa), sisanya slot baru dari `make()`; jumlah turun → lepas anggota tak terkunci dari belakang. Anggota terkunci tak pernah diubah.
 */
export function applyVisaRows<T extends VisaSlot>(slots: readonly T[], rows: readonly ItemRow[], make: () => T): T[] {
  const visa = rows.filter(r => r.module === 'visa')
  const keys = new Set(visa.map(r => r.key))
  const next = slots.map(s => (s.row && !keys.has(s.row) && !s.locked ? untag(s) : s))
  for (const row of visa) {
    const v = row.f.pick || undefined
    const d = daysOf(row)
    const members = next.flatMap((s, i) => (s.row === row.key ? [i] : []))
    const want = Math.max(num(row.f.people), members.filter(i => next[i]!.locked).length)
    for (const i of members) if (!next[i]!.locked) next[i] = { ...next[i]!, visaProductId: v, selectedDurationDays: d }
    let have = members.length
    for (let i = 0; i < next.length && have < want; i++) {
      if (free(next[i]!)) { next[i] = { ...next[i]!, row: row.key, visaProductId: v, selectedDurationDays: d }; have++ }
    }
    while (have < want) { next.push({ ...make(), row: row.key, visaProductId: v, selectedDurationDays: d }); have++ }
    for (let j = members.length - 1; j >= 0 && have > want; j--) {
      const i = members[j]!
      if (!next[i]!.locked) { next[i] = untag(next[i]!); have-- }
    }
  }
  return next
}

/** Jumlah orang tiap baris Visa = anggota sebenarnya (sesudah slot dipangkas/diubah di luar baris), supaya baris tak pernah berbohong. */
export function syncVisaCounts(rows: readonly ItemRow[], slots: readonly VisaSlot[]): ItemRow[] {
  return rows.map(r => {
    if (r.module !== 'visa') return r
    const n = String(slots.filter(s => s.row === r.key).length)
    return r.f.people === n ? r : { ...r, f: { ...r.f, people: n } }
  })
}

/** Subtotal tiap baris Visa = Σ harga visa anggotanya dari pratinjau server (`pilgrimVisaTotals`, urut slot); bukan harga yang dihitung di klien. */
export function visaRowTotal(slots: readonly VisaSlot[], rowKey: string, perSlot: readonly number[] | undefined): number | undefined {
  if (!perSlot) return undefined
  return slots.reduce((sum, s, i) => (s.row === rowKey ? sum + (perSlot[i] ?? 0) : sum), 0)
}

/** Slot → bentuk kirim: kunci baris dibuang. */
export const stripRow = <T extends VisaSlot>({ row: _row, ...rest }: T): Omit<T, 'row'> => rest // eslint-disable-line @typescript-eslint/no-unused-vars
