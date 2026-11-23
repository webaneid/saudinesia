'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { Badge } from '@/components/admin/ui/Badge'
import { PilgrimFieldFields } from '@/components/admin/pilgrim-data/PilgrimFieldFields'
import { bodyFromFieldForm, canSubmitField, formFromField, type PilgrimFieldForm, type PilgrimFieldRow } from '@/components/admin/pilgrim-data/pilgrimFieldForm'
import { adminHref } from '@/lib/admin/href'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i // segmen URL dipakai membangun URL API (SEC-180)

export default function PilgrimFieldEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = adminHref(locale, `/admin/products/pilgrim-fields`)
  const e = useEditEntity<PilgrimFieldRow>(`/api/v1/admin/products/pilgrim-fields/${UUID.test(id) ? id : 'invalid'}`, list)
  const [form, setForm] = useState<PilgrimFieldForm | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)

  useEffect(() => {
    if (e.item && !form) { const f = formFromField(e.item); setForm(f); markClean(f) }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Kolom data jamaah tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form || !e.item) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>
  const { isSystem, role } = e.item
  const isName = role === 'display_name'
  const used = (e.item.usage?.bookingPilgrims ?? 0) + (e.item.usage?.cards ?? 0)
  const patch = (p: Partial<PilgrimFieldForm>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }

  return (
    <EditPage
      icon={ClipboardList} title={e.item.label} backHref={list} backLabel="Daftar Data Jamaah"
      headerAside={isSystem ? <Badge tone="neutral">Bawaan</Badge> : undefined}
      active={form.isActive} onActiveChange={isName ? undefined : isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => { if (await e.save(bodyFromFieldForm(form, 'update', isSystem))) markClean(form) }}
      saving={e.saving} canSubmit={canSubmitField(form, 'update', isSystem)} error={e.error} notice={e.notice}
      remove={isName ? undefined : {
        confirmText: isSystem
          ? 'Kolom bawaan tidak bisa dihapus — ia akan dinonaktifkan (tidak diminta dari jamaah) dan bisa diaktifkan kembali.'
          : 'Hapus kolom ini? Bila sudah berisi data jamaah, ia hanya dinonaktifkan (data tetap tersimpan, bisa diaktifkan kembali).',
        onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } },
        deleting: e.deleting,
        label: isSystem ? 'Nonaktifkan' : undefined,
      }}
      sidebar={
        <p className="m-0 rounded-2xl border border-admin-line bg-white p-4 text-[11px] text-admin-muted">
          Berisi data di {e.item.usage?.bookingPilgrims ?? 0} jamaah booking dan {e.item.usage?.cards ?? 0} kartu jamaah.
          {isName ? ' Nama Lengkap selalu aktif dan wajib.' : ' Kolom nonaktif tidak diminta lagi; data yang sudah ada tetap tersimpan dan tampil.'}
        </p>
      }
    >
      <PilgrimFieldFields value={form} onChange={v => { e.clearMessages(); setForm(v) }} mode="update" isSystem={isSystem} alwaysRequired={isName} typeLocked={used > 0} />
    </EditPage>
  )
}
