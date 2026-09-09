'use client'

import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'

type User = { id: string; fullName: string | null; email: string; role: string; isActive: boolean; phone: string | null }

export default function UsersPage() {
  const [users,  setUsers]  = useState<User[]>([])
  const [show,   setShow]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'admin' })

  async function load() {
    const r = await fetch('/api/v1/admin/system/users')
    const j = await r.json()
    setUsers(j.data ?? [])
  }
  useEffect(() => { load() }, [])

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

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/v1/admin/system/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    await load()
  }

  async function changeRole(id: string, role: string) {
    await fetch(`/api/v1/admin/system/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    await load()
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="admin-h1">Manajemen Pengguna</h1>
        <button onClick={() => setShow(!show)} className="admin-btn">
          <Plus className="h-4 w-4" /> Tambah Admin
        </button>
      </div>

      {show && (
        <div className="admin-form-panel">
          <p className="text-[12px] text-teal-700 font-medium">Buat akun admin baru (tidak memerlukan registrasi)</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Nama</p>
              <input className="admin-inp" value={form.fullName} onChange={set('fullName')} />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Email</p>
              <input type="email" className="admin-inp" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Password</p>
              <input type="password" className="admin-inp" value={form.password} onChange={set('password')} placeholder="Min 8 kar, huruf+angka+spesial" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Role</p>
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

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60">
            <tr>
              <th className="admin-th">Nama</th>
              <th className="admin-th">Email</th>
              <th className="admin-th">Role</th>
              <th className="admin-th">Status</th>
              <th className="admin-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-canvas/40 transition-colors">
                <td className="px-4 py-3 text-ink font-medium text-[13px]">{u.fullName ?? '-'}</td>
                <td className="px-4 py-3 text-slate-500 text-[12px]">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={e => changeRole(u.id, e.target.value)}
                    className="admin-select-xs"
                  >
                    <option value="pilgrim">Pilgrim</option>
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="superadmin">Superadmin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={u.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>
                    {u.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleActive(u.id, u.isActive)}
                    className="text-[12px] text-slate-500 hover:text-ink transition-colors"
                  >
                    {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
