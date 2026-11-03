'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { IdCard, Link2, Plus, RefreshCw, Unlink } from 'lucide-react'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { DocumentRepeater } from '@/components/shared/documents/DocumentRepeater'
import { useConfirm } from '@/components/admin/ui/useConfirm'

// Tautan jamaah booking ↔ data jamaah tersimpan pelanggan (docs/arsitektur-jamaah.md §5.3, Fase 7a). Menautkan / memperbarui mengisi field
// berperan dari kartu (snapshot; kartu diedit kemudian tidak mengubahnya). Checklist dihitung server (evaluateCompleteness); dokumen milik orang
// dikelola di kartu, dokumen per perjalanan (tiket, reservasi) diunggah di sini.
export type ChecklistItem = { key: string; label: string; required: boolean; state: string }

type Props = {
  locale: string
  bookingId: string
  pilgrimId: string
  customerId: string
  linked: { id: string; name: string } | null
  checklist: ChecklistItem[]
}

const STATE: Record<string, { label: string; tone: 'ok' | 'warning' | 'danger' | 'neutral' }> = {
  accepted: { label: 'Diterima', tone: 'ok' },
  pending: { label: 'Menunggu', tone: 'warning' },
  missing: { label: 'Belum ada', tone: 'danger' },
  rejected: { label: 'Ditolak', tone: 'danger' },
  expired: { label: 'Habis berlaku', tone: 'danger' },
  too_short: { label: 'Masa berlaku kurang', tone: 'danger' },
}

export function PilgrimCardPanel({ locale, bookingId, pilgrimId, customerId, linked, checklist }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [cardId, setCardId] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const base = `/api/v1/admin/bookings/${bookingId}/pilgrims/${pilgrimId}`

  useEffect(() => {
    if (linked) return
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/v1/admin/customers/${customerId}/pilgrims?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((j: { success: boolean; data?: { id: string; fullName: string; isSelf: boolean }[] }) =>
        setOptions((j.data ?? []).map(c => ({ id: c.id, label: c.fullName, hint: c.isSelf ? 'Pemesan' : undefined }))))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [customerId, q, linked])

  async function call(method: 'PUT' | 'DELETE', body?: object, done?: string) {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`${base}/card`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setNotice({ text: json?.error ?? 'Gagal menyimpan.', error: true }); return }
      setNotice({ text: done ?? 'Tersimpan.', error: false })
      setCardId('')
      router.refresh()
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
    } finally { setBusy(false) }
  }

  async function refresh() {
    if (!linked) return
    if (!(await ask({ title: 'Perbarui dari data tersimpan?', body: 'Field data jamaah yang terikat kartu ditimpa dengan isi kartu saat ini. Field lain tidak berubah.', confirmLabel: 'Perbarui', tone: 'primary' }))) return
    await call('PUT', { cardId: linked.id }, 'Data jamaah diperbarui dari kartu.')
  }

  async function unlink() {
    if (!(await ask({ title: 'Lepas tautan kartu?', body: 'Data jamaah di booking ini tetap seperti sekarang; hanya tautannya yang dilepas.', confirmLabel: 'Lepas' }))) return
    await call('DELETE', undefined, 'Tautan dilepas.')
  }

  return (
    <div className="space-y-3 rounded-lg border border-admin-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 flex items-center gap-1.5 text-[12px] font-semibold text-admin-ink"><IdCard className="h-3.5 w-3.5" /> Data jamaah tersimpan</p>
        {linked
          ? <Link href={`/${locale}/admin/customers/${customerId}/pilgrims/${linked.id}`} className="text-[12px] font-medium text-admin-accent hover:underline">{linked.name}</Link>
          : <Badge tone="neutral">Belum ditautkan</Badge>}
      </div>

      {linked ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={refresh} disabled={busy}><RefreshCw className="h-3.5 w-3.5" /> Perbarui dari kartu</Button>
          <Button size="sm" variant="ghost" onClick={unlink} disabled={busy}><Unlink className="h-3.5 w-3.5" /> Lepas</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <AutocompleteSelect options={options} value={cardId} onChange={v => setCardId(v ?? '')} onSearch={setQ} loading={loading} placeholder="Pilih jamaah tersimpan…" ariaLabel="Jamaah tersimpan pelanggan" className="min-w-64" />
          <Button size="sm" onClick={() => call('PUT', { cardId }, 'Kartu ditautkan; data jamaah terisi dari kartu.')} disabled={busy || !cardId}><Link2 className="h-3.5 w-3.5" /> Tautkan</Button>
          <Link href={`/${locale}/admin/customers/${customerId}/pilgrims/new`} className="inline-flex items-center gap-1 text-[12px] font-medium text-admin-accent hover:underline"><Plus className="h-3.5 w-3.5" /> Jamaah baru</Link>
        </div>
      )}
      {notice && <p className={`m-0 text-[12px] ${notice.error ? 'text-admin-danger' : 'text-admin-muted'}`} role="status">{notice.text}</p>}

      {checklist.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
          {checklist.map(c => (
            <li key={c.key} className="flex items-center justify-between gap-2 text-[12px] text-admin-ink">
              <span>{c.label}{c.required ? '' : ' (opsional)'}</span>
              <Badge tone={STATE[c.state]?.tone ?? 'neutral'}>{STATE[c.state]?.label ?? c.state}</Badge>
            </li>
          ))}
        </ul>
      )}
      {linked
        ? (
          <div className="space-y-1">
            <p className="m-0 text-[11.5px] text-admin-muted">Dokumen per perjalanan (tiket, reservasi). Paspor, KTP, dan dokumen milik orang dikelola di kartu jamaah.</p>
            <DocumentRepeater endpoint={`${base}/documents`} />
          </div>
        )
        : checklist.length > 0 && <p className="m-0 text-[11.5px] text-admin-muted">Tautkan kartu untuk melihat dan mengunggah dokumen.</p>}
      {dialog}
    </div>
  )
}
