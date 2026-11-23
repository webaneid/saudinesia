'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { FormField } from '@/components/admin/ui/FormField'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import type { VendorContext } from '@/lib/constants/vendor'
import { CurrencySelect } from '@/components/shared/CurrencySelect'
import { cn, formatRupiah } from '@/lib/utils'
import { SellPriceWarnings } from './SellPriceWarnings'

// Isian modal → harga jual — SATU bentuk untuk setiap editor biaya (docs/arsitektur-komponen-biaya.md §10): popup Komponen Biaya (Haji/Paket/
// Ziarah), Pesawat, Muthowif, Transport, Hotel. Urutan pemilik: Vendor → Biaya (mata uang) → HPP Rupiah (otomatis) → Harga Jual Rekomendasi
// (terisi rekomendasi, bisa diubah = harga manual) → Untung (baca-saja). Peringatan lewat SellPriceWarnings (sama dengan PriceCard).
// Komponen ini hanya tampilan terkendali; HPP/rekomendasi selalu dari server (`useCostPreview` → route simulate milik modul).

export type CostPreview = { hppRupiah: number; sellPrice: number }
export type CostValue = { vendorId: string; currency: string; cost: string; sell: string; sellEdited: boolean; note: string }

export const emptyCost = (currency = 'IDR'): CostValue => ({ vendorId: '', currency, cost: '', sell: '', sellEdited: false, note: '' })

/** Harga jual manual yang akan disimpan, atau null bila ikut rekomendasi (kosong / sama dengan rekomendasi / belum diubah). */
export function manualSellOf(v: CostValue, preview: CostPreview | null): number | null {
  const n = Number(v.sell)
  return v.sellEdited && v.sell.trim() !== '' && n > 0 && n !== preview?.sellPrice ? n : null
}

/** Pratinjau HPP → rekomendasi dari angka yang sedang diketik (debounce 500 ms). `url` null = tidak ada pratinjau. */
export function useCostPreview(url: string | null): CostPreview | null {
  const [preview, setPreview] = useState<CostPreview | null>(null)
  useEffect(() => {
    if (!url) { setPreview(null); return }
    let alive = true
    const timer = setTimeout(async () => {
      const r = await fetch(url).catch(() => null)
      const j = await r?.json().catch(() => null)
      if (alive) setPreview(j?.data ? { hppRupiah: Number(j.data.hppRupiah), sellPrice: Number(j.data.sellPrice) } : null)
    }, 500)
    return () => { alive = false; clearTimeout(timer) }
  }, [url])
  return preview
}

/**
 * Simpan harga jual manual titik harga pemilik (route yang sama dengan PriceCard): manual → PUT, sebelumnya manual tapi kini ikut rekomendasi →
 * DELETE, selain itu tak ada panggilan. Mengembalikan pesan galat atau null.
 */
export async function syncManualSell(o: { ownerType: string; ownerId: string; variantKey?: string; manual: number | null; wasManual: boolean; note: string }): Promise<string | null> {
  if (o.manual == null && !o.wasManual) return null
  const r = await fetch('/api/v1/admin/pricing/points', {
    method: o.manual != null ? 'PUT' : 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType: o.ownerType, ownerId: o.ownerId, variantKey: o.variantKey ?? '', ...(o.manual != null ? { sellIdr: o.manual, note: o.note.trim() || null } : {}) }),
  }).catch(() => null)
  if (r?.ok) return null
  const j: { error?: string } | null = await r?.json().catch(() => null) ?? null
  return j?.error ?? 'Harga jual gagal disimpan.'
}

/** Status harga jual tersimpan satu pemilik (untuk mengisi kotak harga jual dan margin bawaan) — dari route titik harga yang sama dengan PriceCard. */
export async function loadSellState(ownerType: string, ownerId: string): Promise<{ manualSell: number | null; manualNote: string; marginPercent: number } | null> {
  const r = await fetch(`/api/v1/admin/pricing/points?${new URLSearchParams({ ownerType, ownerId })}`).catch(() => null)
  if (!r?.ok) return null
  const j = await r.json().catch(() => null)
  const point = (j?.data?.points as Array<{ variantKey: string; mode: string; sellIdr: number; manualNote: string | null }> | undefined)?.find(p => p.variantKey === '')
  const manual = point?.mode === 'manual'
  return { manualSell: manual ? point.sellIdr : null, manualNote: manual ? point.manualNote ?? '' : '', marginPercent: Number(j?.data?.rule?.marginPercent ?? 0) }
}

const rp = (n: number) => formatRupiah(Math.round(n))

function ReadOnly({ children }: { children: ReactNode }) {
  return <div className="admin-input flex items-center bg-admin-spot/50 font-semibold text-admin-ink">{children}</div>
}

/** Untung = jual − HPP; persen dari modal (sama dengan PriceCard/ProfitCell). `stacked` = rupiah di atas persen (sel tabel sempit). */
export function ProfitText({ sell, cost, strong, stacked }: { sell: number | null; cost: number | null; strong?: boolean; stacked?: boolean }) {
  if (sell == null || cost == null) return <span className="text-xs text-admin-muted">—</span>
  const profit = sell - cost
  const tone = profit < 0 ? 'text-admin-danger' : 'text-admin-ok'
  if (stacked) {
    return (
      <div className="text-right">
        <p className={cn('m-0 whitespace-nowrap text-xs font-semibold tabular-nums', tone)}>{rp(profit)}</p>
        {cost > 0 && <p className={cn('m-0 text-[11px] tabular-nums opacity-80', tone)}>{((profit / cost) * 100).toFixed(1)}%</p>}
      </div>
    )
  }
  return (
    <span className={cn('whitespace-nowrap tabular-nums', strong ? 'font-bold' : 'text-xs font-semibold', tone)}>
      {rp(profit)}
      {cost > 0 && <span className="ml-1 font-medium opacity-80">({((profit / cost) * 100).toFixed(1)}%)</span>}
    </span>
  )
}

type Props = {
  value: CostValue
  onChange: (v: CostValue) => void
  preview: CostPreview | null
  marginPercent: number
  currencies: readonly string[]
  /** Pemilih vendor (konteks VendorPicker). Abaikan bila `vendorSlot` diisi. */
  vendorContext?: VendorContext
  /** Judul kolom vendor, mis. "Maskapai". */
  vendorLabel?: string
  /** Pengganti pemilih vendor (mis. Muthowif: vendor tetap Saudinesia, hanya ditampilkan). */
  vendorSlot?: ReactNode
  /** Judul kolom biaya, mis. "Harga Tiket". */
  costLabel?: string
  /** Satuan yang ditambahkan ke petunjuk untung, mis. "per kursi". */
  unitHint?: string
  idPrefix?: string
  /** Isian tambahan sebelum vendor (mis. Nama komponen, tipe kamar + kuota). */
  before?: ReactNode
  /** Mata uang mengikuti induk (mis. satu mata uang per periode hotel) — ditampilkan, tidak dipilih di sini. */
  currencyLocked?: boolean
  /** Isian biaya tambahan sesudah biaya utama, ikut masuk HPP (mis. BRN Visa). */
  afterCost?: ReactNode
  /** Petunjuk HPP pengganti (mis. "Visa + BRN × kurs"). */
  hppHint?: string
}

export function CostFields({ value: v, onChange, preview, marginPercent, currencies, vendorContext = 'costComponent', vendorLabel = 'Vendor', vendorSlot, costLabel = 'Biaya', unitHint = 'per satuan', idPrefix = 'cost', before, currencyLocked = false, afterCost, hppHint }: Props) {
  const set = (p: Partial<CostValue>) => onChange({ ...v, ...p })
  const manual = manualSellOf(v, preview)
  const shownSell = v.sellEdited ? Number(v.sell) || 0 : preview?.sellPrice ?? null
  const id = (s: string) => `${idPrefix}-${s}`

  return (
    <div className="space-y-4">
      {before}
      <FormField label={vendorLabel} htmlFor={id('vendor')} required={!vendorSlot}>
        {vendorSlot ?? <VendorPicker value={v.vendorId} onChange={vendorId => set({ vendorId })} context={vendorContext} label={vendorLabel} />}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={`${costLabel} (${v.currency})`} htmlFor={id('amount')} required hint="Harga dari vendor dalam mata uangnya.">
          <div className="flex gap-2">
            {currencyLocked
              ? <span className="admin-input flex w-auto shrink-0 items-center bg-admin-spot/50 font-semibold text-admin-ink/80">{v.currency}</span>
              : <CurrencySelect value={v.currency} onChange={currency => set({ currency })} currencies={currencies} />}
            <input id={id('amount')} className="admin-input min-w-0 flex-1 tabular-nums" type="number" min={0} step="any" placeholder="0" value={v.cost} onChange={e => set({ cost: e.target.value })} />
          </div>
        </FormField>
        {afterCost}
        <FormField label="HPP (Rupiah)" htmlFor={id('hpp')} hint={hppHint ?? (v.currency === 'IDR' ? 'Sama dengan biaya.' : 'Biaya × kurs terbaru.')}>
          <ReadOnly>{preview ? rp(preview.hppRupiah) : '—'}</ReadOnly>
        </FormField>
        <FormField label="Harga Jual Rekomendasi" htmlFor={id('sell')} hint={`HPP + margin bawaan ${marginPercent}%.`}>
          <input id={id('sell')} className="admin-input font-semibold tabular-nums text-admin-ink" type="number" min={0}
            placeholder={preview ? String(preview.sellPrice) : 'Isi biaya dulu'}
            value={v.sellEdited ? v.sell : preview ? String(preview.sellPrice) : ''}
            onChange={e => set({ sell: e.target.value, sellEdited: true })} />
        </FormField>
        <FormField label="Untung" htmlFor={id('profit')} hint={`Potensi untung ${unitHint} = harga jual − HPP.`}>
          <ReadOnly><ProfitText sell={preview ? shownSell : null} cost={preview?.hppRupiah ?? null} strong /></ReadOnly>
        </FormField>
      </div>

      {manual != null && preview && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-admin-muted">
          Harga manual · rekomendasi {rp(preview.sellPrice)}
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-admin-accent underline" onClick={() => set({ sell: '', sellEdited: false, note: '' })}>
            <RotateCcw className="size-3" /> Kembalikan ke rekomendasi
          </button>
        </p>
      )}
      {manual != null && <SellPriceWarnings sell={manual} cost={preview?.hppRupiah ?? null} recommended={preview?.sellPrice ?? null} marginPercent={marginPercent} />}
      {manual != null && (
        <FormField label="Catatan harga jual" htmlFor={id('note')} hint="Opsional, mis. nego vendor, promo musim. Internal.">
          <input id={id('note')} className="admin-input" maxLength={500} value={v.note} onChange={e => set({ note: e.target.value })} />
        </FormField>
      )}
    </div>
  )
}
