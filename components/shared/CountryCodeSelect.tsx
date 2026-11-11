'use client'

import { useTranslations } from 'next-intl'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { COUNTRIES } from '@/lib/constants/countries'

// Satu-satunya definisi pilihan "kode negara telepon" (ContactPicker + kolom telepon manifest): kotak terpilih ringkas (bendera + "+62"),
// daftar = bendera + nama negara + kode panggilan di kanan; bisa dicari dengan nama, "+62", "62", atau kode ISO.
// Indonesia ditaruh paling atas (pasar utama), sisanya urutan `COUNTRIES`.
const OPTIONS: AutocompleteOption[] = [...COUNTRIES].sort((a, b) => Number(b.code === 'ID') - Number(a.code === 'ID')).map(c => ({
  id: c.code,
  label: c.name,
  flag: c.code,
  hint: `+${c.dialCode}`,
  short: `+${c.dialCode}`,
  keywords: c.code,
}))

type Props = { value: string; onChange: (code: string) => void; disabled?: boolean }

export function CountryCodeSelect({ value, onChange, disabled }: Props) {
  const t = useTranslations('shared.countryCode')
  return (
    <AutocompleteSelect
      options={OPTIONS} value={value} onChange={code => onChange(code ?? 'ID')} clearable={false}
      placeholder={t('placeholder')} searchPlaceholder={t('search')} disabled={disabled} className="w-32 shrink-0"
    />
  )
}
