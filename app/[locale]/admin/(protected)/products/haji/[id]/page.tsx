'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Star, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { Badge } from '@/components/admin/ui/Badge'
import { HAJI_TYPES } from '@/lib/constants/haji'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { CostComponentsPanel } from '@/components/admin/pricing/CostComponentsPanel'
import { MediaField } from '@/components/admin/media/MediaField'

type HajiDetail = {
  id: string; name: string; description: string | null; hajiType: string; year: number
  departureDate: string | null; returnDate: string | null; durationDays: number | null
  includes: string[]; price: number; totalQuota: number; pendingQuota: number; bookedQuota: number
  isActive: boolean; bookingCount: number
}
type Form = { name: string; description: string; hajiType: string; year: string; departureDate: string; returnDate: string; durationDays: string; includes: string; totalQuota: string; isActive: boolean }

const toForm = (h: HajiDetail): Form => ({
  name: h.name, description: h.description ?? '', hajiType: h.hajiType, year: String(h.year),
  departureDate: h.departureDate?.slice(0, 10) ?? '', returnDate: h.returnDate?.slice(0, 10) ?? '',
  durationDays: h.durationDays != null ? String(h.durationDays) : '', includes: h.includes.join('\n'),
  totalQuota: String(h.totalQuota), isActive: h.isActive,
})

type Props = { params: Promise<{ locale: string; id: string }> }

export default function HajiEditPage({ params }: Props) {
  const router = useRouter()
  const [locale, setLocale] = useState('id')
  const [id, setId] = useState('')
  const [haji, setHaji] = useState<HajiDetail | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (hajiId: string, resetForm = true) => {
    const r = await fetch(`/api/v1/admin/products/haji/${hajiId}`)
    if (r.status === 404) { setMissing(true); return }
    const j = await r.json().catch(() => null)
    if (!j?.data) return
    setHaji(j.data); if (resetForm) setForm(toForm(j.data))
  }, [])

  useEffect(() => { params.then(p => { setId(p.id); setLocale(p.locale); load(p.id) }) }, [params, load])

  async function handleSave() {
    if (!form) return
    setSaving(true); setSaved(false); setError(null); setNotice(null)
    const r = await fetch(`/api/v1/admin/products/haji/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name, description: form.description, hajiType: form.hajiType, year: Number(form.year),
        departureDate: form.departureDate || null, returnDate: form.returnDate || null,
        durationDays: form.durationDays ? Number(form.durationDays) : null,
        includes: form.includes.split('\n').map(s => s.trim()).filter(Boolean),
        totalQuota: Number(form.totalQuota), isActive: form.isActive,
      }),
    })
    if (!r.ok) {
      const j: { error?: string } | null = await r.json().catch(() => null)
      setError(j?.error ?? 'Perubahan gagal disimpan.')
    } else {
      setSaved(true)
      await load(id)
    }
    setSaving(false)
  }

  // Hapus aman (docs/arsitektur-komponen-biaya.md §3.3): server menghapus sungguhan bila belum pernah dipesan, selain itu menonaktifkan.
  async function handleDelete() {
    if (!haji) return
    const hasBookings = haji.bookingCount > 0
    const question = hasBookings
      ? `Produk "${haji.name}" sudah punya ${haji.bookingCount} booking sehingga tidak bisa dihapus. Nonaktifkan produk ini (hilang dari katalog, data booking tetap aman)?`
      : `Hapus produk "${haji.name}" beserta komponen biayanya secara permanen? Tindakan ini tidak bisa dibatalkan.`
    if (!confirm(question)) return
    setDeleting(true); setError(null); setNotice(null)
    const r = await fetch(`/api/v1/admin/products/haji/${id}`, { method: 'DELETE' })
    const j: { data?: { deleted?: boolean; message?: string }; error?: string } | null = await r.json().catch(() => null)
    setDeleting(false)
    if (!r.ok) { setError(j?.error ?? 'Produk gagal dihapus.'); return }
    if (j?.data?.deleted) { router.push(`/${locale}/admin/products/haji`); return }
    setNotice(j?.data?.message ?? 'Produk dinonaktifkan.')
    await load(id)
  }

  if (missing) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-admin-muted">Produk haji tidak ditemukan — mungkin sudah dihapus.</p>
        <button onClick={() => router.push(`/${locale}/admin/products/haji`)} className="admin-btn-sm">Kembali ke daftar</button>
      </div>
    )
  }
  if (!haji || !form) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  const sisa = haji.totalQuota - haji.pendingQuota - haji.bookedQuota
  // Galat/pesan lama dibuang begitu pengguna mengubah sesuatu — banner basi tak boleh bertahan setelah tindakan lain berhasil.
  const touch = () => { setError(null); setNotice(null); setSaved(false) }
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { touch(); setForm(f => f && ({ ...f, [k]: e.target.value })) }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/haji`)} aria-label="Kembali ke daftar"
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1 flex items-center gap-2"><Star className="h-5 w-5 text-admin-accent" /> {haji.name}</h1>
        <Badge tone={haji.isActive ? 'ok' : 'neutral'}>{haji.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-admin-danger">{error}</p>}
      {notice && <p role="status" className="text-[13px] font-medium text-admin-ink">{notice}</p>}

      <div className="admin-form-panel">
        <MediaField productType="haji" productId={haji.id} label="Foto Unggulan Haji" />
      </div>

      {/* Info dasar */}
      <div className="admin-form-panel space-y-3">
        <p className="text-sm font-semibold text-admin-ink">Info Produk Haji</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2"><p className="text-xs text-admin-muted mb-1">Nama Produk</p><input className="admin-inp" value={form.name} onChange={set('name')} /></div>
          <div><p className="text-xs text-admin-muted mb-1">Jenis Haji</p><select className="admin-select" value={form.hajiType} onChange={set('hajiType')}>{HAJI_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div><p className="text-xs text-admin-muted mb-1">Tahun</p><input type="number" className="admin-inp" value={form.year} onChange={set('year')} /></div>
          <div><p className="text-xs text-admin-muted mb-1">Tanggal Berangkat</p><input type="date" className="admin-inp" value={form.departureDate} onChange={set('departureDate')} /></div>
          <div><p className="text-xs text-admin-muted mb-1">Tanggal Kembali</p><input type="date" className="admin-inp" value={form.returnDate} onChange={set('returnDate')} /></div>
          <div><p className="text-xs text-admin-muted mb-1">Durasi (hari)</p><input type="number" className="admin-inp" value={form.durationDays} onChange={set('durationDays')} /></div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kuota Total</p>
            <input type="number" className="admin-inp" value={form.totalQuota} onChange={set('totalQuota')} />
            <p className="text-[11px] text-admin-muted/70 mt-1">Ditahan {haji.pendingQuota} · Terjual {haji.bookedQuota} · Sisa {sisa}</p>
          </div>
          <div className="md:col-span-2 lg:col-span-3 min-w-0">
            <p className="text-xs text-admin-muted mb-1">Deskripsi</p>
            <RichTextEditor id="haji-edit-description" title="Deskripsi paket haji" value={form.description} onChange={description => { touch(); setForm(f => f && ({ ...f, description })) }} placeholder="Program perjalanan, fasilitas, syarat, dan catatan penting…" />
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <p className="text-xs text-admin-muted mb-1">Yang Termasuk (satu baris per item)</p>
            <textarea className="admin-inp" rows={4} value={form.includes} onChange={set('includes')} />
          </div>
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div onClick={() => { touch(); setForm(f => f && ({ ...f, isActive: !f.isActive })) }}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di katalog)</span>
        </label>
        <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
        </button>
      </div>

      {/* Komponen biaya — harga produk dihitung dari sini */}
      <CostComponentsPanel
        apiBase={`/api/v1/admin/products/haji/${id}/costs`}
        hint="Tiap komponen (visa, akomodasi, transportasi, dst) dapat margin sendiri, baru dijumlah jadi harga per orang — lihat docs/arsitektur-komponen-biaya.md"
        namePlaceholder="Visa Haji, Akomodasi Makkah, Transportasi, dst"
        onChanged={async () => { touch(); await load(id, false) }}
      />

      {/* Ringkasan harga */}
      <div className="admin-card p-4 space-y-2">
        <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4 text-admin-accent" /> Harga Jual per Orang</p>
        {haji.price > 0 ? (
          <p className="text-xl font-bold text-admin-accent-strong">{formatRupiah(haji.price)}</p>
        ) : (
          <p className="text-[13px] text-admin-warning">Belum ditetapkan — tambahkan Komponen Biaya. Selama belum berharga, produk ini tidak dapat dipesan.</p>
        )}
        <p className="text-[11px] text-admin-muted/70">Dihitung otomatis (jumlah harga jual semua komponen), diperbarui saat komponen atau kurs berubah. Tidak diisi manual.</p>
      </div>

      {/* Danger zone */}
      <div className="admin-form-panel border-admin-danger/20 space-y-3">
        <p className="text-sm font-semibold text-admin-danger">Zona Berbahaya</p>
        <p className="text-[12px] text-admin-muted">
          {haji.bookingCount > 0
            ? `Produk ini sudah punya ${haji.bookingCount} booking sehingga tidak bisa dihapus. Anda dapat menonaktifkannya (hilang dari katalog; data booking tetap aman) dan mengaktifkannya lagi kapan saja lewat saklar "Aktif" di atas.`
            : 'Hapus produk ini secara permanen beserta komponen biayanya. Karena belum pernah dipesan, penghapusan aman dilakukan.'}
        </p>
        <button onClick={handleDelete} disabled={deleting || (haji.bookingCount > 0 && !haji.isActive)}
          className="px-4 py-2 rounded-xl border border-admin-danger/30 text-[13px] font-medium text-admin-danger hover:bg-admin-danger/10 transition-colors disabled:opacity-50">
          {deleting ? 'Memproses...' : haji.bookingCount > 0 ? 'Nonaktifkan Produk' : 'Hapus Produk'}
        </button>
      </div>
    </div>
  )
}
