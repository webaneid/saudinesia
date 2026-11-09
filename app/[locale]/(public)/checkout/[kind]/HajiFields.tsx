'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, UsersRound } from 'lucide-react'
import type { HajiCheckout } from '@/lib/checkout/options'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'

// Haji (keputusan H1 = b, §10.5): jumlah jamaah saja — jadwal milik produk. Tanpa visa umroh; syarat dokumen jamaah = milik produk Haji.
export function HajiFields({ product, maxPeople, onChange }: { product: HajiCheckout; maxPeople: number; onChange: FieldsChange }) {
  const cap = Math.max(0, Math.min(maxPeople, product.seatsLeft))
  const [people, setPeople] = useState(1)

  useEffect(() => {
    if (product.price <= 0) { onChange(null, 'Harga produk ini belum tersedia'); return }
    if (cap < 1) { onChange(null, 'Kuota produk ini sudah penuh'); return }
    onChange({ kind: 'haji', hajiProductId: product.id, numPeople: Math.min(people, cap) }, null)
  }, [product, people, cap, onChange])

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Jadwal</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Berangkat</dt><dd className="font-semibold">{product.departureDate ? formatCalendarDate(product.departureDate, DATE_LONG) : `Musim haji ${product.year}`}</dd></div>
          {product.returnDate && <div><dt className="text-muted-foreground">Pulang</dt><dd className="font-semibold">{formatCalendarDate(product.returnDate, DATE_LONG)}</dd></div>}
          {product.durationDays && <div><dt className="text-muted-foreground">Durasi</dt><dd className="font-semibold">{product.durationDays} hari</dd></div>}
        </dl>
        {product.includes.length > 0 && (
          <ul className="grid gap-2 border-t pt-4 sm:grid-cols-2">
            {product.includes.map(x => <li key={x} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {x}</li>)}
          </ul>
        )}
      </div>
      <div className="checkout-panel">
        <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah jamaah</label>
        {cap > 0 ? <PeopleStepper id="people" value={Math.min(people, cap)} onChange={setPeople} max={cap} /> : <p className="text-sm text-destructive">Kuota sudah penuh.</p>}
        {cap > 0 && product.seatsLeft < 10 && <p className="text-xs text-destructive">Sisa {product.seatsLeft} kursi.</p>}
      </div>
    </div>
  )
}
