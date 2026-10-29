'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Landmark } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MediaField } from '@/components/admin/media/MediaField'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

type TourismSite = { id: string; name: string; city: string | null; description: string | null; gmapsUrl: string | null; isActive: boolean }
type Form = { name: string; city: string; description: string; gmapsUrl: string; isActive: boolean }

export default function TourismSiteEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/tourism-sites`
  const e = useEditEntity<TourismSite>(`/api/v1/admin/products/tourism-sites/${id}`, list)
  const [form, setForm] = useState<Form | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)

  // Formulir diisi SEKALI dari data yang dimuat; simpan berikutnya hanya menggeser baseline.
  useEffect(() => {
    const s = e.item
    if (s && !form) {
      const f: Form = { name: s.name, city: s.city ?? 'makkah', description: s.description ?? '', gmapsUrl: s.gmapsUrl ?? '', isActive: s.isActive }
      setForm(f); markClean(f)
    }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Situs wisata tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const patch = (p: Partial<Form>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }

  return (
    <EditPage
      icon={Landmark} title={e.item?.name ?? 'Situs Wisata'} backHref={list} backLabel="Daftar Situs Wisata"
      active={form.isActive} onActiveChange={isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => { if (await e.save({ ...form, gmapsUrl: form.gmapsUrl || null })) markClean(form) }}
      saving={e.saving} canSubmit={!!form.name.trim()} error={e.error} notice={e.notice}
      remove={{
        confirmText: 'Hapus situs wisata ini? Bila sudah dipakai paket ziarah, ia hanya dinonaktifkan (bisa diaktifkan kembali).',
        onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } },
        deleting: e.deleting,
      }}
      media={<MediaField productType="tourism_site" productId={id} label="Foto Unggulan Situs" />}
      sidebar={
        <p className="m-0 rounded-2xl border border-admin-line bg-white p-4 text-[11px] text-admin-muted">
          Situs nonaktif tidak muncul di pilihan situs saat menyusun paket ziarah.
        </p>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Nama</p>
          <input className="admin-inp" value={form.name} onChange={ev => patch({ name: ev.target.value })} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kota</p>
          <ChoiceSelect ariaLabel="Kota" value={form.city} onChange={v => patch({ city: v })} clearable={false} options={[{ id: 'makkah', label: 'Makkah' }, { id: 'madinah', label: 'Madinah' }, { id: 'jeddah', label: 'Jeddah' }]} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Link Google Maps</p>
          <input className="admin-inp" value={form.gmapsUrl} onChange={ev => patch({ gmapsUrl: ev.target.value })} placeholder="https://maps.google.com/..." />
        </div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="tourismsite-description" title="Deskripsi situs wisata" value={form.description} onChange={description => patch({ description })} placeholder="Sejarah singkat, makna, dan hal yang perlu diketahui jamaah…" />
        </div>
      </div>
    </EditPage>
  )
}
