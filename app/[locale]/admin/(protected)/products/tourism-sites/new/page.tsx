'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

export default function NewTourismSitePage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/tourism-sites', id => `/${locale}/admin/products/tourism-sites/${id}`, 'Situs wisata gagal dibuat.')
  const [form, setForm] = useState({ name: '', city: 'makkah', description: '', gmapsUrl: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={MapPin} title="Situs Wisata Baru" backHref={`/${locale}/admin/products/tourism-sites`} backLabel="Daftar Situs Wisata"
      description="Master data tempat wisata — dipakai berulang di berbagai Paket Ziarah."
      onSubmit={() => submit(form)} saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Jabal Nur (Gua Hira)" /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kota</p>
          <select className="admin-select" value={form.city} onChange={set('city')}><option value="makkah">Makkah</option><option value="madinah">Madinah</option><option value="jeddah">Jeddah</option></select>
        </div>
        <div><p className="mb-1 text-xs text-admin-muted">Link Google Maps (opsional)</p><input className="admin-inp" value={form.gmapsUrl} onChange={set('gmapsUrl')} placeholder="https://maps.google.com/..." /></div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="tourismsite-new-description" title="Deskripsi situs wisata" value={form.description} onChange={description => { clearError(); setForm(p => ({ ...p, description })) }} placeholder="Sejarah singkat, makna, dan hal yang perlu diketahui jamaah…" />
        </div>
      </div>
    </CreatePage>
  )
}
