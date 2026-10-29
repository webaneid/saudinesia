'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { UtensilsCrossed } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

export default function NewCateringPage() {
  const { locale } = useParams() as { locale: string }
  // Katering belum punya halaman edit (gap tercatat di docs/arsitektur-admin-create.md §5) — setelah dibuat kembali ke daftar.
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/catering', () => `/${locale}/admin/products/catering`, 'Paket katering gagal dibuat.')
  const [form, setForm] = useState({ name: '', boardType: 'full_board', menuStyle: 'asian', description: '', pricePerPersonRegular: 150000, pricePerPersonRamadan: 200000, pricePerPersonHajj: 250000 })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={UtensilsCrossed} title="Paket Katering Baru" backHref={`/${locale}/admin/products/catering`} backLabel="Daftar Katering"
      onSubmit={() => submit({ ...form, pricePerPersonRegular: +form.pricePerPersonRegular, pricePerPersonRamadan: +form.pricePerPersonRamadan, pricePerPersonHajj: +form.pricePerPersonHajj })}
      saving={saving} canSubmit={!!form.name.trim()} error={error}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Paket</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Board Type</p>
          <ChoiceSelect ariaLabel="Board type" value={form.boardType} onChange={v => setForm(f => ({ ...f, boardType: v }))} clearable={false} options={[{ id: 'full_board', label: 'Full Board' }, { id: 'half_board', label: 'Half Board' }]} />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Menu</p>
          <ChoiceSelect ariaLabel="Menu" value={form.menuStyle} onChange={v => setForm(f => ({ ...f, menuStyle: v }))} clearable={false} options={[{ id: 'asian', label: 'Asia' }, { id: 'arabic', label: 'Arab' }, { id: 'western', label: 'Barat' }]} />
        </div>
        <div><p className="mb-1 text-xs text-admin-muted">Harga/org/hari Regular</p><input type="number" className="admin-inp" value={form.pricePerPersonRegular} onChange={set('pricePerPersonRegular')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Harga/org/hari Ramadan</p><input type="number" className="admin-inp" value={form.pricePerPersonRamadan} onChange={set('pricePerPersonRamadan')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Harga/org/hari Haji</p><input type="number" className="admin-inp" value={form.pricePerPersonHajj} onChange={set('pricePerPersonHajj')} /></div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="catering-new-description" title="Deskripsi paket katering" value={form.description} onChange={description => { clearError(); setForm(p => ({ ...p, description })) }} placeholder="Menu harian, jam makan, dan catatan khusus (alergi, porsi)…" />
        </div>
      </div>
    </CreatePage>
  )
}
