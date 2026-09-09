'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'

type PricingRule = { id: string; minMarginPercent: number; roundingIncrement: number }
type AddressRecord = {
  type: 'domestic' | 'international'; fullAddress: string; postalCode: string | null
  provinceId: string | null; regencyId: string | null; districtId: string | null; villageId: string | null
  countryCode: string | null; city: string | null; stateRegion: string | null
} | null
type Vendor = { id: string; name: string; category: string | null; country: string; contactInfo: string | null; isActive: boolean; address: AddressRecord }

function toAddressValue(a: AddressRecord): AddressValue {
  if (!a) return EMPTY_ADDRESS
  return {
    type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '',
    provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId,
    countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
  }
}

const EMPTY_VENDOR_FORM = { name: '', category: '', country: 'Saudi Arabia', contactInfo: '' }

export default function SettingsPage() {
  const [rule, setRule] = useState<PricingRule | null>(null)
  const [ruleForm, setRuleForm] = useState({ minMarginPercent: 20, roundingIncrement: 50000 })
  const [savingRule, setSavingRule] = useState(false)

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [showVendorForm, setShowVendorForm] = useState(false)
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null)
  const [savingVendor, setSavingVendor] = useState(false)
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR_FORM)
  const [vendorAddress, setVendorAddress] = useState<AddressValue>(EMPTY_ADDRESS)

  async function loadRule() {
    const r = await fetch('/api/v1/admin/system/settings/pricing-rule')
    const j = await r.json()
    if (j.data) { setRule(j.data); setRuleForm({ minMarginPercent: Number(j.data.minMarginPercent), roundingIncrement: j.data.roundingIncrement }) }
  }
  async function loadVendors() {
    const r = await fetch('/api/v1/admin/system/settings/vendors')
    const j = await r.json()
    setVendors(j.data ?? [])
  }
  useEffect(() => { loadRule(); loadVendors() }, [])

  async function handleSaveRule() {
    setSavingRule(true)
    await fetch('/api/v1/admin/system/settings/pricing-rule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ruleForm),
    })
    await loadRule()
    setSavingRule(false)
  }

  function openVendorForm(v?: Vendor) {
    if (v) {
      setEditingVendorId(v.id)
      setVendorForm({ name: v.name, category: v.category ?? '', country: v.country, contactInfo: v.contactInfo ?? '' })
      setVendorAddress(toAddressValue(v.address))
    } else {
      setEditingVendorId(null)
      setVendorForm(EMPTY_VENDOR_FORM)
      setVendorAddress(EMPTY_ADDRESS)
    }
    setShowVendorForm(true)
  }

  async function handleSaveVendor() {
    setSavingVendor(true)
    const body: Record<string, unknown> = { ...vendorForm, category: vendorForm.category.trim() || undefined }
    if (vendorAddress.fullAddress.trim()) body.address = vendorAddress
    if (editingVendorId) {
      await fetch(`/api/v1/admin/system/settings/vendors/${editingVendorId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } else {
      await fetch('/api/v1/admin/system/settings/vendors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    }
    await loadVendors()
    setShowVendorForm(false)
    setSavingVendor(false)
  }

  async function toggleVendorActive(v: Vendor) {
    await fetch(`/api/v1/admin/system/settings/vendors/${v.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !v.isActive }),
    })
    await loadVendors()
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <h1 className="admin-h1">Pengaturan</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Margin &amp; Pembulatan Harga</h2>
        <p className="text-xs text-slate-500">Berlaku global untuk semua produk, kecuali di-override per tipe produk nanti.</p>
        <div className="admin-form-panel">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Margin minimum (%)</p>
              <input
                type="number"
                className="admin-inp"
                value={ruleForm.minMarginPercent}
                onChange={e => setRuleForm(p => ({ ...p, minMarginPercent: +e.target.value }))}
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Pembulatan (kelipatan Rp)</p>
              <input
                type="number"
                className="admin-inp"
                value={ruleForm.roundingIncrement}
                onChange={e => setRuleForm(p => ({ ...p, roundingIncrement: +e.target.value }))}
              />
            </div>
          </div>
          <button onClick={handleSaveRule} disabled={savingRule} className="admin-btn-sm disabled:opacity-50">
            {savingRule ? '...' : 'Simpan'}
          </button>
          {rule && <p className="text-[11px] text-slate-400">Tersimpan: margin {Number(rule.minMarginPercent)}%, bulatkan ke kelipatan Rp{rule.roundingIncrement.toLocaleString('id-ID')}</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Vendor / Syarikah</h2>
          <button onClick={() => (showVendorForm ? setShowVendorForm(false) : openVendorForm())} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>
        </div>
        {showVendorForm && (
          <div className="admin-form-panel space-y-3">
            <p className="text-sm font-semibold text-ink">{editingVendorId ? 'Edit Vendor' : 'Vendor Baru'}</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-500 mb-1">Nama</p><input className="admin-inp" value={vendorForm.name} onChange={e => setVendorForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Kategori (opsional)</p>
                <input
                  className="admin-inp" value={vendorForm.category} list="vendor-category-suggestions"
                  placeholder="syarikah / maskapai / hotel"
                  onChange={e => setVendorForm(p => ({ ...p, category: e.target.value }))}
                />
                <datalist id="vendor-category-suggestions">
                  <option value="syarikah" />
                  <option value="maskapai" />
                  <option value="hotel" />
                </datalist>
              </div>
              <div><p className="text-xs text-slate-500 mb-1">Negara</p><input className="admin-inp" value={vendorForm.country} onChange={e => setVendorForm(p => ({ ...p, country: e.target.value }))} /></div>
              <div><p className="text-xs text-slate-500 mb-1">Kontak</p><input className="admin-inp" value={vendorForm.contactInfo} onChange={e => setVendorForm(p => ({ ...p, contactInfo: e.target.value }))} /></div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Alamat (docs/arsitektur-alamat.md)</p>
              <AddressPicker value={vendorAddress} onChange={setVendorAddress} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveVendor} disabled={savingVendor} className="admin-btn-sm disabled:opacity-50">{savingVendor ? '...' : 'Simpan'}</button>
              <button onClick={() => setShowVendorForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-line bg-canvas/60">
              <tr><th className="admin-th">Nama</th><th className="admin-th">Kategori</th><th className="admin-th">Negara</th><th className="admin-th">Kontak</th><th className="admin-th text-right">Status</th><th className="admin-th"></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vendors.map(v => (
                <tr key={v.id} className="hover:bg-canvas/40 transition-colors">
                  <td className="px-4 py-3 text-ink font-medium text-[13px]">{v.name}</td>
                  <td className="px-4 py-3 text-[12px]">{v.category ? <span className="admin-badge-blue">{v.category}</span> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">{v.country}</td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">{v.contactInfo ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleVendorActive(v)} className={v.isActive ? 'admin-badge-green' : 'admin-badge-red'}>
                      {v.isActive ? 'Aktif' : 'Nonaktif'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openVendorForm(v)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-ink transition-colors">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
