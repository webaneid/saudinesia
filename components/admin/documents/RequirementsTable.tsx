'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Plus } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { Modal } from '@/components/admin/ui/Modal'
import { Switch } from '@/components/admin/ui/Switch'
import { Tabs } from '@/components/admin/ui/Tabs'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { ActionButton, KindButton, RowActions } from '@/components/shared/data-table/RowActions'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { documentIcon } from '@/lib/documents/icons'
import { moveRow, type RequirementRow } from './requirementRows'
import { DocumentTypeFields } from './DocumentTypeFields'
import { EMPTY_TYPE_FORM, TYPE_KEY_RE, bodyFromTypeForm, type DocumentTypeForm } from './documentTypeForm'

// Syarat dokumen produk sebagai TABEL + popup (menggantikan RequirementsEditor kartu, 2026-11-24) — SATU komponen untuk semua pemilik syarat (Visa, Paket Umroh, Haji).
// "Tambah berkas" = pilih dari katalog Produk → Jenis Dokumen ATAU buat berkas custom (jenis baru di katalog lewat POST document-types, jadi
// bisa dipakai produk lain). Baris disimpan bersama produk oleh halaman pemilik (ganti-semua) — tabel ini hanya mengubah `rows`.

type CatalogType = { id: string; key: string; label: string; icon: string; reusable: boolean; isActive: boolean }
type Props = { rows: RequirementRow[]; onChange: (next: RequirementRow[]) => void; productNoun?: string }

type Mode = 'catalog' | 'custom'
type Draft = {
  mode: Mode
  documentTypeId: string
  label: string
  description: string
  required: boolean
  /** Berkas custom = jenis baru di katalog (isian sama dengan Produk → Jenis Dokumen). */
  type: DocumentTypeForm
}
type Dialog = { index: number | null; draft: Draft } // index null = tambah baru

/** Kolom yang menampilkan galatnya sendiri (sisanya tampil di bawah formulir). */
const SHOWN_FIELDS = new Set(['label', 'key', 'documentTypeId', 'reusable', 'minValidityMonths', 'referenceLabel', 'referencePattern'])

const EMPTY: Draft = { mode: 'catalog', documentTypeId: '', label: '', description: '', required: true, type: EMPTY_TYPE_FORM }

export function RequirementsTable({ rows, onChange, productNoun = 'produk ini' }: Props) {
  const [catalog, setCatalog] = useState<CatalogType[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const { ask, dialog: confirmDialog } = useConfirm()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/admin/products/document-types')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data?: CatalogType[] }) => { if (alive) setCatalog(j.data ?? []) })
      .catch(() => { if (alive) setLoadError(true) })
    return () => { alive = false }
  }, [])

  const byId = new Map((catalog ?? []).map(t => [t.id, t]))
  const taken = new Set(rows.map(r => r.documentTypeId))

  const open = (index: number | null) => {
    setError(null)
    const row = index === null ? null : rows[index]
    setDialog({ index, draft: row ? { ...EMPTY, documentTypeId: row.documentTypeId, label: row.label, description: row.description, required: row.required } : { ...EMPTY } })
  }
  const patch = (p: Partial<Draft>) => setDialog(d => d && { ...d, draft: { ...d.draft, ...p } })

  const remove = async (i: number) => {
    const row = rows[i]
    if (!row) return
    const ok = await ask({ title: `Hapus syarat "${row.label.trim() || row.typeLabel}"?`, body: 'Jamaah tidak lagi diminta mengunggah berkas ini untuk ' + productNoun + ' setelah produk disimpan. Jenis dokumennya tetap ada di katalog.' })
    if (ok) onChange(rows.filter((_, idx) => idx !== i))
  }

  const submit = async () => {
    if (!dialog) return
    const { index, draft } = dialog
    setError(null)
    let typeId = draft.documentTypeId
    let typeLabel = byId.get(typeId)?.label ?? rows[index ?? -1]?.typeLabel ?? ''
    let label = draft.label.trim()

    if (index === null && draft.mode === 'custom') {
      const t = draft.type
      if (t.label.trim().length < 2) return setError({ text: 'Label minimal 2 karakter', field: 'label' })
      if (!TYPE_KEY_RE.test(t.key.trim())) return setError({ text: 'Kode: huruf kecil, angka, garis bawah (2–40 karakter, diawali huruf)', field: 'key' })
      setSaving(true)
      try {
        const res = await fetch('/api/v1/admin/products/document-types', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyFromTypeForm(t, 'create')),
        })
        const j = await res.json().catch(() => null) as { success?: boolean; data?: { id: string }; error?: string; meta?: { field?: string } } | null
        if (!res.ok || !j?.data) return setError({ text: j?.error ?? 'Berkas custom gagal dibuat', field: j?.meta?.field })
        const created: CatalogType = { id: j.data.id, key: t.key.trim(), label: t.label.trim(), icon: t.icon, reusable: t.reusable, isActive: true }
        setCatalog(c => [...(c ?? []), created])
        typeId = created.id
        typeLabel = created.label
        label = '' // label = label katalog
      } catch {
        return setError({ text: 'Koneksi gagal — coba lagi' })
      } finally {
        setSaving(false)
      }
    } else if (!typeId) {
      return setError({ text: 'Pilih jenis berkas', field: 'documentTypeId' })
    } else if (label && label.length < 2) {
      return setError({ text: 'Label minimal 2 karakter', field: 'label' })
    }

    const row: RequirementRow = { documentTypeId: typeId, typeLabel, label, description: draft.description.trim(), required: draft.required }
    onChange(index === null ? [...rows, row] : rows.map((r, i) => (i === index ? row : r)))
    setDialog(null)
  }

  const columns: Column<RequirementRow & { i: number }>[] = [
    { key: 'no', header: '#', cell: r => <span className="tabular-nums text-admin-muted">{r.i + 1}</span> },
    {
      key: 'label', header: 'Berkas', mobile: 'title',
      cell: r => {
        const type = byId.get(r.documentTypeId)
        const Icon = documentIcon(type?.icon ?? 'FileText')
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-admin-accent/12 text-admin-accent-strong"><Icon className="size-3.5" /></span>
            <div className="min-w-0">
              <p className="m-0 font-semibold text-admin-ink">{r.label.trim() || r.typeLabel}</p>
              {r.description && <p className="m-0 mt-0.5 text-xs text-admin-muted">{r.description}</p>}
              {type && !type.isActive && <Badge tone="warning">Jenis nonaktif</Badge>}
            </div>
          </div>
        )
      },
    },
    { key: 'key', header: 'Kode', hideBelowLg: true, cell: r => <code className="rounded bg-admin-spot px-1.5 py-0.5 text-xs text-admin-ink">{byId.get(r.documentTypeId)?.key ?? '—'}</code> },
    { key: 'scope', header: 'Sifat', cell: r => { const t = byId.get(r.documentTypeId); return t ? <span className="whitespace-nowrap text-xs text-admin-muted">{t.reusable ? 'Milik jamaah' : 'Per perjalanan'}</span> : '—' } },
    { key: 'required', header: 'Wajib', cell: r => <Badge tone={r.required ? 'accent' : 'neutral'}>{r.required ? 'Wajib' : 'Opsional'}</Badge> },
    {
      key: 'actions', header: '', actions: true,
      cell: r => (
        <RowActions>
          <ActionButton icon={ArrowUp} label="Naikkan" disabled={r.i === 0} onClick={() => onChange(moveRow(rows, r.i, -1))} />
          <ActionButton icon={ArrowDown} label="Turunkan" disabled={r.i === rows.length - 1} onClick={() => onChange(moveRow(rows, r.i, 1))} />
          <KindButton kind="edit" label="Edit syarat" onClick={() => open(r.i)} />
          <KindButton kind="delete" label="Hapus syarat" onClick={() => { void remove(r.i) }} />
        </RowActions>
      ),
    },
  ]

  const d = dialog?.draft
  const editing = dialog?.index != null
  const editingRow = editing ? rows[dialog.index ?? -1] : undefined
  const catalogOptions = (catalog ?? [])
    .filter(t => t.isActive && (!taken.has(t.id) || t.id === d?.documentTypeId))
    .map(t => ({ id: t.id, label: t.label, hint: t.key }))
  const fieldError = (f: string) => (error?.field === f ? error.text : undefined)

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <div className="min-w-0">
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><FileText className="size-4 text-admin-accent" /> Persyaratan dokumen</h2>
          <p className="m-0 mt-1 text-xs text-admin-muted">Berkas yang diunggah per jamaah untuk {productNoun}. Urutan di tabel = urutan tampil ke jamaah. Tersimpan saat produk disimpan.</p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={() => open(null)} disabled={!catalog}><Plus className="size-3.5" /> Tambah berkas</Button>
      </div>
      {loadError && <p className="m-0 text-xs text-admin-danger">Katalog jenis dokumen gagal dimuat. Muat ulang halaman.</p>}

      <DataTable
        columns={columns}
        rows={rows.map((r, i) => ({ ...r, i }))}
        getRowId={r => r.documentTypeId}
        loading={!catalog && !loadError}
        empty={`Belum ada persyaratan — jamaah tidak diminta mengunggah berkas apa pun untuk ${productNoun}.`}
      />

      <Modal open={!!dialog} title={editing ? 'Edit syarat berkas' : 'Tambah berkas'} onClose={() => setDialog(null)}>
        {d && (
          <form className="space-y-4" onSubmit={ev => { ev.preventDefault(); void submit() }}>
            {!editing && (
              <Tabs<Mode>
                label="Sumber berkas" value={d.mode} onChange={mode => { setError(null); patch({ mode }) }}
                items={[{ id: 'catalog', label: 'Dari katalog' }, { id: 'custom', label: 'Berkas custom' }]}
              />
            )}

            {editing && editingRow && (
              <p className="m-0 text-xs text-admin-muted">Jenis: <span className="font-semibold text-admin-ink">{editingRow.typeLabel}</span> <code className="ml-1 rounded bg-admin-spot px-1.5 py-0.5">{byId.get(editingRow.documentTypeId)?.key}</code></p>
            )}

            {!editing && d.mode === 'catalog' && (
              <FormField label="Jenis berkas" htmlFor="req-type" required error={fieldError('documentTypeId')} hint="Contoh berkas yang sudah disediakan. Tidak ada di daftar? Pakai tab “Berkas custom”.">
                <ChoiceSelect ariaLabel="Jenis berkas" value={d.documentTypeId} clearable={false} options={catalogOptions} placeholder="Pilih berkas…" onChange={documentTypeId => patch({ documentTypeId })} />
              </FormField>
            )}

            {!editing && d.mode === 'custom' && (
              <div className="space-y-3">
                <DocumentTypeFields
                  mode="create" showOrder={false} value={d.type} onChange={type => { setError(null); patch({ type }) }}
                  errors={error?.field ? { [error.field]: error.text } : {}}
                />
                <p className="m-0 rounded-lg bg-admin-spot/60 px-3 py-2 text-xs text-admin-muted">Berkas custom langsung masuk katalog Produk → Jenis Dokumen, jadi bisa dipilih juga di produk lain.</p>
                <p className="label-kecil m-0 pt-1">Untuk produk ini</p>
              </div>
            )}

            {(editing || d.mode === 'catalog') && (
              <FormField label="Label untuk produk ini" htmlFor="req-label" error={fieldError('label')} hint="Opsional. Kosong = memakai nama jenis berkas.">
                <input id="req-label" className="admin-input" maxLength={80} value={d.label}
                  placeholder={byId.get(d.documentTypeId)?.label ?? editingRow?.typeLabel ?? ''} onChange={e => patch({ label: e.target.value })} />
              </FormField>
            )}

            <FormField label="Keterangan untuk jamaah" htmlFor="req-desc" hint="Opsional. Tampil di bawah label, mis. instruksi unggah.">
              <textarea id="req-desc" className="admin-input min-h-20" maxLength={300} value={d.description} placeholder="Scan berwarna, tidak terpotong, maksimal 5 MB" onChange={e => patch({ description: e.target.value })} />
            </FormField>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-admin-ink">
              <Switch checked={d.required} onChange={required => patch({ required })} label="Wajib diunggah" />
              <span className="font-semibold">Wajib diunggah</span>
              <span className="text-xs text-admin-muted">{d.required ? 'harus ada sebelum data jamaah lengkap' : 'opsional, tidak menghalangi kelengkapan'}</span>
            </label>

            {error && !error.field && <p className="m-0 text-xs text-admin-danger">{error.text}</p>}
            {error?.field && !SHOWN_FIELDS.has(error.field) && <p className="m-0 text-xs text-admin-danger">{error.text}</p>}

            <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Batal</Button>
              <Button type="submit" size="sm" loading={saving}>{editing ? 'Simpan perubahan' : d.mode === 'custom' ? 'Buat & tambahkan' : 'Tambahkan'}</Button>
            </div>
          </form>
        )}
      </Modal>
      {confirmDialog}
    </Card>
  )
}
