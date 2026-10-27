'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Heading2, Heading3, Italic, List, ListOrdered, Maximize2, Minimize2, Pilcrow, Redo2, Underline, Undo2, X,
  type LucideIcon,
} from 'lucide-react'
import { HEADING_LEVELS } from '@/lib/rich-text/schema'
import { toEditorContent } from '@/lib/rich-text/doc'
import { cn } from '@/lib/utils'

export type RichTextEditorProps = {
  id: string
  /** JSON dokumen (string) atau teks polos lama; kosong = "". */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Judul di mode layar penuh dan label aksesibilitas. */
  title?: string
  disabled?: boolean
  className?: string
}

// Skema editor = daftar putih lib/rich-text/schema.ts. Format lain dari tempelan (warna, ukuran, tautan, gambar) terbuang
// karena tidak ada di skema, dan server menolak apa pun di luar daftar yang sama.
const [LEVEL_A, LEVEL_B] = HEADING_LEVELS

const serialize = (editor: Editor) => (editor.isEmpty ? '' : JSON.stringify(editor.getJSON()))

export default function RichTextEditorImpl({ id, value, onChange, placeholder, title = 'Sunting teks', disabled = false, className }: RichTextEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const lastEmitted = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [LEVEL_A, LEVEL_B] },
        blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Tulis di sini…' }),
    ],
    content: toEditorContent(value),
    editable: !disabled,
    immediatelyRender: false, // wajib untuk Next.js (hindari hydration mismatch)
    editorProps: { attributes: { id, role: 'textbox', 'aria-multiline': 'true', 'aria-label': title, class: 'rich-text rich-text-editing px-3.5 py-3 outline-none' } },
    onUpdate: ({ editor: e, transaction }) => {
      // Tiptap memancarkan satu `update` saat dimuat (tanpa langkah): meneruskannya menormalkan teks polos lama jadi JSON dan membuat
      // formulir tampak "berubah" padahal pengguna belum menyentuh apa pun (penanda belum-disimpan palsu). Hanya perubahan dokumen nyata yang diteruskan.
      if (!transaction.docChanged) return
      const next = serialize(e)
      lastEmitted.current = next
      onChange(next)
    },
  })

  // Nilai berubah dari luar (mis. data dimuat belakangan, form di-reset): sinkronkan tanpa memicu onChange.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(toEditorContent(value), { emitUpdate: false })
  }, [value, editor])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  // Layar penuh: Esc menutup, halaman di belakangnya tidak ikut tergulir.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('overflow-hidden')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('overflow-hidden')
    }
  }, [expanded])

  useEffect(() => {
    if (expanded) editor?.commands.focus('end')
  }, [expanded, editor])

  return (
    <div
      className={cn(
        expanded
          // `!m-0`: induk bergaya `space-y-*` memberi margin-top pada anak, yang menggeser elemen fixed inset-0 dari tepi layar.
          ? 'fixed inset-0 z-50 !m-0 flex flex-col gap-3 bg-background p-3 sm:p-6'
          : 'rounded-xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20',
        disabled && 'opacity-70',
        className,
      )}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? title : undefined}
    >
      {expanded && (
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 text-base font-bold">{title}</p>
          <button type="button" onClick={() => setExpanded(false)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted">
            <X className="size-4" /> Selesai
          </button>
        </div>
      )}
      <div className={cn(expanded && 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-input bg-background focus-within:border-ring')}>
        {editor && <Toolbar editor={editor} expanded={expanded} onToggleExpand={() => setExpanded(v => !v)} />}
        <div className={cn('overflow-y-auto', expanded ? 'rich-text-fullscreen min-h-0 flex-1' : 'max-h-96')}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

function Toolbar({ editor, expanded, onToggleExpand }: { editor: Editor; expanded: boolean; onToggleExpand: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      p: e.isActive('paragraph'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  })
  const run = () => editor.chain().focus()
  return (
    // HP: toolbar digeser ke samping, tetap satu baris.
    <div role="toolbar" aria-label="Format teks" className="flex items-center gap-0.5 overflow-x-auto border-b border-input bg-muted/50 px-1.5 py-1">
      <Tool icon={Pilcrow} label="Paragraf" active={s.p} onClick={() => run().setParagraph().run()} />
      <Tool icon={Heading2} label="Judul (H2)" active={s.h2} onClick={() => run().toggleHeading({ level: 2 }).run()} />
      <Tool icon={Heading3} label="Subjudul (H3)" active={s.h3} onClick={() => run().toggleHeading({ level: 3 }).run()} />
      <Divider />
      <Tool icon={Bold} label="Tebal" active={s.bold} onClick={() => run().toggleBold().run()} />
      <Tool icon={Italic} label="Miring" active={s.italic} onClick={() => run().toggleItalic().run()} />
      <Tool icon={Underline} label="Garis bawah" active={s.underline} onClick={() => run().toggleUnderline().run()} />
      <Divider />
      <Tool icon={List} label="Daftar berpoin" active={s.bullet} onClick={() => run().toggleBulletList().run()} />
      <Tool icon={ListOrdered} label="Daftar bernomor" active={s.ordered} onClick={() => run().toggleOrderedList().run()} />
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <Tool icon={Undo2} label="Urungkan" disabled={!s.undo} onClick={() => run().undo().run()} />
        <Tool icon={Redo2} label="Ulangi" disabled={!s.redo} onClick={() => run().redo().run()} />
        <Divider />
        <Tool icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Perkecil' : 'Layar penuh'} onClick={onToggleExpand} />
      </span>
    </div>
  )
}

function Tool({ icon: Icon, label, active, disabled, onClick }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()} // seleksi teks tidak hilang saat tombol ditekan
      onClick={onClick}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-35',
        active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-background',
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
