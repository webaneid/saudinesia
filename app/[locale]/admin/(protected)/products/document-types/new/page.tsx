'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { FileBadge } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { DocumentTypeFields } from '../DocumentTypeFields'
import { EMPTY_TYPE_FORM, bodyFromTypeForm, canSubmitType, type DocumentTypeForm } from '../documentTypeForm'

export default function NewDocumentTypePage() {
  const { locale } = useParams() as { locale: string }
  const list = `/${locale}/admin/products/document-types`
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/document-types', id => `${list}/${id}`, 'Jenis dokumen gagal dibuat.')
  const [form, setForm] = useState<DocumentTypeForm>(EMPTY_TYPE_FORM)
  return (
    <CreatePage
      icon={FileBadge} title="Jenis Dokumen Baru" backHref={list} backLabel="Daftar Jenis Dokumen"
      description="Dokumen tambahan yang bisa diminta dari jamaah. Syarat per produk diatur di editor produk."
      onSubmit={() => submit(bodyFromTypeForm(form, 'create'))} saving={saving} canSubmit={canSubmitType(form, 'create')} error={error} submitLabel="Simpan & Lanjut"
    >
      <DocumentTypeFields value={form} onChange={v => { clearError(); setForm(v) }} mode="create" />
    </CreatePage>
  )
}
