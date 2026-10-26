'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

export default function NewMuthowifPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/muthowif', id => `/${locale}/admin/products/muthowif/${id}`, 'Muthowif gagal dibuat.')
  const [form, setForm] = useState({ name: '', bio: '', dailyCapacity: 40, languages: 'Bahasa Indonesia' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={UserRound} title="Muthowif Baru" backHref={`/${locale}/admin/products/muthowif`} backLabel="Daftar Muthowif"
      description="Foto dan data lain dilengkapi di halaman muthowif setelah dibuat. Harga layanan diatur di daftar Muthowif (satu harga untuk semua)."
      onSubmit={() => submit({ ...form, dailyCapacity: +form.dailyCapacity, languages: form.languages.split(',').map(s => s.trim()).filter(Boolean) })}
      saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Nama</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Bahasa (pisah koma)</p><input className="admin-inp" value={form.languages} onChange={set('languages')} placeholder="Bahasa Indonesia, Arab" /></div>
        <div className="min-w-0 md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Bio</p><RichTextEditor id="muthowif-new-bio" title="Bio muthowif" value={form.bio} onChange={bio => { clearError(); setForm(p => ({ ...p, bio })) }} placeholder="Latar belakang, pengalaman membimbing, bahasa…" /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Kapasitas/hari</p><input type="number" className="admin-inp" value={form.dailyCapacity} onChange={set('dailyCapacity')} /></div>
      </div>
    </CreatePage>
  )
}
