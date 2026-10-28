'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/admin/ui/ConfirmDialog'
import { ACTION_ICONS, ACTION_LABELS, actionClass, type ActionKind } from './RowActions'

// Aksi baris yang MENGUBAH data lewat API (docs/arsitektur-tabel.md §2.4): hapus (dengan dialog konfirmasi) dan aktif/nonaktif. Props sengaja data biasa (url/method/body)
// supaya Server Component boleh memakainya langsung; setelah sukses halaman dimuat ulang (`router.refresh()`), halaman klien yang menyimpan daftar sendiri memberi `onDone`.

type Common = { url: string; /** judul dialog / teks aksesibel yang lebih spesifik */ label?: string; onDone?: () => void }

type Props =
  | (Common & { kind: 'delete'; /** nama entitas di dialog, mis. "Hotel Al Safwah" */ subject: string; /** penjelasan tambahan (mis. akibat bila dirujuk) */ note?: string })
  | (Common & { kind: 'toggle'; active: boolean; /** nama kolom boolean di body; bawaan `isActive` */ field?: string; method?: 'PUT' | 'PATCH' })

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (res.ok) return null
    const j: { error?: string } | null = await res.json().catch(() => null)
    return j?.error ?? 'Perubahan gagal disimpan.'
  } catch {
    return 'Tidak dapat menghubungi server.'
  }
}

export function ApiAction(props: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kind: ActionKind = props.kind === 'delete' ? 'delete' : props.active ? 'deactivate' : 'activate'
  const Icon = ACTION_ICONS[kind]
  const text = props.label ?? ACTION_LABELS[kind]

  const finish = () => { setOpen(false); props.onDone?.(); router.refresh() }

  async function run() {
    setBusy(true); setError(null)
    const err = props.kind === 'delete'
      ? await call(props.url, 'DELETE')
      : await call(props.url, props.method ?? 'PUT', { [props.field ?? 'isActive']: !props.active })
    setBusy(false)
    if (err) { setError(err); if (props.kind === 'toggle') setOpen(true); return }
    finish()
  }

  const onClick = () => { setError(null); if (props.kind === 'delete') setOpen(true); else void run() }

  return (
    <>
      <button type="button" title={text} aria-label={text} disabled={busy && !open} onClick={onClick} className={actionClass(kind)}><Icon className="size-4" /></button>
      <ConfirmDialog
        open={open} busy={busy} error={error} tone={props.kind === 'delete' ? 'danger' : 'primary'}
        title={props.kind === 'delete' ? `Hapus ${props.subject}?` : text}
        confirmLabel={props.kind === 'delete' ? 'Ya, hapus' : 'Coba lagi'}
        onClose={() => { setOpen(false); setError(null) }} onConfirm={run}
      >
        {props.kind === 'delete'
          ? <>Data yang sudah dipakai di tempat lain tidak dihapus permanen, melainkan dinonaktifkan. {props.note}</>
          : 'Perubahan status gagal.'}
      </ConfirmDialog>
    </>
  )
}
