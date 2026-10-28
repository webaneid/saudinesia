'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, History, Loader2, Pencil, RotateCcw, Wallet } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { formatRupiah } from '@/lib/utils'

// Satu kartu harga untuk SEMUA produk (docs/arsitektur-harga-terpadu.md §6, §16): Modal · Harga Jual · Untung seragam, mode Otomatis/Manual, peringatan, atur / kembalikan
// harga manual, riwayat. Sumbernya satu: GET /api/v1/admin/pricing/points (titik harga). Rincian MODAL tetap editor biayanya masing-masing (di atas/di samping kartu ini);
// kartu ini tak pernah mengubah modal pemilik berbasis perhitungan — kecuali pemilik manual-only (katering, layanan hotel) yang modalnya opsional diisi di sini.

export type PriceOwnerKind = 'visa' | 'flight' | 'hotel' | 'transport' | 'muthowif' | 'package' | 'tour_package' | 'haji' | 'catering' | 'hotel_service'

type Point = {
  ownerType: PriceOwnerKind; ownerId: string; variantKey: string; unit: string
  costIdr: number | null; sellIdr: number; profitIdr: number | null; marginPct: number | null
  mode: 'auto' | 'manual'; autoSellIdr: number | null; manualNote: string | null; manualAt: string | null
}
type Change = { id: string; variantKey: string; kind: string; oldSellIdr: number | null; newSellIdr: number | null; oldCostIdr: number | null; newCostIdr: number | null; note: string | null; at: string }
type Payload = {
  points: Point[]
  rule: { marginPercent: number; roundingIncrement: number; warnBelowPercent: number }
  manualOnly: boolean
  creatable: string[]
  changes: Change[]
}

const SEASON_LABEL: Record<string, string> = { regular: 'Musim reguler', ramadan: 'Musim Ramadan', hajj: 'Musim Haji' }
export function variantLabel(key: string): string | null {
  if (!key) return null
  const days = /^days:(\d+)-(\d+)$/.exec(key)
  if (days) return `Rentang ${days[1]}–${days[2]} hari`
  const season = /^season:(\w+)$/.exec(key)
  if (season) return SEASON_LABEL[season[1]!] ?? key
  return key
}
const KIND_LABEL: Record<string, string> = { manual_set: 'Harga manual diatur', manual_clear: 'Kembali ke otomatis', cost_set: 'Modal diubah', visa_override_migrated: 'Dipindah dari override lama' }
const UNIT_LABEL: Record<string, string> = { person: 'per orang', room_night: 'per kamar per malam', vehicle: 'per kendaraan', person_day: 'per orang per hari', package: 'per paket', service: 'per layanan' }
const rp = (n: number | null) => (n == null ? '—' : formatRupiah(n))

type Props = {
  ownerType: PriceOwnerKind
  ownerId: string
  title?: string
  /** Ubah nilai ini setelah menyimpan modal/biaya di editor induk agar kartu memuat ulang. */
  reloadKey?: number | string
  /** Dipanggil setelah harga manual berubah (mis. editor induk memuat ulang ringkasannya). */
  onChanged?: () => void
}

export function PriceCard({ ownerType, ownerId, title = 'Harga: modal, jual, untung', reloadKey, onChanged }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/pricing/points?${new URLSearchParams({ ownerType, ownerId })}`)
      if (res.status === 403) { setStatus('forbidden'); return }
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setStatus('error'); return }
      setData(j.data as Payload)
      setStatus('ok')
    } catch { setStatus('error') }
  }, [ownerType, ownerId])

  useEffect(() => { void load() }, [load, reloadKey])

  if (status === 'forbidden') return null // peran tanpa hak melihat modal/untung (policy) — kartu tidak ditampilkan
  if (status === 'loading') return <Card className="flex items-center gap-2 p-5 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat harga…</Card>
  if (status === 'error' || !data) return <Card className="p-5 text-sm text-admin-danger">Harga gagal dimuat. Muat ulang halaman.</Card>

  const rows: Array<{ key: string; point: Point | null }> = data.points.map(p => ({ key: p.variantKey, point: p }))
  for (const key of data.creatable) if (!data.points.some(p => p.variantKey === key)) rows.push({ key, point: null })
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const afterChange = () => { void load(); onChanged?.() }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Wallet className="size-4 text-admin-accent" /> {title}</h2>
        <p className="m-0 mt-1 text-xs text-admin-muted">
          {data.manualOnly
            ? 'Harga jual diisi langsung; modal opsional (untuk menghitung untung).'
            : `Harga otomatis = modal × margin bawaan ${data.rule.marginPercent}%, dibulatkan ke kelipatan ${formatRupiah(data.rule.roundingIncrement)}. Margin hanyalah saran — harga jual boleh diatur manual.`}
        </p>
      </div>

      {rows.length === 0 && (
        <p className="m-0 rounded-xl border border-dashed border-admin-line-strong px-4 py-5 text-center text-xs text-admin-muted">Belum ada harga. Isi modal (biaya) produk ini, atau atur harga jual manual.</p>
      )}
      {rows.map(({ key, point }) => (
        <VariantRow key={key} ownerType={ownerType} ownerId={ownerId} variantKey={key} point={point} rule={data.rule} manualOnly={data.manualOnly} canCreate={data.creatable.includes(key)} onChanged={afterChange} />
      ))}

      <ChangeHistory changes={data.changes} />
    </Card>
  )
}

function VariantRow({ ownerType, ownerId, variantKey, point, rule, manualOnly, canCreate, onChanged }: {
  ownerType: PriceOwnerKind; ownerId: string; variantKey: string; point: Point | null
  rule: Payload['rule']; manualOnly: boolean; canCreate: boolean; onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [sell, setSell] = useState('')
  const [note, setNote] = useState('')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = variantLabel(variantKey)

  function open() {
    setSell(point ? String(point.sellIdr) : '')
    setNote(point?.manualNote ?? '')
    setCost(point?.costIdr != null ? String(point.costIdr) : '')
    setError(null); setEditing(true)
  }
  async function call(method: 'PUT' | 'DELETE' | 'PATCH', body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null)
    const res = await fetch('/api/v1/admin/pricing/points', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerType, ownerId, variantKey, ...body }) })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Perubahan harga gagal disimpan.'); return false }
    return true
  }
  async function save() {
    const value = Number(sell)
    if (!(value > 0)) { setError('Harga jual harus lebih dari 0'); return }
    if (manualOnly && cost.trim() !== (point?.costIdr != null ? String(point.costIdr) : '')) {
      // modal dulu butuh titik harga: simpan harga, lalu modal
      if (!(await call('PUT', { sellIdr: value, note: note || null }))) return
      if (!(await call('PATCH', { costIdr: cost.trim() === '' ? null : Number(cost) }))) return
    } else if (!(await call('PUT', { sellIdr: value, note: note || null }))) return
    setEditing(false); onChanged()
  }
  async function revert() {
    if (await call('DELETE', {})) { setEditing(false); onChanged() }
  }

  const belowCost = point?.costIdr != null && Number(sell) > 0 && Number(sell) < point.costIdr
  // Peringatan saat mengetik — HANYA mengingatkan, tidak pernah mematikan tombol Simpan (docs/arsitektur-harga-terpadu.md §21)
  const typed = Number(sell)
  const belowAuto = !belowCost && point?.autoSellIdr != null && !manualOnly && typed > 0 && typed < point.autoSellIdr
  const loss = point != null && point.profitIdr != null && point.profitIdr < 0
  const thin = point != null && !loss && point.marginPct != null && rule.warnBelowPercent > 0 && point.marginPct < rule.warnBelowPercent
  const incomplete = point != null && point.costIdr == null
  const unpriced = point != null && point.sellIdr === 0

  return (
    <div className="space-y-3 rounded-xl border border-admin-line p-3">
      {(label || point) && (
        <div className="flex flex-wrap items-center gap-2">
          {label && <span className="text-xs font-bold text-admin-ink">{label}</span>}
          {point && <span className="text-[11px] text-admin-muted">{UNIT_LABEL[point.unit] ?? point.unit}</span>}
          {point && !manualOnly && <Badge tone={point.mode === 'manual' ? 'warning' : 'accent'}>{point.mode === 'manual' ? 'Manual' : 'Otomatis'}</Badge>}
          {point && manualOnly && <Badge tone="neutral">Diisi admin</Badge>}
        </div>
      )}

      {point ? (
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          <Stat label="Modal" value={rp(point.costIdr)} hint={incomplete ? 'belum lengkap' : undefined} muted={incomplete} />
          <Stat label="Harga jual" value={rp(point.sellIdr)} strong />
          <Stat
            label="Untung" value={rp(point.profitIdr)}
            hint={point.marginPct != null ? `${point.marginPct.toFixed(1)}% dari modal` : 'modal belum lengkap'}
            tone={loss ? 'danger' : thin ? 'warning' : point.profitIdr != null ? 'ok' : undefined}
          />
        </div>
      ) : (
        <p className="m-0 text-xs text-admin-muted">Belum berharga{canCreate ? ' — atur harga jual agar bisa dipesan.' : '.'}</p>
      )}

      {loss && <Warn>Harga jual di bawah modal — produk dijual rugi.</Warn>}
      {thin && <Warn>Margin {point!.marginPct!.toFixed(1)}% di bawah ambang peringatan {rule.warnBelowPercent}%.</Warn>}
      {incomplete && !manualOnly && <Warn>Modal belum lengkap, jadi untung belum bisa dihitung. Lengkapi biaya produk ini.</Warn>}
      {unpriced && <Warn>Harga jual 0 — produk ini belum bisa dipesan.</Warn>}
      {point?.mode === 'manual' && !manualOnly && (
        <p className="m-0 text-[11px] text-admin-muted">
          Harga manual{point.manualNote ? <> — “{point.manualNote}”</> : null}.{point.autoSellIdr != null && <> Harga otomatis saat ini: <b>{formatRupiah(point.autoSellIdr)}</b>.</>}
        </p>
      )}

      {editing ? (
        <div className="space-y-2.5 rounded-xl bg-admin-spot/60 p-3">
          <div className={manualOnly ? 'grid gap-2 sm:grid-cols-2' : ''}>
            <label className="block text-[11px] font-semibold text-admin-muted">
              Harga jual (Rp)
              <input type="number" min={0} className="admin-inp mt-1" value={sell} onChange={e => setSell(e.target.value)} autoFocus />
            </label>
            {manualOnly && (
              <label className="block text-[11px] font-semibold text-admin-muted">
                Modal (Rp) — opsional
                <input type="number" min={0} className="admin-inp mt-1" value={cost} onChange={e => setCost(e.target.value)} placeholder="kosongkan bila belum diketahui" />
              </label>
            )}
          </div>
          <label className="block text-[11px] font-semibold text-admin-muted">
            Catatan (opsional{belowCost ? ', disarankan: jelaskan alasan harga di bawah modal' : ''})
            <input className="admin-inp mt-1" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="mis. promo musim, negosiasi grup" />
          </label>
          {point?.autoSellIdr != null && !manualOnly && (
            <button type="button" className="text-[11px] font-semibold text-admin-accent underline" onClick={() => setSell(String(point.autoSellIdr))}>Pakai harga otomatis ({formatRupiah(point.autoSellIdr)})</button>
          )}
          {belowCost && <Warn>Di bawah modal ({formatRupiah(point!.costIdr!)}) — rugi {formatRupiah(point!.costIdr! - typed)} per satuan. Peringatan internal; tetap bisa disimpan.</Warn>}
          {belowAuto && <Warn>Di bawah harga otomatis ({formatRupiah(point!.autoSellIdr!)}) — lebih rendah dari rekomendasi. Peringatan internal; tetap bisa disimpan.</Warn>}
          {error && <p className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} loading={busy}><Check className="size-4" /> Simpan harga</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Batal</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {(point || canCreate) && <Button size="sm" variant="outline" onClick={open}><Pencil className="size-4" /> {point ? 'Atur harga manual' : 'Atur harga jual'}</Button>}
          {point?.mode === 'manual' && !manualOnly && point.autoSellIdr != null && (
            <Button size="sm" variant="ghost" onClick={revert} loading={busy}><RotateCcw className="size-4" /> Kembalikan ke otomatis</Button>
          )}
          {error && <span className="text-xs font-medium text-admin-danger">{error}</span>}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone, strong, muted }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warning' | 'danger'; strong?: boolean; muted?: boolean }) {
  const color = tone === 'danger' ? 'text-admin-danger' : tone === 'warning' ? 'text-admin-warning' : tone === 'ok' ? 'text-admin-ok' : muted ? 'text-admin-muted' : 'text-admin-ink'
  return (
    <div className="ubin space-y-0.5">
      <p className="label-kecil m-0">{label}</p>
      <p className={`m-0 break-words text-sm tabular-nums ${strong ? 'font-extrabold' : 'font-bold'} ${color}`}>{value}</p>
      {hint && <p className="m-0 text-[11px] text-admin-muted">{hint}</p>}
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="m-0 flex items-start gap-1.5 text-xs font-medium text-admin-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {children}</p>
}

function ChangeHistory({ changes }: { changes: Change[] }) {
  const [open, setOpen] = useState(false)
  if (changes.length === 0) return null
  return (
    <div>
      <button type="button" className="flex items-center gap-1.5 text-xs font-semibold text-admin-muted hover:text-admin-ink" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <History className="size-3.5" /> Riwayat perubahan harga ({changes.length}) <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
          {changes.map(c => (
            <li key={c.id} className="rounded-lg bg-admin-spot/60 px-3 py-2 text-[11px] text-admin-muted">
              <b className="text-admin-ink">{KIND_LABEL[c.kind] ?? c.kind}</b>
              {variantLabel(c.variantKey) ? ` · ${variantLabel(c.variantKey)}` : ''}
              {c.kind === 'cost_set' ? ` · modal ${rp(c.oldCostIdr)} → ${rp(c.newCostIdr)}` : ` · ${rp(c.oldSellIdr)} → ${rp(c.newSellIdr)}`}
              {c.note ? ` · “${c.note}”` : ''}
              <span className="ml-1 opacity-70">{new Date(c.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
