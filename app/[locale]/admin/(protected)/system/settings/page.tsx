'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Send } from 'lucide-react'
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
  emailNotificationsEnabled: boolean
}
const EMPTY_SITE_FORM = { platformName: '', metaTitle: '', metaDescription: '', contactEmail: '', contactPhone: '' }

type IntegrationStatus = {
  appUrl: { set: boolean; value: string | null }
  email: { configured: boolean; hasApiKey: boolean; from: string | null; hasReplyTo: boolean }
  whatsapp: {
    configured: boolean; hasToken: boolean; webhookSecretSet: boolean; businessNumberSet: boolean; webhookUrl: string | null
    gateway: { reachable: boolean; connected: boolean | null }
  }
  google: { configured: boolean; redirectUri: string | null }
}
type TestEmailResult = { status: 'sent' | 'failed' | 'skipped'; detail: string | null; to: string }

export default function SettingsPage() {
  const [rule, setRule] = useState<PricingRule | null>(null)
  const [ruleForm, setRuleForm] = useState({ minMarginPercent: 20, roundingIncrement: 50000 })
  const [savingRule, setSavingRule] = useState(false)

  const [siteForm, setSiteForm] = useState(EMPTY_SITE_FORM)
  const [savingSite, setSavingSite] = useState(false)
  const [siteSavedAt, setSiteSavedAt] = useState<number | null>(null)

  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [savingEmailToggle, setSavingEmailToggle] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestEmailResult | { status: 'error'; detail: string } | null>(null)

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
      setEmailEnabled(s.emailNotificationsEnabled)
    }
  }
  async function loadIntegrations() {
    const r = await fetch('/api/v1/admin/system/integrations')
    const j = await r.json()
    setIntegrations(j.data ?? null)
  }
  useEffect(() => { loadRule(); loadVendors(); loadSiteSetting(); loadIntegrations() }, [])

  async function handleToggleEmail(next: boolean) {
    setSavingEmailToggle(true)
    setEmailEnabled(next)
    const r = await fetch('/api/v1/admin/system/settings/site', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailNotificationsEnabled: next }),
    })
    if (!r.ok) setEmailEnabled(!next)
    setSavingEmailToggle(false)
  }

  async function handleTestEmail() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch('/api/v1/admin/system/integrations/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testTo.trim() ? { to: testTo.trim() } : {}),
      })
      const j = await r.json()
      setTestResult(r.ok && j.data ? j.data : { status: 'error', detail: j.error ?? 'Gagal mengirim email uji' })
    } catch {
      setTestResult({ status: 'error', detail: 'Tidak dapat menghubungi server' })
    }
    setTesting(false)
  }

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
        <h2 className="text-sm font-semibold text-admin-ink">Integrasi &amp; Notifikasi</h2>
        <p className="text-xs text-admin-muted">
          Status konfigurasi layanan pihak ketiga. Kunci/rahasia hanya diatur lewat environment server dan tidak pernah ditampilkan di sini.
        </p>
        <div className="admin-form-panel space-y-4">
          {!integrations ? (
            <p className="text-xs text-admin-muted">Memuat status...</p>
          ) : (
            <>
              <ul className="divide-y divide-admin-line text-[13px]">
                <li className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-admin-ink">Email (Resend)</p>
                    <p className="text-[11px] text-admin-muted">
                      {integrations.email.configured
                        ? `Pengirim: ${integrations.email.from}`
                        : `Belum lengkap — ${!integrations.email.hasApiKey ? 'RESEND_API_KEY' : 'RESEND_FROM'} belum diisi. Email dicatat sebagai "dilewati", bukan "terkirim".`}
                    </p>
                  </div>
                  <Badge tone={integrations.email.configured ? 'ok' : 'warning'}>{integrations.email.configured ? 'Terkonfigurasi' : 'Belum diatur'}</Badge>
                </li>
                <li className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-admin-ink">WhatsApp (GOWA)</p>
                    <p className="text-[11px] text-admin-muted">
                      {!integrations.whatsapp.configured
                        ? 'WA_GATEWAY_URL belum diisi — pesan WhatsApp dicatat sebagai "dilewati"; notifikasi tetap lewat email.'
                        : !integrations.whatsapp.gateway.reachable
                          ? 'Gateway tidak dapat dijangkau — WhatsApp gagal terkirim; notifikasi tetap lewat email.'
                          : integrations.whatsapp.gateway.connected === false
                            ? 'Gateway aktif tetapi perangkat WhatsApp belum login/terhubung — notifikasi tetap lewat email.'
                            : integrations.whatsapp.gateway.connected === true
                              ? 'Gateway aktif dan perangkat WhatsApp terhubung.'
                              : 'Gateway dapat dijangkau (status perangkat tidak diketahui).'}
                    </p>
                    <p className="text-[11px] text-admin-muted">
                      Verifikasi nomor (pesan masuk): secret webhook {integrations.whatsapp.webhookSecretSet ? 'terisi (kuat)' : 'BELUM diisi / terlalu lemah (WHATSAPP_WEBHOOK_SECRET ≥32 karakter acak — webhook mati)'}, nomor bisnis {integrations.whatsapp.businessNumberSet ? 'terisi' : 'BELUM diisi (NEXT_PUBLIC_BUSINESS_WA)'}.
                      {integrations.whatsapp.webhookUrl && <> Pasang di GOWA: <code className="text-admin-ink">WHATSAPP_WEBHOOK={integrations.whatsapp.webhookUrl}</code></>}
                    </p>
                  </div>
                  <Badge tone={integrations.whatsapp.configured && integrations.whatsapp.gateway.reachable && integrations.whatsapp.gateway.connected !== false ? 'ok' : 'warning'}>
                    {!integrations.whatsapp.configured ? 'Belum diatur' : !integrations.whatsapp.gateway.reachable ? 'Tidak terjangkau' : integrations.whatsapp.gateway.connected === false ? 'Terputus' : 'Aktif'}
                  </Badge>
                </li>
                <li className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-admin-ink">Masuk dengan Google</p>
                    <p className="text-[11px] text-admin-muted">
                      {integrations.google.configured ? 'Tombol Google tampil di halaman masuk/daftar.' : 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diisi — tombol Google disembunyikan.'}
                      {integrations.google.redirectUri && <> Redirect URI: <code className="text-admin-ink">{integrations.google.redirectUri}</code></>}
                    </p>
                  </div>
                  <Badge tone={integrations.google.configured ? 'ok' : 'neutral'}>{integrations.google.configured ? 'Terkonfigurasi' : 'Nonaktif'}</Badge>
                </li>
                <li className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-admin-ink">APP_URL (tautan di email)</p>
                    <p className="text-[11px] text-admin-muted">{integrations.appUrl.set ? integrations.appUrl.value : 'Belum diisi — email dikirim tanpa tombol/tautan.'}</p>
                  </div>
                  <Badge tone={integrations.appUrl.set ? 'ok' : 'warning'}>{integrations.appUrl.set ? 'Terisi' : 'Kosong'}</Badge>
                </li>
              </ul>

              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5" checked={emailEnabled} disabled={savingEmailToggle} onChange={e => handleToggleEmail(e.target.checked)} />
                <span>
                  <span className="font-medium text-admin-ink">Kirim notifikasi email ke jamaah</span>
                  <span className="block text-[11px] text-admin-muted">Saklar darurat. Bila dimatikan, email dicatat &quot;dilewati&quot;; WhatsApp tidak terpengaruh.</span>
                </span>
              </label>

              <div className="space-y-2 border-t border-admin-line pt-3">
                <p className="text-xs font-semibold text-admin-ink">Kirim email uji</p>
                <div className="flex flex-col gap-2 md:flex-row">
                  <input className="admin-inp md:max-w-sm" type="email" placeholder="Kosongkan = kirim ke email akun Anda" value={testTo} onChange={e => setTestTo(e.target.value)} />
                  <button onClick={handleTestEmail} disabled={testing} className="admin-btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                    <Send className="h-3.5 w-3.5" /> {testing ? 'Mengirim...' : 'Kirim uji'}
                  </button>
                </div>
                {testResult && (
                  <p className="text-[12px]" role="status">
                    {testResult.status === 'sent' && <Badge tone="ok">Diterima Resend</Badge>}
                    {testResult.status === 'skipped' && <Badge tone="warning">Dilewati</Badge>}
                    {(testResult.status === 'failed' || testResult.status === 'error') && <Badge tone="danger">Gagal</Badge>}
                    {' '}
                    <span className="text-admin-muted">
                      {testResult.status === 'sent' ? `Diterima Resend untuk ${(testResult as TestEmailResult).to}. Cek kotak masuk (dan spam) — diterima Resend belum menjamin masuk inbox.` : testResult.detail}
                    </span>
                  </p>
                )}
              </div>
            </>
          )}
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
