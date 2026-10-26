'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Package } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

export default function NewPackagePage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/admin/products/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.id) { setError(json?.error ?? 'Paket gagal dibuat.'); return }
      router.push(`/${locale}/admin/products/packages/${json.data.id}`)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <CreatePage
      icon={Package} title="Paket Umroh Baru" backHref={`/${locale}/admin/products/packages`} backLabel="Daftar Paket Umroh"
      description="Isi info dasar dulu — hotel, kendaraan, muthowif, visa, tiket pesawat, katering, dan komponen biaya dikonfigurasi di halaman paket setelah dibuat."
      onSubmit={save} saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3">
        <div><p className="mb-1 text-xs text-admin-muted">Nama Paket</p><input className="admin-inp" autoFocus value={form.name} onChange={e => { setError(null); setForm(p => ({ ...p, name: e.target.value })) }} placeholder="Paket Umroh Hemat 9 Hari" /></div>
        <div className="min-w-0"><p className="mb-1 text-xs text-admin-muted">Deskripsi</p><RichTextEditor id="package-new-description" title="Deskripsi paket umroh" value={form.description} onChange={description => { setError(null); setForm(p => ({ ...p, description })) }} placeholder="Ringkasan paket, program, dan keunggulan…" /></div>
      </div>
    </CreatePage>
  )
}
