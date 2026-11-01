import Link from 'next/link'
import { Copy, Eye, EyeOff, FileSearch, Pencil, Trash2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Kolom aksi standar (docs/arsitektur-tabel.md §2.4). Hanya IKON + teks aksesibel (`title`/`aria-label`); ikon menunjukkan AKSI, bukan status (status = <Badge>).
// Server-safe: `ActionLink` tautan biasa. Aksi yang mengubah data memakai <ApiAction> (klien). Satu-satunya tempat memetakan ikon — ganti di sini, berlaku di semua tabel.

export type ActionKind = 'view' | 'edit' | 'duplicate' | 'delete' | 'activate' | 'deactivate'

export const ACTION_ICONS: Record<ActionKind, LucideIcon> = {
  view: FileSearch,
  edit: Pencil,
  duplicate: Copy,
  delete: Trash2,
  activate: Eye,
  deactivate: EyeOff,
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  view: 'Lihat detail',
  edit: 'Edit',
  duplicate: 'Duplikat',
  delete: 'Hapus',
  activate: 'Aktifkan',
  deactivate: 'Nonaktifkan',
}

/** Kelas satu tombol ikon — dipakai ActionLink dan ApiAction supaya keduanya identik. */
export function actionClass(kind: ActionKind): string {
  return cn(
    'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-admin-line bg-white text-admin-muted transition-colors disabled:pointer-events-none disabled:opacity-50',
    kind === 'delete' ? 'hover:border-admin-danger/40 hover:bg-admin-danger/10 hover:text-admin-danger' : 'hover:bg-admin-spot hover:text-admin-ink',
  )
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-1.5">{children}</div>
}

/** Aksi berupa navigasi (Lihat / Edit). `label` bawaan dari jenisnya; isi bila perlu lebih spesifik ("Edit hotel Al Safwah"). */
export function ActionLink({ kind, href, label }: { kind: Extract<ActionKind, 'view' | 'edit'>; href: string; label?: string }) {
  const Icon = ACTION_ICONS[kind]
  const text = label ?? ACTION_LABELS[kind]
  return <Link href={href} title={text} aria-label={text} className={actionClass(kind)}><Icon className="size-4" /></Link>
}

/** Aksi khusus modul (mis. "Lepas WhatsApp") berikon: dipakai Client Component yang memegang handler-nya. Tampilan sama dengan aksi baku. */
export function ActionButton({ icon: Icon, label, onClick, tone, disabled }: { icon: LucideIcon; label: string; onClick: () => void; tone?: 'danger'; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={actionClass(tone === 'danger' ? 'delete' : 'edit')}><Icon className="size-4" /></button>
}

/** Aksi baku dengan handler klien (Edit / Duplikat / Hapus di daftar bersarang, mis. periode harga hotel): ikon dari `ACTION_ICONS`, bukan ikon pilihan sendiri. */
export function KindButton({ kind, label, onClick, disabled }: { kind: ActionKind; label?: string; onClick: () => void; disabled?: boolean }) {
  const Icon = ACTION_ICONS[kind]
  const text = label ?? ACTION_LABELS[kind]
  return <button type="button" title={text} aria-label={text} disabled={disabled} onClick={onClick} className={actionClass(kind)}><Icon className="size-4" /></button>
}
