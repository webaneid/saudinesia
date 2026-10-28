'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { PageMeta } from '@/lib/admin/pagination'
import { DELETION_REQUEST_TONE } from '@/lib/admin/statusTone'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionButton, RowActions } from '@/components/admin/data-table/RowActions'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { Badge } from '@/components/admin/ui/Badge'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Modal } from '@/components/admin/ui/Modal'
import { ShieldCheck } from 'lucide-react'

type DeletionRequest = {
  id: string
  status: 'pending' | 'completed' | 'rejected' | 'withdrawn'
  note: string | null
  requestedAt: string
  processedAt: string | null
  user: { fullName: string; email: string }
  processedBy: { fullName: string } | null
}

type Preview = {
  user: { fullName: string; email: string }
  eligible: boolean
  blockers: string[]
  willErase: { bookings: number; pilgrims: number; documents: number; visaApplications: number; notifications: number; authTokens: number; address: number }
}

const STATUS_LABEL: Record<DeletionRequest['status'], string> = {
  pending: 'Menunggu',
  completed: 'Selesai',
  rejected: 'Ditolak',
  withdrawn: 'Ditarik',
}

export default function DeletionRequestsPage() {
  const { locale } = useParams() as { locale: string }
  const { page, limit, setPage, setParams } = useListPage()
  const statusFilter = (useSearchParams().get('status') ?? '') as DeletionRequest['status'] | ''
  const [requests, setRequests] = useState<DeletionRequest[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v1/admin/deletion-requests?page=${page}&limit=${limit}${statusFilter ? `&status=${statusFilter}` : ''}`)
      const j = await r.json()
      setRequests(j.data ?? [])
      setMeta(j.meta ?? null)
    } finally {
      setLoading(false)
    }
  }, [page, limit, statusFilter])
  useEffect(() => { load() }, [load])

  function closePanel() {
    setProcessingId(null); setNoteDraft(''); setPreview(null); setPreviewError(null); setConfirmEmail(''); setActionError(null)
  }

  async function openPanel(id: string) {
    closePanel()
    setProcessingId(id)
    try {
      const r = await fetch(`/api/v1/admin/deletion-requests/${id}/preview`)
      const j = await r.json()
      if (j.success) setPreview(j.data)
      else setPreviewError(j.error ?? 'Gagal memuat pratinjau.')
    } catch {
      setPreviewError('Gagal memuat pratinjau.')
    }
  }

  async function handleProcess(id: string, status: 'completed' | 'rejected') {
    setBusy(true); setActionError(null)
    try {
      const r = await fetch(`/api/v1/admin/deletion-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status === 'completed' ? { status, note: noteDraft || undefined, confirmEmail } : { status, note: noteDraft || undefined }),
      })
      const j = await r.json()
      if (!j.success) {
        const blockers = (j.meta?.blockers as string[] | undefined)?.join(' ')
        setActionError([j.error, blockers].filter(Boolean).join(' '))
        return
      }
      closePanel()
      await load()
    } catch {
      setActionError('Permintaan gagal dikirim.')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<DeletionRequest>[] = [
    {
      key: 'user', header: 'Jamaah', mobile: 'title',
      cell: req => (
        <>
          <p className="m-0 text-[13px] font-medium">{req.user.fullName}</p>
          <p className="m-0 text-[12px] text-admin-muted">{req.user.email}</p>
        </>
      ),
    },
    { key: 'requested', header: 'Diajukan', cell: req => <span className="text-[12px] text-admin-muted">{new Date(req.requestedAt).toLocaleDateString('id-ID')}</span> },
    { key: 'status', header: 'Status', cell: req => <Badge tone={DELETION_REQUEST_TONE[req.status] ?? 'neutral'}>{STATUS_LABEL[req.status]}</Badge> },
    { key: 'by', header: 'Diproses Oleh', cell: req => <span className="text-[12px] text-admin-muted">{req.processedBy?.fullName ?? '—'}</span> },
    {
      key: 'actions', header: '', actions: true,
      cell: req => req.status === 'pending'
        ? <RowActions><ActionButton icon={ShieldCheck} label={`Proses permintaan hapus akun ${req.user.email}`} onClick={() => openPanel(req.id)} /></RowActions>
        : req.note ? <span className="inline-block max-w-xs text-left text-[11px] text-admin-muted">{req.note}</span> : null,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permintaan Hapus Akun"
        description="UU PDP — hak subjek data. Data pribadi dihapus/dianonimkan permanen; catatan booking/pembayaran (angka & kode) tetap disimpan untuk kewajiban hukum/pajak. Akun dengan booking berjalan atau refund belum tuntas tidak bisa diproses."
      />
      <FilterBar active={Boolean(statusFilter)} resetHref={`/${locale}/admin/system/deletion-requests`}>
        <FilterSelect label="Status" value={statusFilter} options={(Object.keys(STATUS_LABEL) as Array<DeletionRequest['status']>).map(v => ({ value: v, label: STATUS_LABEL[v] }))} onChange={v => setParams({ status: v || undefined })} />
      </FilterBar>

      <Modal open={processingId !== null} title="Proses permintaan hapus akun" onClose={closePanel}>
        <div className="space-y-3">
          {previewError && <p className="m-0 text-[13px] text-admin-danger">{previewError}</p>}
          {!preview && !previewError && <p className="m-0 text-[13px] text-admin-muted">Memuat pratinjau…</p>}
          {preview && (
            <>
              <p className="m-0 text-[13px] font-semibold">{preview.user.fullName} · {preview.user.email}</p>
              <p className="m-0 text-[13px] text-admin-muted">
                Yang akan dihapus/dianonimkan permanen: {preview.willErase.bookings} booking (angka &amp; kode tetap disimpan), {preview.willErase.pilgrims} data jamaah,
                {' '}{preview.willErase.documents} dokumen (berkas ikut dihapus), {preview.willErase.notifications} log notifikasi, {preview.willErase.address} alamat, profil &amp; kontak.
              </p>
              {preview.blockers.map(b => <p key={b} className="m-0 text-[13px] text-admin-danger">{b}</p>)}
              {preview.eligible && (
                <input className="admin-inp w-full" placeholder={`Ketik ${preview.user.email} untuk konfirmasi`} value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)} />
              )}
            </>
          )}
          <input className="admin-inp w-full" placeholder="Catatan (opsional)" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
          {actionError && <p role="alert" className="m-0 text-[13px] text-admin-danger">{actionError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={closePanel} className="admin-btn-ghost text-sm">Batal</button>
            <button onClick={() => processingId && handleProcess(processingId, 'rejected')} disabled={busy} className="admin-badge-red">Tolak</button>
            <button
              onClick={() => processingId && handleProcess(processingId, 'completed')}
              disabled={busy || !preview?.eligible || confirmEmail.trim().toLowerCase() !== preview.user.email.toLowerCase()}
              className="admin-btn-sm disabled:opacity-50"
            >Hapus &amp; Anonimkan</button>
          </div>
        </div>
      </Modal>

      <DataTable
        columns={columns}
        rows={requests}
        getRowId={req => req.id}
        loading={loading}
        empty="Belum ada permintaan."
        footer={meta && meta.total > 0 ? <Pagination {...meta} onPageChange={setPage} /> : undefined}
      />
    </div>
  )
}
