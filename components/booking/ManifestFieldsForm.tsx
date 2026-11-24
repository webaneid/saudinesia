'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CountryCodeSelect } from '@/components/shared/CountryCodeSelect'
import { AddressPicker } from '@/components/shared/AddressPicker'
import { toPickerAddress } from '@/lib/manifest/addressValue'
import { cn } from '@/lib/utils'

// Bentuk kolom katalog Data Jamaah (lib/pilgrim-data/catalog.ts, docs/arsitektur-data-jamaah.md) — dipakai render dinamis,
// bukan form hardcode per produk.
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
  /** Awalan id kolom (label tertaut ke isian) — beda per formulir bila beberapa formulir tampil di satu halaman. */
  idPrefix?: string
}

// Render generik berdasarkan katalog Data Jamaah (`pilgrim_fields`) — admin atur kolom apa saja
// tanpa perubahan kode (docs/arsitektur-data-jamaah.md §3.1). Field fieldType='phone' TIDAK
// memakai ContactPicker (itu widget majemuk khusus pasangan HP+WA dengan checkbox sinkron) —
// di sini tiap field phone berdiri sendiri dengan kode negara + nomor, sesuai render generik.
export function ManifestFieldsForm({ fields, values, onChange, errors, idPrefix = 'mf' }: Props) {
  function setValue(fieldKey: string, value: unknown) {
    onChange({ ...values, [fieldKey]: value })
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {[...fields].sort((a, b) => a.order - b.order).map(field => (
        <div key={field.id} className={cn('space-y-2', (field.fieldType === 'textarea' || field.fieldType === 'address') && 'md:col-span-2')}>
          <Label htmlFor={`${idPrefix}-${field.fieldKey}`}>
            {field.label} {field.required && <span className="text-destructive">*</span>}
          </Label>
          <ManifestFieldInput
            id={`${idPrefix}-${field.fieldKey}`}
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

function ManifestFieldInput({ id, field, value, onChange }: { id: string; field: ManifestField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.fieldType) {
    case 'select': {
      const options = Array.isArray(field.options) ? field.options as { value: string; label: string }[] : []
      return (
        <div id={id} role="radiogroup" className="flex gap-2">
          {options.map(o => (
            <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
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
      return <Input id={id} type="date" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'email':
      return <Input id={id} type="email" placeholder="email@example.com" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'textarea':
      return (
        <textarea id={id}
          className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
        />
      )
    case 'number':
      return <Input id={id} type="number" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
    case 'phone': {
      const v = (value as PhoneValue | undefined) ?? { countryCode: 'ID', number: '' }
      return (
        <div className="flex gap-2">
          <CountryCodeSelect value={v.countryCode} onChange={countryCode => onChange({ ...v, countryCode })} />
          <Input id={id} type="tel" placeholder="8xx xxxx xxxx" className="flex-1"
            value={v.number} onChange={e => onChange({ ...v, number: e.target.value })} />
        </div>
      )
    }
    case 'address':
      // Alamat berjenjang (D1, docs/arsitektur-jamaah.md §5.5): nilai = objek alamat; server memeriksa hierarki dan menurunkan teksnya.
      return <AddressPicker value={toPickerAddress(value)} onChange={onChange} />
    case 'text':
    default:
      return <Input id={id} type="text" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />
  }
}
