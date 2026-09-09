'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, MapPin, Upload, Trash2 } from 'lucide-react'

type TourismSite = {
  id: string; name: string; city: string | null; description: string | null
  gmapsUrl: string | null; isActive: boolean; photoUrl: string | null
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

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadSite(siteId: string) {
    const r = await fetch(`/api/v1/admin/products/tourism-sites/${siteId}`)
    const j = await r.json()
    if (j.data) {
      const s: TourismSite = j.data
      setForm({
        name: s.name, city: s.city ?? 'makkah', description: s.description ?? '',
        gmapsUrl: s.gmapsUrl ?? '', isActive: s.isActive,
      })
      setPhotoUrl(s.photoUrl)
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

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true); setPhotoError('')
    const formData = new FormData()
    formData.append('file', file)
    const r = await fetch(`/api/v1/admin/products/tourism-sites/${id}/photo`, { method: 'POST', body: formData })
    const j = await r.json()
    setUploadingPhoto(false)
    if (!j.success) { setPhotoError(j.error ?? 'Gagal upload foto'); return }
    setPhotoUrl(j.data.url)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handlePhotoDelete() {
    setUploadingPhoto(true)
    await fetch(`/api/v1/admin/products/tourism-sites/${id}/photo`, { method: 'DELETE' })
    setPhotoUrl(null)
    setUploadingPhoto(false)
  }

  if (!loaded) return <div className="text-sm text-slate-400 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/tourism-sites`)}
          className="text-slate-400 hover:text-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Situs Wisata</h1>
      </div>

      <div className="admin-form-panel space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-lg bg-canvas border border-line overflow-hidden shrink-0 grid place-items-center">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Foto situs" className="h-full w-full object-cover" />
            ) : (
              <MapPin className="h-8 w-8 text-slate-300" />
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
                className="admin-btn-sm text-xs disabled:opacity-50 flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5" /> {uploadingPhoto ? 'Memproses...' : photoUrl ? 'Ganti Foto' : 'Upload Foto'}
              </button>
              {photoUrl && (
                <button type="button" onClick={handlePhotoDelete} disabled={uploadingPhoto}
                  className="admin-btn-ghost text-xs disabled:opacity-50 flex items-center gap-1.5 text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400">JPG/PNG/WebP, maks 5 MB</p>
            {photoError && <p className="text-[11px] text-rose-600">{photoError}</p>}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs text-slate-500 mb-1">Nama</p>
            <input className="admin-inp" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Kota</p>
            <select className="admin-select" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}>
              <option value="makkah">Makkah</option>
              <option value="madinah">Madinah</option>
              <option value="jeddah">Jeddah</option>
            </select>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Link Google Maps</p>
            <input className="admin-inp" value={form.gmapsUrl} onChange={e => setForm(f => ({ ...f, gmapsUrl: e.target.value }))} placeholder="https://maps.google.com/..." />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-slate-500 mb-1">Deskripsi</p>
            <textarea className="admin-inp" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-teal-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-ink">Aktif (tampil di pilihan situs paket)</span>
        </label>

        <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
