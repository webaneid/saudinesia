'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Landmark } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

export default function NewTourPackagePage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/tour-packages', id => `/${locale}/admin/products/tour-packages/${id}`, 'Paket ziarah gagal dibuat.')
  const [form, setForm] = useState({ name: '', description: '' })

  return (
    <CreatePage
      icon={Landmark} title="Paket Ziarah Baru" backHref={`/${locale}/admin/products/tour-packages`} backLabel="Daftar Paket Ziarah"
      description="Isi info dasar dulu — kendaraan, hotel, situs, dan komponen biaya dikonfigurasi di halaman paket setelah dibuat."
      onSubmit={() => submit(form)} saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3">
        <div><p className="mb-1 text-xs text-admin-muted">Nama Paket</p><input className="admin-inp" autoFocus value={form.name} onChange={e => { clearError(); setForm(p => ({ ...p, name: e.target.value })) }} placeholder="Ziarah Makkah — Sejarah Islam" /></div>
        <div className="min-w-0">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="tourpackage-new-description" title="Deskripsi paket ziarah" value={form.description} onChange={description => { clearError(); setForm(p => ({ ...p, description })) }} placeholder="Program ziarah, situs yang dikunjungi, dan catatan untuk jamaah…" />
        </div>
      </div>
    </CreatePage>
  )
}
