'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarDays, Info, UsersRound } from 'lucide-react'
import type { VisaCheckout } from '@/lib/checkout/options'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import { priceHint, type FieldsChange } from './fields'

// Visa: jumlah jamaah, rencana tanggal berangkat, dan lama tinggal bila harganya berjenjang per rentang hari. Visa plus (wajib dibeli bersama produk lain)
// tetap dapat diisi untuk DITAMBAHKAN KE KERANJANG bersama produk wajibnya (§10.7); "Pesan sekarang" sendirian ditolak mesin (aturan visa, 422 di pratinjau).
export function VisaFields({ product, today, maxPeople, onChange }: { product: VisaCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const t = useTranslations('checkout')
  const [people, setPeople] = useState(1)
  const [date, setDate] = useState('')
  const multiTier = product.tiers.length > 1
  const [tier, setTier] = useState(multiTier ? '' : '0')

  useEffect(() => {
    if (product.tiers.length === 0) { onChange(null, t('visa.missing.unpriced')); return }
    if (!date) { onChange(null, t('visa.missing.pickDate')); return }
    if (date < today) { onChange(null, t('visa.missing.datePast')); return }
    const picked = tier === '' ? undefined : product.tiers[Number(tier)] // Number('') = 0 — belum memilih ≠ jenjang pertama
    if (!picked) { onChange(null, t('visa.missing.pickStay')); return }
    onChange({ kind: 'visa', visaProductId: product.id, numPeople: people, plannedTravelDate: date, ...(multiTier ? { selectedDurationDays: picked.minDays } : {}) }, null)
  }, [product, people, date, tier, multiTier, today, onChange, t])

  return (
    <>
    {product.bundledWith.length > 0 && (
      <div className="checkout-panel flex gap-3 text-sm">
        <Info className="h-5 w-5 shrink-0 text-brand" aria-hidden />
        <p>{t.rich('visa.bundled', { items: product.bundledWith.map(c => t(`components.${c}`)).join(', '), strong: chunks => <strong>{chunks}</strong> })}</p>
      </div>
    )}
    <div className="checkout-panel">
      <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {t('visa.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="travel" className="checkout-label">{t('visa.travelDate')}</label>
          <input id="travel" type="date" className="checkout-input" value={date} min={today} onChange={e => setDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('visa.processNote', { days: product.processDays })}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('visa.people')}</label>
          <PeopleStepper id="people" value={people} onChange={setPeople} max={maxPeople} />
        </div>
      </div>
      {multiTier && (
        <div className="space-y-1.5">
          <label className="checkout-label">{t('visa.stay')}</label>
          <ChoiceSelect ariaLabel={t('visa.stay')} value={tier} onChange={setTier} placeholder={t('visa.pickStay')} clearable={false}
            options={product.tiers.map((x, i) => ({ id: String(i), label: x.minDays === x.maxDays ? t('visa.dayExact', { days: x.minDays }) : t('visa.dayRange', { min: x.minDays, max: x.maxDays }), hint: priceHint(x.fee, t('common.perPersonShort')) }))} />
        </div>
      )}
    </div>
    </>
  )
}
