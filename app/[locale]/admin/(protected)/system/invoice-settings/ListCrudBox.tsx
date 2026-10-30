'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { Modal } from '@/components/admin/ui/Modal'
import { Badge } from '@/components/admin/ui/Badge'
import { ApiAction } from '@/components/admin/data-table/ApiAction'
import { ActionButton, RowActions } from '@/components/admin/data-table/RowActions'

type Props<T extends { id: string; isActive: boolean }, F> = {
  title: string
  icon: LucideIcon
  description: ReactNode
  /** `/api/v1/admin/system/<sumber>` — GET/POST di sini, PUT/DELETE di `/<id>`. */
  apiBase: string
  noun: string
  emptyText: string
  summary: (row: T) => ReactNode
  blank: F
  toForm: (row: T) => F
  renderFields: (form: F, set: (patch: Partial<F>) => void) => ReactNode
  /** Galat validasi sisi klien (null = lanjut kirim); server tetap memvalidasi ulang. */
  precheck?: (form: F) => string | null
  /** Dipanggil setelah daftar berubah (tambah/ubah/hapus/aktif) — induk dapat memperbarui peringatan. */
  onChanged?: (rows: T[]) => void
}

/**
 * Kotak daftar kecil dengan CRUD lengkap (rekening bank, akun QRIS, aturan pajak): tambah/ubah lewat modal, aktif/nonaktif dan hapus lewat aksi ikon berkonfirmasi.
 * Tersimpan LANGSUNG ke server (bukan bagian tombol Simpan halaman); setiap galat server ditampilkan.
 */
export function ListCrudBox<T extends { id: string; isActive: boolean }, F>({ title, icon, description, apiBase, noun, emptyText, summary, blank, toForm, renderFields, precheck, onChanged }: Props<T, F>) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; form: F } | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(apiBase)
      const j: { data?: T[]; error?: string } | null = await r.json().catch(() => null)
      if (!r.ok || !j?.data) { setError(j?.error ?? `${title} gagal dimuat.`); return }
      setError(null); setRows(j.data); onChanged?.(j.data)
    } catch { setError('Tidak dapat menghubungi server.') }
  }, [apiBase, title, onChanged])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editing) return
    const pre = precheck?.(editing.form)
    if (pre) { setFormError(pre); return }
    setSaving(true); setFormError(null)
    try {
      const r = await fetch(editing.id ? `${apiBase}/${editing.id}` : apiBase, { method: editing.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing.form) })
      if (!r.ok) {
        const j: { error?: string } | null = await r.json().catch(() => null)
        setFormError(j?.error ?? `${noun} gagal disimpan.`)
        return
      }
      setEditing(null)
      await load()
    } catch { setFormError('Tidak dapat menghubungi server.') } finally { setSaving(false) }
  }

  return (
    <MetaBox
      title={title} icon={icon} description={description}
      aside={<button type="button" onClick={() => { setFormError(null); setEditing({ id: null, form: blank }) }} className="admin-btn-sm"><Plus className="size-3.5" /> Tambah</button>}
    >
      {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
      {rows === null && !error && <p className="m-0 flex items-center gap-2 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat…</p>}
      {rows?.length === 0 && <p className="m-0 text-sm text-admin-muted">{emptyText}</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows?.map(row => (
          <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-admin-line px-3 py-2.5">
            <div className="min-w-0 text-sm">{summary(row)}</div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={row.isActive ? 'ok' : 'neutral'}>{row.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
              <RowActions>
                <ActionButton icon={Pencil} label={`Ubah ${noun}`} onClick={() => { setFormError(null); setEditing({ id: row.id, form: toForm(row) }) }} />
                <ApiAction kind="toggle" url={`${apiBase}/${row.id}`} active={row.isActive} label={`${row.isActive ? 'Nonaktifkan' : 'Aktifkan'} ${noun}`} onDone={() => void load()} />
                <ApiAction kind="delete" url={`${apiBase}/${row.id}`} subject={noun} label={`Hapus ${noun}`} onDone={() => void load()} />
              </RowActions>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={editing !== null} title={editing?.id ? `Ubah ${noun}` : `Tambah ${noun}`} onClose={() => setEditing(null)}>
        {editing && (
          <div className="grid gap-3 p-5">
            {renderFields(editing.form, patch => setEditing(e => (e ? { ...e, form: { ...e.form, ...patch } } : e)))}
            {formError && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{formError}</p>}
            <div className="flex justify-end gap-2 border-t border-admin-line pt-3">
              <button type="button" onClick={() => setEditing(null)} className="admin-btn-ghost text-sm">Batal</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="admin-btn disabled:opacity-50">{saving ? 'Menyimpan…' : 'Simpan'}</button>
            </div>
          </div>
        )}
      </Modal>
    </MetaBox>
  )
}
