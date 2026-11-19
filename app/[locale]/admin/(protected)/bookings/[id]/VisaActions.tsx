'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { VISA_STATUS } from '@/lib/constants/booking'
import { VISA_STATUS_TRANSITIONS } from '@/lib/validators/visaStatus'

// Tombol ubah status visa satu jamaah (docs/arsitektur-visa.md §9). Menolak WAJIB menulis alasan — alasan itu TAMPIL ke jamaah (V2).
// Sesudah berhasil halaman dimuat ulang supaya linimasa dan lencana ikut berubah.

interface VisaActionsProps {
  pilgrimId:     string
  currentStatus: string
}

export function VisaActions({ pilgrimId, currentStatus }: VisaActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const nextStatuses = VISA_STATUS_TRANSITIONS[currentStatus] ?? []

  async function updateStatus(newStatus: string, rejectionReason?: string) {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/v1/admin/visa/${pilgrimId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...(rejectionReason ? { rejectionReason } : {}) }),
      })
      const json = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) { setError(json?.error ?? 'Gagal mengubah status visa'); return }
      setRejecting(false); setReason('')
      router.refresh()
    } catch {
      setError('Gagal terhubung ke server')
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-admin-muted">Ubah status:</span>
        {nextStatuses.length === 0
          ? <span className="text-[11px] text-admin-muted/70">Tidak ada langkah berikutnya</span>
          : nextStatuses.map(s => (
            <button key={s} type="button" disabled={loading}
              onClick={() => (s === 'rejected' ? setRejecting(true) : updateStatus(s))}
              className="rounded-lg border border-admin-line px-2.5 py-1 text-[11px] font-medium text-admin-ink/80 transition-colors hover:bg-admin-spot disabled:opacity-50">
              → {VISA_STATUS[s as keyof typeof VISA_STATUS]?.label}
            </button>
          ))}
      </div>
      {rejecting && (
        <div className="space-y-2 rounded-lg border border-admin-line p-3">
          <label htmlFor={`reject-${pilgrimId}`} className="block text-[12px] font-semibold text-admin-ink">Alasan penolakan (tampil ke jamaah)</label>
          <textarea id={`reject-${pilgrimId}`} className="admin-inp min-h-20 w-full" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Mis. foto paspor buram, mohon unggah ulang" />
          <div className="flex gap-2">
            <button type="button" className="admin-btn-sm" disabled={loading || reason.trim().length < 3} onClick={() => updateStatus('rejected', reason.trim())}>Tolak visa</button>
            <button type="button" className="admin-btn-sm" disabled={loading} onClick={() => { setRejecting(false); setReason('') }}>Batal</button>
          </div>
        </div>
      )}
      {error && <p className="m-0 text-[11px] text-admin-danger">{error}</p>}
    </div>
  )
}
