'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { Badge } from '@/components/admin/ui/Badge'

type AdminUser = { id: string; fullName: string; email: string; role: string; isActive: boolean }

export default function EditAdminUserPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/system/users`
  const e = useEditEntity<AdminUser>(`/api/v1/admin/system/users/${id}`, list)
  const [fullName, setFullName] = useState<string | null>(null)

  useEffect(() => { if (e.item) setFullName(e.item.fullName) }, [e.item])

  if (e.missing) return <p className="text-sm text-admin-muted">Pengguna tidak ditemukan. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || fullName === null) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  // Peran dan status aktif diubah dari daftar (aturan SEC-13); penghapusan akun mengikuti alur UU PDP (docs/arsitektur-hapus-akun.md), bukan tombol hapus.
  return (
    <EditPage
      icon={Users} title={e.item?.fullName ?? 'Pengguna'} backHref={list} backLabel="Daftar Pengguna"
      description="Peran dan status aktif diubah dari daftar pengguna. Penghapusan akun mengikuti alur penghapusan akun (UU PDP)."
      headerAside={<Badge tone={e.item?.isActive ? 'ok' : 'neutral'}>{e.item?.isActive ? 'Aktif' : 'Nonaktif'}</Badge>}
      onSubmit={() => e.save({ fullName })} saving={e.saving} canSubmit={fullName.trim().length >= 2 && fullName.trim() !== e.item?.fullName} error={e.error} notice={e.notice}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Nama</p><input className="admin-inp" value={fullName} onChange={ev => { e.clearMessages(); setFullName(ev.target.value) }} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Email (identitas akun, tidak dapat diubah di sini)</p><input className="admin-inp" value={e.item?.email ?? ''} readOnly disabled /></div>
      </div>
    </EditPage>
  )
}
