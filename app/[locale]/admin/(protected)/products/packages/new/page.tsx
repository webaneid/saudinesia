'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Package } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

export default function NewPackagePage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/packages', id => `/${locale}/admin/products/packages/${id}`, 'Paket gagal dibuat.')
  const [form, setForm] = useState({ name: '', description: '' })

  return (
    <CreatePage
      icon={Package} title="Paket Umroh Baru" backHref={`/${locale}/admin/products/packages`} backLabel="Daftar Paket Umroh"
      description="Isi info dasar dulu — hotel, kendaraan, muthowif, visa, tiket pesawat, katering, dan komponen biaya dikonfigurasi di halaman paket setelah dibuat."
      onSubmit={() => submit(form)} saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3">
        <div><p className="mb-1 text-xs text-admin-muted">Nama Paket</p><input className="admin-inp" autoFocus value={form.name} onChange={e => { clearError(); setForm(p => ({ ...p, name: e.target.value })) }} placeholder="Paket Umroh Hemat 9 Hari" /></div>
        <div className="min-w-0"><p className="mb-1 text-xs text-admin-muted">Deskripsi</p><RichTextEditor id="package-new-description" title="Deskripsi paket umroh" value={form.description} onChange={description => { clearError(); setForm(p => ({ ...p, description })) }} placeholder="Ringkasan paket, program, dan keunggulan…" /></div>
      </div>
    </CreatePage>
  )
}
