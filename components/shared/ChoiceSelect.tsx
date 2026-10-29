'use client'

import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'

type Props = {
  options: AutocompleteOption[]
  /** Nilai terpilih; '' = belum memilih (bentuk yang sama dengan `<select>` polos, jadi state lama tak perlu diubah). */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  /** Boleh mengosongkan pilihan (bawaan: ya — `<select>` lama punya opsi "— pilih —"). */
  clearable?: boolean
  className?: string
}

/** Pengganti `<select>` polos untuk daftar data yang bertumbuh (docs/arsitektur-combobox.md §5, Fase 2): bentuk nilai string ('' = kosong), tampilan dan pencarian dari `AutocompleteSelect`. */
export function ChoiceSelect({ options, value, onChange, placeholder, ariaLabel, disabled, clearable = true, className }: Props) {
  return (
    <AutocompleteSelect
      options={options} value={value || null} onChange={id => onChange(id ?? '')}
      placeholder={placeholder} ariaLabel={ariaLabel} disabled={disabled} clearable={clearable} className={className}
    />
  )
}
