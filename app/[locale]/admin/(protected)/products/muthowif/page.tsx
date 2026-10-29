'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, Save, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { Badge } from '@/components/admin/ui/Badge'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { CurrencySelect } from '@/components/shared/CurrencySelect'

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR']

type Muthowif = { id: string; name: string; rating: number; dailyCapacity: number; isActive: boolean }
type Preview = { hppRupiah: number; sellPrice: number }

export default function MuthowifPage() {
  const { locale } = useParams() as { locale: string }


  // HPP layanan muthowif — satu komponen flat, tidak per-orang, cache di MuthowifServicePrice.price
  // (docs/arsitektur-muthowif.md §10). Tidak ada vendor pihak ketiga sungguhan di sini (beda dari
  // Visa/Flight/Hotel/Transport) — Saudinesia menetapkan sendiri harga pasaran, jadi vendor
  // ("Saudinesia", dibuat otomatis server-side) cuma ditampilkan read-only, tidak dipilih admin.
  const [currentPrice, setCurrentPrice] = useState(0)
  const [vendorName, setVendorName] = useState('Saudinesia')
  const [currency, setCurrency] = useState('IDR')
  const [hargaLayanan, setHargaLayanan] = useState('')
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [priceTick, setPriceTick] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [savingPrice, setSavingPrice] = useState(false)
  const [priceSaved, setPriceSaved] = useState(false)

  async function loadPrice() {
    const sr = await fetch('/api/v1/admin/products/muthowif/service-price')
    const sj = await sr.json()
    if (sj.data) { setCurrentPrice(sj.data.price); setServiceId(sj.data.id ?? null) }
    setPriceTick(t => t + 1)

    const cr = await fetch('/api/v1/admin/products/muthowif/service-price/cost')
    const cj = await cr.json()
    if (cj.data) {
      setVendorName(cj.data.vendorName ?? 'Saudinesia')
      setCurrency(cj.data.currency ?? 'IDR')
      setHargaLayanan(cj.data.hargaLayanan ? String(cj.data.hargaLayanan) : '')
    }
  }
  useEffect(() => { loadPrice() }, [])

  // Live preview harga jual — debounce 500ms, pola sama Flight/Transport cost editor.
  useEffect(() => {
    const cost = Number(hargaLayanan)
    if (!cost || cost <= 0) { setPreview(null); return }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ hargaLayanan: String(cost), currency })
      const r = await fetch(`/api/v1/admin/products/muthowif/service-price/simulate?${params}`)
      const j = await r.json()
      setPreview(j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null)
    }, 500)
    return () => clearTimeout(timer)
  }, [hargaLayanan, currency])

  const canSavePrice = Number(hargaLayanan) > 0

  async function handleSavePrice() {
    setSavingPrice(true)
    await fetch('/api/v1/admin/products/muthowif/service-price/cost', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency, hargaLayanan: Number(hargaLayanan) }),
    })
    await loadPrice()
    setSavingPrice(false); setPriceSaved(true)
    setTimeout(() => setPriceSaved(false), 2000)
  }

  const base = `/${locale}/admin/products/muthowif`
  const columns = (reload: () => void): Column<Muthowif>[] => [
    { key: 'name', header: 'Nama', mobile: 'title', cell: m => <Link href={`${base}/${m.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{m.name}</Link> },
    { key: 'rating', header: 'Rating', cell: m => <span className="text-[12px] text-admin-gold-strong">★ {m.rating}</span> },
    { key: 'capacity', header: 'Kap/hari', align: 'right', cell: m => <span className="text-[12px] text-admin-muted">{m.dailyCapacity}</span> },
    { key: 'status', header: 'Status', cell: m => <Badge tone={m.isActive ? 'ok' : 'neutral'}>{m.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: m => <CatalogActions editHref={`${base}/${m.id}`} url={`/api/v1/admin/products/muthowif/${m.id}`} subject={`muthowif ${m.name}`} active={m.isActive} onDone={reload} /> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Muthowif" actions={<Link href={`/${locale}/admin/products/muthowif/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>} />

      {/* HPP layanan — satu harga flat, bukan per-orang (docs/arsitektur-muthowif.md §9/§10) */}
      <div className="admin-form-panel space-y-4">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> HPP &amp; Harga Layanan Muthowif</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">
            Satu harga berlaku untuk semua booking — muthowif spesifik ditentukan admin belakangan, jamaah membayar untuk jasa pembimbingan, bukan memilih orang tertentu.
          </p>
        </div>

        <div className="admin-card p-3 flex items-center gap-3">
          <p className="text-xs text-admin-muted">Harga saat ini:</p>
          <p className="text-sm font-bold text-admin-ink">{formatRupiah(currentPrice)}</p>
          <p className="text-xs text-admin-muted/70">/ hari — dihitung otomatis dari HPP di bawah</p>
        </div>

        <div className="border border-admin-line rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-admin-ink">Vendor &amp; Mata Uang</p>
          <p className="text-[11px] text-admin-muted/70">
            Muthowif tidak punya vendor pihak ketiga — Saudinesia menetapkan sendiri harga pasarannya.
          </p>
          <div className="flex items-center gap-2">
            <p className="admin-inp flex-1 bg-admin-spot/50 text-admin-ink/80">{vendorName}</p>
            <CurrencySelect value={currency} onChange={setCurrency} currencies={CURRENCIES} />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <p className="text-xs text-admin-muted mb-1">Harga Layanan ({currency})</p>
            <input type="number" className="admin-inp" value={hargaLayanan} onChange={e => setHargaLayanan(e.target.value)} placeholder="0" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">HPP (Rupiah)</p>
            <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{preview ? formatRupiah(Math.round(preview.hppRupiah)) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Harga Jual (otomatis)</p>
            <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{preview ? formatRupiah(preview.sellPrice) : '—'}</p>
          </div>
        </div>

        <button onClick={handleSavePrice} disabled={savingPrice || !canSavePrice} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {savingPrice ? 'Menyimpan...' : priceSaved ? 'Tersimpan ✓' : 'Simpan Harga Layanan'}
        </button>
      </div>

      {serviceId && <PriceCard ownerType="muthowif" ownerId={serviceId} title="Harga layanan: modal, jual, untung" reloadKey={priceTick} onChanged={() => { void loadPrice() }} />}

      <CatalogList<Muthowif> endpoint="/api/v1/admin/products/muthowif" columns={columns} getRowId={m => m.id} status isActive={m => m.isActive} searchPlaceholder="Cari nama muthowif…" empty="Belum ada muthowif." />
    </div>
  )
}
