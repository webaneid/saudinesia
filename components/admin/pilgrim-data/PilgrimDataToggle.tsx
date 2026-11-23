'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { Switch } from '@/components/admin/ui/Switch'
import { Badge } from '@/components/admin/ui/Badge'
import { adminHref } from '@/lib/admin/href'
import type { PilgrimDataOwner } from '@/lib/pilgrim-data/owners'

// Saklar "minta data jamaah" — SATU komponen di setiap halaman edit produk (docs/arsitektur-data-jamaah.md §3.2, D3). Tersimpan sendiri saat
// diubah (seperti foto), tidak ikut tombol Simpan halaman. Nyala = jamaah diminta semua kolom AKTIF katalog Produk → Data Jamaah; mati = tidak
// ada kewajiban data jamaah (data pemesan tetap dari akunnya).

type State = { enabled: boolean; defaultEnabled: boolean; stored: boolean }

export function PilgrimDataToggle({ productType, productId }: { productType: PilgrimDataOwner; productId: string | null }) {
  const { locale } = useParams() as { locale: string }
  const [state, setState] = useState<State | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!productId) return
    let alive = true
    fetch(`/api/v1/admin/products/pilgrim-data?productType=${productType}&productId=${encodeURIComponent(productId)}`)
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setState(j.data); else setError(j.error ?? 'Saklar data jamaah gagal dimuat.') })
      .catch(() => { if (alive) setError('Saklar data jamaah gagal dimuat.') })
    return () => { alive = false }
  }, [productType, productId])

  async function change(enabled: boolean) {
    if (!productId) return
    setSaving(true); setError(null)
    try {
      const r = await fetch('/api/v1/admin/products/pilgrim-data', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productType, productId, enabled }),
      })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success) setState(j.data)
      else setError(j?.error ?? 'Saklar data jamaah gagal disimpan.')
    } catch {
      setError('Saklar data jamaah gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  const id = `pilgrim-data-${productType}`
  return (
    <MetaBox title="Data Jamaah" icon={ClipboardList} collapsible={false} aside={state && !state.stored ? <Badge tone="neutral">Bawaan</Badge> : undefined}>
      {!state ? (
        <p className="m-0 text-[13px] text-admin-muted">{error ?? 'Memuat…'}</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <Switch id={id} checked={state.enabled} onChange={change} disabled={saving} label="Minta data jamaah" className="mt-0.5" />
            <label htmlFor={id} className="cursor-pointer text-sm text-admin-ink">
              <span className="font-semibold">Minta data jamaah</span>
              <span className="block text-xs text-admin-muted">
                {state.enabled
                  ? 'Setiap jamaah pemesan produk ini diminta melengkapi kolom aktif Data Jamaah.'
                  : 'Tidak ada kewajiban data jamaah — cukup data pemesan dari akunnya.'}
              </span>
            </label>
          </div>
          <p className="m-0 text-[11px] text-admin-muted">
            Kolom yang diminta diatur di <Link href={adminHref(locale, '/admin/products/pilgrim-fields')} className="font-semibold text-admin-accent-strong underline">Produk → Data Jamaah</Link>. Tersimpan otomatis.
          </p>
          {error && <p className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
        </div>
      )}
    </MetaBox>
  )
}
