'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { HOTEL_FACILITIES } from '@/lib/constants/hotelFacilities'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

export default function NewHotelPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/hotels', id => `/${locale}/admin/products/hotels/${id}`, 'Hotel gagal dibuat.')
  const [form, setForm] = useState({ name: '', city: 'makkah', stars: 4, distanceToHaramM: 500, description: '', facilities: [] as string[] })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }
  const toggleFacility = (code: string) => { clearError(); setForm(p => ({ ...p, facilities: p.facilities.includes(code) ? p.facilities.filter(c => c !== code) : [...p.facilities, code] })) }

  return (
    <CreatePage
      icon={Building2} title="Hotel Baru" backHref={`/${locale}/admin/products/hotels`} backLabel="Daftar Hotel"
      description="Isi data dasar dulu — foto, fasilitas detail, periode harga, dan jadwal kamar diatur di halaman hotel setelah dibuat."
      onSubmit={() => submit({ ...form, stars: +form.stars, distanceToHaramM: +form.distanceToHaramM })}
      saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Nama Hotel</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Nama lengkap hotel" /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kota</p>
          <ChoiceSelect ariaLabel="Kota" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} clearable={false} options={[{ id: 'makkah', label: 'Makkah' }, { id: 'madinah', label: 'Madinah' }]} />
        </div>
        <div><p className="mb-1 text-xs text-admin-muted">Bintang</p><input type="number" min={1} max={5} className="admin-inp" value={form.stars} onChange={set('stars')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Jarak ke Haram (meter)</p><input type="number" className="admin-inp" value={form.distanceToHaramM} onChange={set('distanceToHaramM')} /></div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="hotel-new-description" title="Deskripsi hotel" value={form.description} onChange={description => { clearError(); setForm(p => ({ ...p, description })) }} placeholder="Tentang hotel, lokasi, fasilitas unggulan, catatan untuk jamaah…" />
        </div>
        <div className="md:col-span-2">
          <p className="mb-2 text-xs text-admin-muted">Fasilitas</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {HOTEL_FACILITIES.map(f => (
              <label key={f.code} className="flex cursor-pointer items-center gap-2 text-[13px] text-admin-ink/80">
                <input type="checkbox" className="h-3.5 w-3.5" checked={form.facilities.includes(f.code)} onChange={() => toggleFacility(f.code)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </CreatePage>
  )
}
