'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { useIsSuperAdmin } from '@/components/admin/shell/AdminRole'
import { Modal } from '@/components/admin/ui/Modal'
import { getCountryName } from '@/lib/constants/countries'
import { VENDOR_CONTEXT_CATEGORIES, type VendorContext } from '@/lib/constants/vendor'
import { VendorForm } from './VendorForm'
import type { VendorCategoryOption, VendorRecord } from './types'

type VendorItem = { id: string; name: string; countryCode: string | null; isActive: boolean }

type Props = {
  value: string
  onChange: (vendorId: string) => void
  /** Konteks pemanggil — menentukan penyaring kategori awal dan kategori yang terisi di modal "Vendor baru". */
  context: VendorContext
  /** Nama aksesibel kolom (mis. "Vendor harga visa"). */
  label?: string
}

const API = '/api/v1/admin/system/vendors'
const labelOf = (v: VendorItem) => `${v.name}${v.countryCode ? ` · ${getCountryName(v.countryCode) ?? v.countryCode}` : ''}${v.isActive ? '' : ' (nonaktif)'}`

/**
 * SATU-SATUNYA cara memilih vendor di admin (ADR-0003 keputusan 5): daftar dengan pencarian sisi-server, disaring ke kategori konteks
 * (dapat dilepas lewat "Tampilkan semua kategori"), dan — khusus superadmin — "Vendor baru" yang membuka `VendorForm` yang SAMA di modal
 * dengan kategori konteks terisi. Hanya vendor aktif yang dapat dipilih baru; vendor terpilih yang sudah nonaktif tetap tampil agar tidak
 * hilang diam-diam. Manager membaca daftar ramping; membuat vendor baru bukan haknya (tombol tidak tampil).
 */
export function VendorPicker({ value, onChange, context, label = 'Vendor' }: Props) {
  const isSuperAdmin = useIsSuperAdmin()
  const contextSlugs: readonly string[] | null = VENDOR_CONTEXT_CATEGORIES[context]
  const contextSlug = contextSlugs?.[0] ?? null // setiap konteks bertipe satu kategori; API menyaring satu slug
  const [showAll, setShowAll] = useState(contextSlug === null)
  const [items, setItems] = useState<VendorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const known = useRef(new Map<string, VendorItem>())
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastQuery = useRef('')

  const [modalOpen, setModalOpen] = useState(false)
  const [categories, setCategories] = useState<VendorCategoryOption[] | null>(null)

  const load = useCallback(async (q: string) => {
    lastQuery.current = q
    setLoading(true)
    const params = new URLSearchParams({ limit: '50', status: 'active' })
    if (q) params.set('q', q)
    if (!showAll && contextSlug) params.set('category', contextSlug)
    try {
      const r = await fetch(`${API}?${params}`)
      const j = await r.json().catch(() => null)
      if (lastQuery.current !== q) return // jawaban basi dari ketikan sebelumnya
      if (!r.ok || !Array.isArray(j?.data)) { setFailed(true); setItems([]); return }
      const list = j.data as VendorItem[]
      for (const v of list) known.current.set(v.id, v)
      setFailed(false)
      setItems(list)
    } catch {
      setFailed(true); setItems([])
    } finally {
      if (lastQuery.current === q) setLoading(false)
    }
  }, [showAll, contextSlug])

  useEffect(() => { void load('') }, [load])
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  // Vendor terpilih yang tidak ada di hasil (nonaktif / beda kategori / belum dimuat): cari di semua vendor supaya namanya tetap tampil.
  useEffect(() => {
    if (!value || known.current.has(value)) return
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`${API}?limit=100&status=all`)
        const j = await r.json().catch(() => null)
        if (cancelled || !Array.isArray(j?.data)) return
        for (const v of j.data as VendorItem[]) known.current.set(v.id, v)
        setItems(prev => [...prev]) // memicu render ulang agar opsi terpilih ikut tampil
      } catch { /* label cadangan di bawah */ }
    })()
    return () => { cancelled = true }
  }, [value])

  const options: AutocompleteOption[] = useMemo(() => {
    const opts = items.map(v => ({ id: v.id, label: labelOf(v) }))
    if (value && !opts.some(o => o.id === value)) {
      const v = known.current.get(value)
      opts.unshift({ id: value, label: v ? labelOf(v) : 'Vendor terpilih' })
    }
    return opts
  }, [items, value])

  function onSearch(q: string) {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void load(q.trim()), 250)
  }

  async function openModal() {
    setModalOpen(true)
    if (categories) return
    try {
      const r = await fetch('/api/v1/admin/system/vendor-categories')
      const j = await r.json().catch(() => null)
      setCategories(Array.isArray(j?.data) ? (j.data as VendorCategoryOption[]) : [])
    } catch { setCategories([]) }
  }

  function onSaved(vendor: VendorRecord) {
    known.current.set(vendor.id, { id: vendor.id, name: vendor.name, countryCode: vendor.countryCode, isActive: vendor.isActive })
    setModalOpen(false)
    onChange(vendor.id)
    void load(lastQuery.current)
  }

  const contextCategoryIds = categories?.filter(c => contextSlugs?.includes(c.slug)).map(c => c.id) ?? []

  return (
    <div className="grid gap-1.5" aria-label={label}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <AutocompleteSelect options={options} value={value || null} onChange={id => onChange(id ?? '')} placeholder="Pilih vendor…" loading={loading} onSearch={onSearch} />
        </div>
        {isSuperAdmin && (
          <button type="button" onClick={() => void openModal()} className="admin-btn-ghost flex shrink-0 items-center gap-1 text-xs">
            <Plus className="h-3 w-3" /> Vendor Baru
          </button>
        )}
      </div>
      {failed && <p role="alert" className="m-0 text-[11px] font-medium text-admin-danger">Daftar vendor gagal dimuat.</p>}
      {!failed && !loading && items.length === 0 && !lastQuery.current && (
        <p className="m-0 text-[11px] text-admin-warning">
          {isSuperAdmin ? 'Belum ada vendor untuk kategori ini — tambah lewat "Vendor Baru".' : 'Belum ada vendor untuk kategori ini — minta superadmin menambahkannya di Sistem → Vendor.'}
        </p>
      )}
      {contextSlug && (
        <button type="button" onClick={() => setShowAll(s => !s)} className="w-fit text-[11px] font-medium text-admin-accent hover:text-admin-accent-strong">
          {showAll ? 'Hanya kategori ini' : 'Tampilkan semua kategori'}
        </button>
      )}

      {isSuperAdmin && (
        <Modal open={modalOpen} title="Vendor baru" onClose={() => setModalOpen(false)}>
          {categories === null ? (
            <p className="m-0 text-sm text-admin-muted">Memuat kategori…</p>
          ) : (
            <VendorForm categories={categories} initialCategoryIds={contextCategoryIds} autoFocusName onSaved={onSaved} onCancel={() => setModalOpen(false)} />
          )}
        </Modal>
      )}
    </div>
  )
}
