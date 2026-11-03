'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { FileBadge } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { Badge } from '@/components/admin/ui/Badge'
import { DocumentTypeFields } from '../DocumentTypeFields'
import { bodyFromTypeForm, canSubmitType, formFromType, type DocumentTypeForm, type DocumentTypeRow } from '../documentTypeForm'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i // segmen URL dipakai membangun URL API (SEC-180)

export default function DocumentTypeEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/document-types`
  const e = useEditEntity<DocumentTypeRow>(`/api/v1/admin/products/document-types/${UUID.test(id) ? id : 'invalid'}`, list)
  const [form, setForm] = useState<DocumentTypeForm | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)

  useEffect(() => {
    if (e.item && !form) { const f = formFromType(e.item); setForm(f); markClean(f) }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Jenis dokumen tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form || !e.item) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>
  const isSystem = e.item.isSystem
  const patch = (p: Partial<DocumentTypeForm>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }

  return (
    <EditPage
      icon={FileBadge} title={e.item.label} backHref={list} backLabel="Daftar Jenis Dokumen"
      headerAside={isSystem ? <Badge tone="neutral">Bawaan</Badge> : undefined}
      active={form.isActive} onActiveChange={isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => { if (await e.save(bodyFromTypeForm(form, 'update', isSystem))) markClean(form) }}
      saving={e.saving} canSubmit={canSubmitType(form, 'update')} error={e.error} notice={e.notice}
      remove={{
        confirmText: isSystem
          ? 'Jenis bawaan tidak bisa dihapus — ia akan dinonaktifkan (tidak muncul di pilihan unggah) dan bisa diaktifkan kembali.'
          : 'Hapus jenis dokumen ini? Bila sudah dipakai berkas jamaah, ia hanya dinonaktifkan (bisa diaktifkan kembali).',
        onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } },
        deleting: e.deleting,
        label: isSystem ? 'Nonaktifkan' : undefined,
      }}
      sidebar={
        <p className="m-0 rounded-2xl border border-admin-line bg-white p-4 text-[11px] text-admin-muted">
          Dipakai {e.item._count?.documents ?? 0} berkas jamaah. Jenis nonaktif tidak muncul di pilihan unggah; berkas yang sudah ada tetap tersimpan.
        </p>
      }
    >
      <DocumentTypeFields value={form} onChange={v => { e.clearMessages(); setForm(v) }} mode="update" isSystem={isSystem} />
    </EditPage>
  )
}
