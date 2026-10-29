'use client'

import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { COUNTRIES } from '@/lib/constants/countries'
import { isoToFlagEmoji } from '@/lib/utils/flag'

// Satu-satunya definisi pilihan "kode negara telepon" (ContactPicker + kolom telepon manifest): kotak terpilih ringkas ("🇮🇩 +62"),
// daftar = bendera + nama negara + kode panggilan di kanan; bisa dicari dengan nama, "+62", "62", atau kode ISO.
// Indonesia ditaruh paling atas (pasar utama), sisanya urutan `COUNTRIES`.
const OPTIONS: AutocompleteOption[] = [...COUNTRIES].sort((a, b) => Number(b.code === 'ID') - Number(a.code === 'ID')).map(c => ({
  id: c.code,
  label: c.name,
  prefix: isoToFlagEmoji(c.code),
  hint: `+${c.dialCode}`,
  short: `+${c.dialCode}`,
  keywords: c.code,
}))

type Props = { value: string; onChange: (code: string) => void; disabled?: boolean }

export function CountryCodeSelect({ value, onChange, disabled }: Props) {
  return (
    <AutocompleteSelect
      options={OPTIONS} value={value} onChange={code => onChange(code ?? 'ID')} clearable={false}
      placeholder="Kode negara" searchPlaceholder="Cari negara atau kode…" disabled={disabled} className="w-32 shrink-0"
    />
  )
}
