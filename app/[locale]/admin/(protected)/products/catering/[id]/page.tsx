'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { UtensilsCrossed } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { Badge } from '@/components/admin/ui/Badge'
import { Switch } from '@/components/admin/ui/Switch'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { MediaField } from '@/components/admin/media/MediaField'

type Catering = {
  id: string; name: string; boardType: string; menuStyle: string; description: string | null
  pricePerPersonRegular: number | string; pricePerPersonRamadan: number | string; pricePerPersonHajj: number | string; isActive: boolean
}

export default function EditCateringPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/catering`
  const e = useEditEntity<Catering>(`/api/v1/admin/products/catering/${id}`, list)
  const [form, setForm] = useState<{ name: string; boardType: string; menuStyle: string; description: string; pricePerPersonRegular: string; pricePerPersonRamadan: string; pricePerPersonHajj: string; isActive: boolean } | null>(null)

  useEffect(() => {
    const c = e.item
    if (c) setForm({ name: c.name, boardType: c.boardType, menuStyle: c.menuStyle, description: c.description ?? '', pricePerPersonRegular: String(Number(c.pricePerPersonRegular)), pricePerPersonRamadan: String(Number(c.pricePerPersonRamadan)), pricePerPersonHajj: String(Number(c.pricePerPersonHajj)), isActive: c.isActive })
  }, [e.item])

  if (e.missing) return <p className="text-sm text-admin-muted">Paket katering tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const set = (k: 'name' | 'boardType' | 'menuStyle' | 'pricePerPersonRegular' | 'pricePerPersonRamadan' | 'pricePerPersonHajj') => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { e.clearMessages(); setForm(p => p && ({ ...p, [k]: ev.target.value })) }

  return (
    <EditPage
      icon={UtensilsCrossed} title={e.item?.name ?? 'Paket Katering'} backHref={list} backLabel="Daftar Katering"
      headerAside={<Badge tone={e.item?.isActive ? 'ok' : 'neutral'}>{e.item?.isActive ? 'Aktif' : 'Nonaktif'}</Badge>}
      onSubmit={() => e.save({ ...form, pricePerPersonRegular: +form.pricePerPersonRegular, pricePerPersonRamadan: +form.pricePerPersonRamadan, pricePerPersonHajj: +form.pricePerPersonHajj })}
      saving={e.saving} canSubmit={!!form.name.trim()} error={e.error} notice={e.notice}
      top={<MediaField productType="catering" productId={id} label="Foto Unggulan Katering" />}
      remove={{ confirmText: 'Hapus paket katering ini? Bila sudah dipakai booking atau paket, ia hanya dinonaktifkan (bisa diaktifkan kembali).', onDelete: e.remove, deleting: e.deleting }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Paket</p><input className="admin-inp" value={form.name} onChange={set('name')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Board Type</p><select className="admin-select" value={form.boardType} onChange={set('boardType')}><option value="full_board">Full Board</option><option value="half_board">Half Board</option></select></div>
        <div><p className="mb-1 text-xs text-admin-muted">Menu</p><select className="admin-select" value={form.menuStyle} onChange={set('menuStyle')}><option value="asian">Asia</option><option value="arabic">Arab</option><option value="western">Barat</option></select></div>
        <div><p className="mb-1 text-xs text-admin-muted">Harga/org/hari Regular</p><input type="number" className="admin-inp" value={form.pricePerPersonRegular} onChange={set('pricePerPersonRegular')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Harga/org/hari Ramadan</p><input type="number" className="admin-inp" value={form.pricePerPersonRamadan} onChange={set('pricePerPersonRamadan')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Harga/org/hari Haji</p><input type="number" className="admin-inp" value={form.pricePerPersonHajj} onChange={set('pricePerPersonHajj')} /></div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id={`catering-edit-${id}`} title="Deskripsi paket katering" value={form.description} onChange={description => { e.clearMessages(); setForm(p => p && ({ ...p, description })) }} placeholder="Menu harian, jam makan, dan catatan khusus (alergi, porsi)…" />
        </div>
        <label className="flex items-center gap-2.5 md:col-span-2">
          <Switch checked={form.isActive} onChange={v => { e.clearMessages(); setForm(p => p && ({ ...p, isActive: v })) }} label="Aktif" />
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di katalog dan pilihan)</span>
        </label>
      </div>
    </EditPage>
  )
}
