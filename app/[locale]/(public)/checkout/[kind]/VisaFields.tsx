'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Info, UsersRound } from 'lucide-react'
import type { VisaCheckout } from '@/lib/checkout/options'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import { priceHint, type FieldsChange } from './fields'

// Visa: jumlah jamaah, rencana tanggal berangkat, dan lama tinggal bila harganya berjenjang per rentang hari. Visa plus (wajib dibeli bersama produk lain)
// tetap dapat diisi untuk DITAMBAHKAN KE KERANJANG bersama produk wajibnya (§10.7); "Pesan sekarang" sendirian ditolak mesin (aturan visa, 422 di pratinjau).
export function VisaFields({ product, today, maxPeople, onChange }: { product: VisaCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const [people, setPeople] = useState(1)
  const [date, setDate] = useState('')
  const multiTier = product.tiers.length > 1
  const [tier, setTier] = useState(multiTier ? '' : '0')

  useEffect(() => {
    if (product.tiers.length === 0) { onChange(null, 'Harga visa ini belum tersedia'); return }
    if (!date) { onChange(null, 'Pilih rencana tanggal berangkat'); return }
    if (date < today) { onChange(null, 'Tanggal berangkat tidak boleh sebelum hari ini'); return }
    const t = tier === '' ? undefined : product.tiers[Number(tier)] // Number('') = 0 — belum memilih ≠ jenjang pertama
    if (!t) { onChange(null, 'Pilih lama tinggal'); return }
    onChange({ kind: 'visa', visaProductId: product.id, numPeople: people, plannedTravelDate: date, ...(multiTier ? { selectedDurationDays: t.minDays } : {}) }, null)
  }, [product, people, date, tier, multiTier, today, onChange])

  return (
    <>
    {product.bundledWith.length > 0 && (
      <div className="checkout-panel flex gap-3 text-sm">
        <Info className="h-5 w-5 shrink-0 text-brand" aria-hidden />
        <p>Visa ini hanya dijual bersama <strong>{product.bundledWith.join(', ')}</strong> dalam pesanan yang sama. Isi rencana perjalanan, <strong>tambahkan ke keranjang</strong>, lalu tambahkan produk tersebut sebelum memesan.</p>
      </div>
    )}
    <div className="checkout-panel">
      <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Rencana perjalanan</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="travel" className="checkout-label">Rencana tanggal berangkat</label>
          <input id="travel" type="date" className="checkout-input" value={date} min={today} onChange={e => setDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">Proses visa ± {product.processDays} hari kerja — pesan jauh hari sebelum berangkat.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah jamaah</label>
          <PeopleStepper id="people" value={people} onChange={setPeople} max={maxPeople} />
        </div>
      </div>
      {multiTier && (
        <div className="space-y-1.5">
          <label className="checkout-label">Lama tinggal</label>
          <ChoiceSelect ariaLabel="Lama tinggal" value={tier} onChange={setTier} placeholder="Pilih lama tinggal" clearable={false}
            options={product.tiers.map((t, i) => ({ id: String(i), label: t.minDays === t.maxDays ? `${t.minDays} hari` : `${t.minDays}–${t.maxDays} hari`, hint: priceHint(t.fee, '/org') }))} />
        </div>
      )}
    </div>
    </>
  )
}
