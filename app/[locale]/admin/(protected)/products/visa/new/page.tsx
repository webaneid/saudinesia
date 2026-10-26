'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'

export default function NewVisaPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', country: 'Saudi Arabia', visaType: '', processDays: 14, description: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setError(null); setForm(p => ({ ...p, [k]: e.target.value })) }

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/admin/products/visa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, processDays: +form.processDays, requirements: [] }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.id) { setError(json?.error ?? 'Produk visa gagal dibuat.'); return }
      router.push(`/${locale}/admin/products/visa/${json.data.id}`)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <CreatePage
      icon={KeyRound} title="Produk Visa Baru" backHref={`/${locale}/admin/products/visa`} backLabel="Daftar Produk Visa"
      description="Harga dan persyaratan dokumen diatur di halaman produk setelah dibuat — harga terhitung otomatis begitu komponen HPP diisi."
      onSubmit={save} saving={saving} canSubmit={!!form.name.trim() && !!form.visaType.trim()} error={error} submitLabel="Simpan & Lanjut"
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
