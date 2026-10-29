'use client'

import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

const NAMES: Record<string, string> = { IDR: 'Rupiah', SAR: 'Riyal Saudi', USD: 'Dolar AS', EUR: 'Euro' }

type Props = {
  value: string
  onChange: (currency: string) => void
  /** Urutan mata uang yang ditawarkan (tiap modul punya urutan bawaan sendiri). */
  currencies?: readonly string[]
  className?: string
}

/** Satu pemilih mata uang untuk semua editor harga/biaya: kotak ringkas (kode) + daftar kode · nama. Tak bisa dikosongkan. */
export function CurrencySelect({ value, onChange, currencies = ['IDR', 'SAR', 'USD', 'EUR'], className = 'w-28 shrink-0' }: Props) {
  return (
    <ChoiceSelect
      ariaLabel="Mata uang" value={value} onChange={onChange} clearable={false} className={className}
      options={currencies.map(c => ({ id: c, label: c, hint: NAMES[c] }))}
    />
  )
}
