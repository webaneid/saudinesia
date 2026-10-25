'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const [show,   setShow]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'admin' })

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

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/system/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    await load(); setShow(false); setSaving(false)
  }

  // Server menolak (422) mengubah akun sendiri atau menyisakan nol superadmin aktif (SEC-13) — tampilkan alasannya, lalu muat ulang
  // supaya dropdown peran kembali ke nilai sebenarnya.
  async function updateUser(id: string, change: { isActive?: boolean; role?: string }) {
    setNotice(null)
    const r = await fetch(`/api/v1/admin/system/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    })
    if (!r.ok) {
      const j: { error?: string } | null = await r.json().catch(() => null)
      setNotice(j?.error ?? 'Perubahan gagal disimpan.')
    }
    await load()
  }
  // SEC-43: lepas verifikasi WhatsApp (nomor daur ulang/disalahgunakan). Nomor kontak tetap; akun hanya berhenti menerima WhatsApp.
  async function releaseWhatsapp(u: User) {
    if (!window.confirm(`Lepas verifikasi WhatsApp akun ${u.email}? Notifikasi WhatsApp berhenti sampai nomor dibuktikan lagi (email tetap).`)) return
    setNotice(null)
    const r = await fetch(`/api/v1/admin/system/users/${u.id}/whatsapp`, { method: 'DELETE' })
    if (!r.ok) setNotice('Verifikasi WhatsApp gagal dilepas.')
    await load()
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
        actions={<button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Admin</button>}
      />

      {notice && <p role="alert" className="m-0 text-[13px] font-medium text-admin-danger">{notice}</p>}

      {show && (
        <div className="admin-form-panel">
          <p className="text-[12px] text-admin-accent-strong font-medium">Buat akun admin baru (tidak memerlukan registrasi)</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-admin-muted mb-1">Nama</p>
              <input className="admin-inp" value={form.fullName} onChange={set('fullName')} />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Email</p>
              <input type="email" className="admin-inp" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Password</p>
              <input type="password" className="admin-inp" value={form.password} onChange={set('password')} placeholder="Min 8 kar, huruf+angka+spesial" />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Role</p>
              <select className="admin-select" value={form.role} onChange={set('role')}>
                <option value="admin">Admin (Ops)</option>
                <option value="manager">Manager</option>
                <option value="superadmin">Super Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.email || !form.password} className="admin-btn-sm disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Buat Akun'}
            </button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

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
