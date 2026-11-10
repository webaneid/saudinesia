'use client'

import { useEffect, useState } from 'react'
import { UsersRound } from 'lucide-react'
import type { MuthowifCheckout } from '@/lib/checkout/options'
import { formatRupiah } from '@/lib/utils'
import { CHECKOUT_MAX_DAYS } from '@/lib/validators/checkout'
import { PeopleStepper } from './PeopleStepper'
import { ServiceDays } from './ServiceDays'
import { serviceDays, type FieldsChange } from './fields'

// Muthowif (docs/arsitektur-booking-engine-v2.md §10.6, K11b-3): satu layanan umum — pelanggan memilih tanggal dan jumlah orang, pembimbing
// ditentukan tim kami. Jumlah hari dihitung server; kapasitas harian dicek mesin per tanggal (penuh → 409 dengan tanggalnya).
export function MuthowifFields({ product, today, maxPeople, onChange }: { product: MuthowifCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const [rawStart, setStart] = useState('')
  const [rawEnd, setEnd] = useState('')
  const [people, setPeople] = useState(1)
  const { start, end, days, missing } = serviceDays(rawStart, rawEnd, today, CHECKOUT_MAX_DAYS)

  useEffect(() => {
    if (!(product.pricePerPersonDay > 0)) { onChange(null, 'Harga layanan muthowif belum tersedia'); return }
    if (missing) { onChange(null, missing); return }
    onChange({ kind: 'muthowif', startDate: start, endDate: end, numPeople: people }, null)
  }, [product, start, end, missing, people, onChange])

  return (
    <div className="space-y-5">
      <ServiceDays today={today} start={rawStart} end={rawEnd} onStart={setStart} onEnd={setEnd} days={days}
        note={product.pricePerPersonDay > 0 ? `Harga ${formatRupiah(product.pricePerPersonDay)}/orang/hari.` : undefined} />
      <div className="checkout-panel">
        <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah jamaah</label>
        <PeopleStepper id="people" value={people} onChange={setPeople} max={maxPeople} />
        <p className="text-xs text-muted-foreground">Pembimbing yang bertugas ditentukan tim kami dan dikabarkan sebelum keberangkatan.</p>
      </div>
    </div>
  )
}
