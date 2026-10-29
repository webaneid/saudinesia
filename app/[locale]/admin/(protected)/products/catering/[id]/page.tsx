'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { UtensilsCrossed } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { MediaField } from '@/components/admin/media/MediaField'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

type Catering = { id: string; name: string; boardType: string; menuStyle: string; description: string | null; isActive: boolean }

export default function EditCateringPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/catering`
  const e = useEditEntity<Catering>(`/api/v1/admin/products/catering/${id}`, list)
  type Form = { name: string; boardType: string; menuStyle: string; description: string; isActive: boolean }
  const [form, setForm] = useState<Form | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)

  // Formulir diisi SEKALI dari data yang dimuat; simpan berikutnya hanya menggeser baseline (tidak menimpa ketikan).
  useEffect(() => {
    const c = e.item
    if (c && !form) {
      const f: Form = { name: c.name, boardType: c.boardType, menuStyle: c.menuStyle, description: c.description ?? '', isActive: c.isActive }
      setForm(f); markClean(f)
    }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Paket katering tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const set = (k: 'name' | 'boardType' | 'menuStyle') => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { e.clearMessages(); setForm(p => p && ({ ...p, [k]: ev.target.value })) }

  return (
    <EditPage
      icon={UtensilsCrossed} title={e.item?.name ?? 'Paket Katering'} backHref={list} backLabel="Daftar Katering"
      active={form.isActive} onActiveChange={v => { e.clearMessages(); setForm(p => p && ({ ...p, isActive: v })) }} dirty={dirty}
      onSubmit={async () => { if (await e.save({ ...form })) markClean(form) }}
      saving={e.saving} canSubmit={!!form.name.trim()} error={e.error} notice={e.notice}
      media={<MediaField productType="catering" productId={id} label="Foto Unggulan Katering" />}
      after={<PriceCard ownerType="catering" ownerId={id} title="Harga per orang per hari (tiga musim): modal, jual, untung" />}
      remove={{ confirmText: 'Hapus paket katering ini? Bila sudah dipakai booking atau paket, ia hanya dinonaktifkan (bisa diaktifkan kembali).', onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } }, deleting: e.deleting }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Paket</p><input className="admin-inp" value={form.name} onChange={set('name')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Board Type</p><ChoiceSelect ariaLabel="Board type" value={form.boardType} onChange={v => setForm(f => f && { ...f, boardType: v })} clearable={false} options={[{ id: 'full_board', label: 'Full Board' }, { id: 'half_board', label: 'Half Board' }]} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Menu</p><ChoiceSelect ariaLabel="Menu" value={form.menuStyle} onChange={v => setForm(f => f && { ...f, menuStyle: v })} clearable={false} options={[{ id: 'asian', label: 'Asia' }, { id: 'arabic', label: 'Arab' }, { id: 'western', label: 'Barat' }]} /></div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id={`catering-edit-${id}`} title="Deskripsi paket katering" value={form.description} onChange={description => { e.clearMessages(); setForm(p => p && ({ ...p, description })) }} placeholder="Menu harian, jam makan, dan catatan khusus (alergi, porsi)…" />
        </div>
      </div>
    </EditPage>
  )
}
