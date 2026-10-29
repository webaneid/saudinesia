'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

type Season = { id: string; name: string; startDate: string; endDate: string }

export default function EditSeasonPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/seasons`
  const e = useEditEntity<Season>(`/api/v1/admin/products/seasons/${id}`, list)
  const [form, setForm] = useState<{ name: string; startDate: string; endDate: string } | null>(null)

  useEffect(() => { if (e.item) setForm({ name: e.item.name, startDate: e.item.startDate.slice(0, 10), endDate: e.item.endDate.slice(0, 10) }) }, [e.item])

  if (e.missing) return <p className="text-sm text-admin-muted">Musim tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const set = (k: 'name' | 'startDate' | 'endDate') => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { e.clearMessages(); setForm(p => p && ({ ...p, [k]: ev.target.value })) }

  return (
    <EditPage
      icon={CalendarDays} title="Ubah Musim" backHref={list} backLabel="Daftar Musim"
      description="Tanggal di luar rentang Ramadan/Haji otomatis dianggap Regular."
      onSubmit={() => e.save(form)} saving={e.saving} canSubmit={!!form.startDate && !!form.endDate} error={e.error} notice={e.notice}
      remove={{ confirmText: 'Hapus musim ini secara permanen?', onDelete: e.remove, deleting: e.deleting }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div><p className="mb-1 text-xs text-admin-muted">Musim</p><ChoiceSelect ariaLabel="Musim" value={form.name} onChange={v => setForm(f => f && { ...f, name: v })} clearable={false} options={[{ id: 'ramadan', label: 'Ramadan' }, { id: 'hajj', label: 'Haji' }, { id: 'regular', label: 'Regular' }]} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Mulai</p><input type="date" className="admin-inp" value={form.startDate} onChange={set('startDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Selesai</p><input type="date" className="admin-inp" value={form.endDate} onChange={set('endDate')} /></div>
      </div>
    </EditPage>
  )
}
