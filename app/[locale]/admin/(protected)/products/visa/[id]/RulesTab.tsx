'use client'

import { useEffect, useState } from 'react'
import { Building, Building2, Bus, FileCheck2, Link2, MapPinned, Plane, UserRound, UtensilsCrossed } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/admin/ui/Card'
import { Switch } from '@/components/admin/ui/Switch'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { REQUIRED_COMPONENT_LABEL, visaSalesModel, type RequiredComponent } from '@/lib/validators/visa'

// Model penjualan visa (docs/rencana-visa-produk.md §2.1): "Visa only" (cukup lengkapi dokumen) atau "Visa plus" — daftar centang produk yang WAJIB dibeli
// bersama visa ini di booking yang sama. Model = turunan `requiredComponents` (kosong = only), dievaluasi lib/booking/rules.ts untuk SETIAP pelanggan;
// isi Paket Umroh / Paket Ziarah yang memuat komponen itu ikut memenuhi aturan.

type Trip = { id: string; name: string; category: string | null; origin: string; destination: string }
type Props = { rules: RequiredComponent[]; onChange: (next: RequiredComponent[]) => void }

type Simple = { type: Exclude<RequiredComponent['type'], 'transport'>; hint: string; icon: LucideIcon }
const BEFORE_TRANSPORT: readonly Simple[] = [
  { type: 'flight', hint: 'Booking wajib memuat tiket pesawat (atau paket bertiket).', icon: Plane },
  { type: 'hotel_makkah', hint: 'Booking wajib memuat hotel di Makkah (item hotel, atau hotel Makkah paket).', icon: Building2 },
  { type: 'hotel_madinah', hint: 'Booking wajib memuat hotel di Madinah (item hotel, atau hotel Madinah paket).', icon: Building },
]
const AFTER_TRANSPORT: readonly Simple[] = [
  { type: 'muthowif', hint: 'Booking wajib memuat layanan muthowif (atau paket bermuthowif).', icon: UserRound },
  { type: 'tour', hint: 'Booking wajib memuat Paket Ziarah.', icon: MapPinned },
  { type: 'catering', hint: 'Booking wajib memuat katering (atau paket berkatering).', icon: UtensilsCrossed },
]

export function RulesTab({ rules, onChange }: Props) {
  const [trips, setTrips] = useState<Trip[]>([])
  useEffect(() => {
    fetch('/api/v1/admin/products/transport/trips').then(r => r.json()).then(j => { if (Array.isArray(j.data)) setTrips(j.data) }).catch(() => setTrips([]))
  }, [])

  const has = (type: RequiredComponent['type']) => rules.some(r => r.type === type)
  const toggle = (type: RequiredComponent['type'], on: boolean) => onChange(on ? [...rules.filter(r => r.type !== type), { type } as RequiredComponent] : rules.filter(r => r.type !== type))
  const transport = rules.find((r): r is Extract<RequiredComponent, { type: 'transport' }> => r.type === 'transport')
  const setTransport = (patch: { categories?: string[]; tripIds?: string[] }) => {
    const next = { type: 'transport' as const, categories: transport?.categories ?? [], tripIds: transport?.tripIds ?? [], ...patch }
    onChange([...rules.filter(r => r.type !== 'transport'), {
      type: 'transport', ...(next.categories.length > 0 && { categories: next.categories }), ...(next.tripIds.length > 0 && { tripIds: next.tripIds }),
    }])
  }
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const categories = [...new Set(trips.map(t => t.category).filter((c): c is string => !!c))].sort()
  const model = visaSalesModel(rules)
  // "Visa plus" tanpa komponen tidak ada artinya: memilihnya langsung mewajibkan tiket + hotel Makkah + hotel Madinah (kombinasi paling umum), dan mematikan
  // semua komponen = kembali "Visa only".
  const setModel = (v: string) => { if (v === 'only') onChange([]); else if (!model.plus) onChange([{ type: 'flight' }, { type: 'hotel_makkah' }, { type: 'hotel_madinah' }]) }
  const row = ({ type, hint, icon: Icon }: Simple) => (
    <div key={type} className="flex items-start justify-between gap-3 border-t border-admin-line pt-3">
      <div>
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-admin-ink"><Icon className="size-4 text-admin-muted" /> {REQUIRED_COMPONENT_LABEL[type]}</p>
        <p className="m-0 text-xs text-admin-muted">{hint}</p>
      </div>
      <Switch checked={has(type)} onChange={on => toggle(type, on)} label={`Wajibkan ${REQUIRED_COMPONENT_LABEL[type].toLowerCase()}`} />
    </div>
  )

  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-2">
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Link2 className="size-4 text-admin-accent" /> Model penjualan</h2>
        <ChoiceSelect
          ariaLabel="Model penjualan visa" clearable={false} className="max-w-sm" value={model.plus ? 'plus' : 'only'} onChange={setModel}
          options={[
            { id: 'only', label: 'Visa only', hint: 'Cukup lengkapi dokumen — tiket/hotel boleh dari luar' },
            { id: 'plus', label: 'Visa plus', hint: 'Wajib membeli komponen tertentu dari kita' },
          ]}
        />
        <p className="m-0 text-xs text-admin-muted">
          {model.plus
            ? <>Booking berisi visa ini tidak bisa diterbitkan bila produk yang dicentang di bawah tidak ada. Isi Paket Umroh / Paket Ziarah ikut dihitung. Berlaku untuk semua pelanggan.</>
            : <>Visa dijual tanpa kewajiban membeli komponen lain. Bukti booking hotel/tiket dari luar diminta lewat tab <span className="inline-flex items-center gap-1 font-semibold text-admin-ink"><FileCheck2 className="size-3.5" /> Persyaratan dokumen</span>.</>}
        </p>
      </div>

      {model.plus && <>
        <h3 className="m-0 pt-1 text-xs font-bold uppercase tracking-wide text-admin-muted">Wajib dibeli bersama visa ini</h3>
        {BEFORE_TRANSPORT.map(row)}

        <div className="space-y-3 border-t border-admin-line pt-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="m-0 flex items-center gap-2 text-sm font-semibold text-admin-ink"><Bus className="size-4 text-admin-muted" /> {REQUIRED_COMPONENT_LABEL.transport}</p>
              <p className="m-0 text-xs text-admin-muted">Tanpa pilihan di bawah = transport apa pun. Persempit ke kategori jurusan (mis. bandara–hotel) atau rute tertentu.</p>
            </div>
            <Switch checked={!!transport} onChange={on => toggle('transport', on)} label="Wajibkan transport" />
          </div>
          {transport && (
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="space-y-1.5">
                <legend className="label-kecil">Kategori jurusan</legend>
                {categories.length === 0 && <p className="m-0 text-xs text-admin-muted">Belum ada trip berkategori.</p>}
                {categories.map(c => (
                  <label key={c} className="flex items-center gap-2 text-sm text-admin-ink">
                    <input type="checkbox" checked={(transport.categories ?? []).includes(c)} onChange={() => setTransport({ categories: flip(transport.categories ?? [], c) })} />
                    {c}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="label-kecil">Atau rute tertentu</legend>
                {trips.map(t => (
                  <label key={t.id} className="flex items-center gap-2 text-sm text-admin-ink">
                    <input type="checkbox" checked={(transport.tripIds ?? []).includes(t.id)} onChange={() => setTransport({ tripIds: flip(transport.tripIds ?? [], t.id) })} />
                    <span>{t.name} <span className="text-xs text-admin-muted">({t.origin} → {t.destination})</span></span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
        </div>
        {AFTER_TRANSPORT.map(row)}
      </>}
    </Card>
  )
}
