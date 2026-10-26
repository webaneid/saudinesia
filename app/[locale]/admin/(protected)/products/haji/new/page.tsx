'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { HAJI_TYPES } from '@/lib/constants/haji'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

export default function NewHajiPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', hajiType: 'furoda', year: new Date().getFullYear() + 1, departureDate: '', returnDate: '', durationDays: 40, totalQuota: 50, description: '', includes: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setError(null); setForm(p => ({ ...p, [k]: e.target.value })) }

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/admin/products/haji', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, year: +form.year, durationDays: +form.durationDays, totalQuota: +form.totalQuota,
          includes: form.includes.split('\n').map(s => s.trim()).filter(Boolean),
          departureDate: form.departureDate || null, returnDate: form.returnDate || null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.id) { setError(json?.error ?? 'Produk haji gagal dibuat.'); return }
      router.push(`/${locale}/admin/products/haji/${json.data.id}`)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <CreatePage
      icon={Star} title="Produk Haji Baru" backHref={`/${locale}/admin/products/haji`} backLabel="Daftar Produk Haji"
      description="Harga dihitung otomatis dari Komponen Biaya (HPP + kurs + margin) — diisi di halaman produk setelah dibuat. Selama belum berharga, produk tidak dapat dipesan."
      onSubmit={save} saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Produk</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Haji Furoda 2027 - Paket Premium" /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Jenis Haji</p><select className="admin-select" value={form.hajiType} onChange={set('hajiType')}>{HAJI_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tahun</p><input type="number" className="admin-inp" value={form.year} onChange={set('year')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tanggal Berangkat</p><input type="date" className="admin-inp" value={form.departureDate} onChange={set('departureDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tanggal Kembali</p><input type="date" className="admin-inp" value={form.returnDate} onChange={set('returnDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Durasi (hari)</p><input type="number" className="admin-inp" value={form.durationDays} onChange={set('durationDays')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Kuota</p><input type="number" className="admin-inp" value={form.totalQuota} onChange={set('totalQuota')} /></div>
        <div className="min-w-0 md:col-span-2 lg:col-span-3">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="haji-new-description" title="Deskripsi paket haji" value={form.description} onChange={description => { setError(null); setForm(p => ({ ...p, description })) }} placeholder="Program perjalanan, fasilitas, syarat, dan catatan penting…" />
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <p className="mb-1 text-xs text-admin-muted">Yang Termasuk (satu baris per item)</p>
          <textarea className="admin-inp" rows={4} value={form.includes} onChange={set('includes')} placeholder={'Visa Haji\nAkomodasi Makkah\nTransportasi Armuzna'} />
        </div>
      </div>
    </CreatePage>
  )
}
