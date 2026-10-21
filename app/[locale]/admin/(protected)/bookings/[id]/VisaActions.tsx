'use client'

import { useState } from 'react'
import { VISA_STATUS } from '@/lib/constants/booking'
import { VISA_STATUS_TRANSITIONS } from '@/lib/validators/visaStatus'

interface VisaActionsProps {
  pilgrimId:     string
  visaAppId:     string
  currentStatus: string
}

export function VisaActions({ pilgrimId, visaAppId: _, currentStatus }: VisaActionsProps) {
  const [status,  setStatus]  = useState(currentStatus)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const nextStatuses = VISA_STATUS_TRANSITIONS[status] ?? []

  async function updateStatus(newStatus: string) {
    setLoading(true); setError('')
    const res  = await fetch(`/api/v1/admin/visa/${pilgrimId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    const json = await res.json()
    if (!json.success) { setError(json.error ?? 'Gagal'); setLoading(false); return }
    setStatus(newStatus); setLoading(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-admin-muted font-medium">Update visa:</span>
      {nextStatuses.length === 0
        ? <span className="text-[11px] text-admin-muted/70">Tidak ada transisi</span>
        : nextStatuses.map(s => (
          <button key={s} onClick={() => updateStatus(s)} disabled={loading}
            className="px-2.5 py-1 rounded-lg border border-admin-line text-[11px] font-medium text-admin-ink/80 hover:bg-admin-spot disabled:opacity-50 transition-colors">
            → {VISA_STATUS[s as keyof typeof VISA_STATUS]?.label}
          </button>
        ))
      }
      {error && <span className="text-[11px] text-admin-danger">{error}</span>}
    </div>
  )
}
