'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PageMeta } from '@/lib/admin/pagination'
import { DELETION_REQUEST_TONE } from '@/lib/admin/statusTone'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { Badge } from '@/components/admin/ui/Badge'
import { PageHeader } from '@/components/admin/shell/PageHeader'

type DeletionRequest = {
  id: string
  status: 'pending' | 'completed' | 'rejected'
  note: string | null
  requestedAt: string
  processedAt: string | null
  user: { fullName: string; email: string }
  processedBy: { fullName: string } | null
}

const STATUS_LABEL: Record<DeletionRequest['status'], string> = {
  pending: 'Menunggu',
  completed: 'Selesai',
  rejected: 'Ditolak',
}

export default function DeletionRequestsPage() {
  const { page, limit, setPage } = useListPage()
  const [requests, setRequests] = useState<DeletionRequest[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v1/admin/deletion-requests?page=${page}&limit=${limit}`)
      const j = await r.json()
      setRequests(j.data ?? [])
      setMeta(j.meta ?? null)
    } finally {
      setLoading(false)
    }
  }, [page, limit])
  useEffect(() => { load() }, [load])

  async function handleProcess(id: string, status: 'completed' | 'rejected') {
    await fetch(`/api/v1/admin/deletion-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note: noteDraft || undefined }),
    })
    setProcessingId(null)
    setNoteDraft('')
    await load()
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
      key: 'actions', header: '', align: 'right',
      cell: req => (
        <>
          {req.status === 'pending' && (
            processingId === req.id ? (
              <div className="ml-auto max-w-xs space-y-2">
                <input
                  className="admin-inp w-full" placeholder="Catatan (opsional)"
                  value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button onClick={() => handleProcess(req.id, 'completed')} className="admin-btn-sm">Tandai Selesai</button>
                  <button onClick={() => handleProcess(req.id, 'rejected')} className="admin-badge-red">Tolak</button>
                  <button onClick={() => { setProcessingId(null); setNoteDraft('') }} className="admin-btn-ghost text-sm">Batal</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setProcessingId(req.id)} className="admin-btn-sm">Proses</button>
            )
          )}
          {req.status !== 'pending' && req.note && <p className="m-0 ml-auto max-w-xs text-[11px] text-admin-muted">{req.note}</p>}
        </>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permintaan Hapus Akun"
        description="UU PDP — hak subjek data. Diproses manual, bukan hard-delete otomatis (riwayat booking/pembayaran punya kebutuhan retensi hukum/pajak)."
      />
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
