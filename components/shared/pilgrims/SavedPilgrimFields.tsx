'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AddressPicker } from '@/components/shared/AddressPicker'
import { ContactPicker } from '@/components/shared/ContactPicker'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { COUNTRY_OPTIONS } from '@/lib/ui/countryOptions'
import { NIK_MASK } from '@/lib/pii/mask'
import type { SavedPilgrimFormValue } from './savedPilgrimForm'

// Isian kartu jamaah (docs/arsitektur-jamaah.md §5.1) — satu komponen untuk "Jamaah Saya" dan admin atas nama pelanggan.
// Hanya kolom; tombol simpan milik halaman pemakai. NIK dan nomor paspor tersimpan tak pernah ditampilkan (samaran saja).

type Props = {
  value: SavedPilgrimFormValue
  onChange: (v: SavedPilgrimFormValue) => void
  /** "Saya sendiri" hanya relevan untuk pemilik akun (dan staf atas nama pelanggan). */
  showSelf?: boolean
  /** Awalan id kolom — beda per formulir bila beberapa formulir bisa tampil di satu halaman. */
  idPrefix?: string
}

export function SavedPilgrimFields({ value: v, onChange, showSelf = true, idPrefix = 'sp' }: Props) {
  const t = useTranslations('shared.pilgrims.fields')
  const genderOptions = [{ id: 'male', label: t('male') }, { id: 'female', label: t('female') }]
  const set = <K extends keyof SavedPilgrimFormValue>(k: K, x: SavedPilgrimFormValue[K]) => onChange({ ...v, [k]: x })
  const wni = v.nationality === 'ID'

  return (
    <div className="space-y-5">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">{t('identity')}</h2>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>{t('fullName')}</Label>
          <Input id={`${idPrefix}-name`} value={v.fullName} onChange={e => set('fullName', e.target.value)} maxLength={120} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('gender')}</Label>
            <ChoiceSelect options={genderOptions} value={v.gender} onChange={x => set('gender', x as SavedPilgrimFormValue['gender'])} placeholder={t('pick')} ariaLabel={t('gender')} />
          </div>
          <div className="space-y-2">
            <Label>{t('nationality')}</Label>
            <ChoiceSelect options={COUNTRY_OPTIONS} value={v.nationality} onChange={x => set('nationality', x || 'ID')} clearable={false} ariaLabel={t('nationality')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-bplace`}>{t('birthPlace')}</Label>
            <Input id={`${idPrefix}-bplace`} value={v.birthPlace} onChange={e => set('birthPlace', e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-bdate`}>{t('birthDate')}</Label>
            <Input id={`${idPrefix}-bdate`} type="date" value={v.birthDate} onChange={e => set('birthDate', e.target.value)} required />
          </div>
        </div>

        {wni && (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-nik`}>{t('nik')}</Label>
            <Input id={`${idPrefix}-nik`} inputMode="numeric" autoComplete="off" value={v.nik} maxLength={40}
              placeholder={v.hasNik && !v.clearNik ? t('savedKeep', { mask: NIK_MASK }) : t('nikPlaceholder')}
              onChange={e => onChange({ ...v, nik: e.target.value, clearNik: false })} />
            <p className="text-xs text-muted-foreground">{t('nikHint')}</p>
            {v.hasNik && !v.nik && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={v.clearNik} onChange={e => set('clearNik', e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
                {t('clearNik')}
              </label>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t pt-4">
        <h2 className="text-sm font-semibold">{wni ? t('passportWni') : t('passportForeign')}</h2>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-pass`}>{t('passportNumber')}</Label>
          <Input id={`${idPrefix}-pass`} autoComplete="off" value={v.passportNumber} maxLength={40}
            placeholder={v.passportMask && !v.clearPassport ? t('savedKeep', { mask: v.passportMask }) : t('passportPlaceholder')}
            onChange={e => onChange({ ...v, passportNumber: e.target.value, clearPassport: false })} />
          {v.passportMask && !v.passportNumber && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={v.clearPassport} onChange={e => set('clearPassport', e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
              {t('clearPassport')}
            </label>
          )}
        </div>
        {!v.clearPassport && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-pissued`}>{t('issued')}</Label>
              <Input id={`${idPrefix}-pissued`} type="date" value={v.passportIssuedAt} onChange={e => set('passportIssuedAt', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-pexp`}>{t('expiry')}</Label>
              <Input id={`${idPrefix}-pexp`} type="date" value={v.passportExpiry} onChange={e => set('passportExpiry', e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 border-t pt-4">
        <h2 className="text-sm font-semibold">{t('contact')}</h2>
        <ContactPicker value={v.contact} onChange={c => set('contact', c)} showEmail={false} />
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-email`}>{t('email')}</Label>
          <Input id={`${idPrefix}-email`} type="email" value={v.email} onChange={e => set('email', e.target.value)} maxLength={254} />
        </div>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-semibold">{t('address')}</h2>
        <AddressPicker value={v.address} onChange={a => set('address', a)} />
        {v.hadAddress && !v.address.fullAddress.trim() && <p className="text-xs text-muted-foreground">{t('addressCleared')}</p>}
      </section>

      {showSelf && (
        <label className="flex items-start gap-2 border-t pt-4 text-sm">
          <input type="checkbox" checked={v.isSelf} onChange={e => set('isSelf', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
          <span>{t('isSelf')}</span>
        </label>
      )}
    </div>
  )
}
