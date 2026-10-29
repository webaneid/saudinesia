'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

export default function NewSeasonPage() {
  const { locale } = useParams() as { locale: string }
  // Musim tak punya halaman edit — setelah dibuat kembali ke daftar.
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/seasons', () => `/${locale}/admin/products/seasons`, 'Musim gagal dibuat.')
  const [form, setForm] = useState({ name: 'ramadan', startDate: '', endDate: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={CalendarDays} title="Musim Baru" backHref={`/${locale}/admin/products/seasons`} backLabel="Daftar Musim"
      description="Tanggal di luar rentang Ramadan/Haji otomatis dianggap Regular."
      onSubmit={() => submit(form)} saving={saving} canSubmit={!!form.startDate && !!form.endDate} error={error}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <p className="mb-1 text-xs text-admin-muted">Musim</p>
          <ChoiceSelect ariaLabel="Musim" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} clearable={false} options={[{ id: 'ramadan', label: 'Ramadan' }, { id: 'hajj', label: 'Haji' }, { id: 'regular', label: 'Regular' }]} />
        </div>
        <div><p className="mb-1 text-xs text-admin-muted">Mulai</p><input type="date" className="admin-inp" value={form.startDate} onChange={set('startDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Selesai</p><input type="date" className="admin-inp" value={form.endDate} onChange={set('endDate')} /></div>
      </div>
    </CreatePage>
  )
}
