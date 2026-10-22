// Helper dokumen teks kaya yang aman dipakai di klien MAUPUN server (tanpa Tiptap). Nilai tersimpan = JSON dokumen Tiptap
// sebagai string; teks polos lama (bukan JSON) tetap sah dan dibaca sebagai paragraf per baris.

export type RichNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  text?: string
  marks?: { type: string }[]
}

/** JSON dokumen → pohon; `null` bila nilainya teks polos atau JSON rusak. */
export function parseDoc(value: string | null | undefined): RichNode | null {
  const s = (value ?? '').trim()
  if (!s.startsWith('{')) return null
  try {
    const doc = JSON.parse(s) as RichNode
    return doc?.type === 'doc' ? doc : null
  } catch {
    return null
  }
}

/** Nilai tersimpan → konten awal editor. Teks polos lama menjadi satu paragraf per baris. */
export function toEditorContent(value: string | null | undefined): RichNode | string {
  const doc = parseDoc(value)
  if (doc) return doc
  const s = (value ?? '').trim()
  if (!s) return ''
  return {
    type: 'doc',
    content: s.split(/\r?\n/).map(line => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  }
}

function textOf(n: RichNode): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return '\n'
  return (n.content ?? []).map(textOf).join('')
}

/** Ada teks bermakna? (untuk penanda kelengkapan dan "kosong → null"). */
export function hasContent(value: string | null | undefined): boolean {
  const doc = parseDoc(value)
  if (!doc) return (value ?? '').trim().length > 0
  return textOf(doc).trim().length > 0
}

/**
 * Teks kaya → teks polos untuk kanal tanpa format (WhatsApp, email teks, ekspor, ringkasan satu baris).
 * Satu baris per blok; butir daftar diberi "• " / "1. ". Teks polos lama dikembalikan apa adanya;
 * JSON rusak → string kosong (tidak membocorkan JSON ke pengguna).
 */
export function plainText(value: string | null | undefined): string {
  const s = (value ?? '').trim()
  if (!s.startsWith('{')) return s
  const doc = parseDoc(s)
  if (!doc) return ''
  const lines: string[] = []
  const walk = (n: RichNode, prefix = '') => {
    const children = n.content ?? []
    if (n.type === 'bulletList' || n.type === 'orderedList') {
      children.forEach((li, i) => {
        const bullet = n.type === 'bulletList' ? '• ' : `${i + 1}. `
        ;(li.content ?? []).forEach((c, j) => walk(c, j === 0 ? bullet : '  '))
      })
    } else if (n.type === 'paragraph' || n.type === 'heading') {
      const t = textOf(n).trim()
      if (t) lines.push(prefix + t)
    } else {
      children.forEach(c => walk(c))
    }
  }
  walk(doc)
  return lines.join('\n')
}
