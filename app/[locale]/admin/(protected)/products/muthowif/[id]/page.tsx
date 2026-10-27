'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MediaField } from '@/components/admin/media/MediaField'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

type Muthowif = { id: string; name: string; bio: string | null; languages: string[]; dailyCapacity: number; isActive: boolean }
type Form = { name: string; bio: string; languages: string; dailyCapacity: string; isActive: boolean }

export default function MuthowifEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/muthowif`
  const e = useEditEntity<Muthowif>(`/api/v1/admin/products/muthowif/${id}`, list)
  const [form, setForm] = useState<Form | null>(null)
  const { dirty, markClean } = useDirtyForm(form)

  // Formulir diisi SEKALI dari data yang dimuat; simpan berikutnya hanya menggeser baseline.
  useEffect(() => {
    const m = e.item
    if (m && !form) {
      const f: Form = { name: m.name, bio: m.bio ?? '', languages: (m.languages ?? []).join(', '), dailyCapacity: String(m.dailyCapacity), isActive: m.isActive }
      setForm(f); markClean(f)
    }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Muthowif tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const patch = (p: Partial<Form>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }

  return (
    <EditPage
      icon={Users} title={e.item?.name ?? 'Muthowif'} backHref={list} backLabel="Daftar Muthowif"
      active={form.isActive} onActiveChange={isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => {
        const ok = await e.save({
          name: form.name, bio: form.bio || null,
          languages: form.languages.split(',').map(s => s.trim()).filter(Boolean),
          dailyCapacity: Number(form.dailyCapacity), isActive: form.isActive,
        })
        if (ok) markClean(form)
      }}
      saving={e.saving} canSubmit={!!form.name.trim() && Number(form.dailyCapacity) > 0} error={e.error} notice={e.notice}
      media={<MediaField productType="muthowif" productId={id} label="Foto Profil Muthowif" />}
      mediaTitle="Foto Profil"
      sidebar={
        <p className="m-0 rounded-2xl border border-admin-line bg-white p-4 text-[11px] text-admin-muted">
          Muthowif nonaktif tidak tampil di katalog dan tidak dihitung ke pool kuota harian (docs/arsitektur-muthowif.md §9.2).
        </p>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Nama</p>
          <input className="admin-inp" value={form.name} onChange={ev => patch({ name: ev.target.value })} />
        </div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Bio</p>
          <RichTextEditor id="muthowif-bio" title="Bio muthowif" value={form.bio} onChange={bio => patch({ bio })} placeholder="Latar belakang, pengalaman membimbing, bahasa, dan gaya bimbingan…" />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Bahasa (pisah koma)</p>
          <input className="admin-inp" value={form.languages} onChange={ev => patch({ languages: ev.target.value })} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kapasitas/hari</p>
          <input type="number" min={1} className="admin-inp" value={form.dailyCapacity} onChange={ev => patch({ dailyCapacity: ev.target.value })} />
        </div>
      </div>
    </EditPage>
  )
}
