'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

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

type SiteSetting = {
  id: string
  platformName: string | null
  metaTitle: string | null
  metaDescription: string | null
  contactEmail: string | null
  contactPhone: string | null
}
const EMPTY_SITE_FORM = { platformName: '', metaTitle: '', metaDescription: '', contactEmail: '', contactPhone: '' }

export default function SettingsPage() {
  const [rule, setRule] = useState<PricingRule | null>(null)
  const [ruleForm, setRuleForm] = useState({ minMarginPercent: 20, roundingIncrement: 50000 })
  const [savingRule, setSavingRule] = useState(false)

  const [siteForm, setSiteForm] = useState(EMPTY_SITE_FORM)
  const [savingSite, setSavingSite] = useState(false)
  const [siteSavedAt, setSiteSavedAt] = useState<number | null>(null)

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
  async function loadSiteSetting() {
    const r = await fetch('/api/v1/admin/system/settings/site')
    const j = await r.json()
    const s: SiteSetting | undefined = j.data
    if (s) {
      setSiteForm({
        platformName: s.platformName ?? '',
        metaTitle: s.metaTitle ?? '',
        metaDescription: s.metaDescription ?? '',
        contactEmail: s.contactEmail ?? '',
        contactPhone: s.contactPhone ?? '',
      })
    }
  }
  useEffect(() => { loadRule(); loadVendors(); loadSiteSetting() }, [])

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

  async function handleSaveSite() {
    setSavingSite(true)
    await fetch('/api/v1/admin/system/settings/site', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(siteForm),
    })
    await loadSiteSetting()
    setSavingSite(false)
    setSiteSavedAt(Date.now())
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

  const vendorColumns: Column<Vendor>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: v => <span className="text-[13px] font-medium">{v.name}</span> },
    { key: 'category', header: 'Kategori', cell: v => v.category ? <Badge tone="accent">{v.category}</Badge> : <span className="text-[12px] text-admin-muted/70">—</span> },
    { key: 'country', header: 'Negara', cell: v => <span className="text-[12px] text-admin-muted">{v.country}</span> },
    { key: 'contact', header: 'Kontak', cell: v => <span className="text-[12px] text-admin-muted">{v.contactInfo ?? '—'}</span> },
    {
      key: 'status', header: 'Status', align: 'right',
      cell: v => (
        <button onClick={() => toggleVendorActive(v)} aria-label={v.isActive ? 'Nonaktifkan vendor' : 'Aktifkan vendor'}>
          <Badge tone={v.isActive ? 'ok' : 'danger'}>{v.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
        </button>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: v => (
        <button onClick={() => openVendorForm(v)} className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader title="Pengaturan" />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-admin-ink">Margin &amp; Pembulatan Harga</h2>
        <p className="text-xs text-admin-muted">Berlaku global untuk semua produk, kecuali di-override per tipe produk nanti.</p>
        <div className="admin-form-panel">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-admin-muted mb-1">Margin minimum (%)</p>
              <input
                type="number"
                className="admin-inp"
                value={ruleForm.minMarginPercent}
                onChange={e => setRuleForm(p => ({ ...p, minMarginPercent: +e.target.value }))}
              />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Pembulatan (kelipatan Rp)</p>
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
          {rule && <p className="text-[11px] text-admin-muted/70">Tersimpan: margin {Number(rule.minMarginPercent)}%, bulatkan ke kelipatan Rp{rule.roundingIncrement.toLocaleString('id-ID')}</p>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-admin-ink">Pengaturan Umum Situs</h2>
        <p className="text-xs text-admin-muted">Nama tampilan platform, meta SEO default, dan kontak publik. Tidak termasuk rekening bank (tetap diatur lewat .env).</p>
        <div className="admin-form-panel space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-admin-muted mb-1">Nama Platform</p>
              <input className="admin-inp" placeholder="Saudinesia" value={siteForm.platformName} onChange={e => setSiteForm(p => ({ ...p, platformName: e.target.value }))} />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Email Kontak Publik</p>
              <input className="admin-inp" placeholder="info@saudinesia.com" value={siteForm.contactEmail} onChange={e => setSiteForm(p => ({ ...p, contactEmail: e.target.value }))} />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Telepon Kontak Publik</p>
              <input className="admin-inp" placeholder="+628xxxxxxxxxx" value={siteForm.contactPhone} onChange={e => setSiteForm(p => ({ ...p, contactPhone: e.target.value }))} />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Meta Title Default (SEO)</p>
              <input className="admin-inp" placeholder="Saudinesia — Booking Haji & Umroh" value={siteForm.metaTitle} onChange={e => setSiteForm(p => ({ ...p, metaTitle: e.target.value }))} />
            </div>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Meta Description Default (SEO)</p>
            <textarea className="admin-inp w-full" rows={2} placeholder="Platform booking Haji & Umroh terpercaya..." value={siteForm.metaDescription} onChange={e => setSiteForm(p => ({ ...p, metaDescription: e.target.value }))} />
          </div>
          <button onClick={handleSaveSite} disabled={savingSite} className="admin-btn-sm disabled:opacity-50">
            {savingSite ? '...' : 'Simpan'}
          </button>
          {siteSavedAt && <p className="text-[11px] text-admin-muted/70">Tersimpan.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-admin-ink">Vendor / Syarikah</h2>
          <button onClick={() => (showVendorForm ? setShowVendorForm(false) : openVendorForm())} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>
        </div>
        {showVendorForm && (
          <div className="admin-form-panel space-y-3">
            <p className="text-sm font-semibold text-admin-ink">{editingVendorId ? 'Edit Vendor' : 'Vendor Baru'}</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div><p className="text-xs text-admin-muted mb-1">Nama</p><input className="admin-inp" value={vendorForm.name} onChange={e => setVendorForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Kategori (opsional)</p>
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
              <div><p className="text-xs text-admin-muted mb-1">Negara</p><input className="admin-inp" value={vendorForm.country} onChange={e => setVendorForm(p => ({ ...p, country: e.target.value }))} /></div>
              <div><p className="text-xs text-admin-muted mb-1">Kontak</p><input className="admin-inp" value={vendorForm.contactInfo} onChange={e => setVendorForm(p => ({ ...p, contactInfo: e.target.value }))} /></div>
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Alamat (docs/arsitektur-alamat.md)</p>
              <AddressPicker value={vendorAddress} onChange={setVendorAddress} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveVendor} disabled={savingVendor} className="admin-btn-sm disabled:opacity-50">{savingVendor ? '...' : 'Simpan'}</button>
              <button onClick={() => setShowVendorForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}
        <DataTable columns={vendorColumns} rows={vendors} getRowId={v => v.id} empty="Belum ada vendor." />
      </section>
    </div>
  )
}
