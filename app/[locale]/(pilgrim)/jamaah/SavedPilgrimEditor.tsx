'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { WARNING_TEXT } from '@/components/shared/pilgrims/warningText'
import { EMPTY_PILGRIM_FORM, bodyFromForm, canSubmitPilgrim, formFromCard, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import type { PilgrimWarning, SavedPilgrimView } from '@/lib/pilgrims/service'

// Tambah/ubah kartu "Jamaah Saya" (Fase 3). Respons selalu diperiksa: galat server tampil, formulir tidak ditutup.
// Peringatan NIK hanya dari masukan sendiri (tak pernah menyebut akun lain) — tampil sesudah simpan, tidak menghalangi.

type Props = { locale: string; card?: SavedPilgrimView; initialWarnings?: PilgrimWarning[]; initialNotice?: string }

const API = '/api/v1/account/pilgrims'

export function SavedPilgrimEditor({ locale, card, initialWarnings = [], initialNotice }: Props) {
  const router = useRouter()
  const base = `/${locale}/jamaah`
  const [form, setForm] = useState<SavedPilgrimFormValue>(() => (card ? formFromCard(card) : EMPTY_PILGRIM_FORM))
  const [busy, setBusy] = useState<'save' | 'delete' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null)
  const [warnings, setWarnings] = useState<PilgrimWarning[]>(initialWarnings)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [archived, setArchived] = useState(card?.archived ?? false)

  async function call(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
    const res = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
    const json = await res.json().catch(() => null)
    return { res, json: json as { success?: boolean; data?: Record<string, unknown>; error?: string; meta?: { warnings?: PilgrimWarning[] } } | null }
  }

  async function save() {
    if (!canSubmitPilgrim(form) || busy) return
    setBusy('save'); setError(null); setNotice(null); setWarnings([])
    try {
      const { res, json } = await call(card ? 'PUT' : 'POST', card ? `${API}/${card.id}` : API, bodyFromForm(form))
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Data jamaah gagal disimpan.'); return }
      const saved = json.data as unknown as SavedPilgrimView
      const w = json.meta?.warnings ?? []
      if (!card) { router.push(`${base}/${saved.id}${w.length ? `?w=${w.join(',')}` : '?saved=1'}`); return }
      setForm(formFromCard(saved))
      setWarnings(w)
      setNotice('Data jamaah tersimpan.')
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!card || busy) return
    setBusy('delete'); setError(null); setNotice(null)
    try {
      const { res, json } = await call('DELETE', `${API}/${card.id}`)
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Gagal menghapus.'); return }
      if (json.data.deleted) { router.push(base); return }
      setNotice(typeof json.data.message === 'string' ? json.data.message : 'Diarsipkan.')
      setConfirmDelete(false)
      setArchived(true)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (!card || busy) return
    setBusy('restore'); setError(null); setNotice(null)
    try {
      const { res, json } = await call('POST', `${API}/${card.id}/restore`)
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Gagal memulihkan.'); return }
      setNotice('Data jamaah dipulihkan dari arsip.')
      setArchived(false)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Link href={base} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Jamaah Saya</Link>
        <h1 className="text-2xl font-bold">{card ? card.fullName : 'Tambah Jamaah'}</h1>
      </div>

      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">{notice}</p>}
      {warnings.length > 0 && (
        <ul role="status" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {warnings.map(w => <li key={w}>{WARNING_TEXT[w]}</li>)}
        </ul>
      )}

      {archived ? (
        <div className="space-y-3 rounded-xl border bg-card p-6">
          <p className="text-sm">Data jamaah ini diarsipkan karena pernah dipakai booking. Pulihkan dulu untuk mengubahnya.</p>
          <Button type="button" onClick={restore} disabled={busy !== null}>{busy === 'restore' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Pulihkan dari arsip</Button>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-5 rounded-xl border bg-card p-6">
          <SavedPilgrimFields value={form} onChange={setForm} />
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button type="submit" disabled={!canSubmitPilgrim(form) || busy !== null}>{busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy === 'save' ? 'Menyimpan…' : 'Simpan'}</Button>
            <Button asChild variant="ghost"><Link href={base}>Batal</Link></Button>
          </div>
        </form>
      )}

      {card && !archived && (
        <div className="space-y-2 rounded-xl border border-destructive/30 p-4">
          <p className="text-sm font-semibold">Hapus data jamaah</p>
          <p className="text-xs text-muted-foreground">Data yang belum pernah dipakai booking dihapus permanen; yang pernah dipakai diarsipkan supaya riwayat pesanan tetap utuh.</p>
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Hapus {card.fullName}?</span>
              <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={busy !== null}>{busy === 'delete' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ya, hapus</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>Batal</Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>Hapus</Button>
          )}
        </div>
      )}
    </div>
  )
}
