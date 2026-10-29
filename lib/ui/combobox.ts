// Murni (tanpa React/Prisma) — aturan pencarian `AutocompleteSelect` dan tesnya (docs/arsitektur-combobox.md §3).

export type ComboOption = {
  id: string
  label: string
  /** Teks pendamping di sisi kanan daftar (kode telepon, harga, kota…). Ikut dicari. */
  hint?: string
  /** Kode negara ISO 3166-1 alpha-2: bendera SVG di depan label (`Flag`). Tidak ikut dicari (pakai `keywords: kode` bila perlu). */
  flag?: string
  /** Teks ringkas untuk kotak terpilih bila label terlalu panjang (mis. "+62"). Bawaan: label. */
  short?: string
  /** Kata kunci tambahan yang ikut dicari tetapi tidak tampil (mis. kode ISO). */
  keywords?: string
}

/** Huruf kecil, tanpa diakritik, tanpa "+" di depan — "+966", "966", "Arab", "arab saudi" semuanya bisa mencocokkan. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/^\++/, '').trim()
}

function score(o: ComboOption, q: string): number {
  const label = normalizeSearch(o.label)
  if (label.startsWith(q)) return 0
  if (label.split(/[\s\-/(),.]+/).some(w => w.startsWith(q))) return 1
  const hint = normalizeSearch(o.hint ?? '')
  if (hint.startsWith(q)) return 2
  const rest = normalizeSearch(`${o.hint ?? ''} ${o.keywords ?? ''}`)
  if (rest.split(/\s+/).some(w => w.startsWith(q))) return 3
  if (label.includes(q) || rest.includes(q)) return 4
  return -1
}

/** Pilihan yang cocok, yang diawali ketikan lebih dulu (urutan asal dipertahankan di dalam tiap tingkat). Teks kosong = semua. */
export function matchOptions<T extends ComboOption>(options: readonly T[], query: string): T[] {
  const q = normalizeSearch(query)
  if (!q) return [...options]
  const scored: { o: T; s: number; i: number }[] = []
  options.forEach((o, i) => { const s = score(o, q); if (s >= 0) scored.push({ o, s, i }) })
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).map(x => x.o)
}
