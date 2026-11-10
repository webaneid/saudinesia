'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { documentIcon } from '@/lib/documents/icons'
import { FileViewerDialog } from './FileViewerDialog'
import { formatCalendarDate } from '@/lib/time'
import type { DocumentTypeOption, PilgrimDocumentView } from '@/lib/documents/service'
import { EMPTY_DRAFT, REJECT_TEXT, STATUS_TEXT, canUpload, documentRows, formatBytes, uploadFields, type DocumentRow, type UploadDraft } from './documentRows'

// Dokumen satu jamaah (docs/arsitektur-jamaah.md §7.4) — satu komponen untuk "Jamaah Saya" dan admin atas nama pelanggan (tanpa impor admin).
// `endpoint` = koleksi dokumen kartu (GET daftar + jenis, POST unggah); `${endpoint}/${id}` = lihat (URL presigned, ditampilkan di popup FileViewerDialog) / hapus.
// Berkas gambar diubah ke WebP di server; status pemeriksaan diisi admin (Fase 6) — di sini hanya ditampilkan.

type Props = {
  endpoint: string
  readOnly?: boolean
  /** Jenis dokumen yang formulir unggahnya langsung terbuka (mis. dari tombol "Unggah" di daftar kelengkapan). */
  openTypeId?: string
  /** Dipanggil sesudah dokumen diunggah/dihapus — pemanggil memuat ulang kelengkapan yang dihitung server. */
  onChange?: () => void
  /** Hanya jenis ini yang tampil (dokumen pribadi di halaman booking = syarat produk saja; kartu tetap menyimpan jenis lain untuk booking lain,
   *  jadi berkas jenis lain disembunyikan, bukan ditandai "tidak diperlukan"). Tanpa ini = semua jenis dari server. */
  onlyTypeIds?: readonly string[]
}
type Loaded = { documents: PilgrimDocumentView[]; types: DocumentTypeOption[] }

const STATUS_VARIANT = { pending: 'muted', accepted: 'success', rejected: 'destructive' } as const

export function DocumentRepeater({ endpoint, readOnly = false, openTypeId, onChange, onlyTypeIds }: Props) {
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // id baris yang sedang diproses
  const [openFor, setOpenFor] = useState<string | null>(readOnly ? null : openTypeId ?? null) // id jenis yang formulir unggahnya terbuka
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewing, setViewing] = useState<PilgrimDocumentView | null>(null) // berkas yang sedang dilihat di popup

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      const json = await res.json().catch(() => null) as { data?: Loaded; error?: string } | null
      if (!res.ok || !json?.data) { setLoadError(json?.error ?? 'Dokumen gagal dimuat.'); return }
      setData(json.data); setLoadError(null)
    } catch {
      setLoadError('Tidak dapat menghubungi server.')
    }
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  async function remove(doc: PilgrimDocumentView) {
    setBusy(doc.id); setError(null); setNotice(null)
    try {
      const res = await fetch(`${endpoint}/${doc.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setError(json?.error ?? 'Dokumen gagal dihapus.'); return }
      setConfirmDelete(null); setNotice('Dokumen dihapus.')
      await load(); onChange?.()
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setBusy(null)
    }
  }

  if (loadError) return <p role="alert" className="text-sm text-destructive">{loadError}</p>
  if (!data) return <p className="text-sm text-muted-foreground">Memuat dokumen…</p>

  const only = onlyTypeIds ? new Set(onlyTypeIds) : null
  const types = only ? data.types.filter(t => only.has(t.id)) : data.types
  const rows = documentRows(types, only ? data.documents.filter(d => only.has(d.documentTypeId)) : data.documents)
  const multiTypes = types.filter(t => t.allowMultiple)

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">{notice}</p>}

      {rows.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada dokumen yang diminta di sini.</p>}
      <ul className="divide-y rounded-xl border empty:hidden">
        {rows.map(row => (
          <RowItem
            key={row.document?.id ?? row.type.id} row={row} readOnly={readOnly} busy={busy === row.document?.id}
            confirming={!!row.document && confirmDelete === row.document.id}
            formOpen={row.kind === 'single' && openFor === row.type.id}
            onOpenForm={() => { setOpenFor(row.type.id); setNotice(null) }}
            onCloseForm={() => setOpenFor(null)}
            onUploaded={async () => { setOpenFor(null); setNotice('Dokumen tersimpan.'); await load(); onChange?.() }}
            onPreview={() => row.document && setViewing(row.document)}
            onAskDelete={() => row.document && setConfirmDelete(row.document.id)}
            onCancelDelete={() => setConfirmDelete(null)}
            onDelete={() => row.document && void remove(row.document)}
            endpoint={endpoint}
          />
        ))}
      </ul>

      {!readOnly && multiTypes.length > 0 && (
        <AddExtra types={multiTypes} endpoint={endpoint} open={openFor === 'extra'} onOpen={() => { setOpenFor('extra'); setNotice(null) }} onClose={() => setOpenFor(null)}
          onUploaded={async () => { setOpenFor(null); setNotice('Dokumen tersimpan.'); await load(); onChange?.() }} />
      )}
      {viewing && <FileViewerDialog title={viewing.label} endpoint={`${endpoint}/${viewing.id}`} onClose={() => setViewing(null)} />}
      <p className="text-xs text-muted-foreground">Foto (JPG, PNG, WebP) atau PDF, maksimal 5 MB. Foto disimpan ulang sebagai WebP tanpa data lokasi.</p>
    </div>
  )
}

type RowProps = {
  row: DocumentRow; readOnly: boolean; busy: boolean; confirming: boolean; formOpen: boolean; endpoint: string
  onOpenForm: () => void; onCloseForm: () => void; onUploaded: () => Promise<void>
  onPreview: () => void; onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void
}

function RowItem({ row, readOnly, busy, confirming, formOpen, endpoint, onOpenForm, onCloseForm, onUploaded, onPreview, onAskDelete, onCancelDelete, onDelete }: RowProps) {
  const Icon = documentIcon(row.type.icon)
  const doc = row.document
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">{doc?.label ?? row.type.label}</p>
          {doc ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {row.kind === 'extra' && row.unlisted
                  ? <Badge variant="muted">Tidak diperlukan</Badge>
                  : <Badge variant={STATUS_VARIANT[doc.status]}>{STATUS_TEXT[doc.status]}</Badge>}
                <span>{doc.mimeType === 'application/pdf' ? 'PDF' : 'Foto'} · {formatBytes(doc.sizeBytes)}</span>
                {doc.referenceCode && <span>{row.type.referenceLabel ?? 'Kode'}: {doc.referenceCode}</span>}
                {doc.expiresAt && <span>Berlaku s.d. {formatCalendarDate(doc.expiresAt)}</span>}
                {doc.byStaff && <span>Diunggah petugas</span>}
              </div>
              {row.kind === 'extra' && row.unlisted && (
                <p className="text-xs text-muted-foreground">Tidak diperlukan di sini — tidak diperiksa petugas. Boleh dihapus.</p>
              )}
              {doc.status === 'rejected' && !(row.kind === 'extra' && row.unlisted) && (
                <p className="text-xs text-destructive">Ditolak{doc.rejectReason ? ` (${REJECT_TEXT[doc.rejectReason]})` : ''}{doc.reviewNote ? `: ${doc.reviewNote}` : ''} — unggah ulang berkas yang benar.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Belum diunggah</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doc && <Button type="button" size="sm" variant="outline" onClick={onPreview} aria-label={`Lihat ${doc.label}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Lihat</Button>}
          {!readOnly && row.kind === 'single' && !formOpen && (
            <Button type="button" size="sm" variant={doc ? 'ghost' : 'default'} onClick={onOpenForm}><Upload className="mr-1.5 h-3.5 w-3.5" />{doc ? 'Ganti' : 'Unggah'}</Button>
          )}
          {!readOnly && doc && !confirming && (
            <Button type="button" size="sm" variant="ghost" onClick={onAskDelete} aria-label={`Hapus ${doc.label}`}><Trash2 className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      </div>
      {confirming && doc && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 p-3">
          <span className="text-sm">Hapus {doc.label}? Berkasnya ikut dihapus.</span>
          <Button type="button" size="sm" variant="destructive" onClick={onDelete} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ya, hapus</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancelDelete} disabled={busy}>Batal</Button>
        </div>
      )}
      {formOpen && (
        <UploadForm type={row.type} endpoint={endpoint} replacing={!!doc} onCancel={onCloseForm} onUploaded={onUploaded} />
      )}
    </li>
  )
}

function AddExtra({ types, endpoint, open, onOpen, onClose, onUploaded }: { types: DocumentTypeOption[]; endpoint: string; open: boolean; onOpen: () => void; onClose: () => void; onUploaded: () => Promise<void> }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const type = types.find(t => t.id === typeId) ?? types[0]
  if (!open || !type) return <Button type="button" variant="outline" size="sm" onClick={onOpen}><Plus className="mr-1.5 h-3.5 w-3.5" />{types.length === 1 && types[0] ? `Tambah ${types[0].label}` : 'Tambah dokumen lain'}</Button>
  return (
    <div className="space-y-3 rounded-xl border p-4">
      {types.length > 1 && (
        <div className="space-y-2">
          <Label>Jenis dokumen</Label>
          <ChoiceSelect options={types.map(t => ({ id: t.id, label: t.label }))} value={type.id} onChange={v => setTypeId(v)} clearable={false} ariaLabel="Jenis dokumen" />
        </div>
      )}
      <UploadForm key={type.id} type={type} endpoint={endpoint} replacing={false} onCancel={onClose} onUploaded={onUploaded} />
    </div>
  )
}

function UploadForm({ type, endpoint, replacing, onCancel, onUploaded }: { type: DocumentTypeOption; endpoint: string; replacing: boolean; onCancel: () => void; onUploaded: () => Promise<void> }) {
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof UploadDraft) => (e: React.ChangeEvent<HTMLInputElement>) => { setError(null); setDraft(d => ({ ...d, [k]: e.target.value })) }
  const idp = `doc-${type.id}`

  async function submit() {
    if (!canUpload(type, draft, file) || !file || saving) return
    setSaving(true); setError(null)
    const body = new FormData()
    for (const [k, v] of Object.entries(uploadFields(type, draft))) body.append(k, v)
    body.append('file', file)
    try {
      const res = await fetch(endpoint, { method: 'POST', body })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setError(json?.error ?? 'Dokumen gagal diunggah.'); return }
      await onUploaded()
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-3">
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      {replacing && <p className="text-xs text-muted-foreground">Berkas baru menggantikan berkas lama (berkas lama dihapus) dan diperiksa ulang.</p>}
      {type.key === 'other' && (
        <div className="space-y-2"><Label htmlFor={`${idp}-label`}>Nama dokumen</Label><Input id={`${idp}-label`} value={draft.label} onChange={set('label')} maxLength={80} placeholder="Mis. Surat Mahram" /></div>
      )}
      {type.referenceLabel && (
        <div className="space-y-2"><Label htmlFor={`${idp}-ref`}>{type.referenceLabel}</Label><Input id={`${idp}-ref`} value={draft.referenceCode} onChange={set('referenceCode')} maxLength={40} autoComplete="off" /></div>
      )}
      {type.hasExpiry && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`${idp}-iss`}>Tanggal terbit (opsional)</Label><Input id={`${idp}-iss`} type="date" value={draft.issuedAt} onChange={set('issuedAt')} /></div>
          <div className="space-y-2"><Label htmlFor={`${idp}-exp`}>Berlaku sampai{type.minValidityMonths == null ? ' (opsional)' : ''}</Label><Input id={`${idp}-exp`} type="date" value={draft.expiresAt} onChange={set('expiresAt')} /></div>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${idp}-file`}>Berkas</Label>
        <Input id={`${idp}-file`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => { setError(null); setFile(e.target.files?.[0] ?? null) }} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={!canUpload(type, draft, file) || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}{saving ? 'Mengunggah…' : 'Unggah'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}><X className="mr-1.5 h-3.5 w-3.5" />Batal</Button>
      </div>
    </div>
  )
}
