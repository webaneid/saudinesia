'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/admin/ui/ConfirmDialog'
import { ACTION_ICONS, ACTION_LABELS, actionClass, type ActionKind } from '@/components/shared/data-table/RowActions'

// Aksi baris yang MENGUBAH data lewat API (docs/arsitektur-tabel.md §2.4): hapus (dengan dialog konfirmasi) dan aktif/nonaktif. Props sengaja data biasa (url/method/body)
// supaya Server Component boleh memakainya langsung; setelah sukses halaman dimuat ulang (`router.refresh()`), halaman klien yang menyimpan daftar sendiri memberi `onDone`.

type Common = { url: string; /** judul dialog / teks aksesibel yang lebih spesifik */ label?: string; onDone?: () => void }

type Props =
  | (Common & { kind: 'delete'; /** nama entitas di dialog, mis. "Hotel Al Safwah" */ subject: string; /** penjelasan tambahan (mis. akibat bila dirujuk) */ note?: string })
  | (Common & { kind: 'toggle'; active: boolean; /** nama kolom boolean di body; bawaan `isActive` */ field?: string; method?: 'PUT' | 'PATCH' })

/** `error` = galat server (apa adanya); `message` = pesan hasil dari server pada respons sukses (mis. vendor dirujuk → dinonaktifkan, bukan dihapus). */
async function call(url: string, method: string, body?: unknown): Promise<{ error: string | null; message?: string }> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const j: { error?: string; data?: { message?: unknown } } | null = await res.json().catch(() => null)
    if (res.ok) return { error: null, message: typeof j?.data?.message === 'string' ? j.data.message : undefined }
    return { error: j?.error ?? 'Perubahan gagal disimpan.' }
  } catch {
    return { error: 'Tidak dapat menghubungi server.' }
  }
}

export function ApiAction(props: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const kind: ActionKind = props.kind === 'delete' ? 'delete' : props.active ? 'deactivate' : 'activate'
  const Icon = ACTION_ICONS[kind]
  const text = props.label ?? ACTION_LABELS[kind]

  const finish = () => { setOpen(false); setResult(null); props.onDone?.(); router.refresh() }

  async function run() {
    setBusy(true); setError(null)
    const r = props.kind === 'delete'
      ? await call(props.url, 'DELETE')
      : await call(props.url, props.method ?? 'PUT', { [props.field ?? 'isActive']: !props.active })
    setBusy(false)
    if (r.error) { setError(r.error); if (props.kind === 'toggle') setOpen(true); return }
    if (r.message) { setOpen(true); setResult(r.message); return } // tampilkan pesan server; daftar dimuat ulang saat dialog ditutup
    finish()
  }

  const onClick = () => { setError(null); if (props.kind === 'delete') setOpen(true); else void run() }

  return (
    <>
      <button type="button" title={text} aria-label={text} disabled={busy && !open} onClick={onClick} className={actionClass(kind)}><Icon className="size-4" /></button>
      <ConfirmDialog
        open={open} busy={busy} error={error} result={result} tone={props.kind === 'delete' ? 'danger' : 'primary'}
        title={props.kind === 'delete' ? `Hapus ${props.subject}?` : text}
        confirmLabel={props.kind === 'delete' ? 'Ya, hapus' : 'Coba lagi'}
        onClose={() => { if (result) finish(); else { setOpen(false); setError(null) } }} onConfirm={run}
      >
        {props.kind === 'delete'
          ? <>Data yang sudah dipakai di tempat lain tidak dihapus permanen, melainkan dinonaktifkan. {props.note}</>
          : 'Perubahan status gagal.'}
      </ConfirmDialog>
    </>
  )
}
