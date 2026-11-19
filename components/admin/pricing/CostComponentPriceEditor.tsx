'use client'

import { useState } from 'react'
import { AlertTriangle, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/admin/ui/Button'
import { formatRupiah } from '@/lib/utils'
import { marginNote } from '@/lib/pricing/marginNote'
import { MarginNote } from './MarginNote'

type Props = {
  /** `ProductCost.id` = ownerId titik harga `cost_component` (docs/arsitektur-harga-terpadu.md §22). */
  costId: string
  name: string
  hppIdr: number | null
  recommendedIdr: number | null
  sellIdr: number | null
  manual: boolean
  note: string | null
  marginPercent: number
  onSaved: () => void | Promise<void>
  onCancel: () => void
}

/**
 * Atur harga jual SATU komponen biaya (sebaris di panel Komponen Biaya). Rekomendasi = HPP × margin; harga bebas — catatan selisih hanya mengingatkan,
 * Simpan tak pernah dikunci (§21). Lewat route harga yang sama dengan PriceCard (`admin/pricing/points`); total produk dihitung ulang server.
 */
export function CostComponentPriceEditor({ costId, name, hppIdr, recommendedIdr, sellIdr, manual, note: savedNote, marginPercent, onSaved, onCancel }: Props) {
  const [sell, setSell] = useState(sellIdr != null ? String(sellIdr) : '')
  const [note, setNote] = useState(savedNote ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(method: 'PUT' | 'DELETE', body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null)
    const res = await fetch('/api/v1/admin/pricing/points', {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'cost_component', ownerId: costId, variantKey: '', ...body }),
    })
    const j: { error?: string } | null = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Harga komponen gagal disimpan.'); return false }
    return true
  }
  async function save() {
    const value = Number(sell)
    if (!(value > 0)) { setError('Harga jual harus lebih dari 0'); return }
    if (await call('PUT', { sellIdr: value, note: note.trim() || null })) await onSaved()
  }
  async function revert() {
    if (await call('DELETE', {})) await onSaved()
  }

  const typed = Number(sell)
  const belowCost = hppIdr != null && typed > 0 && typed < hppIdr
  const hint = belowCost ? null : marginNote({ sell: typed, recommended: recommendedIdr, ref: 'margin', marginPercent })

  return (
    <div className="space-y-2.5 rounded-xl bg-admin-spot/60 p-3">
      <label className="block text-[11px] font-semibold text-admin-muted">
        Harga jual {name} (Rp)
        <input type="number" min={0} className="admin-inp mt-1" value={sell} onChange={e => setSell(e.target.value)} autoFocus />
      </label>
      <label className="block text-[11px] font-semibold text-admin-muted">
        Catatan (opsional{belowCost ? ', disarankan: jelaskan alasan harga di bawah modal' : ''})
        <input className="admin-inp mt-1" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="mis. nego vendor, promo musim" />
      </label>
      {recommendedIdr != null && (
        <button type="button" className="text-[11px] font-semibold text-admin-accent underline" onClick={() => setSell(String(recommendedIdr))}>
          Pakai rekomendasi ({formatRupiah(recommendedIdr)})
        </button>
      )}
      {belowCost && (
        <p className="m-0 flex items-start gap-1.5 text-xs font-medium text-admin-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Di bawah modal ({formatRupiah(hppIdr!)}) — rugi {formatRupiah(hppIdr! - typed)} per satuan. Peringatan internal; tetap bisa disimpan.
        </p>
      )}
      {hint && <MarginNote note={hint} />}
      {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} loading={busy}><Check className="size-4" /> Simpan harga</Button>
        {manual && recommendedIdr != null && (
          <Button size="sm" variant="ghost" onClick={revert} disabled={busy}><RotateCcw className="size-4" /> Kembalikan ke rekomendasi</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Batal</Button>
      </div>
    </div>
  )
}
