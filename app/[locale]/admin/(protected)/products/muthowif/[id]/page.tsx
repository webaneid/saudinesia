'use client'

import { MediaField } from '@/components/admin/media/MediaField'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

type Muthowif = {
  id: string; name: string; bio: string | null; languages: string[]
  dailyCapacity: number; isActive: boolean
}

type Props = { params: Promise<{ locale: string; id: string }> }

export default function MuthowifEditPage({ params }: Props) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [locale, setLocale] = useState('id')
  const [form, setForm] = useState({ name: '', bio: '', languages: '', dailyCapacity: 40, isActive: true })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)


  async function loadMuthowif(muthowifId: string) {
    const r = await fetch(`/api/v1/admin/products/muthowif/${muthowifId}`)
    const j = await r.json()
    if (j.data) {
      const m: Muthowif = j.data
      setForm({
        name: m.name, bio: m.bio ?? '',
        languages: (m.languages as unknown as string[]).join(', '),
        dailyCapacity: m.dailyCapacity, isActive: m.isActive,
      })
    }
  }

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      await loadMuthowif(p.id)
      setLoaded(true)
    })
  }, [params])

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/muthowif/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name, bio: form.bio || null,
        languages: form.languages.split(',').map(s => s.trim()).filter(Boolean),
        dailyCapacity: +form.dailyCapacity, isActive: form.isActive,
      }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!loaded) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/muthowif`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Muthowif</h1>
      </div>

      <div className="admin-form-panel space-y-4">
        <MediaField productType="muthowif" productId={id} label="Foto Profil Muthowif" />

        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Nama</p>
            <input className="admin-inp" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="md:col-span-2 min-w-0">
            <p className="text-xs text-admin-muted mb-1">Bio</p>
            <RichTextEditor id="muthowif-bio" title="Bio muthowif" value={form.bio} onChange={bio => setForm(f => ({ ...f, bio }))} placeholder="Latar belakang, pengalaman membimbing, bahasa, dan gaya bimbingan…" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Bahasa (pisah koma)</p>
            <input className="admin-inp" value={form.languages} onChange={e => setForm(f => ({ ...f, languages: e.target.value }))} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kapasitas/hari</p>
            <input type="number" className="admin-inp" value={form.dailyCapacity} onChange={e => setForm(f => ({ ...f, dailyCapacity: +e.target.value }))} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di katalog & tersedia untuk assignment)</span>
        </label>
        <p className="text-[11px] text-admin-muted/70">
          Kapasitas muthowif nonaktif tidak dihitung ke pool kuota harian (docs/arsitektur-muthowif.md §9.2).
        </p>

        <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
