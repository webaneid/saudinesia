'use client'

import { useTranslations } from 'next-intl'
import { Minus, Plus } from 'lucide-react'

/** Jumlah orang: tombol −/+ dan isian angka, dibatasi `min`..`max`. */
export function PeopleStepper({ id, value, onChange, max, min = 1 }: { id: string; value: number; onChange: (n: number) => void; max: number; min?: number }) {
  const t = useTranslations('checkout.stepper')
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.trunc(n) : min))
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={t('decrease')}
        className="grid h-11 w-11 place-items-center rounded-xl border text-brand transition-colors hover:border-brand disabled:opacity-40">
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={e => onChange(clamp(Number(e.target.value)))}
        className="checkout-input w-20 text-center font-semibold" />
      <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={t('increase')}
        className="grid h-11 w-11 place-items-center rounded-xl border text-brand transition-colors hover:border-brand disabled:opacity-40">
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
