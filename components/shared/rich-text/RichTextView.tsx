import type { ReactNode } from 'react'
import { parseDoc, type RichNode } from '@/lib/rich-text/doc'
import { cn } from '@/lib/utils'

type RichTextViewProps = {
  value: string | null | undefined
  /** Ditampilkan bila nilainya kosong. Default: tidak merender apa pun. */
  empty?: ReactNode
  className?: string
}

/**
 * Menampilkan teks kaya TANPA memuat Tiptap dan tanpa dangerouslySetInnerHTML: hanya node yang ada di daftar putih
 * (lib/rich-text/schema.ts) dipetakan ke elemen React, node lain diabaikan. Teks polos lama tampil per baris.
 * Aman dipakai di Server Component.
 */
export function RichTextView({ value, empty = null, className }: RichTextViewProps) {
  const s = (value ?? '').trim()
  if (!s) return <>{empty}</>
  const doc = parseDoc(s)
  if (!doc) return <p className={cn('whitespace-pre-line text-sm', className)}>{s}</p>
  return <div className={cn('rich-text', className)}>{renderChildren(doc)}</div>
}

const renderChildren = (n: RichNode) => (n.content ?? []).map((c, i) => <Node key={i} n={c} />)

function Node({ n }: { n: RichNode }): ReactNode {
  const attrs = n.attrs ?? {}
  switch (n.type) {
    case 'paragraph':
      return <p>{renderChildren(n)}</p>
    case 'heading':
      return attrs.level === 3 ? <h3>{renderChildren(n)}</h3> : <h2>{renderChildren(n)}</h2>
    case 'bulletList':
      return <ul>{renderChildren(n)}</ul>
    case 'orderedList':
      return <ol start={typeof attrs.start === 'number' ? attrs.start : undefined}>{renderChildren(n)}</ol>
    case 'listItem':
      return <li>{renderChildren(n)}</li>
    case 'hardBreak':
      return <br />
    case 'text': {
      let el: ReactNode = n.text ?? ''
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') el = <strong>{el}</strong>
        else if (m.type === 'italic') el = <em>{el}</em>
        else if (m.type === 'underline') el = <u>{el}</u>
      }
      return el
    }
    default:
      return null
  }
}
