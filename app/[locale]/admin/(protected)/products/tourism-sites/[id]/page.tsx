'use client'

import { MediaField } from '@/components/admin/media/MediaField'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

type TourismSite = {
  id: string; name: string; city: string | null; description: string | null
  gmapsUrl: string | null; isActive: boolean
}

type Props = { params: Promise<{ locale: string; id: string }> }

export default function TourismSiteEditPage({ params }: Props) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [locale, setLocale] = useState('id')
  const [form, setForm] = useState({ name: '', city: 'makkah', description: '', gmapsUrl: '', isActive: true })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)


  async function loadSite(siteId: string) {
    const r = await fetch(`/api/v1/admin/products/tourism-sites/${siteId}`)
    const j = await r.json()
    if (j.data) {
      const s: TourismSite = j.data
      setForm({
        name: s.name, city: s.city ?? 'makkah', description: s.description ?? '',
        gmapsUrl: s.gmapsUrl ?? '', isActive: s.isActive,
      })
    }
  }

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      await loadSite(p.id)
      setLoaded(true)
    })
  }, [params])

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/tourism-sites/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, gmapsUrl: form.gmapsUrl || null }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!loaded) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/tourism-sites`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Situs Wisata</h1>
      </div>

      <div className="admin-form-panel space-y-4">
        <MediaField productType="tourism_site" productId={id} label="Foto Unggulan Situs" />

        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Nama</p>
            <input className="admin-inp" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kota</p>
            <select className="admin-select" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}>
              <option value="makkah">Makkah</option>
              <option value="madinah">Madinah</option>
              <option value="jeddah">Jeddah</option>
            </select>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Link Google Maps</p>
            <input className="admin-inp" value={form.gmapsUrl} onChange={e => setForm(f => ({ ...f, gmapsUrl: e.target.value }))} placeholder="https://maps.google.com/..." />
          </div>
          <div className="md:col-span-2 min-w-0">
            <p className="text-xs text-admin-muted mb-1">Deskripsi</p>
            <RichTextEditor id="tourismsite-description" title="Deskripsi situs wisata" value={form.description} onChange={description => setForm(f => ({ ...f, description }))} placeholder="Sejarah singkat, makna, dan hal yang perlu diketahui jamaah…" />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di pilihan situs paket)</span>
        </label>

        <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
