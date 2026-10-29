'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

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
        <ChoiceSelect className="min-w-0 flex-1" placeholder="— pilih muthowif —" value={selected} onChange={setSelected}
          options={roster.map(r => ({ id: r.id, label: r.name, hint: `kap. ${r.dailyCapacity}/hari` }))} />
        <button onClick={handleAssign} disabled={!selected || loading}
          className="admin-btn-sm disabled:opacity-50 shrink-0">
          {loading ? 'Menyimpan...' : 'Assign'}
        </button>
      </div>
    </div>
  )
}
