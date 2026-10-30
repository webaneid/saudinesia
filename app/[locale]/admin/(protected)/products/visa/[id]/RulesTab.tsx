'use client'

import { useEffect, useState } from 'react'
import { Building2, Bus, Link2, Plane } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/admin/ui/Card'
import { Switch } from '@/components/admin/ui/Switch'
import type { RequiredComponent } from '@/lib/validators/visa'

// Aturan ketergantungan visa (docs/arsitektur-booking-engine-v2.md D5, §10.2): komponen yang WAJIB ada di booking yang sama. Dievaluasi lib/booking/rules.ts;
// Paket Umroh yang memuat komponen itu memenuhi aturan, dan pelanggan tertentu dapat dilonggarkan (Pelanggan → "Boleh pesan visa tanpa pesawat dan hotel").

type Trip = { id: string; name: string; category: string | null; origin: string; destination: string }
type Props = { rules: RequiredComponent[]; onChange: (next: RequiredComponent[]) => void }

const SIMPLE: ReadonlyArray<{ type: 'flight' | 'hotel'; label: string; hint: string; icon: LucideIcon }> = [
  { type: 'flight', label: 'Tiket pesawat', hint: 'Booking wajib memuat tiket (atau paket bertiket).', icon: Plane },
  { type: 'hotel', label: 'Hotel', hint: 'Booking wajib memuat hotel Makkah atau Madinah (atau paket berhotel).', icon: Building2 },
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

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Link2 className="size-4 text-admin-accent" /> Wajib dalam booking yang sama</h2>
        <p className="m-0 mt-1 text-xs text-admin-muted">
          Booking berisi visa ini ditolak bila komponen di bawah tidak ada. Paket Umroh yang memuatnya ikut memenuhi aturan. Pelanggan tertentu bisa dilonggarkan dari halaman Pelanggan.
        </p>
      </div>

      {SIMPLE.map(({ type, label, hint, icon: Icon }) => (
        <div key={type} className="flex items-start justify-between gap-3 border-t border-admin-line pt-3">
          <div>
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-admin-ink"><Icon className="size-4 text-admin-muted" /> {label}</p>
            <p className="m-0 text-xs text-admin-muted">{hint}</p>
          </div>
          <Switch checked={has(type)} onChange={on => toggle(type, on)} label={`Wajibkan ${label.toLowerCase()}`} />
        </div>
      ))}

      <div className="space-y-3 border-t border-admin-line pt-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-admin-ink"><Bus className="size-4 text-admin-muted" /> Transport</p>
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
    </Card>
  )
}
