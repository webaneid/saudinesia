'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserRound } from 'lucide-react'

type RosterItem = { id: string; name: string; dailyCapacity: number }

export function MuthowifAssignPanel({ bookingId }: { bookingId: string }) {
  const router = useRouter()
  const [roster, setRoster] = useState<RosterItem[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/v1/admin/bookings/${bookingId}/muthowif/assign`)
      .then(r => r.json())
      .then(j => setRoster(j.data ?? []))
  }, [bookingId])

  async function handleAssign() {
    if (!selected) return
    setLoading(true); setError('')
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/muthowif/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muthowifId: selected }),
    })
    const json = await res.json()
    setLoading(false)
    if (!json.success) { setError(json.error ?? 'Gagal assign'); return }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-admin-warning flex items-center gap-1.5">
        <UserRound className="h-3.5 w-3.5" /> Belum di-assign — pilih muthowif dari roster aktif
      </p>
      {error && <p className="text-[12px] text-admin-danger">{error}</p>}
      <div className="flex gap-2">
        <select className="admin-select flex-1 text-sm" value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">— pilih muthowif —</option>
          {roster.map(r => <option key={r.id} value={r.id}>{r.name} (kap. {r.dailyCapacity}/hari)</option>)}
        </select>
        <button onClick={handleAssign} disabled={!selected || loading}
          className="admin-btn-sm disabled:opacity-50 shrink-0">
          {loading ? 'Menyimpan...' : 'Assign'}
        </button>
      </div>
    </div>
  )
}
