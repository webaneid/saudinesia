'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { COUNTRIES } from '@/lib/constants/countries'
import { isoToFlagEmoji } from '@/lib/utils/flag'
import { splitE164 } from '@/lib/utils/phone'

export type ContactValue = {
  phoneCountryCode: string
  phone: string
  whatsappCountryCode: string
  whatsapp: string
  email: string
}

export const EMPTY_CONTACT: ContactValue = {
  phoneCountryCode: 'ID',
  phone: '',
  whatsappCountryCode: 'ID',
  whatsapp: '',
  email: '',
}

/** Isi komponen dari nomor E.164 yang tersimpan di akun (kosong → default Indonesia; WhatsApp mengikuti telepon bila belum ada). */
export function contactFromStored(phone: string, whatsapp: string): ContactValue {
  const p = phone ? splitE164(phone) : null
  const w = whatsapp ? splitE164(whatsapp) : null
  return {
    ...EMPTY_CONTACT,
    phoneCountryCode: p?.countryCode ?? 'ID', phone: p?.local ?? '',
    whatsappCountryCode: w?.countryCode ?? p?.countryCode ?? 'ID', whatsapp: w?.local ?? p?.local ?? '',
  }
}

// docs/arsitektur-komponen-kontak.md §3.2 — "Sama dengan nomor HP" TIDAK disimpan sebagai
// boolean di value, cukup dibandingkan aktual tiap render (dihitung ulang, bukan dipercaya buta,
// pola yang sama dipakai kolom cache harga di modul lain).
function isWhatsappSameAsPhone(v: ContactValue): boolean {
  return v.whatsappCountryCode === v.phoneCountryCode && v.whatsapp === v.phone
}

const COUNTRY_CODE_OPTIONS: AutocompleteOption[] = COUNTRIES.map(c => ({
  id: c.code,
  label: `${isoToFlagEmoji(c.code)} +${c.dialCode} ${c.name}`,
}))

type Props = {
  value: ContactValue
  onChange: (v: ContactValue) => void
  /** false = tanpa kolom Email (mis. pendaftaran/Lengkapi data akun: email adalah identitas akun, bukan data kontak). */
  showEmail?: boolean
}

export function ContactPicker({ value, onChange, showEmail = true }: Props) {
  // "Sama dengan nomor HP" dimulai dari nilai turunan (bandingkan phone vs whatsapp aktual —
  // penting saat memuat data existing yang sudah divergen), tapi begitu pengguna secara EKSPLISIT
  // membuka centang, itu harus tetap terbuka walau phone/whatsapp kebetulan masih sama persis —
  // makanya butuh override lokal `unlocked`, bukan murni turunan (docs/arsitektur-komponen-kontak.md §3.2).
  const [unlocked, setUnlocked] = useState(false)
  const sameAsPhone = unlocked ? false : isWhatsappSameAsPhone(value)

  function setPhoneCountryCode(code: string | null) {
    const next = code ?? 'ID'
    onChange(sameAsPhone
      ? { ...value, phoneCountryCode: next, whatsappCountryCode: next, whatsapp: value.phone }
      : { ...value, phoneCountryCode: next })
  }

  function setPhone(phone: string) {
    onChange(sameAsPhone
      ? { ...value, phone, whatsapp: phone, whatsappCountryCode: value.phoneCountryCode }
      : { ...value, phone })
  }

  function toggleSameAsPhone(checked: boolean) {
    if (checked) {
      setUnlocked(false)
      onChange({ ...value, whatsappCountryCode: value.phoneCountryCode, whatsapp: value.phone })
    } else {
      setUnlocked(true)
    }
  }

  function setWhatsappCountryCode(code: string | null) {
    onChange({ ...value, whatsappCountryCode: code ?? 'ID' })
  }

  function setWhatsapp(whatsapp: string) {
    onChange({ ...value, whatsapp })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nomor HP</Label>
        <div className="flex gap-2">
          <div className="w-36 shrink-0">
            <AutocompleteSelect
              options={COUNTRY_CODE_OPTIONS}
              value={value.phoneCountryCode}
              onChange={setPhoneCountryCode}
              placeholder="Kode negara"
            />
          </div>
          <Input type="tel" placeholder="8xx xxxx xxxx" className="flex-1"
            value={value.phone} onChange={e => setPhone(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Nomor WhatsApp</Label>
        <div className="flex gap-2">
          <div className="w-36 shrink-0">
            <AutocompleteSelect
              options={COUNTRY_CODE_OPTIONS}
              value={value.whatsappCountryCode}
              onChange={setWhatsappCountryCode}
              placeholder="Kode negara"
              disabled={sameAsPhone}
            />
          </div>
          <Input type="tel" placeholder="8xx xxxx xxxx" className="flex-1"
            value={value.whatsapp} onChange={e => setWhatsapp(e.target.value)}
            disabled={sameAsPhone} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={sameAsPhone} onChange={e => toggleSameAsPhone(e.target.checked)} />
          Sama dengan nomor HP
        </label>
      </div>

      {showEmail && (
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" placeholder="email@example.com"
            value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} />
        </div>
      )}
    </div>
  )
}
