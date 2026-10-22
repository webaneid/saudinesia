'use client'

import dynamic from 'next/dynamic'

export type { RichTextEditorProps } from './RichTextEditorImpl'

/**
 * Editor teks kaya umum (docs/arsitektur-editor-teks.md). Tiptap dimuat TERPISAH (next/dynamic) hanya di halaman
 * yang memakai komponen ini. Nilai = JSON dokumen (string); validasi server: `richTextField()` di lib/validators/richText.ts;
 * tampilan: `RichTextView`.
 */
export const RichTextEditor = dynamic(() => import('./RichTextEditorImpl'), {
  ssr: false,
  loading: () => <div aria-hidden className="h-52 animate-pulse rounded-xl border border-input bg-muted/40" />,
})
