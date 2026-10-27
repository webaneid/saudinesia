'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileText, Info, KeyRound, Loader2, Save, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Tabs, tabId, tabPanelId, type TabItem } from '@/components/admin/ui/Tabs'
import { formatRupiah } from '@/lib/utils'
import type { VisaRequirement } from '@/lib/types/visa'
import { CostTiersTab } from './CostTiersTab'
import { ProductInfoTab } from './ProductInfoTab'
import { RequirementsTab } from './RequirementsTab'
import type { DeleteResult, InfoForm, ProductDetail } from './types'

type TabKey = 'info' | 'docs' | 'price'
type Props = { params: Promise<{ locale: string; id: string }> }

const snapshotOf = (form: InfoForm, reqs: VisaRequirement[]) => JSON.stringify({ form, reqs })
const cleanReqs = (reqs: VisaRequirement[]) => reqs.filter(r => r.docType.trim() && r.label.trim())

export default function VisaEditPage({ params }: Props) {
  const { locale, id } = use(params)
  const router = useRouter()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [form, setForm] = useState<InfoForm | null>(null)
  const [reqs, setReqs] = useState<VisaRequirement[]>([])
  const [snapshot, setSnapshot] = useState('')
  const [tab, setTab] = useState<TabKey>('info')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const refreshProduct = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/products/visa/${id}`)
    const j = await r.json()
    if (j.data) setProduct(j.data)
    return j.data as ProductDetail | undefined
  }, [id])

  useEffect(() => {
    refreshProduct().then(v => {
      if (!v) { setNotFound(true); return }
      const nextForm: InfoForm = {
        name: v.name, country: v.country, visaType: v.visaType, description: v.description ?? '',
        processDays: String(v.processDays), isActive: v.isActive,
      }
      const nextReqs = Array.isArray(v.documentRequirements)
        ? v.documentRequirements.map(r => ({ docType: r.docType, label: r.label, description: r.description, required: r.required }))
        : []
      setForm(nextForm)
      setReqs(nextReqs)
      setSnapshot(snapshotOf(nextForm, nextReqs))
    })
  }, [refreshProduct])

  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [justSaved])

  if (notFound) return <p className="p-6 text-sm text-admin-muted">Produk visa tidak ditemukan.</p>
  if (!product || !form) {
    return <div className="flex items-center gap-2 p-6 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat…</div>
  }

  const dirty = snapshotOf(form, reqs) !== snapshot
  const canSave = !!form.name.trim() && !!form.visaType.trim() && Number(form.processDays) > 0
  const requiredCount = reqs.filter(r => r.required).length
  const price = Number(product.price)
  const ruleCount = Array.isArray(product.durationFeeRules) ? product.durationFeeRules.length : 0

  const patchForm = (patch: Partial<InfoForm>) => { setForm(f => (f ? { ...f, ...patch } : f)); setJustSaved(false) }
  const setRequirements = (next: VisaRequirement[]) => { setReqs(next); setJustSaved(false) }

  function discard() {
    const saved = JSON.parse(snapshot) as { form: InfoForm; reqs: VisaRequirement[] }
    setForm(saved.form)
    setReqs(saved.reqs)
    setError(null)
  }

  async function save() {
    if (!form) return
    setSaving(true)
    setError(null)
    const requirements = cleanReqs(reqs)
    const res = await fetch(`/api/v1/admin/products/visa/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(), country: form.country.trim(), visaType: form.visaType.trim(),
        description: form.description, processDays: Number(form.processDays), isActive: form.isActive, requirements,
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null)
      setError(j?.error ?? 'Perubahan gagal disimpan. Coba lagi.')
      setSaving(false)
      return
    }
    setReqs(requirements)
    setSnapshot(snapshotOf(form, requirements))
    await refreshProduct()
    setSaving(false)
    setJustSaved(true)
  }

  // Hapus-aman (lib/admin/productDelete.ts): terhapus → kembali ke daftar; dirujuk pesanan/pengajuan/paket → dinonaktifkan dan pesannya ditampilkan.
  async function remove(): Promise<DeleteResult> {
    try {
      const res = await fetch(`/api/v1/admin/products/visa/${id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) return { error: j?.error ?? 'Produk gagal dihapus.' }
      if (j.data.deleted) { router.push(`/${locale}/admin/products/visa`); return null }
      // Status di formulir DAN baseline ikut nonaktif, ketikan lain yang belum disimpan tetap terhitung "belum disimpan".
      setForm(f => (f ? { ...f, isActive: false } : f))
      setSnapshot(prev => { const saved = JSON.parse(prev) as { form: InfoForm; reqs: VisaRequirement[] }; return snapshotOf({ ...saved.form, isActive: false }, saved.reqs) })
      await refreshProduct()
      return { notice: j.data.message ?? 'Dipakai sehingga dinonaktifkan.' }
    } catch {
      return { error: 'Tidak dapat menghubungi server.' }
    }
  }

  const tabs: readonly TabItem<TabKey>[] = [
    { id: 'info', label: 'Informasi', icon: Info },
    { id: 'docs', label: 'Persyaratan dokumen', icon: FileText, count: reqs.length },
    { id: 'price', label: 'Harga dan HPP', icon: Wallet, count: ruleCount || undefined },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24">
      <PageHeader
        icon={KeyRound}
        title={form.name || 'Produk visa'}
        description={[form.visaType, form.country].filter(Boolean).join(' · ')}
        actions={<Badge tone={form.isActive ? 'ok' : 'neutral'}>{form.isActive ? 'Aktif' : 'Nonaktif'}</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Harga saat ini" value={formatRupiah(price)} hint="per orang" />
        <Stat label="Estimasi proses" value={`${form.processDays || '—'} hari`} hint="hari kerja" />
        <Stat label="Dokumen" value={`${requiredCount} wajib`} hint={`dari ${reqs.length} dokumen`} />
        <Stat label="Rentang harga" value={ruleCount ? `${ruleCount} rentang` : 'Belum diatur'} hint="berdasarkan durasi" warn={!ruleCount} />
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} label="Bagian produk visa" />

      {/* Semua panel tetap ter-mount (hanya disembunyikan) supaya isian yang belum disimpan dan riwayat undo editor tidak hilang saat pindah tab. */}
      <div id={tabPanelId('info')} role="tabpanel" aria-labelledby={tabId('info')} hidden={tab !== 'info'}>
        <ProductInfoTab productId={product.id} form={form} onChange={patchForm} price={price} locale={locale} productName={product.name} onShowPrice={() => setTab('price')} onDelete={remove} />
      </div>
      <div id={tabPanelId('docs')} role="tabpanel" aria-labelledby={tabId('docs')} hidden={tab !== 'docs'}>
        <RequirementsTab reqs={reqs} onChange={setRequirements} />
      </div>
      <div id={tabPanelId('price')} role="tabpanel" aria-labelledby={tabId('price')} hidden={tab !== 'price'}>
        <CostTiersTab productId={id} onSaved={refreshProduct} />
      </div>

      {(dirty || justSaved || error) && (
        <div className="sticky bottom-4 z-30">
          <div className="kartu flex flex-wrap items-center justify-between gap-3 border-admin-line-strong px-4 py-3 shadow-lg">
            <div className="min-w-0 text-sm">
              {error ? (
                <span className="font-medium text-admin-danger">{error}</span>
              ) : dirty ? (
                <span className="font-semibold text-admin-ink">
                  Ada perubahan yang belum disimpan
                  {!canSave && <span className="ml-2 font-normal text-admin-warning">Nama, jenis visa, dan estimasi proses wajib diisi.</span>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-admin-ok"><Check className="size-4" /> Perubahan tersimpan</span>
              )}
            </div>
            <div className="flex gap-2">
              {dirty && <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>Batalkan</Button>}
              {dirty && (
                <Button size="sm" onClick={save} loading={saving} disabled={!canSave}>
                  <Save className="size-4" /> Simpan perubahan
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="ubin space-y-0.5">
      <p className="label-kecil m-0">{label}</p>
      <p className={`m-0 text-lg font-extrabold tracking-tight ${warn ? 'text-admin-warning' : 'text-admin-ink'}`}>{value}</p>
      <p className="m-0 text-[11px] text-admin-muted">{hint}</p>
    </div>
  )
}
