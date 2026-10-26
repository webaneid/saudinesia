'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'

export default function NewVisaPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/visa', id => `/${locale}/admin/products/visa/${id}`, 'Produk visa gagal dibuat.')
  const [form, setForm] = useState({ name: '', country: 'Saudi Arabia', visaType: '', processDays: 14, description: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={KeyRound} title="Produk Visa Baru" backHref={`/${locale}/admin/products/visa`} backLabel="Daftar Produk Visa"
      description="Harga dan persyaratan dokumen diatur di halaman produk setelah dibuat — harga terhitung otomatis begitu komponen HPP diisi."
      onSubmit={() => submit({ ...form, processDays: +form.processDays, requirements: [] })} saving={saving} canSubmit={!!form.name.trim() && !!form.visaType.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-admin-muted">Nama Produk</p>
          <input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Visa Umroh Reguler 2026" />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Negara</p>
          <input className="admin-inp" value={form.country} onChange={set('country')} placeholder="Saudi Arabia" />
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Jenis Visa (teks bebas)</p>
          <input className="admin-inp" value={form.visaType} onChange={set('visaType')} placeholder="Umroh / Visitor / Bisnis…" list="visa-type-suggestions" />
          <datalist id="visa-type-suggestions">
            {['Umroh', 'Visitor', 'Bisnis', 'Kerja', 'Transit', 'Haji'].map(t => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Estimasi Proses (hari)</p>
          <input type="number" className="admin-inp" value={form.processDays} onChange={set('processDays')} />
        </div>
        <div className="md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi (opsional)</p>
          <textarea className="admin-inp" rows={3} value={form.description} onChange={set('description')} />
        </div>
      </div>
    </CreatePage>
  )
}
