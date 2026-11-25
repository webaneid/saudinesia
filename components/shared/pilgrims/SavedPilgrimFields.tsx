'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AddressPicker } from '@/components/shared/AddressPicker'
import { ContactPicker } from '@/components/shared/ContactPicker'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { COUNTRY_OPTIONS } from '@/lib/ui/countryOptions'
import { ManifestFieldsForm } from '@/components/booking/ManifestFieldsForm'
import { NIK_MASK } from '@/lib/pii/mask'
import { isBaby } from '@/lib/pilgrims/age'
import { isCalendarDate } from '@/lib/time'
import type { ManifestRole } from '@/lib/manifest/roles'
import { cardLayout, orderedRoles, type CardField } from './cardFields'
import { useFieldLabel } from './useFieldLabel'
import { usePilgrimFields } from './usePilgrimFields'
import type { SavedPilgrimFormValue } from './savedPilgrimForm'

// Isian kartu jamaah (docs/arsitektur-jamaah.md §5.1) — satu komponen untuk "Jamaah Saya", Profil, popup booking, dan admin atas nama pelanggan.
// Kolom yang tampil = kolom AKTIF katalog Data Jamaah (docs/rencana-profil-jamaah.md P2); nama dan tanggal lahir selalu tampil. Kolom yang
// disembunyikan tidak terhapus (formulir mengirim balik nilai kartu). Hanya kolom; tombol simpan milik halaman pemakai.
// NIK dan nomor paspor tersimpan tak pernah ditampilkan (samaran saja).

type Props = {
  value: SavedPilgrimFormValue
  onChange: (v: SavedPilgrimFormValue) => void
  /** "Saya sendiri" hanya relevan untuk pemilik akun (dan staf atas nama pelanggan). */
  showSelf?: boolean
  /** Awalan id kolom — beda per formulir bila beberapa formulir bisa tampil di satu halaman. */
  idPrefix?: string
  /** Kolom katalog yang sudah dimuat pemakai (popup, Profil); tak diberikan = dimuat sendiri. */
  fields?: CardField[]
  /** Kolom yang sudah ada di formulir induk (Profil: nama, kontak, email, alamat). */
  omit?: readonly ManifestRole[]
  /** Tanpa tanda wajib (Profil: boleh dilengkapi nanti; kolom yang kurang disebut di atas formulir). */
  relaxed?: boolean
}

const IDENTITY: readonly ManifestRole[] = ['display_name', 'gender', 'nationality', 'birth_place', 'birth_date', 'nik']
const PASSPORT: readonly ManifestRole[] = ['passport_number', 'passport_issued', 'passport_expiry']
const WIDE: readonly ManifestRole[] = ['display_name', 'nik', 'passport_number']

export function SavedPilgrimFields({ value: v, onChange, showSelf = true, idPrefix = 'sp', fields: given, omit, relaxed = false }: Props) {
  const t = useTranslations('shared.pilgrims.fields')
  const loaded = usePilgrimFields(given)
  const layout = useMemo(() => cardLayout(loaded ?? null, omit), [loaded, omit])
  const set = <K extends keyof SavedPilgrimFormValue>(k: K, x: SavedPilgrimFormValue[K]) => onChange({ ...v, [k]: x })
  const wni = v.nationality === 'ID'
  const baby = isCalendarDate(v.birthDate) && isBaby(v.birthDate) // bayi belum punya NIK
  const has = (r: ManifestRole) => layout.roles.has(r)
  const labelOf = useFieldLabel()
  const label = (r: ManifestRole) => labelOf(r, layout.roles.get(r))
  const star = (on: boolean) => on && <span className="text-destructive" aria-hidden> *</span>
  const required = (r: ManifestRole) => !relaxed && (layout.roles.get(r)?.required ?? false)

  if (loaded === undefined) return <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}</p>

  function field(role: ManifestRole): React.ReactNode {
    switch (role) {
      case 'display_name':
        return <>
          <Label htmlFor={`${idPrefix}-name`}>{label(role)}{star(true)}</Label>
          <Input id={`${idPrefix}-name`} value={v.fullName} onChange={e => set('fullName', e.target.value)} maxLength={120} required />
        </>
      case 'gender':
        return <>
          <Label>{label(role)}{star(required(role))}</Label>
          <ChoiceSelect options={[{ id: 'male', label: t('male') }, { id: 'female', label: t('female') }]} value={v.gender} onChange={x => set('gender', x as SavedPilgrimFormValue['gender'])} placeholder={t('pick')} ariaLabel={label(role)} />
        </>
      case 'nationality':
        return <>
          <Label>{label(role)}{star(required(role))}</Label>
          <ChoiceSelect options={COUNTRY_OPTIONS} value={v.nationality} onChange={x => set('nationality', x || 'ID')} clearable={false} ariaLabel={label(role)} />
        </>
      case 'birth_place':
        return <>
          <Label htmlFor={`${idPrefix}-bplace`}>{label(role)}{star(required(role))}</Label>
          <Input id={`${idPrefix}-bplace`} value={v.birthPlace} onChange={e => set('birthPlace', e.target.value)} maxLength={100} />
        </>
      case 'birth_date':
        return <>
          <Label htmlFor={`${idPrefix}-bdate`}>{label(role)}{star(!relaxed)}</Label>
          <Input id={`${idPrefix}-bdate`} type="date" value={v.birthDate} onChange={e => set('birthDate', e.target.value)} required={!relaxed} />
        </>
      case 'nik':
        return wni && <>
          <Label htmlFor={`${idPrefix}-nik`}>{label(role)}{star(required(role) && !baby)}</Label>
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
        </>
      case 'passport_number':
        return <>
          <Label htmlFor={`${idPrefix}-pass`}>{label(role)}{star(required(role))}</Label>
          <Input id={`${idPrefix}-pass`} autoComplete="off" value={v.passportNumber} maxLength={40}
            placeholder={v.passportMask && !v.clearPassport ? t('savedKeep', { mask: v.passportMask }) : t('passportPlaceholder')}
            onChange={e => onChange({ ...v, passportNumber: e.target.value, clearPassport: false })} />
          {v.passportMask && !v.passportNumber && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={v.clearPassport} onChange={e => set('clearPassport', e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
              {t('clearPassport')}
            </label>
          )}
        </>
      case 'passport_issued':
        return !v.clearPassport && <>
          <Label htmlFor={`${idPrefix}-pissued`}>{label(role)}{star(required(role))}</Label>
          <Input id={`${idPrefix}-pissued`} type="date" value={v.passportIssuedAt} onChange={e => set('passportIssuedAt', e.target.value)} />
        </>
      case 'passport_expiry':
        return !v.clearPassport && <>
          <Label htmlFor={`${idPrefix}-pexp`}>{label(role)}{star(required(role))}</Label>
          <Input id={`${idPrefix}-pexp`} type="date" value={v.passportExpiry} onChange={e => set('passportExpiry', e.target.value)} />
        </>
      default:
        return null
    }
  }

  const grid = (roles: readonly ManifestRole[]) => (
    <div className="grid gap-4 sm:grid-cols-2">
      {roles.map(r => {
        const content = field(r)
        return content ? <div key={r} className={`space-y-2 ${WIDE.includes(r) ? 'sm:col-span-2' : ''}`}>{content}</div> : null
      })}
    </div>
  )

  const identity = orderedRoles(layout, IDENTITY)
  // Ganti kewarganegaraan pada kartu berpaspor: server meminta nomor paspor diketik ulang → kolomnya ditampilkan walau nonaktif di katalog.
  const passportRoles = orderedRoles(layout, PASSPORT)
  const passport = passportRoles.includes('passport_number') || !v.passportMask || v.nationality === v.savedNationality ? passportRoles : (['passport_number', ...passportRoles] as ManifestRole[])
  const contact = has('phone') || has('whatsapp') || has('email')

  return (
    <div className="space-y-5 [&>section+section]:border-t [&>section+section]:pt-5">
      {identity.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">{t('identity')}</h2>
          {grid(identity)}
        </section>
      )}

      {passport.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">{!wni && required('passport_number') ? t('passportForeign') : t('passportWni')}</h2>
          {grid(passport)}
        </section>
      )}

      {contact && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">{t('contact')}</h2>
          {(has('phone') || has('whatsapp')) && (
            <ContactPicker value={v.contact} onChange={c => set('contact', c)} showEmail={false} only={has('phone') && has('whatsapp') ? undefined : has('phone') ? 'phone' : 'whatsapp'} />
          )}
          {has('email') && (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-email`}>{label('email')}{star(required('email'))}</Label>
              <Input id={`${idPrefix}-email`} type="email" value={v.email} onChange={e => set('email', e.target.value)} maxLength={254} />
            </div>
          )}
        </section>
      )}

      {has('address') && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{label('address')}{star(required('address'))}</h2>
          <AddressPicker value={v.address} onChange={a => set('address', a)} saved={v.hadAddress} />
        </section>
      )}

      {layout.extras.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">{t('extra')}</h2>
            {!relaxed && <p className="text-xs text-muted-foreground">{t('extraHint')}</p>}
          </div>
          <ManifestFieldsForm fields={relaxed ? layout.extras.map(f => ({ ...f, required: false })) : layout.extras} values={v.extra} onChange={x => set('extra', x)} idPrefix={`${idPrefix}-x`} />
        </section>
      )}

      {showSelf && (
        <label className="flex items-start gap-2 border-t pt-4 text-sm">
          <input type="checkbox" checked={v.isSelf} onChange={e => set('isSelf', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
          <span>{t('isSelf')}</span>
        </label>
      )}
    </div>
  )
}
