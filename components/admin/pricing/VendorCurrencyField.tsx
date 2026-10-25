'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { vendorQuickAddError } from '@/lib/admin/vendorQuickAdd'

export type VendorOption = { id: string; name: string }

type Props = {
  vendors: VendorOption[]
  vendorId: string
  currency: string
  currencies: readonly string[]
  /** Kategori vendor yang dibuat lewat "Vendor Baru" (mis. 'package', 'haji'). */
  category: string
  onVendorChange: (vendorId: string) => void
  onCurrencyChange: (currency: string) => void
  /** Dipanggil setelah vendor baru berhasil dibuat; induk menambahkannya ke daftar dan memilihnya. */
  onVendorCreated: (vendor: VendorOption) => void
}

/**
 * Kotak "Vendor & Mata Uang" editor HPP: pilih vendor (atau tambah cepat) + mata uang. Satu idiom visual untuk semua editor Komponen Biaya
 * (docs/arsitektur-komponen-biaya.md §3.2). Tambah vendor hanya berhasil bagi superadmin — penolakan ditampilkan sebagai pesan (SEC-61b).
 */
export function VendorCurrencyField({ vendors, vendorId, currency, currencies, category, onVendorChange, onCurrencyChange, onVendorCreated }: Props) {
  const [quickAdd, setQuickAdd] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createVendor() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const r = await fetch('/api/v1/admin/system/settings/vendors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), category }),
    })
    const j = await r.json().catch(() => null)
    setSaving(false)
    if (!j?.data?.id) { setError(vendorQuickAddError(r.status, j?.error)); return }
    onVendorCreated({ id: j.data.id, name: j.data.name })
    setName(''); setQuickAdd(false)
  }

  return (
    <div className="border border-admin-line rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-admin-ink">Vendor &amp; Mata Uang</p>
      {vendors.length === 0 && !quickAdd && (
        <p className="text-[11px] text-admin-warning">Belum ada vendor — tambah dulu.</p>
      )}
      {error && <p role="alert" className="text-[11px] font-medium text-admin-danger">{error}</p>}
      <div className="flex items-center gap-2">
        {!quickAdd ? (
          <>
            <select className="admin-inp flex-1" value={vendorId} onChange={e => onVendorChange(e.target.value)}>
              <option value="">Pilih vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" onClick={() => setQuickAdd(true)}
              className="admin-btn-ghost text-xs shrink-0 flex items-center gap-1">
              <Plus className="h-3 w-3" /> Vendor Baru
            </button>
          </>
        ) : (
          <>
            <input autoFocus className="admin-inp flex-1" placeholder="Nama vendor"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createVendor() } }} />
            <button type="button" onClick={createVendor} disabled={saving || !name.trim()}
              className="admin-btn-sm text-xs shrink-0 disabled:opacity-50">{saving ? '...' : 'Simpan'}</button>
            <button type="button" onClick={() => { setQuickAdd(false); setName('') }}
              className="admin-btn-ghost text-xs shrink-0">Batal</button>
          </>
        )}
        <select className="admin-inp w-20 shrink-0" value={currency} onChange={e => onCurrencyChange(e.target.value)}>
          {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  )
}
