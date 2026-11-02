'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { EMPTY_PILGRIM_FORM, bodyFromForm, canSubmitPilgrim, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i // segmen URL dipakai membangun URL API — jangan biarkan '../' atau '?' lewat

// Tambah jamaah tersimpan atas nama pelanggan (docs/arsitektur-jamaah.md §9; tercatat createdById = staf). Respons tanpa orakel, sama dengan jamaah.
export default function NewCustomerPilgrimPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const valid = UUID.test(id)
  const customerHref = `/${locale}/admin/customers/${valid ? id : ''}`
  const [form, setForm] = useState<SavedPilgrimFormValue>(EMPTY_PILGRIM_FORM)
  const c = useCreateEntity(`/api/v1/admin/customers/${valid ? id : 'invalid'}/pilgrims`, cardId => `${customerHref}/pilgrims/${cardId}`, 'Data jamaah gagal disimpan.')

  return (
    <CreatePage
      title="Tambah Jamaah" description="Data jamaah tersimpan milik pelanggan ini — hanya pelanggan dan staf yang melihatnya." icon={UserPlus}
      backHref={customerHref} backLabel="Detail pelanggan"
      onSubmit={() => c.submit(bodyFromForm(form))} saving={c.saving} canSubmit={canSubmitPilgrim(form)} error={c.error}
    >
      <SavedPilgrimFields value={form} onChange={v => { c.clearError(); setForm(v) }} />
    </CreatePage>
  )
}
