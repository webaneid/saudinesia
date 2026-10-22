// Satu-satunya daftar node/format/atribut teks kaya yang sah. Editor (klien), validator (server) dan tampilan membaca
// daftar ini supaya tidak pernah menyimpang. Menambah node (mis. tabel) = ubah di sini, lalu toolbar + tampilan.
// Lihat docs/arsitektur-editor-teks.md.

export const NODE_ATTRS: Record<string, readonly string[]> = {
  doc: [],
  paragraph: [],
  heading: ['level'],
  text: [],
  hardBreak: [],
  bulletList: [],
  orderedList: ['start', 'type'],
  listItem: [],
}

export const MARKS: readonly string[] = ['bold', 'italic', 'underline']

export const HEADING_LEVELS = [2, 3] as const

export const LIMITS = {
  maxChars: 100_000,
  maxNodes: 5_000,
  maxDepth: 12,
} as const

export const ORDERED_LIST_TYPES: readonly string[] = ['1', 'a', 'A', 'i', 'I']
