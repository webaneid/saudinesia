'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import type { PageMeta } from '@/lib/admin/pagination'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { Badge } from '@/components/admin/ui/Badge'
import { PageHeader } from '@/components/admin/shell/PageHeader'

type User = { id: string; fullName: string | null; email: string; role: string; isActive: boolean; phone: string | null; whatsappVerifiedAt: string | null }

export default function UsersPage() {
  const { page, limit, setPage } = useListPage()
  const [users,  setUsers]  = useState<User[]>([])
  const [meta,   setMeta]   = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const { locale } = useParams() as { locale: string }
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v1/admin/system/users?page=${page}&limit=${limit}`)
      const j = await r.json()
      setUsers(j.data ?? [])
      setMeta(j.meta ?? null)
    } finally {
      setLoading(false)
    }
  }, [page, limit])
  useEffect(() => { load() }, [load])

  async function updateUser(id: string, change: { isActive?: boolean; role?: string }) {
    setNotice(null)
    const r = await fetch(`/api/v1/admin/system/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    })
    if (!r.ok) {
      const j: { error?: string } | null = await r.json().catch(() => null)
      setNotice({ text: j?.error ?? 'Perubahan gagal disimpan.', error: true })
    }
    await load()
  }
  // SEC-43: lepas verifikasi WhatsApp (nomor daur ulang/disalahgunakan). Nomor kontak tetap; akun hanya berhenti menerima WhatsApp.
  async function releaseWhatsapp(u: User) {
    if (!window.confirm(`Lepas verifikasi WhatsApp akun ${u.email}? Notifikasi WhatsApp berhenti sampai nomor dibuktikan lagi (email tetap).`)) return
    setNotice(null)
    const r = await fetch(`/api/v1/admin/system/users/${u.id}/whatsapp`, { method: 'DELETE' })
    setNotice({ text: r.ok ? 'Verifikasi WhatsApp akun ini sudah dilepas.' : 'Verifikasi WhatsApp gagal dilepas.', error: !r.ok })
    await load()
  }
  // SEC-14: korban lockout (30 gagal/jam, atau 3 email/10 mnt) dibebaskan superadmin tanpa menunggu jendela habis.
  async function resetLimits(id: string) {
    setNotice(null)
    const r = await fetch(`/api/v1/admin/system/users/${id}/reset-limits`, { method: 'POST' })
    setNotice({ text: r.ok ? 'Pembatasan login dan email akun ini sudah dibuka.' : 'Pembatasan gagal dibuka.', error: !r.ok })
  }
  const toggleActive = (id: string, isActive: boolean) => updateUser(id, { isActive: !isActive })
  const changeRole = (id: string, role: string) => updateUser(id, { role })

  const columns: Column<User>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: u => <span className="text-[13px] font-medium">{u.fullName ?? '-'}</span> },
    { key: 'email', header: 'Email', cell: u => <span className="text-[12px] text-admin-muted">{u.email}</span> },
    {
      key: 'role', header: 'Role',
      cell: u => (
        <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} aria-label={`Role ${u.email}`} className="admin-select-xs">
          <option value="pilgrim">Pilgrim</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="superadmin">Superadmin</option>
        </select>
      ),
    },
    { key: 'status', header: 'Status', cell: u => <Badge tone={u.isActive ? 'ok' : 'neutral'}>{u.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: u => (
        <div className="flex items-center justify-end gap-3">
          {u.whatsappVerifiedAt && (
            <button onClick={() => releaseWhatsapp(u)} className="text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
              Lepas WhatsApp
            </button>
          )}
          <button onClick={() => resetLimits(u.id)} className="text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
            Buka pembatasan
          </button>
          <button onClick={() => toggleActive(u.id, u.isActive)} className="text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
            {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Manajemen Pengguna"
        actions={<Link href={`/${locale}/admin/system/users/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Admin</Link>}
      />

      {notice && <p role={notice.error ? 'alert' : 'status'} className={`m-0 text-[13px] font-medium ${notice.error ? 'text-admin-danger' : 'text-admin-ink'}`}>{notice.text}</p>}

      <DataTable
        columns={columns}
        rows={users}
        getRowId={u => u.id}
        loading={loading}
        empty="Belum ada pengguna."
        footer={meta && meta.total > 0 ? <Pagination {...meta} onPageChange={setPage} /> : undefined}
      />
    </div>
  )
}
