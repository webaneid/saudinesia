'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { Badge } from '@/components/admin/ui/Badge'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { SingleCostForm } from '@/components/admin/pricing/SingleCostForm'
import { adminHref } from '@/lib/admin/href'

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR']

type Muthowif = { id: string; name: string; rating: number; dailyCapacity: number; isActive: boolean }

export default function MuthowifPage() {
  const { locale } = useParams() as { locale: string }


  // HPP layanan muthowif — satu komponen flat, tidak per-orang, cache di MuthowifServicePrice.price
  // (docs/arsitektur-muthowif.md §10). Tidak ada vendor pihak ketiga sungguhan di sini (beda dari
  // Visa/Flight/Hotel/Transport) — Saudinesia menetapkan sendiri harga pasaran, jadi vendor
  // ("Saudinesia", dibuat otomatis server-side) cuma ditampilkan read-only, tidak dipilih admin.
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [priceTick, setPriceTick] = useState(0)

  async function loadService() {
    const sr = await fetch('/api/v1/admin/products/muthowif/service-price')
    const sj = await sr.json()
    if (sj.data) setServiceId(sj.data.id ?? null)
  }
  useEffect(() => { void loadService() }, [])

  const base = adminHref(locale, `/admin/products/muthowif`)
  const columns = (reload: () => void): Column<Muthowif>[] => [
    { key: 'name', header: 'Nama', mobile: 'title', cell: m => <Link href={`${base}/${m.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{m.name}</Link> },
    { key: 'rating', header: 'Rating', cell: m => <span className="text-[12px] text-admin-gold-strong">★ {m.rating}</span> },
    { key: 'capacity', header: 'Kap/hari', align: 'right', cell: m => <span className="text-[12px] text-admin-muted">{m.dailyCapacity}</span> },
    { key: 'status', header: 'Status', cell: m => <Badge tone={m.isActive ? 'ok' : 'neutral'}>{m.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: m => <CatalogActions editHref={`${base}/${m.id}`} url={`/api/v1/admin/products/muthowif/${m.id}`} subject={`muthowif ${m.name}`} active={m.isActive} onDone={reload} /> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Muthowif" actions={<Link href={adminHref(locale, `/admin/products/muthowif/new`)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>} />

      {/* HPP layanan — satu harga flat, bukan per-orang (docs/arsitektur-muthowif.md §9/§10) */}
      <SingleCostForm
        title="HPP & Harga Layanan Muthowif" ownerType="muthowif" ownerId={serviceId} reloadKey={priceTick}
        hint="Satu harga per hari untuk semua booking — muthowif yang bertugas ditentukan admin belakangan, jamaah tidak memilih orang."
        costUrl="/api/v1/admin/products/muthowif/service-price/cost" simulateUrl="/api/v1/admin/products/muthowif/service-price/simulate" costKey="hargaLayanan"
        costLabel="Harga Layanan" currencies={CURRENCIES} defaultCurrency="IDR" unitHint="per hari"
        vendor={{ fixed: true, note: 'Muthowif tidak punya vendor pihak ketiga — Saudinesia menetapkan sendiri harganya.' }}
        onSaved={async () => { await loadService(); setPriceTick(t => t + 1) }}
      />

      {serviceId && <PriceCard ownerType="muthowif" ownerId={serviceId} title="Harga layanan: modal, jual, untung" reloadKey={priceTick} onChanged={() => setPriceTick(t => t + 1)} />}

      <CatalogList<Muthowif> endpoint="/api/v1/admin/products/muthowif" columns={columns} getRowId={m => m.id} status isActive={m => m.isActive} searchPlaceholder="Cari nama muthowif…" empty="Belum ada muthowif." />
    </div>
  )
}
