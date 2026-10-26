'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { Badge } from '@/components/admin/ui/Badge'
import { Switch } from '@/components/admin/ui/Switch'

type FlightRoute = { id: string; origin: string; destination: string; isActive: boolean }

export default function EditFlightRoutePage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/flight`
  const e = useEditEntity<FlightRoute>(`/api/v1/admin/products/flight/routes/${id}`, list)
  const [form, setForm] = useState<{ origin: string; destination: string; isActive: boolean } | null>(null)

  useEffect(() => { if (e.item) setForm({ origin: e.item.origin, destination: e.item.destination, isActive: e.item.isActive }) }, [e.item])

  if (e.missing) return <p className="text-sm text-admin-muted">Rute tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const set = (k: 'origin' | 'destination') => (ev: React.ChangeEvent<HTMLInputElement>) => { e.clearMessages(); setForm(p => p && ({ ...p, [k]: ev.target.value })) }

  return (
    <EditPage
      icon={MapPin} title={`${e.item?.origin} → ${e.item?.destination}`} backHref={list} backLabel="Daftar Tiket Pesawat"
      headerAside={<Badge tone={e.item?.isActive ? 'ok' : 'neutral'}>{e.item?.isActive ? 'Aktif' : 'Nonaktif'}</Badge>}
      onSubmit={() => e.save(form)} saving={e.saving} canSubmit={!!form.origin.trim() && !!form.destination.trim()} error={e.error} notice={e.notice}
      remove={{ confirmText: 'Hapus rute ini? Bila sudah dipakai jadwal atau paket umroh, ia hanya dinonaktifkan (bisa diaktifkan kembali).', onDelete: e.remove, deleting: e.deleting }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Asal</p><input className="admin-inp" value={form.origin} onChange={set('origin')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tujuan</p><input className="admin-inp" value={form.destination} onChange={set('destination')} /></div>
        <label className="flex items-center gap-2.5 md:col-span-2">
          <Switch checked={form.isActive} onChange={v => { e.clearMessages(); setForm(p => p && ({ ...p, isActive: v })) }} label="Aktif" />
          <span className="text-sm font-medium text-admin-ink">Aktif (dapat dipakai jadwal baru)</span>
        </label>
      </div>
    </EditPage>
  )
}
