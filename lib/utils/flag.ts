// Konversi kode negara ISO 3166-1 alpha-2 jadi emoji bendera lewat Unicode Regional
// Indicator Symbol — tidak perlu simpan/muat gambar bendera terpisah.
// docs/arsitektur-komponen-kontak.md §3.1.
export function isoToFlagEmoji(iso2: string): string {
  return [...iso2.toUpperCase()].map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('')
}
