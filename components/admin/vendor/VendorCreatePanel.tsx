'use client'

import { useRouter } from 'next/navigation'
import { VendorForm } from './VendorForm'
import type { VendorCategoryOption } from './types'

/** Halaman "Vendor baru": setelah tersimpan, buka halaman detail vendor itu. */
export function VendorCreatePanel({ locale, categories }: { locale: string; categories: VendorCategoryOption[] }) {
  const router = useRouter()
  return (
    <div className="kartu p-5">
      <VendorForm
        categories={categories}
        onSaved={v => router.push(`/${locale}/admin/system/vendors/${v.id}`)}
        onCancel={() => router.push(`/${locale}/admin/system/vendors`)}
      />
    </div>
  )
}
