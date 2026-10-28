'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Info, Pencil, Wallet } from 'lucide-react'
import { Button } from '@/components/admin/ui/Button'
import { formatRupiah } from '@/lib/utils'
import { evaluatePricing, type PricingEvaluation, type PricingInput } from '@/lib/pricing/warnings'

// Kartu "Harga pesanan" (docs/arsitektur-harga-terpadu.md §21.3): Total HPP · Rekomendasi · Harga jual (patokan, bisa diatur) + riwayat penyesuaian.
// PERINGATAN HANYA MENGINGATKAN: di bawah rekomendasi (kuning) atau di bawah HPP (merah) — tombol Simpan tetap aktif, tak ada catatan wajib, dan semuanya INTERNAL (tak masuk invoice).
// Aturan peringatan satu sumber (`evaluatePricing`) dengan server. Total hanya dapat diatur saat menunggu pembayaran; "edit" = atur total lagi (riwayat bertambah).

type Summary = PricingInput
type Adj = {
  id: string; amountIdr: number; label: string; reason: string | null; totalBefore: number; totalAfter: number; belowCost: boolean
  reversesId: string | null; reversed: boolean; byName: string | null; createdAt: string
}
const rp = (n: number) => formatRupiah(n)

export function BookingPriceCard({ bookingId, status }: { bookingId: string; status: string }) {
  const router = useRouter()
  const editable = status === 'awaiting_payment'
  const [summary, setSummary] = useState<Summary | null>(null)
  const [items, setItems] = useState<Adj[]>([])
  const [total, setTotal] = useState('')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<PricingEvaluation | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      fetch(`/api/v1/admin/bookings/${bookingId}/pricing`).then(r => r.json().catch(() => null)),
      fetch(`/api/v1/admin/bookings/${bookingId}/adjustments`).then(r => r.json().catch(() => null)),
    ])
    if (p?.data?.summary) { setSummary(p.data.summary as Summary); setTotal(String(p.data.summary.sellIdr)) }
    if (Array.isArray(a?.data)) setItems(a.data)
  }, [bookingId])
  useEffect(() => { void load() }, [load])

  if (!summary) return null
  const typed = Number(total)
  const valid = Number.isFinite(typed) && typed > 0
  const live = evaluatePricing({ ...summary, sellIdr: valid ? typed : summary.sellIdr })
  const current = evaluatePricing(summary)
  const changed = valid && Math.round(typed * 100) !== Math.round(summary.sellIdr * 100)
  const recPct = summary.costKnownIdr > 0 && !live.incompleteRecommended ? ((summary.recommendedIdr - summary.costKnownIdr) / summary.costKnownIdr) * 100 : null

  async function submit() {
    setBusy(true); setError(''); setSaved(null)
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/total`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalIdr: typed, ...(label.trim() ? { label } : {}), ...(reason.trim() ? { reason } : {}) }),
    })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal menyimpan total'); return }
    setSaved(j.data.warningAfter as PricingEvaluation)
    setLabel(''); setReason('')
    await load(); router.refresh()
  }
  async function reverse(id: string) {
    setBusy(true); setError('')
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/adjustments/${id}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal membatalkan penyesuaian'); return }
    await load(); router.refresh()
  }
  async function saveNote(id: string) {
    setBusy(true); setError('')
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/adjustments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: editText.trim() ? editText : null }) })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal menyimpan catatan'); return }
    setEditId(null); await load()
  }

  return (
    <div className="admin-card p-4 space-y-3">
      <p className="admin-section flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Harga pesanan</p>

      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
        <Stat label="Total HPP" value={rp(summary.costKnownIdr)} hint={summary.costUnknownLines > 0 ? `${summary.costUnknownLines} baris belum punya modal` : 'modal seluruh baris'} />
        <Stat label="Rekomendasi" value={live.incompleteRecommended ? `≥ ${rp(summary.recommendedIdr)}` : rp(summary.recommendedIdr)} hint={recPct != null ? `HPP + ${recPct.toFixed(1)}% (margin bawaan)` : live.incompleteRecommended ? 'pesanan lama, belum lengkap' : 'HPP + margin bawaan'} />
        <Stat label="Harga jual" value={rp(summary.sellIdr)} strong tone={current.level === 'below_cost' ? 'danger' : current.level === 'below_recommended' ? 'warning' : undefined}
          hint={current.marginPct != null ? `${current.marginIdr < 0 ? 'rugi' : 'untung'} ${rp(Math.abs(current.marginIdr))} (${current.marginPct.toFixed(1)}%)${current.incompleteCost ? ', HPP belum lengkap' : ''}` : undefined} />
      </div>
      <Banner ev={current} />

      {editable ? (
        <div className="space-y-2 rounded-xl bg-admin-spot/60 p-3">
          <label className="block text-[11px] font-semibold text-admin-muted">
            Atur total harga jual (Rp)
            <input aria-label="Total harga jual" type="number" min={1} className="admin-inp mt-1" value={total} onChange={e => { setTotal(e.target.value); setSaved(null) }} />
          </label>
          {changed && <Banner ev={live} preview />}
          {changed && (
            <p className="m-0 text-[11px] text-admin-muted">
              {live.shortfallVsRecommendedIdr != null && <>Selisih dari rekomendasi: <b>{live.shortfallVsRecommendedIdr > 0 ? `−${rp(live.shortfallVsRecommendedIdr)}` : `+${rp(typed - summary.recommendedIdr)}`}</b>. </>}
              Selisih dari HPP: <b>{live.marginIdr >= 0 ? '+' : '−'}{rp(Math.abs(live.marginIdr))}</b>.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label="Label di invoice" className="admin-inp" maxLength={120} placeholder="Label di invoice (opsional, bawaan: Diskon / Biaya tambahan)" value={label} onChange={e => setLabel(e.target.value)} />
            <input aria-label="Catatan internal" className="admin-inp" maxLength={500} placeholder="Catatan internal (opsional, mis. nego dengan ketua rombongan)" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <p className="m-0 text-[11px] text-admin-muted">Label tampil di invoice jamaah — jangan menulis nama atau data pribadi. Catatan dan peringatan hanya terlihat admin.</p>
          {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
          {saved && <p role="status" className="m-0 flex items-center gap-1.5 text-[12px] font-medium text-admin-ok"><Check className="size-3.5" /> Total tersimpan{saved.level !== 'ok' ? ' (peringatan di atas hanya pengingat).' : '.'}</p>}
          <Button size="sm" onClick={submit} loading={busy} disabled={!changed}><Pencil className="size-4" /> Simpan total</Button>
        </div>
      ) : (
        <p className="m-0 text-[12px] text-admin-muted">Total hanya dapat diatur saat pesanan menunggu pembayaran. Setelah dibayar, gunakan jalur refund.</p>
      )}

      {items.length > 0 && (
        <ul className="m-0 list-none divide-y divide-admin-line p-0">
          {items.map(a => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[12px]">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-semibold text-admin-ink">{a.label}{a.reversed && <span className="ml-1.5 text-admin-muted">(dibatalkan)</span>}{a.belowCost && <span className="ml-1.5 rounded bg-admin-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-admin-danger">di bawah HPP</span>}</p>
                <p className="m-0 text-admin-muted">{new Date(a.createdAt).toLocaleString('id-ID')} · {a.byName ?? 'staf'} · total {rp(a.totalBefore)} → {rp(a.totalAfter)}</p>
                {editId === a.id ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <input aria-label="Catatan internal penyesuaian" autoFocus className="admin-inp min-w-0 flex-1" maxLength={500} value={editText} onChange={e => setEditText(e.target.value)} />
                    <button type="button" disabled={busy} onClick={() => saveNote(a.id)} className="admin-btn-sm">Simpan catatan</button>
                    <button type="button" disabled={busy} onClick={() => setEditId(null)} className="admin-btn-sm">Batal</button>
                  </div>
                ) : (
                  <p className="m-0 text-admin-muted">
                    {a.reason ? <>Catatan: {a.reason}</> : <span className="italic">Tanpa catatan</span>}{' '}
                    <button type="button" className="font-semibold text-admin-accent underline" onClick={() => { setEditId(a.id); setEditText(a.reason ?? '') }}>{a.reason ? 'Ubah catatan' : 'Tambah catatan'}</button>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-bold tabular-nums ${a.amountIdr < 0 ? 'text-admin-danger' : 'text-admin-ok'}`}>{rp(a.amountIdr)}</span>
                {editable && !a.reversed && !a.reversesId && <button type="button" disabled={busy} onClick={() => reverse(a.id)} className="admin-btn-sm">Batalkan</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, hint, strong, tone }: { label: string; value: string; hint?: string; strong?: boolean; tone?: 'danger' | 'warning' }) {
  const color = tone === 'danger' ? 'text-admin-danger' : tone === 'warning' ? 'text-admin-warning' : 'text-admin-ink'
  return (
    <div className="rounded-xl border border-admin-line p-2.5">
      <p className="m-0 text-[11px] font-semibold text-admin-muted">{label}</p>
      <p className={`m-0 tabular-nums ${strong ? 'text-[15px] font-bold' : 'text-[13px] font-semibold'} ${color}`}>{value}</p>
      {hint && <p className="m-0 text-[11px] text-admin-muted">{hint}</p>}
    </div>
  )
}

/** Banner peringatan INTERNAL — tak pernah menonaktifkan apa pun. */
function Banner({ ev, preview }: { ev: PricingEvaluation; preview?: boolean }) {
  if (ev.level === 'ok' && !ev.incompleteCost) return null
  const loss = ev.level === 'below_cost'
  if (ev.level === 'ok') {
    return <p className="m-0 flex items-start gap-1.5 text-[12px] text-admin-muted"><Info className="mt-0.5 size-3.5 shrink-0" /> HPP belum lengkap: ada baris yang modalnya belum diisi, jadi untung sebenarnya bisa lebih kecil.</p>
  }
  return (
    <div role="alert" className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium ${loss ? 'bg-admin-danger/10 text-admin-danger' : 'bg-admin-warning/10 text-admin-warning'}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {loss
          ? <>{preview ? 'Dengan total ini' : 'Harga jual'} di bawah HPP — rugi {rp(ev.lossIdr)}.</>
          : <>{preview ? 'Dengan total ini' : 'Harga jual'} di bawah rekomendasi (−{rp(ev.shortfallVsRecommendedIdr ?? 0)}).</>}
        {ev.incompleteCost && loss ? ' (HPP belum lengkap, kerugian bisa lebih besar.)' : ''}
        {' '}Peringatan ini hanya untuk internal, tidak tampil di invoice, dan tidak menghalangi penyimpanan.
      </span>
    </div>
  )
}
