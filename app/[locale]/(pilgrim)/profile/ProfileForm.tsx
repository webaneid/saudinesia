'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { ContactPicker, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { e164FromCountry } from '@/lib/utils/phone'
import { useApiError } from '@/components/shared/useApiError'

type AddressRecord = {
  type: 'domestic' | 'international'
  fullAddress: string
  postalCode: string | null
  provinceId: string | null
  regencyId: string | null
  districtId: string | null
  villageId: string | null
  countryCode: string | null
  city: string | null
  stateRegion: string | null
} | null

interface ProfileFormProps {
  locale: string
  needsConsent: boolean
  initialData: { fullName: string; email: string; phone: string; whatsapp: string }
  initialAddress: AddressRecord
}

function toAddressValue(a: AddressRecord): AddressValue {
  if (!a) return EMPTY_ADDRESS
  return {
    type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '',
    provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId,
    countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
  }
}

export function ProfileForm({ locale, needsConsent, initialData, initialAddress }: ProfileFormProps) {
  const router = useRouter()
  const t = useTranslations('pilgrimArea.profile')
  const errorText = useApiError()
  const [fullName, setFullName] = useState(initialData.fullName)
  const [address,  setAddress]  = useState<AddressValue>(toAddressValue(initialAddress))
  const [contact,  setContact]  = useState<ContactValue>(() => contactFromStored(initialData.phone, initialData.whatsapp))
  const [consent,  setConsent]  = useState(!needsConsent)
  const [loading,  setLoading]  = useState(false)
  const [success,  setSuccess]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess(false); setLoading(true)
    try {
      const body: Record<string, unknown> = { fullName }
      if (address.fullAddress.trim()) body.address = address
      const res = await fetch('/api/v1/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) { setError(errorText(json, t('saveFailed'))); return }

      const phone = e164FromCountry(contact.phoneCountryCode, contact.phone)
      const whatsapp = e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)
      if (!phone || !whatsapp) { setError(t('phoneRequired')); return }
      // Kirim ulang hanya bila nomor diubah: menyimpan nama/alamat tidak boleh menulis ulang nomor (mis. nomor lama berkode panggilan di luar
      // daftar negara, atau menghabiskan batas ubah-nomor) — dan tidak memicu email "nomor diubah".
      if (phone === initialData.phone && whatsapp === initialData.whatsapp) { setSuccess(true); return }
      const c = await fetch('/api/v1/auth/contact', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, whatsapp, ...(needsConsent ? { whatsappConsent: consent } : {}) }),
      })
      const cj = await c.json()
      if (!cj.success) { setError(errorText(cj, t('phoneFailed'))); return }
      setSuccess(true)
      router.refresh() // status verifikasi WhatsApp bergantung pada nomor yang baru disimpan
    } catch {
      setError(t('error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-6 space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>{t('fullName')}</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>{t('email')}</Label>
          <Input value={initialData.email} disabled className="opacity-60" />
          <p className="text-xs text-muted-foreground">{t('emailFixed')}</p>
        </div>
        <ContactPicker value={contact} onChange={setContact} showEmail={false} />
        <p className="text-xs text-muted-foreground">{t('waNote')}</p>
        {needsConsent && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
            <span>{t('consent')}</span>
          </label>
        )}

        <div className="space-y-2 pt-2 border-t">
          <Label>{t('address')}</Label>
          <AddressPicker value={address} onChange={setAddress} />
        </div>

        {error   && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600">{t('saved')}</p>}

        <Button type="submit" disabled={loading || !consent}>{loading ? t('saving') : t('save')}</Button>
      </form>
    </div>
  )
}
