'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR']

type FlightRoute = { id: string; origin: string; destination: string; isActive: boolean }
type Schedule = {
  id: string; routeId: string; departureFrom: string; departureTo: string
  price: number; totalSeats: number; pendingSeats: number; bookedSeats: number; isActive: boolean
  route: FlightRoute
}
type Preview = { hppRupiah: number; sellPrice: number }

type Props = { params: Promise<{ locale: string; id: string }> }

function toDateInput(d: string) {
  return d.slice(0, 10)
}

export default function FlightEditPage({ params }: Props) {
  const { ask, dialog } = useConfirm()
  const router = useRouter()
  const [id, setId] = useState('')
  const [locale, setLocale] = useState('id')
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [routes, setRoutes] = useState<FlightRoute[]>([])
  const [form, setForm] = useState({ routeId: '', departureFrom: '', departureTo: '', totalSeats: '0', isActive: true })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [vendorId, setVendorId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [hargaTiket, setHargaTiket] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [savingCost, setSavingCost] = useState(false)
  const [costSaved, setCostSaved] = useState(false)
  const [costError, setCostError] = useState<string | null>(null)
  const [priceTick, setPriceTick] = useState(0) // naik setiap biaya tersimpan → PriceCard memuat ulang

  // Live preview harga jual — debounce 500ms, sama pola docs/arsitektur-visa.md tapi hanya
  // 1 komponen HPP ("tiket") karena flight tidak punya BRN-equivalent (arsitektur-tiket-pesawat.md §4).
  useEffect(() => {
    const cost = Number(hargaTiket)
    if (!cost || cost <= 0) { setPreview(null); return }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ hargaTiket: String(cost), currency })
      const r = await fetch(`/api/v1/admin/products/flight/simulate?${params}`)
      const j = await r.json()
      setPreview(j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null)
    }, 500)
    return () => clearTimeout(timer)
  }, [hargaTiket, currency])

  async function loadCost(scheduleId: string) {
    const r = await fetch(`/api/v1/admin/products/flight/schedules/${scheduleId}/cost`)
    const j = await r.json()
    if (j.data) {
      setVendorId(j.data.vendorId ?? '')
      setCurrency(j.data.currency ?? 'USD')
      setHargaTiket(j.data.hargaTiket ? String(j.data.hargaTiket) : '')
    }
    // FlightSchedule.price adalah cache turunan komponen HPP — refresh juga setelah cost berubah.
    const sr = await fetch(`/api/v1/admin/products/flight/schedules/${scheduleId}`)
    const sj = await sr.json()
    if (sj.data) setSchedule(sj.data)
  }

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      const r = await fetch(`/api/v1/admin/products/flight/schedules/${p.id}`)
      const j = await r.json()
      if (j.data) {
        const s: Schedule = j.data
        setSchedule(s)
        setForm({
          routeId: s.routeId,
          departureFrom: toDateInput(s.departureFrom),
          departureTo: toDateInput(s.departureTo),
          totalSeats: String(s.totalSeats),
          isActive: s.isActive,
        })
      }
      const rr = await fetch('/api/v1/admin/products/flight/routes')
      const rj = await rr.json()
      setRoutes(rj.data ?? [])
      await loadCost(p.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  async function handleSaveBasic() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/flight/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, totalSeats: +form.totalSeats }),
    })
    const sr = await fetch(`/api/v1/admin/products/flight/schedules/${id}`)
    const sj = await sr.json()
    if (sj.data) setSchedule(sj.data)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const canSaveCost = !!vendorId && Number(hargaTiket) > 0

  async function handleSaveCost() {
    setSavingCost(true)
    setCostError(null)
    const r = await fetch(`/api/v1/admin/products/flight/schedules/${id}/cost`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId, currency, hargaTiket: Number(hargaTiket) }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => null)
      setCostError(j?.error ?? 'Harga tiket gagal disimpan.')
      setSavingCost(false)
      return
    }
    await loadCost(id)
    setPriceTick(t => t + 1)
    setSavingCost(false); setCostSaved(true)
    setTimeout(() => setCostSaved(false), 2000)
  }

  async function handleDelete() {
    if (!schedule) return
    if (!(await ask({ title: `Hapus jadwal ${schedule.route.origin} → ${schedule.route.destination}?`, body: 'Jadwal yang sudah dipakai booking dinonaktifkan, bukan dihapus.' }))) return
    await fetch(`/api/v1/admin/products/flight/schedules/${id}`, { method: 'DELETE' })
    router.push(`/${locale}/admin/products/flight`)
  }

  if (!schedule) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      {dialog}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(`/${locale}/admin/products/flight`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Jadwal Penerbangan</h1>
      </div>

      {/* Basic info */}
      <div className="admin-form-panel space-y-4">
        <p className="text-sm font-semibold text-admin-ink">Informasi Dasar</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Rute</p>
            <ChoiceSelect placeholder="Pilih rute…" value={form.routeId} onChange={v => setForm(f => ({ ...f, routeId: v }))} clearable={false}
              options={routes.map(r => ({ id: r.id, label: `${r.origin} → ${r.destination}` }))} />
            <p className="text-[11px] text-admin-muted/70 mt-1">Rute baru dikelola dari halaman daftar jadwal.</p>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Periode Mulai</p>
            <input type="date" className="admin-inp" value={form.departureFrom} onChange={e => setForm(f => ({ ...f, departureFrom: e.target.value }))} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Periode Akhir</p>
            <input type="date" className="admin-inp" value={form.departureTo} onChange={e => setForm(f => ({ ...f, departureTo: e.target.value }))} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Total Kursi</p>
            <input type="number" className="admin-inp" value={form.totalSeats} onChange={e => setForm(f => ({ ...f, totalSeats: e.target.value }))} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kuota Terpakai</p>
            <p className="admin-inp bg-admin-spot/50 text-admin-muted">{schedule.bookedSeats + schedule.pendingSeats} kursi (booked {schedule.bookedSeats}, pending {schedule.pendingSeats})</p>
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div
            onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di katalog)</span>
        </label>

        <div className="admin-card p-3 flex items-center gap-3">
          <p className="text-xs text-admin-muted">Harga saat ini:</p>
          <p className="text-sm font-bold text-admin-ink">{formatRupiah(schedule.price)}</p>
          <p className="text-xs text-admin-muted/70">/ orang — dihitung otomatis dari HPP di bawah</p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSaveBasic}
            disabled={saving || !form.routeId || !form.departureFrom || !form.departureTo}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </div>
      </div>

      {/* HPP */}
      <div className="admin-form-panel space-y-4">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> HPP &amp; Harga Tiket</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">
            Satu komponen: Harga Tiket dari maskapai, dikonversi ke Rupiah pakai kurs, ditambah margin jadi Harga Jual — lihat docs/arsitektur-tiket-pesawat.md §4
          </p>
        </div>

        <div className="border border-admin-line rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-admin-ink">Maskapai &amp; Mata Uang</p>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <VendorPicker value={vendorId} onChange={setVendorId} context="flight" label="Maskapai" />
            </div>
            <select className="admin-inp w-20 shrink-0" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <p className="text-xs text-admin-muted mb-1">Harga Tiket ({currency})</p>
            <input type="number" className="admin-inp" value={hargaTiket} onChange={e => setHargaTiket(e.target.value)} placeholder="0" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">HPP (Rupiah)</p>
            <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{preview ? formatRupiah(Math.round(preview.hppRupiah)) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Harga Jual (otomatis)</p>
            <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{preview ? formatRupiah(preview.sellPrice) : '—'}</p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSaveCost}
            disabled={savingCost || !canSaveCost}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {savingCost ? 'Menyimpan...' : costSaved ? 'Tersimpan ✓' : 'Simpan Harga Tiket'}
          </button>
        {costError && <p role="alert" className="text-[12px] font-medium text-admin-danger">{costError}</p>}
        </div>
      </div>

      <PriceCard ownerType="flight" ownerId={id} reloadKey={priceTick} onChanged={() => { void loadCost(id) }} />

      {/* Danger zone */}
      <div className="admin-form-panel border-admin-danger/20 space-y-3">
        <p className="text-sm font-semibold text-admin-danger">Zona Berbahaya</p>
        <p className="text-[12px] text-admin-muted">
          Hapus jadwal ini secara permanen. Jika sudah ada booking terkait, jadwal akan dinonaktifkan (bukan dihapus).
        </p>
        <button
          onClick={handleDelete}
          className="px-4 py-2 rounded-xl border border-admin-danger/30 text-[13px] font-medium text-admin-danger hover:bg-admin-danger/10 transition-colors"
        >
          Hapus Jadwal
        </button>
      </div>
    </div>
  )
}
