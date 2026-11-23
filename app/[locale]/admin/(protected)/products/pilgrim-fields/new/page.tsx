'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { PilgrimFieldFields } from '@/components/admin/pilgrim-data/PilgrimFieldFields'
import { EMPTY_FIELD_FORM, bodyFromFieldForm, canSubmitField, type PilgrimFieldForm } from '@/components/admin/pilgrim-data/pilgrimFieldForm'
import { adminHref } from '@/lib/admin/href'

export default function NewPilgrimFieldPage() {
  const { locale } = useParams() as { locale: string }
  const list = adminHref(locale, `/admin/products/pilgrim-fields`)
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/pilgrim-fields', id => `${list}/${id}`, 'Kolom data jamaah gagal dibuat.')
  const [form, setForm] = useState<PilgrimFieldForm>(EMPTY_FIELD_FORM)
  return (
    <CreatePage
      icon={ClipboardList} title="Kolom Data Jamaah Baru" backHref={list} backLabel="Daftar Data Jamaah"
      description="Kolom tambahan milik jamaah (mis. golongan darah), tersimpan di kartu jamaah dan dipakai ulang di setiap booking."
      onSubmit={() => submit(bodyFromFieldForm(form, 'create'))} saving={saving} canSubmit={canSubmitField(form, 'create')} error={error} submitLabel="Simpan & Lanjut"
    >
      <PilgrimFieldFields value={form} onChange={v => { clearError(); setForm(v) }} mode="create" />
    </CreatePage>
  )
}
