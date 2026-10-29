'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

export default function NewAdminUserPage() {
  const { locale } = useParams() as { locale: string }
  // Pengguna dikelola dari daftar (ubah peran/nonaktifkan) — setelah dibuat kembali ke daftar.
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/system/users', () => `/${locale}/admin/system/users`, 'Akun gagal dibuat.')
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'admin' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={Users} title="Akun Admin Baru" backHref={`/${locale}/admin/system/users`} backLabel="Daftar Pengguna"
      description="Membuat akun staf langsung (tanpa registrasi). Peran dapat diubah dari daftar pengguna."
      onSubmit={() => submit(form)} saving={saving} canSubmit={form.fullName.trim().length >= 2 && !!form.email.trim() && !!form.password} error={error} submitLabel="Buat Akun"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Nama</p><input className="admin-inp" autoFocus value={form.fullName} onChange={set('fullName')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Email</p><input type="email" className="admin-inp" autoComplete="off" value={form.email} onChange={set('email')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Password</p><input type="password" className="admin-inp" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="Min 8 kar, huruf+angka+spesial" /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Role</p>
          <ChoiceSelect ariaLabel="Role" value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} clearable={false} options={[{ id: 'admin', label: 'Admin (Ops)' }, { id: 'manager', label: 'Manager' }, { id: 'superadmin', label: 'Super Admin' }]} />
        </div>
      </div>
    </CreatePage>
  )
}
