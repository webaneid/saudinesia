'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plane } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

type FlightRoute = { id: string; origin: string; destination: string; isActive: boolean }

export default function NewFlightSchedulePage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/flight/schedules', id => `/${locale}/admin/products/flight/${id}`, 'Jadwal gagal dibuat.')
  const [routes, setRoutes] = useState<FlightRoute[] | null>(null)
  const [form, setForm] = useState({ routeId: '', departureFrom: '', departureTo: '', totalSeats: '0' })

  useEffect(() => {
    fetch('/api/v1/admin/products/flight/routes').then(r => r.json()).then(j => setRoutes((j.data ?? []).filter((r: FlightRoute) => r.isActive))).catch(() => setRoutes([]))
  }, [])

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={Plane} title="Jadwal Penerbangan Baru" backHref={`/${locale}/admin/products/flight`} backLabel="Daftar Tiket Pesawat"
      description="Harga dan maskapai diatur di halaman jadwal setelah dibuat — harga terhitung otomatis begitu komponen HPP diisi."
      onSubmit={() => submit({ ...form, totalSeats: +form.totalSeats })}
      saving={saving} canSubmit={!!form.routeId && !!form.departureFrom && !!form.departureTo} error={error} submitLabel="Simpan & Lanjut"
    >
      {routes !== null && routes.length === 0 ? (
        <p className="m-0 text-sm text-admin-warning">Belum ada rute aktif. <Link href={`/${locale}/admin/products/flight`} className="font-semibold underline">Tambah rute dulu</Link> di daftar Tiket Pesawat.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <p className="mb-1 text-xs text-admin-muted">Rute</p>
            <ChoiceSelect placeholder="Pilih rute…" value={form.routeId} onChange={v => setForm(f => ({ ...f, routeId: v }))}
              options={(routes ?? []).map(r => ({ id: r.id, label: `${r.origin} → ${r.destination}` }))} />
          </div>
          <div><p className="mb-1 text-xs text-admin-muted">Periode Mulai</p><input type="date" className="admin-inp" value={form.departureFrom} onChange={set('departureFrom')} /></div>
          <div><p className="mb-1 text-xs text-admin-muted">Periode Akhir</p><input type="date" className="admin-inp" value={form.departureTo} onChange={set('departureTo')} /></div>
          <div><p className="mb-1 text-xs text-admin-muted">Total Kursi</p><input type="number" className="admin-inp" value={form.totalSeats} onChange={set('totalSeats')} /></div>
        </div>
      )}
    </CreatePage>
  )
}
