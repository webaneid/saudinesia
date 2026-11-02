'use client'

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

const GENDER_OPTIONS = [{ id: 'male', label: 'Laki-laki' }, { id: 'female', label: 'Perempuan' }]

type Props = {
  value: SavedPilgrimFormValue
  onChange: (v: SavedPilgrimFormValue) => void
  /** "Saya sendiri" hanya relevan untuk pemilik akun (dan staf atas nama pelanggan). */
  showSelf?: boolean
}

export function SavedPilgrimFields({ value: v, onChange, showSelf = true }: Props) {
  const set = <K extends keyof SavedPilgrimFormValue>(k: K, x: SavedPilgrimFormValue[K]) => onChange({ ...v, [k]: x })
  const wni = v.nationality === 'ID'

  return (
    <div className="space-y-5">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Identitas</h2>
        <div className="space-y-2">
          <Label htmlFor="sp-name">Nama lengkap (sesuai paspor/KTP)</Label>
          <Input id="sp-name" value={v.fullName} onChange={e => set('fullName', e.target.value)} maxLength={120} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Jenis kelamin</Label>
            <ChoiceSelect options={GENDER_OPTIONS} value={v.gender} onChange={x => set('gender', x as SavedPilgrimFormValue['gender'])} placeholder="Pilih" ariaLabel="Jenis kelamin" />
          </div>
          <div className="space-y-2">
            <Label>Kewarganegaraan</Label>
            <ChoiceSelect options={COUNTRY_OPTIONS} value={v.nationality} onChange={x => set('nationality', x || 'ID')} clearable={false} ariaLabel="Kewarganegaraan" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-bplace">Tempat lahir</Label>
            <Input id="sp-bplace" value={v.birthPlace} onChange={e => set('birthPlace', e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-bdate">Tanggal lahir</Label>
            <Input id="sp-bdate" type="date" value={v.birthDate} onChange={e => set('birthDate', e.target.value)} required />
          </div>
        </div>

        {wni && (
          <div className="space-y-2">
            <Label htmlFor="sp-nik">NIK (16 digit)</Label>
            <Input id="sp-nik" inputMode="numeric" autoComplete="off" value={v.nik} maxLength={40}
              placeholder={v.hasNik && !v.clearNik ? `Tersimpan ${NIK_MASK} — kosongkan untuk tetap` : '16 digit sesuai KTP/KK'}
              onChange={e => onChange({ ...v, nik: e.target.value, clearNik: false })} />
            <p className="text-xs text-muted-foreground">Wajib untuk WNI, kecuali bayi di bawah 2 tahun. NIK disimpan terenkripsi dan tidak pernah ditampilkan kembali.</p>
            {v.hasNik && !v.nik && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={v.clearNik} onChange={e => set('clearNik', e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
                Hapus NIK tersimpan
              </label>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t pt-4">
        <h2 className="text-sm font-semibold">Paspor {wni ? '(opsional)' : '(wajib untuk warga negara lain)'}</h2>
        <div className="space-y-2">
          <Label htmlFor="sp-pass">Nomor paspor</Label>
          <Input id="sp-pass" autoComplete="off" value={v.passportNumber} maxLength={40}
            placeholder={v.passportMask && !v.clearPassport ? `Tersimpan ${v.passportMask} — kosongkan untuk tetap` : 'Contoh: C1234567'}
            onChange={e => onChange({ ...v, passportNumber: e.target.value, clearPassport: false })} />
          {v.passportMask && !v.passportNumber && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={v.clearPassport} onChange={e => set('clearPassport', e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
              Hapus data paspor
            </label>
          )}
        </div>
        {!v.clearPassport && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sp-pissued">Tanggal terbit</Label>
              <Input id="sp-pissued" type="date" value={v.passportIssuedAt} onChange={e => set('passportIssuedAt', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sp-pexp">Berlaku sampai</Label>
              <Input id="sp-pexp" type="date" value={v.passportExpiry} onChange={e => set('passportExpiry', e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 border-t pt-4">
        <h2 className="text-sm font-semibold">Kontak (opsional)</h2>
        <ContactPicker value={v.contact} onChange={c => set('contact', c)} showEmail={false} />
        <div className="space-y-2">
          <Label htmlFor="sp-email">Email</Label>
          <Input id="sp-email" type="email" value={v.email} onChange={e => set('email', e.target.value)} maxLength={254} />
        </div>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-semibold">Alamat (opsional)</h2>
        <AddressPicker value={v.address} onChange={a => set('address', a)} />
        {v.hadAddress && !v.address.fullAddress.trim() && <p className="text-xs text-muted-foreground">Alamat lengkap dikosongkan — alamat tersimpan akan dihapus saat disimpan.</p>}
      </section>

      {showSelf && (
        <label className="flex items-start gap-2 border-t pt-4 text-sm">
          <input type="checkbox" checked={v.isSelf} onChange={e => set('isSelf', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
          <span>Ini data saya sendiri (pemilik akun)</span>
        </label>
      )}
    </div>
  )
}
