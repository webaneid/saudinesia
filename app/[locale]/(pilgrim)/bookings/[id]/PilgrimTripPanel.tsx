'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FolderOpen, Link2, Plus, RefreshCw, Unlink } from 'lucide-react'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { DocumentRepeater } from '@/components/shared/documents/DocumentRepeater'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { checklistState, type ChecklistTone } from '@/lib/documents/checklistLabels'

// Data & dokumen satu jamaah di booking milik jamaah (docs/arsitektur-jamaah.md §5.5 butir 2): pilih dari Jamaah Saya (snapshot — mengedit kartu
// kemudian tidak mengubah booking sampai "Perbarui"), checklist kelengkapan (dihitung server), dan dokumen per perjalanan. Paspor/KTP diunggah di kartu.
export type TripChecklistItem = { key: string; label: string; required: boolean; state: string }

type Props = {
  locale: string
  bookingId: string
  pilgrimId: string
  linked: { id: string; name: string } | null
  checklist: TripChecklistItem[]
}

const VARIANT: Record<ChecklistTone, 'success' | 'warning' | 'destructive' | 'muted'> = { ok: 'success', warning: 'warning', danger: 'destructive', neutral: 'muted' }

export function PilgrimTripPanel({ locale, bookingId, pilgrimId, linked, checklist }: Props) {
  const router = useRouter()
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [cardId, setCardId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'refresh' | 'unlink' | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const base = `/api/v1/bookings/${bookingId}/pilgrims/${pilgrimId}`

  useEffect(() => {
    if (linked) return
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/v1/account/pilgrims?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((j: { success: boolean; data?: { id: string; fullName: string; isSelf: boolean }[] }) =>
        setOptions((j.data ?? []).map(c => ({ id: c.id, label: c.fullName, hint: c.isSelf ? 'Saya sendiri' : undefined }))))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [q, linked])

  async function call(method: 'PUT' | 'DELETE', body: object | undefined, done: string) {
    setBusy(true); setNotice(null); setConfirming(null)
    try {
      const res = await fetch(`${base}/card`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setNotice({ text: json?.error ?? 'Gagal menyimpan.', error: true }); return }
      setNotice({ text: done, error: false })
      setCardId('')
      router.refresh()
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {linked ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/${locale}/jamaah/${linked.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <FolderOpen className="h-4 w-4" /> {linked.name} — kelola data & dokumen di Jamaah Saya
            </Link>
          </div>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span>{confirming === 'refresh'
                ? 'Ganti data jamaah di booking ini dengan isi Jamaah Saya saat ini?'
                : 'Lepas tautan? Data jamaah di booking ini tetap seperti sekarang.'}</span>
              <Button size="sm" disabled={busy}
                onClick={() => confirming === 'refresh'
                  ? call('PUT', { cardId: linked.id }, 'Data jamaah diperbarui dari Jamaah Saya.')
                  : call('DELETE', undefined, 'Tautan dilepas.')}>
                Ya, lanjutkan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>Batal</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirming('refresh')} disabled={busy}><RefreshCw className="h-4 w-4" /> Perbarui dari Jamaah Saya</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming('unlink')} disabled={busy}><Unlink className="h-4 w-4" /> Lepas</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Pilih data jamaah ini dari Jamaah Saya — data dan dokumennya terisi otomatis.</p>
          <div className="flex flex-wrap items-center gap-2">
            <AutocompleteSelect options={options} value={cardId} onChange={v => setCardId(v ?? '')} onSearch={setQ} loading={loading}
              placeholder="Pilih dari Jamaah Saya…" ariaLabel="Jamaah Saya" className="min-w-64" />
            <Button size="sm" onClick={() => call('PUT', { cardId }, 'Data jamaah terisi dari Jamaah Saya.')} disabled={busy || !cardId}><Link2 className="h-4 w-4" /> Pakai</Button>
            <Link href={`/${locale}/jamaah/new`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Plus className="h-4 w-4" /> Tambah jamaah</Link>
          </div>
        </div>
      )}
      {notice && <p className={`text-sm ${notice.error ? 'text-destructive' : 'text-muted-foreground'}`} role="status">{notice.text}</p>}

      {checklist.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Kelengkapan dokumen</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {checklist.map(c => {
              const st = checklistState(c.state)
              return (
                <li key={c.key} className="flex items-center justify-between gap-2 text-sm">
                  <span>{c.label}{c.required ? '' : ' (opsional)'}</span>
                  <Badge variant={VARIANT[st.tone]}>{st.label}</Badge>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {linked && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Dokumen perjalanan ini (tiket, reservasi). Paspor, KTP, dan dokumen pribadi diunggah di Jamaah Saya.</p>
          <DocumentRepeater endpoint={`${base}/documents`} />
        </div>
      )}
    </div>
  )
}
