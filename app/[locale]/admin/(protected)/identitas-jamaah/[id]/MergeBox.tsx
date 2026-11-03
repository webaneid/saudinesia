'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GitMerge, Search } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { formatCalendarDate, DATE_LONG, type CalendarDate } from '@/lib/time'
import { useIdentityAction } from './useIdentityAction'

type Found = { id: string; fullName: string; birthDate: CalendarDate | null; hasNik: boolean; cards: number; bookings: number }
type Props = { locale: string; identityId: string; fullName: string }

// Gabung dua identitas orang yang sama (§4.4): cari identitas lain (nama / NIK 16 digit), lalu petugas memilih identitas mana yang DIPAKAI.
// Kunci identitas yang lain menjadi alias sehingga kartu berkunci itu tetap tertaut ke identitas yang dipakai.
export function MergeBox({ locale, identityId, fullName }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const { busy, notice, setNotice, send } = useIdentityAction()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [other, setOther] = useState<Found | null>(null)
  const [keep, setKeep] = useState<'this' | 'other'>('this')

  async function search() {
    if (!q.trim()) return
    setNotice(null); setOther(null)
    const res = await fetch(`/api/v1/admin/identities?limit=10&q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!res.ok) { setNotice({ text: json?.error ?? 'Pencarian gagal.', error: true }); return }
    setFound((json.data as Found[]).filter(f => f.id !== identityId))
  }

  async function merge() {
    if (!other) return
    const kept = keep === 'this' ? fullName : other.fullName
    if (!(await ask({ title: 'Gabungkan dua identitas?', body: `Identitas yang dipakai: ${kept}. Kartu, riwayat booking, dan jejak identitas lain pindah ke sana; identitas lain dihapus. Tidak dapat dibatalkan.`, confirmLabel: 'Gabungkan', tone: 'danger' }))) return
    const r = await send(`/api/v1/admin/identities/${identityId}/merge`, 'POST', { otherId: other.id, keep }, 'Identitas digabung.', false)
    if (r.ok) router.push(`/${locale}/admin/identitas-jamaah/${(r.data as { identityId: string }).identityId}`)
  }

  return (
    <div className="space-y-2 text-[12.5px]">
      <div className="flex gap-1.5">
        <input className="admin-inp min-w-0 flex-1" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
          maxLength={100} placeholder="Nama atau NIK identitas lain" aria-label="Cari identitas lain" />
        <button type="button" onClick={search} aria-label="Cari" className="admin-btn-sm border border-admin-line bg-white"><Search className="size-3.5" /></button>
      </div>
      {found && found.length === 0 && <p className="m-0 text-admin-muted">Tidak ada identitas lain yang cocok.</p>}
      {found && found.length > 0 && !other && (
        <ul className="m-0 list-none space-y-1 p-0">
          {found.map(f => (
            <li key={f.id}>
              <button type="button" onClick={() => setOther(f)} className="w-full rounded-md border border-admin-line px-2 py-1.5 text-left hover:bg-admin-spot">
                <span className="font-semibold text-admin-ink">{f.fullName}</span>
                <span className="block text-admin-muted">{f.birthDate ? formatCalendarDate(f.birthDate, DATE_LONG) : '-'} · {f.hasNik ? 'NIK' : 'Paspor'} · {f.cards} kartu · {f.bookings} booking</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {other && (
        <fieldset className="m-0 space-y-1.5 border-0 p-0">
          <legend className="mb-1 font-semibold text-admin-ink">Identitas mana yang dipakai?</legend>
          {([['this', fullName], ['other', other.fullName]] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="keep" checked={keep === v} onChange={() => setKeep(v)} /> {label}{v === 'this' ? ' (identitas ini)' : ''}</label>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={busy} onClick={merge} className="admin-btn-sm inline-flex items-center gap-1 bg-admin-danger text-white hover:opacity-90 disabled:opacity-50"><GitMerge className="size-3.5" /> Gabungkan</button>
            <button type="button" onClick={() => setOther(null)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </fieldset>
      )}
      {notice && <p role={notice.error ? 'alert' : 'status'} className={`m-0 ${notice.error ? 'text-admin-danger' : 'text-admin-muted'}`}>{notice.text}</p>}
      {dialog}
    </div>
  )
}
