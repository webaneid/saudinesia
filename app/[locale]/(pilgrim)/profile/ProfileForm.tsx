'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CheckCircle } from 'lucide-react'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'

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
  initialData: { fullName: string; email: string; phone: string }
  phoneVerified: boolean
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

export function ProfileForm({ locale, initialData, phoneVerified, initialAddress }: ProfileFormProps) {
  const [fullName, setFullName] = useState(initialData.fullName)
  const [address,  setAddress]  = useState<AddressValue>(toAddressValue(initialAddress))
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Nomor WhatsApp</Label>
            {phoneVerified
              ? <Badge variant="success" className="text-xs"><CheckCircle className="h-3 w-3 mr-1" />Terverifikasi</Badge>
              : <Badge variant="warning" className="text-xs">Belum diverifikasi</Badge>}
          </div>
          <Input value={initialData.phone ? `+${initialData.phone}` : '-'} disabled className="opacity-60" />
        </div>

        <div className="space-y-2 pt-2 border-t">
          <Label>Alamat</Label>
          <AddressPicker value={address} onChange={setAddress} />
        </div>

        {error   && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600">Profil berhasil disimpan.</p>}

        <Button type="submit" disabled={loading}>{loading ? 'Menyimpan...' : 'Simpan Perubahan'}</Button>
      </form>
    </div>
  )
}
