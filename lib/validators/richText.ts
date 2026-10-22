import { z } from 'zod'
import { HEADING_LEVELS, LIMITS, MARKS, NODE_ATTRS, ORDERED_LIST_TYPES } from '../rich-text/schema'
import { hasContent, type RichNode } from '../rich-text/doc'

// Validasi + normalisasi kolom teks kaya (docs/arsitektur-editor-teks.md §4). Input TIDAK pernah disimpan mentah: hasilnya
// adalah salinan bersih yang hanya berisi type/attrs/content/text/marks dari daftar putih. Teks polos lama lolos apa adanya.

export class RichTextError extends Error {}

function reject(message: string): never {
  throw new RichTextError(message)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isSmallInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000

function cleanAttrs(type: string, raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) return reject('atribut tidak valid')
  const allowed = NODE_ATTRS[type] ?? []
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key)) return reject(`atribut "${key}" tidak diizinkan`)
    if (key === 'level' && !(HEADING_LEVELS as readonly unknown[]).includes(value)) return reject('hanya judul H2 dan H3')
    if (key === 'start' && value !== null && !isSmallInt(value)) return reject('nomor awal daftar tidak valid')
    if (key === 'type' && value !== null && !(typeof value === 'string' && ORDERED_LIST_TYPES.includes(value))) return reject('jenis daftar tidak valid')
    out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

function cleanNode(raw: unknown, depth: number, counter: { n: number }): RichNode {
  if (++counter.n > LIMITS.maxNodes) return reject('terlalu panjang')
  if (depth > LIMITS.maxDepth) return reject('struktur terlalu dalam')
  if (!isRecord(raw) || typeof raw.type !== 'string' || !Object.hasOwn(NODE_ATTRS, raw.type)) {
    return reject(`jenis "${isRecord(raw) ? String(raw.type) : typeof raw}" tidak diizinkan`)
  }
  const type = raw.type
  if (type === 'doc' && depth > 0) return reject('dokumen bersarang')

  const node: RichNode = { type }
  const attrs = cleanAttrs(type, raw.attrs)
  if (attrs) node.attrs = attrs
  if (type === 'heading' && node.attrs?.level === undefined) return reject('judul tanpa level')

  if (type === 'text') {
    if (typeof raw.text !== 'string') return reject('teks tidak valid')
    node.text = raw.text
    if (raw.marks !== undefined) {
      if (!Array.isArray(raw.marks)) return reject('format tidak valid')
      const marks = raw.marks.map((m: unknown) => {
        if (!isRecord(m) || typeof m.type !== 'string' || !MARKS.includes(m.type)) return reject(`format "${isRecord(m) ? String(m.type) : typeof m}" tidak diizinkan`)
        if (m.attrs !== undefined && !(isRecord(m.attrs) && Object.keys(m.attrs).length === 0)) return reject('atribut format tidak diizinkan')
        return { type: m.type }
      })
      if (marks.length) node.marks = marks
    }
    if (raw.content !== undefined) return reject('teks tidak boleh punya isi')
    return node
  }

  if (raw.text !== undefined || raw.marks !== undefined) return reject('teks di luar node teks')
  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) return reject('isi tidak valid')
    node.content = raw.content.map((c: unknown) => cleanNode(c, depth + 1, counter))
  }
  return node
}

/** Validasi & bersihkan nilai teks kaya; kembalikan string yang disimpan. Lempar `RichTextError` bila ditolak. */
export function sanitizeRichText(value: string): string {
  const s = value.trim()
  if (!s.startsWith('{')) return s // teks polos (data lama / tanpa editor)
  let parsed: unknown
  try {
    parsed = JSON.parse(s)
  } catch {
    return reject('bukan JSON yang sah')
  }
  if (!isRecord(parsed) || parsed.type !== 'doc') return reject('akar dokumen tidak valid')
  const clean = JSON.stringify(cleanNode(parsed, 0, { n: 0 }))
  if (clean.length > LIMITS.maxChars) return reject('terlalu panjang')
  return clean
}

/** Kolom teks kaya untuk skema Zod `.strict()`. Pakai `.nullish()` bila kolomnya opsional, lalu `emptyToNull()`. */
export function richTextField(maxChars: number = LIMITS.maxChars) {
  return z.string().max(maxChars, 'Isi terlalu panjang').transform((value, ctx) => {
    try {
      return sanitizeRichText(value)
    } catch (e) {
      if (!(e instanceof RichTextError)) throw e
      ctx.addIssue({ code: 'custom', message: `Isi teks tidak valid: ${e.message}` })
      return z.NEVER
    }
  })
}

/** Kolom `String?`: nilai tanpa teks bermakna (editor dikosongkan, atau hanya paragraf kosong) disimpan sebagai null. */
export const emptyToNull = (value: string | null | undefined): string | null => (value && hasContent(value) ? value : null)
