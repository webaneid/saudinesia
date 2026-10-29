'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Bus } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MediaField } from '@/components/admin/media/MediaField'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

const TYPES = ['bus', 'coaster', 'hiace', 'staria', 'gmc', 'innova', 'sedan']

type Vehicle = { id: string; name: string; vehicleType: string; capacity: number; fleetCount: number; description: string | null; isActive: boolean }
type Form = { name: string; vehicleType: string; capacity: string; fleetCount: string; description: string; isActive: boolean }

export default function VehicleEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/transport`
  const e = useEditEntity<Vehicle>(`/api/v1/admin/products/transport/vehicles/${id}`, list)
  const [form, setForm] = useState<Form | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)

  // Formulir diisi SEKALI dari data yang dimuat; simpan berikutnya hanya menggeser baseline.
  useEffect(() => {
    const v = e.item
    if (v && !form) {
      const f: Form = { name: v.name, vehicleType: v.vehicleType, capacity: String(v.capacity), fleetCount: String(v.fleetCount), description: v.description ?? '', isActive: v.isActive }
      setForm(f); markClean(f)
    }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Kendaraan tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const patch = (p: Partial<Form>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }

  return (
    <EditPage
      icon={Bus} title={e.item?.name ?? 'Kendaraan'} backHref={list} backLabel="Transport"
      active={form.isActive} onActiveChange={isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => { if (await e.save({ ...form, capacity: +form.capacity, fleetCount: +form.fleetCount })) markClean(form) }}
      saving={e.saving} canSubmit={!!form.name.trim() && +form.capacity > 0 && +form.fleetCount > 0} error={e.error} notice={e.notice}
      media={<MediaField productType="vehicle" productId={id} label="Foto Kendaraan" />}
      mediaTitle="Galeri Kendaraan"
      sidebar={
        <p className="m-0 rounded-2xl border border-admin-line bg-white p-4 text-[11px] text-admin-muted">
          Harga diatur di halaman <strong>Trip</strong> — setiap trip punya harga berbeda per kendaraan.
        </p>
      }
      remove={{
        confirmText: 'Hapus kendaraan ini? Bila sudah dipakai harga trip, ia hanya dinonaktifkan (bisa diaktifkan kembali).',
        onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } },
        deleting: e.deleting,
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-admin-muted">Nama Kendaraan</p>
          <input className="admin-inp" value={form.name} onChange={ev => patch({ name: ev.target.value })} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Tipe</p>
          <ChoiceSelect value={form.vehicleType} onChange={v => patch({ vehicleType: v })} clearable={false} options={TYPES.map(t => ({ id: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kapasitas (orang)</p>
          <input type="number" min={1} className="admin-inp" value={form.capacity} onChange={ev => patch({ capacity: ev.target.value })} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Jumlah Armada (unit)</p>
          <input type="number" min={1} className="admin-inp" value={form.fleetCount} onChange={ev => patch({ fleetCount: ev.target.value })} />
        </div>
        <div className="md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi (opsional)</p>
          <textarea className="admin-inp" rows={2} value={form.description} onChange={ev => patch({ description: ev.target.value })} />
        </div>
      </div>
    </EditPage>
  )
}
