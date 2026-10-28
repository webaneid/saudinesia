'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, Plus, X } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ApiAction } from '@/components/admin/data-table/ApiAction'
import { ActionButton, RowActions } from '@/components/admin/data-table/RowActions'
import { buildPageMeta } from '@/lib/admin/pagination'

export type CategoryRow = { id: string; slug: string; name: string; isActive: boolean; sortOrder: number; isSystem: boolean; vendorCount: number }
type Notice = { text: string; error: boolean }

const API = '/api/v1/admin/system/vendor-categories'

const PAGE_SIZE = 10

/** Kelola kategori vendor (CRUD lengkap). Kategori bawaan sistem hanya bisa diganti nama/urutannya; yang dipakai vendor dinonaktifkan, bukan dihapus. Daftar kecil dari server → paginasi di klien. */
export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string; sortOrder: string } | null>(null)
  const [page, setPage] = useState(1)

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
      key: 'actions', header: '', actions: true,
      cell: c => {
        if (editing?.id === c.id) {
          return (
            <RowActions>
              <ActionButton icon={Check} label={`Simpan perubahan kategori ${c.name}`} disabled={busy} onClick={saveEdit} />
              <ActionButton icon={X} label="Batal ubah" disabled={busy} onClick={() => setEditing(null)} />
            </RowActions>
          )
        }
        return (
          <RowActions>
            <ActionButton icon={Pencil} label={`Ubah kategori ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name, sortOrder: String(c.sortOrder) })} />
            {!c.isSystem && <ApiAction kind="toggle" url={`${API}/${c.id}`} active={c.isActive} label={`${c.isActive ? 'Nonaktifkan' : 'Aktifkan'} kategori ${c.name}`} />}
            {!c.isSystem && <ApiAction kind="delete" url={`${API}/${c.id}`} subject={`kategori ${c.name}`} note={c.vendorCount > 0 ? 'Kategori ini dipakai vendor — akan dinonaktifkan, bukan dihapus.' : undefined} />}
          </RowActions>
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

      {(() => {
        const meta = buildPageMeta(categories.length, Math.min(page, Math.max(1, Math.ceil(categories.length / PAGE_SIZE))), PAGE_SIZE)
        const rows = categories.slice((meta.page - 1) * PAGE_SIZE, meta.page * PAGE_SIZE)
        return <DataTable columns={columns} rows={rows} getRowId={c => c.id} rowClassName={c => (c.isActive ? undefined : 'opacity-60')} empty="Belum ada kategori." footer={meta.total > 0 ? <Pagination {...meta} onPageChange={setPage} /> : undefined} />
      })()}
    </div>
  )
}
