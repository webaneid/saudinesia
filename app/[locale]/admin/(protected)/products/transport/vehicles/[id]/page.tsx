'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react'
import { ProductMediaGallery } from '@/components/admin/media/ProductMediaGallery'

const TYPES = ['bus', 'coaster', 'hiace', 'staria', 'gmc', 'innova', 'sedan']

type Vehicle = {
  id: string; name: string; vehicleType: string; capacity: number
  fleetCount: number; description: string | null; isActive: boolean
}

type Props = { params: Promise<{ locale: string; id: string }> }

export default function VehicleEditPage({ params }: Props) {
  const router = useRouter()
  const [id, setId]         = useState('')
  const [locale, setLocale] = useState('id')
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [form, setForm] = useState({
    name: '', vehicleType: 'bus', capacity: 49, description: '', fleetCount: 1, isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      const r = await fetch(`/api/v1/admin/products/transport/vehicles/${p.id}`)
      const j = await r.json()
      if (j.data) {
        const v: Vehicle = j.data
        setVehicle(v)
        setForm({
          name: v.name, vehicleType: v.vehicleType, capacity: v.capacity,
          description: v.description ?? '', fleetCount: v.fleetCount, isActive: v.isActive,
        })
      }
    })
  }, [params])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/products/transport/vehicles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, capacity: +form.capacity, fleetCount: +form.fleetCount }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Perubahan gagal disimpan.'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  // Hapus-aman: server menghapus bila belum dipakai harga trip mana pun, selain itu menonaktifkan dan memberi pesan (lib/admin/safeDelete.ts).
  async function handleDelete() {
    setDeleting(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/products/transport/vehicles/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Gagal menghapus kendaraan.'); return }
      if (json.data.deleted) { router.push(`/${locale}/admin/products/transport`); return }
      setNotice(json.data.message)
      setForm(p => ({ ...p, isActive: false }))
      setConfirming(false)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setDeleting(false)
    }
  }

  if (!vehicle) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/transport`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Kendaraan</h1>
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-admin-danger">{error}</p>}
      {notice && <p role="status" className="text-[13px] font-medium text-admin-ink">{notice}</p>}

      <ProductMediaGallery
        hotelId={id}
        apiBase={`/api/v1/admin/products/transport/vehicles/${id}/images`}
        label="Foto Kendaraan"
      />

      <div className="admin-form-panel space-y-4">
        <p className="text-sm font-semibold text-admin-ink">Informasi Kendaraan</p>
        <p className="text-[11px] text-admin-muted/70">
          Harga diatur di halaman <strong>Trip</strong> — setiap trip punya harga berbeda per kendaraan.
        </p>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-admin-muted mb-1">Nama Kendaraan</p>
            <input className="admin-inp" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Tipe</p>
            <select className="admin-select" value={form.vehicleType} onChange={set('vehicleType')}>
              {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kapasitas (orang)</p>
            <input type="number" min={1} className="admin-inp" value={form.capacity} onChange={set('capacity')} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Jumlah Armada (unit)</p>
            <input type="number" min={1} className="admin-inp" value={form.fleetCount} onChange={set('fleetCount')} />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Deskripsi (opsional)</p>
            <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit pt-1">
          <div
            onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di catalog)</span>
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </div>
      </div>

      <section aria-label="Hapus" className="space-y-2 rounded-2xl border border-admin-danger/30 p-4">
        <h2 className="m-0 text-sm font-bold text-admin-danger">Hapus</h2>
        {confirming ? (
          <div className="space-y-2">
            <p className="m-0 text-sm text-admin-ink">Hapus kendaraan ini? Bila sudah dipakai harga trip, ia hanya dinonaktifkan (bisa diaktifkan kembali).</p>
            <div className="flex gap-2">
              <button type="button" disabled={deleting} onClick={handleDelete} className="admin-btn bg-admin-danger hover:opacity-90 disabled:opacity-50">{deleting && <Loader2 className="size-4 animate-spin" />} Ya, hapus</button>
              <button type="button" disabled={deleting} onClick={() => setConfirming(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="admin-btn-sm flex items-center gap-1.5 border border-admin-danger/40 bg-white text-admin-danger hover:bg-admin-danger/10"><Trash2 className="size-3.5" /> Hapus</button>
        )}
      </section>
    </div>
  )
}
