'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CountryCodeSelect } from '@/components/shared/CountryCodeSelect'
import { cn } from '@/lib/utils'

// Bentuk field seperti dikembalikan getManifestFieldRequirements() (docs/arsitektur-manifest.md
// §4) — dipakai render dinamis, bukan form hardcode per produk.
export type ManifestField = {
  id: string
  fieldKey: string
  label: string
  fieldType: string // 'text' | 'textarea' | 'phone' | 'email' | 'date' | 'select' | 'number' | 'address'
  options: unknown
  required: boolean
  role: string | null
  order: number
}

export type PhoneValue = { countryCode: string; number: string }

type Props = {
  fields: ManifestField[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  errors?: Record<string, string>
}

// Render generik berdasarkan konfigurasi ManifestFieldRequirement — admin atur field apa saja
// tanpa perubahan kode (docs/arsitektur-manifest.md §1/§5). Field fieldType='phone' TIDAK
// memakai ContactPicker (itu widget majemuk khusus pasangan HP+WA dengan checkbox sinkron) —
// di sini tiap field phone berdiri sendiri dengan kode negara + nomor, sesuai render generik.
export function ManifestFieldsForm({ fields, values, onChange, errors }: Props) {
  function setValue(fieldKey: string, value: unknown) {
    onChange({ ...values, [fieldKey]: value })
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {[...fields].sort((a, b) => a.order - b.order).map(field => (
        <div key={field.id} className={cn('space-y-2', field.fieldType === 'textarea' && 'md:col-span-2')}>
          <Label>
            {field.label} {field.required && <span className="text-destructive">*</span>}
          </Label>
          <ManifestFieldInput
            field={field}
            value={values[field.fieldKey]}
            onChange={v => setValue(field.fieldKey, v)}
          />
          {errors?.[field.fieldKey] && <p className="text-xs text-destructive">{errors[field.fieldKey]}</p>}
        </div>
      ))}
    </div>
  )
}

function ManifestFieldInput({ field, value, onChange }: { field: ManifestField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.fieldType) {
    case 'select': {
      const options = Array.isArray(field.options) ? field.options as { value: string; label: string }[] : []
      return (
        <div className="flex gap-2">
          {options.map(o => (
            <button key={o.value} type="button"
              onClick={() => onChange(o.value)}
              className={cn('flex-1 rounded-md border py-2 text-sm transition-colors',
                value === o.value ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-accent')}>
              {o.label}
            </button>
          ))}
        </div>
      )
    }
    case 'date':
      return <Input type="date" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'email':
      return <Input type="email" placeholder="email@example.com" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'textarea':
      return (
        <textarea
          className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
        />
      )
    case 'number':
      return <Input type="number" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'phone': {
      const v = (value as PhoneValue | undefined) ?? { countryCode: 'ID', number: '' }
      return (
        <div className="flex gap-2">
          <CountryCodeSelect value={v.countryCode} onChange={countryCode => onChange({ ...v, countryCode })} />
          <Input type="tel" placeholder="8xx xxxx xxxx" className="flex-1"
            value={v.number} onChange={e => onChange({ ...v, number: e.target.value })} />
        </div>
      )
    }
    case 'address':
      // Belum diwire — docs/arsitektur-alamat.md sengaja belum menyentuh BookingPilgrim.
      // Fallback teks bebas kalau admin sempat mengatur fieldType='address' sebelum itu terjadi.
      return <Input type="text" placeholder="Alamat lengkap" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'text':
    default:
      return <Input type="text" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
  }
}
