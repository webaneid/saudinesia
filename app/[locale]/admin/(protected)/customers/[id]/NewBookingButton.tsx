'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus } from 'lucide-react'
import { Button } from '@/components/admin/ui/Button'

// Buat draf booking untuk pelanggan ini (docs/arsitektur-booking-engine-v2.md §10.3) — lalu ke editor draf. Galat server ditampilkan apa adanya.
export function NewBookingButton({ customerId, locale }: { customerId: string; locale: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/v1/admin/bookings/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId }) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.id) { setError(json?.error ?? 'Draf booking gagal dibuat.'); return }
      router.push(`/${locale}/admin/bookings/drafts/${json.data.id}`)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={create} loading={busy}><CalendarPlus className="size-4" /> Buat booking</Button>
      {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
    </div>
  )
}
