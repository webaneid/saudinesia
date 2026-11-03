// Kunci nama untuk pencocokan identitas (docs/arsitektur-jamaah.md §4.1, §5) — murni. Bukan untuk tampilan.
// Huruf kecil, tanpa diakritik/tanda baca, spasi tunggal; gelar akademik sesudah koma dibuang, gelar sapaan di depan dibuang.
// Sengaja konservatif: nama yang beda ejaan (Muhammad/Mohammad) TIDAK disamakan — perbedaan seperti itu jadi `conflict` untuk ditinjau admin.

const LEADING_TITLES = new Set(['h', 'hj', 'haji', 'hajjah', 'kh', 'dr', 'drs', 'dra', 'ir', 'prof', 'ust', 'ustadz', 'ustadzah', 'tn', 'ny', 'nn', 'mr', 'mrs', 'ms', 'sdr', 'sdri'])

export function nameKeyOf(fullName: string): string {
  const beforeComma = fullName.split(',')[0] ?? ''
  const words = beforeComma
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean)
  while (words.length > 1 && LEADING_TITLES.has(words[0]!)) words.shift()
  return words.join(' ') || fullName.trim().toLowerCase().replace(/\s+/g, ' ') // aksara non-Latin: tetap punya kunci
}
