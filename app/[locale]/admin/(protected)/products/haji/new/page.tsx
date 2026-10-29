'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Star } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { HAJI_TYPES } from '@/lib/constants/haji'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

export default function NewHajiPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/haji', id => `/${locale}/admin/products/haji/${id}`, 'Produk haji gagal dibuat.')
  const [form, setForm] = useState({ name: '', hajiType: 'furoda', year: new Date().getFullYear() + 1, departureDate: '', returnDate: '', durationDays: 40, totalQuota: 50, description: '', includes: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={Star} title="Produk Haji Baru" backHref={`/${locale}/admin/products/haji`} backLabel="Daftar Produk Haji"
      description="Harga dihitung otomatis dari Komponen Biaya (HPP + kurs + margin) — diisi di halaman produk setelah dibuat. Selama belum berharga, produk tidak dapat dipesan."
      onSubmit={() => submit({
        ...form, year: +form.year, durationDays: +form.durationDays, totalQuota: +form.totalQuota,
        includes: form.includes.split('\n').map(s => s.trim()).filter(Boolean),
        departureDate: form.departureDate || null, returnDate: form.returnDate || null,
      })} saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Produk</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Haji Furoda 2027 - Paket Premium" /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Jenis Haji</p><ChoiceSelect ariaLabel="Jenis haji" value={form.hajiType} onChange={v => setForm(f => ({ ...f, hajiType: v }))} clearable={false} options={HAJI_TYPES.map(t => ({ id: t.value, label: t.label }))} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tahun</p><input type="number" className="admin-inp" value={form.year} onChange={set('year')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tanggal Berangkat</p><input type="date" className="admin-inp" value={form.departureDate} onChange={set('departureDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tanggal Kembali</p><input type="date" className="admin-inp" value={form.returnDate} onChange={set('returnDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Durasi (hari)</p><input type="number" className="admin-inp" value={form.durationDays} onChange={set('durationDays')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Kuota</p><input type="number" className="admin-inp" value={form.totalQuota} onChange={set('totalQuota')} /></div>
        <div className="min-w-0 md:col-span-2 lg:col-span-3">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="haji-new-description" title="Deskripsi paket haji" value={form.description} onChange={description => { clearError(); setForm(p => ({ ...p, description })) }} placeholder="Program perjalanan, fasilitas, syarat, dan catatan penting…" />
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <p className="mb-1 text-xs text-admin-muted">Yang Termasuk (satu baris per item)</p>
          <textarea className="admin-inp" rows={4} value={form.includes} onChange={set('includes')} placeholder={'Visa Haji\nAkomodasi Makkah\nTransportasi Armuzna'} />
        </div>
      </div>
    </CreatePage>
  )
}
