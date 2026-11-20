'use client'

import { useRouter } from 'next/navigation'
import { VendorForm } from './VendorForm'
import type { VendorCategoryOption } from './types'
import { adminHref } from '@/lib/admin/href'

/** Halaman "Vendor baru": setelah tersimpan, buka halaman detail vendor itu. */
export function VendorCreatePanel({ locale, categories }: { locale: string; categories: VendorCategoryOption[] }) {
  const router = useRouter()
  return (
    <div className="kartu p-5">
      <VendorForm
        categories={categories}
        onSaved={v => router.push(adminHref(locale, `/admin/system/vendors/${v.id}`))}
        onCancel={() => router.push(adminHref(locale, `/admin/system/vendors`))}
      />
    </div>
  )
}
