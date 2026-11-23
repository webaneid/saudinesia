'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Save, Wallet } from 'lucide-react'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import type { VendorContext } from '@/lib/constants/vendor'
import { CostFields, emptyCost, loadSellState, manualSellOf, syncManualSell, useCostPreview, type CostValue } from './CostFields'

// Formulir modal → harga jual untuk produk ber-SATU biaya (Pesawat per jadwal, Muthowif layanan) — isian sama dengan popup Komponen Biaya
// (`CostFields`, docs/arsitektur-komponen-biaya.md §10). Biaya disimpan lewat route biaya milik modul; harga jual manual lewat route titik harga
// yang sama dengan PriceCard (`syncManualSell`). HPP/rekomendasi selalu dari route simulate modul.

type Vendor = { context: VendorContext; label: string } | { fixed: true; note: string }

type Props = {
  title: string
  hint: ReactNode
  /** Titik harga pemilik (ownerType/ownerId PriceCard). ownerId null = belum ada (harga manual baru bisa diatur sesudah biaya tersimpan). */
  ownerType: string
  ownerId: string | null
  /** Route biaya modul: GET → `{ vendorId?, vendorName?, currency, [costKey] }`, PUT ← `{ vendorId?, currency, [costKey] }`. */
  costUrl: string
  /** Route simulate modul (query `[costKey]` + `currency`). */
  simulateUrl: string
  /** Nama kolom biaya di route modul, mis. `hargaTiket`. */
  costKey: string
  costLabel: string
  currencies: readonly string[]
  defaultCurrency: string
  vendor: Vendor
  unitHint: string
  /** Naikkan untuk memuat ulang (mis. harga diubah di PriceCard). */
  reloadKey?: number
  onSaved?: () => void | Promise<void>
}

export function SingleCostForm({ title, hint, ownerType, ownerId, costUrl, simulateUrl, costKey, costLabel, currencies, defaultCurrency, vendor, unitHint, reloadKey = 0, onSaved }: Props) {
  const [form, setForm] = useState<CostValue>(emptyCost(defaultCurrency))
  const [vendorName, setVendorName] = useState('')
  const [wasManual, setWasManual] = useState(false)
  const [marginPercent, setMarginPercent] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(costUrl).catch(() => null)
    const j = await r?.json().catch(() => null)
    const d = j?.data as Record<string, unknown> | null | undefined
    const sell = ownerId ? await loadSellState(ownerType, ownerId) : null
    const cost = Number(d?.[costKey] ?? 0)
    setVendorName(String(d?.vendorName ?? ''))
    setForm({
      vendorId: String(d?.vendorId ?? ''), currency: String(d?.currency ?? defaultCurrency), cost: cost > 0 ? String(cost) : '',
      sell: sell?.manualSell != null ? String(sell.manualSell) : '', sellEdited: sell?.manualSell != null, note: sell?.manualNote ?? '',
    })
    setWasManual(sell?.manualSell != null)
    if (sell) setMarginPercent(sell.marginPercent)
    setLoaded(true)
  }, [costUrl, costKey, defaultCurrency, ownerType, ownerId])

  useEffect(() => { void load() }, [load, reloadKey])

  const costNum = Number(form.cost)
  const preview = useCostPreview(loaded && costNum > 0 ? `${simulateUrl}?${new URLSearchParams({ [costKey]: String(costNum), currency: form.currency })}` : null)
  const needsVendor = !('fixed' in vendor)
  const canSave = loaded && costNum > 0 && (!needsVendor || !!form.vendorId)

  async function save() {
    setSaving(true); setError(null)
    const r = await fetch(costUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(needsVendor ? { vendorId: form.vendorId } : {}), currency: form.currency, [costKey]: costNum }),
    }).catch(() => null)
    if (!r?.ok) {
      const j: { error?: string } | null = await r?.json().catch(() => null) ?? null
      setError(j?.error ?? 'Biaya gagal disimpan.'); setSaving(false); return
    }
    const failed = ownerId ? await syncManualSell({ ownerType, ownerId, manual: manualSellOf(form, preview), wasManual, note: form.note }) : null
    await onSaved?.()
    await load()
    setSaving(false)
    if (failed) { setError(`Biaya tersimpan, tetapi harga jual gagal disimpan: ${failed}`); return }
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Wallet className="size-4 text-admin-accent" /> {title}</h2>
        <p className="m-0 mt-1 text-xs text-admin-muted">{hint}</p>
      </div>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
        <CostFields
          value={form} onChange={v => { setError(null); setForm(v) }} preview={preview} marginPercent={marginPercent} currencies={currencies}
          costLabel={costLabel} unitHint={unitHint} idPrefix={ownerType}
          {...(needsVendor
            ? { vendorContext: vendor.context, vendorLabel: vendor.label }
            : { vendorLabel: 'Vendor', vendorSlot: <div><div className="admin-input flex items-center bg-admin-spot/50 text-admin-ink/80">{vendorName || 'Saudinesia'}</div><p className="m-0 mt-1 text-xs text-admin-muted">{vendor.note}</p></div> })}
        />
        {!ownerId && <p className="m-0 text-xs text-admin-muted">Harga jual manual bisa diatur sesudah biaya pertama tersimpan.</p>}
        {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
        <div className="flex justify-end border-t border-admin-line pt-4">
          <Button type="submit" size="sm" loading={saving} disabled={!canSave}><Save className="size-3.5" /> {saved ? 'Tersimpan' : 'Simpan harga'}</Button>
        </div>
      </form>
    </Card>
  )
}
