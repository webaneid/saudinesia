'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { ContactPicker, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { e164FromCountry } from '@/lib/utils/phone'

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
      if (!json.success) { setError(json.error ?? 'Gagal menyimpan.'); return }

      const phone = e164FromCountry(contact.phoneCountryCode, contact.phone)
      const whatsapp = e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)
      if (!phone || !whatsapp) { setError('Isi nomor telepon dan nomor WhatsApp.'); return }
      // Kirim ulang hanya bila nomor diubah: menyimpan nama/alamat tidak boleh menulis ulang nomor (mis. nomor lama berkode panggilan di luar
      // daftar negara, atau menghabiskan batas ubah-nomor) — dan tidak memicu email "nomor diubah".
      if (phone === initialData.phone && whatsapp === initialData.whatsapp) { setSuccess(true); return }
      const c = await fetch('/api/v1/auth/contact', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, whatsapp, ...(needsConsent ? { whatsappConsent: consent } : {}) }),
      })
      const cj = await c.json()
      if (!cj.success) { setError(cj.error ?? 'Gagal menyimpan nomor.'); return }
      setSuccess(true)
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-6 space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Nama Lengkap</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={initialData.email} disabled className="opacity-60" />
          <p className="text-xs text-muted-foreground">Email tidak dapat diubah dari profil</p>
        </div>
        <ContactPicker value={contact} onChange={setContact} showEmail={false} />
        <p className="text-xs text-muted-foreground">Notifikasi pembayaran dan pembaruan pesanan dikirim ke nomor WhatsApp ini, selain lewat email.</p>
        {needsConsent && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
            <span>Saya setuju Saudinesia mengirim notifikasi pembayaran dan pembaruan pesanan ke nomor WhatsApp di atas.</span>
          </label>
        )}

        <div className="space-y-2 pt-2 border-t">
          <Label>Alamat</Label>
          <AddressPicker value={address} onChange={setAddress} />
        </div>

        {error   && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600">Profil berhasil disimpan.</p>}

        <Button type="submit" disabled={loading || !consent}>{loading ? 'Menyimpan...' : 'Simpan Perubahan'}</Button>
      </form>
    </div>
  )
}
