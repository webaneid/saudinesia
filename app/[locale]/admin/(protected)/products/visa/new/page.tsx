'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { adminHref } from '@/lib/admin/href'
import { EMPTY_VISA_INFO, VisaInfoFields, visaInfoBody, visaInfoValid, type VisaInfo } from '../VisaInfoFields'

export default function NewVisaPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/visa', id => adminHref(locale, `/admin/products/visa/${id}`), 'Produk visa gagal dibuat.')
  const [form, setForm] = useState<VisaInfo>(EMPTY_VISA_INFO)

  return (
    <CreatePage
      icon={KeyRound} title="Produk Visa Baru" backHref={adminHref(locale, `/admin/products/visa`)} backLabel="Daftar Produk Visa"
      description="Harga per rentang hari, persyaratan dokumen, dan model penjualan diatur di halaman produk setelah dibuat. Selama belum berharga, produk tidak dapat dipesan."
      onSubmit={() => submit(visaInfoBody(form))} saving={saving} canSubmit={visaInfoValid(form)} error={error} submitLabel="Simpan & Lanjut"
    >
      <VisaInfoFields value={form} onChange={p => { clearError(); setForm(f => ({ ...f, ...p })) }} idPrefix="visa-new" autoFocus />
    </CreatePage>
  )
}
