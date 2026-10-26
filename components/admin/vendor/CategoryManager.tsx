'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'

export type CategoryRow = { id: string; slug: string; name: string; isActive: boolean; sortOrder: number; isSystem: boolean; vendorCount: number }
type Notice = { text: string; error: boolean }

const API = '/api/v1/admin/system/vendor-categories'

/** Kelola kategori vendor (CRUD lengkap). Kategori bawaan sistem hanya bisa diganti nama/urutannya; yang dipakai vendor dinonaktifkan, bukan dihapus. */
export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string; sortOrder: string } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setNotice({ text: json?.error ?? 'Permintaan gagal', error: true })
        return { ok: false, error: json?.error }
      }
      return { ok: true, data: json.data }
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server', error: true })
      return { ok: false }
    } finally { setBusy(false) }
  }

  async function add() {
    if (!newName.trim()) return
    const r = await call(API, 'POST', { name: newName.trim() })
    if (r.ok) { setNewName(''); setNotice({ text: 'Kategori ditambahkan.', error: false }); router.refresh() }
  }

  async function saveEdit() {
    if (!editing) return
    const sortOrder = Number(editing.sortOrder)
    if (!Number.isInteger(sortOrder) || sortOrder < 0) return setNotice({ text: 'Urutan harus bilangan bulat 0 atau lebih', error: true })
    const r = await call(`${API}/${editing.id}`, 'PUT', { name: editing.name.trim(), sortOrder })
    if (r.ok) { setEditing(null); setNotice({ text: 'Perubahan tersimpan.', error: false }); router.refresh() }
  }

  async function setActive(c: CategoryRow, isActive: boolean) {
    const r = await call(`${API}/${c.id}`, 'PUT', { isActive })
    if (r.ok) { setNotice({ text: isActive ? 'Kategori diaktifkan kembali.' : 'Kategori dinonaktifkan.', error: false }); router.refresh() }
  }

  async function remove(c: CategoryRow) {
    const r = await call(`${API}/${c.id}`, 'DELETE')
    if (!r.ok) return
    setConfirmingDelete(null)
    setNotice({ text: r.data?.deleted ? 'Kategori dihapus.' : String(r.data?.message ?? 'Kategori dipakai sehingga dinonaktifkan.'), error: false })
    router.refresh()
  }

  const columns: Column<CategoryRow>[] = [
    {
      key: 'name', header: 'Kategori', mobile: 'title',
      cell: c => editing?.id === c.id ? (
        <input aria-label="Nama kategori" className="admin-inp max-w-64" value={editing.name} maxLength={80} onChange={e => setEditing({ ...editing, name: e.target.value })} />
      ) : (
        <div>
          <div className="text-[13px] font-semibold">{c.name}</div>
          <div className="font-mono text-[11px] text-admin-muted">{c.slug}</div>
        </div>
      ),
    },
    {
      key: 'order', header: 'Urutan', hideBelowLg: true,
      cell: c => editing?.id === c.id ? (
        <input aria-label="Urutan" inputMode="numeric" className="admin-inp w-24" value={editing.sortOrder} onChange={e => setEditing({ ...editing, sortOrder: e.target.value })} />
      ) : <span className="text-[12px] tabular-nums">{c.sortOrder}</span>,
    },
    { key: 'vendors', header: 'Vendor', cell: c => <span className="text-[12px] tabular-nums">{c.vendorCount}</span> },
    {
      key: 'status', header: 'Status',
      cell: c => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
          {c.isSystem && <Badge tone="accent">Bawaan</Badge>}
        </div>
      ),
    },
    {
      key: 'actions', header: '',
      cell: c => {
        if (editing?.id === c.id) {
          return (
            <div className="flex gap-1">
              <Button size="sm" disabled={busy} onClick={saveEdit}><Check className="size-4" /> Simpan</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}><X className="size-4" /> Batal</Button>
            </div>
          )
        }
        if (confirmingDelete === c.id) {
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-admin-ink">{c.vendorCount > 0 ? 'Dipakai vendor — akan dinonaktifkan.' : 'Hapus permanen?'}</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(c)}>Ya</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(null)}>Batal</Button>
            </div>
          )
        }
        return (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setEditing({ id: c.id, name: c.name, sortOrder: String(c.sortOrder) })}><Pencil className="size-4" /> Ubah</Button>
            {!c.isSystem && (c.isActive
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setActive(c, false)}><Power className="size-4" /> Nonaktifkan</Button>
              : <Button size="sm" variant="outline" disabled={busy} onClick={() => setActive(c, true)}><Power className="size-4" /> Aktifkan</Button>)}
            {!c.isSystem && <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(c.id)}><Trash2 className="size-4" /> Hapus</Button>}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void add() }}>
        <input aria-label="Nama kategori baru" className="admin-inp max-w-72" placeholder="Nama kategori baru" value={newName} maxLength={80} onChange={e => setNewName(e.target.value)} />
        <Button type="submit" disabled={busy || !newName.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Tambah</Button>
      </form>

      {notice && <p role="status" className={`m-0 text-sm font-medium ${notice.error ? 'text-admin-danger' : 'text-admin-ok'}`}>{notice.text}</p>}

      <DataTable columns={columns} rows={categories} getRowId={c => c.id} rowClassName={c => (c.isActive ? undefined : 'opacity-60')} empty="Belum ada kategori." />
    </div>
  )
}
