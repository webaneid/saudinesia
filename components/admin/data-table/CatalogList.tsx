'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PageMeta } from '@/lib/admin/pagination'
import type { FilterOption } from '@/lib/admin/filter'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { SearchInput } from '@/components/admin/data-table/SearchInput'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { ApiAction } from '@/components/admin/data-table/ApiAction'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'

// Daftar katalog admin yang SERAGAM (docs/arsitektur-tabel.md Fase 3): pencarian + filter dropdown + DataTable + paginasi dari server. Halaman hanya menyebut endpoint,
// kolom, dan filter. Server dipanggil dengan `?page=&limit=&q=&status=` (paginasi opt-in — lihat lib/admin/catalogQuery.ts); URL halaman memuat state (bisa di-bookmark).

export type CatalogFilter = { param: string; label: string; options: readonly FilterOption[]; allLabel?: string }

type CatalogListProps<T> = {
  /** Endpoint daftar, mis. `/api/v1/admin/products/haji`. */
  endpoint: string
  columns: (reload: () => void) => Column<T>[]
  getRowId: (row: T) => string
  empty: ReactNode
  searchPlaceholder?: string
  /** Tampilkan filter Status (Aktif/Nonaktif) — untuk model yang punya `isActive`. */
  status?: boolean
  filters?: readonly CatalogFilter[]
  /** Hanya cari/filter-bar bila model mendukung; false = tanpa kotak cari. */
  search?: boolean
  /** Awalan param URL bila halaman punya beberapa tabel. */
  ns?: string
  /** Baris nonaktif ditampilkan redup (kolom `isActive`). */
  isActive?: (row: T) => boolean
  /** Dipanggil setiap data termuat (mis. halaman induk butuh `meta.total`). */
  onLoaded?: (meta: PageMeta | null) => void
  /** Ubah nilai ini untuk memuat ulang dari luar. */
  reloadKey?: number | string
}

export function CatalogList<T>({ endpoint, columns, getRowId, empty, searchPlaceholder, status, filters = [], search = true, ns = '', isActive, onLoaded, reloadKey }: CatalogListProps<T>) {
  const { page, limit, setPage, setParams, get, reset } = useListPage(ns)
  const [rows, setRows] = useState<T[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const onLoadedRef = useRef(onLoaded)
  onLoadedRef.current = onLoaded

  const q = get('q')
  const statusValue = get('status')
  const filterValues = Object.fromEntries(filters.map(f => [f.param, get(f.param)]))
  const filterKey = JSON.stringify(filterValues)

  useEffect(() => {
    const ctl = new AbortController()
    setLoading(true); setError(null)
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (q) qs.set('q', q)
    if (statusValue) qs.set('status', statusValue)
    for (const [k, v] of Object.entries(JSON.parse(filterKey) as Record<string, string>)) if (v) qs.set(k, v)
    fetch(`${endpoint}?${qs}`, { signal: ctl.signal })
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!r.ok || !Array.isArray(j?.data)) { setError(j?.error ?? 'Daftar gagal dimuat.'); setRows([]); setMeta(null); return }
        setRows(j.data); setMeta(j.meta ?? null); onLoadedRef.current?.(j.meta ?? null)
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') { setError('Tidak dapat menghubungi server.'); setRows([]) } })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    return () => ctl.abort()
  }, [endpoint, page, limit, q, statusValue, filterKey, tick, reloadKey])

  const reload = useCallback(() => setTick(t => t + 1), [])
  const anyFilter = Boolean(q || statusValue || Object.values(filterValues).some(Boolean))
  const hasBar = search || status || filters.length > 0

  return (
    <div className="space-y-3">
      {hasBar && (
        <FilterBar active={anyFilter} onReset={() => reset(['q', 'status', ...filters.map(f => f.param)])}>
          {search && <SearchInput value={q} onChange={v => setParams({ q: v || undefined })} placeholder={searchPlaceholder ?? 'Cari…'} />}
          {status && <FilterSelect label="Status" value={statusValue} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} onChange={v => setParams({ status: v || undefined })} />}
          {filters.map(f => <FilterSelect key={f.param} label={f.label} allLabel={f.allLabel} value={filterValues[f.param] ?? ''} options={f.options} onChange={v => setParams({ [f.param]: v || undefined })} />)}
        </FilterBar>
      )}
      {error && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{error}</p>}
      <DataTable
        columns={columns(reload)} rows={rows} getRowId={getRowId} loading={loading} empty={anyFilter ? 'Tidak ada data yang cocok dengan filter.' : empty}
        rowClassName={isActive ? r => (isActive(r) ? undefined : 'opacity-50') : undefined}
        footer={meta && meta.total > 0 ? <Pagination {...meta} onPageChange={setPage} /> : undefined}
      />
    </div>
  )
}

type CatalogActionsProps = {
  /** Halaman edit/kelola entitas. */
  editHref: string
  /** URL entitas untuk PUT/DELETE, mis. `/api/v1/admin/products/haji/<id>`. Tanpa ini hanya tombol Edit. */
  url?: string
  /** Nama yang tampil di dialog dan teks aksesibel, mis. "Hotel Al Safwah". */
  subject: string
  /** Status aktif saat ini; `undefined` = model tanpa `isActive` (tanpa tombol Aktif/Nonaktif). */
  active?: boolean
  /** Sembunyikan Hapus (mis. entitas yang tak boleh dihapus). */
  noDelete?: boolean
  note?: string
  onDone?: () => void
}

/** Kolom aksi katalog yang seragam: Edit, Aktifkan/Nonaktifkan (bila ada), Hapus (hapus-aman: dinonaktifkan bila dirujuk — pesan server tampil di dialog). */
export function CatalogActions({ editHref, url, subject, active, noDelete, note, onDone }: CatalogActionsProps) {
  return (
    <RowActions>
      <ActionLink kind="edit" href={editHref} label={`Edit ${subject}`} />
      {url && active !== undefined && <ApiAction kind="toggle" url={url} active={active} label={`${active ? 'Nonaktifkan' : 'Aktifkan'} ${subject}`} onDone={onDone} />}
      {url && !noDelete && <ApiAction kind="delete" url={url} subject={subject} label={`Hapus ${subject}`} note={note} onDone={onDone} />}
    </RowActions>
  )
}
