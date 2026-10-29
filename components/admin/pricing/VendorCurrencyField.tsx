'use client'

import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import { CurrencySelect } from '@/components/shared/CurrencySelect'

type Props = {
  vendorId: string
  currency: string
  currencies: readonly string[]
  onVendorChange: (vendorId: string) => void
  onCurrencyChange: (currency: string) => void
}

/**
 * Kotak "Vendor & Mata Uang" editor HPP: pilih vendor (VendorPicker — satu-satunya pemilih vendor, termasuk pembuatan lewat modal) + mata uang.
 * Satu idiom visual untuk semua editor Komponen Biaya (docs/arsitektur-komponen-biaya.md §3.2).
 */
export function VendorCurrencyField({ vendorId, currency, currencies, onVendorChange, onCurrencyChange }: Props) {
  return (
    <div className="border border-admin-line rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-admin-ink">Vendor &amp; Mata Uang</p>
      <VendorPicker value={vendorId} onChange={onVendorChange} context="costComponent" label="Vendor komponen biaya" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-admin-muted">Mata uang</span>
        <CurrencySelect value={currency} onChange={onCurrencyChange} currencies={currencies} />
      </div>
    </div>
  )
}
