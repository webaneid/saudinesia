'use client'

import { VendorPicker } from '@/components/admin/vendor/VendorPicker'

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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <VendorPicker value={vendorId} onChange={onVendorChange} context="costComponent" label="Vendor komponen biaya" />
        </div>
        <select aria-label="Mata uang" className="admin-inp w-20 shrink-0" value={currency} onChange={e => onCurrencyChange(e.target.value)}>
          {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  )
}
