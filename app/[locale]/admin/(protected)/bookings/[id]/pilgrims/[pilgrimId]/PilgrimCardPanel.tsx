'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Link2, Pencil, Plus, Unlink, UserCheck } from 'lucide-react'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { Button } from '@/components/admin/ui/Button'
import { PilgrimCardDialog } from '@/components/shared/pilgrims/PilgrimCardDialog'
import { EMPTY_PILGRIM_FORM, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import { contactFromStored } from '@/components/shared/ContactPicker'
import type { AddressValue } from '@/components/shared/AddressPicker'
import { WARNING_TEXT } from '@/components/shared/pilgrims/warningText'
import type { PilgrimWarning } from '@/lib/pilgrims/service'
import { useConfirm } from '@/components/admin/ui/useConfirm'

// Tautan jamaah booking ↔ data jamaah tersimpan pelanggan (docs/arsitektur-jamaah.md §5.3, Fase 7a) — kotak "Kartu jamaah" di halaman Kelola jamaah
// (pilgrims/[pilgrimId]; halaman booking hanya memeriksa). Menautkan / memperbarui mengisi field berperan dari kartu (snapshot). Kartu baru dan ubah
// kartu = popup bersama PilgrimCardDialog (ubah → kartu disalin ulang ke jamaah booking) — sama dengan halaman booking jamaah, lewat route admin.

type Props = {
  locale: string
  bookingId: string
  pilgrimId: string
  customerId: string
  linked: { id: string; name: string } | null
  /** Pemesan sebagai jamaah: kartu "Saya sendiri" pelanggan (bila ada), sudah dipakai di booking ini, dan data akun pelanggan untuk mengisi kartu baru. */
  self: { cardId: string | null; usedHere: boolean; fullName: string; email: string; phone: string | null; whatsapp: string | null; address: AddressValue | null }
  /** Data jamaah dikunci selama diperiksa/terverifikasi (isReviewLocked) — ubah/lepas disembunyikan. */
  locked: boolean
}

export function PilgrimCardPanel({ locale, bookingId, pilgrimId, customerId, linked, self, locked }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [cardId, setCardId] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [creating, setCreating] = useState<'new' | 'self' | 'edit' | null>(null)
  const base = `/api/v1/admin/bookings/${bookingId}/pilgrims/${pilgrimId}`
  const cards = `/api/v1/admin/customers/${customerId}/pilgrims`

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

  /** Mengembalikan pesan galat (null = berhasil). */
  async function call(method: 'PUT' | 'DELETE', body?: object, done?: string): Promise<string | null> {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`${base}/card`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { const text = json?.error ?? 'Gagal menyimpan.'; setNotice({ text, error: true }); return text }
      setNotice({ text: done ?? 'Tersimpan.', error: false })
      setCardId('')
      setCreating(null)
      router.refresh()
      return null
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
      return 'Tidak dapat menghubungi server.'
    } finally { setBusy(false) }
  }

  const linkNew = (id: string, warnings: PilgrimWarning[]) =>
    call('PUT', { cardId: id }, ['Data jamaah tersimpan di pelanggan dan ditautkan.', ...warnings.map(w => WARNING_TEXT[w])].join(' '))
  // Pemesan sebagai jamaah: kartu "Saya sendiri" pelanggan yang sudah ada langsung ditautkan; belum ada → popup terisi dari akun pelanggan.
  function pickSelf() {
    if (self.cardId) { void call('PUT', { cardId: self.cardId }, 'Pemesan ditautkan sebagai jamaah ini.'); return }
    setNotice(null); setCreating('self')
  }
  const selfForm = (): SavedPilgrimFormValue => ({
    ...EMPTY_PILGRIM_FORM, fullName: self.fullName, email: self.email, isSelf: true, contact: contactFromStored(self.phone ?? '', self.whatsapp ?? ''),
    ...(self.address ? { address: self.address } : {}),
  })

  async function unlink() {
    if (!(await ask({ title: 'Lepas tautan kartu?', body: 'Data jamaah di booking ini tetap seperti sekarang; hanya tautannya yang dilepas.', confirmLabel: 'Lepas' }))) return
    await call('DELETE', undefined, 'Tautan dilepas.')
  }

  return (
    <div className="space-y-3">
      {linked ? (
        <>
          <p className="m-0 text-[13px] text-admin-ink">
            Tertaut ke kartu{' '}
            <Link href={`/${locale}/admin/customers/${customerId}/pilgrims/${linked.id}`} className="font-semibold text-admin-accent hover:underline">{linked.name}</Link>
            <span className="text-admin-muted"> milik pelanggan — isian berperan (nama, NIK, paspor, …) disalin dari kartu ini.</span>
          </p>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setNotice(null); setCreating('edit') }} disabled={busy}><Pencil className="h-3.5 w-3.5" /> Ubah data kartu</Button>
              <Button size="sm" variant="ghost" onClick={unlink} disabled={busy}><Unlink className="h-3.5 w-3.5" /> Lepas tautan</Button>
            </div>
          )}
        </>
      ) : locked ? (
        <p className="m-0 text-[13px] text-admin-muted">Belum ditautkan ke kartu jamaah.</p>
      ) : (
        <>
          <p className="m-0 text-[13px] text-admin-muted">Pilih jamaah tersimpan milik pelanggan, atau buat yang baru. Dokumen pribadi diunggah ke kartu itu.</p>
          <div className="flex flex-wrap items-center gap-2">
            <AutocompleteSelect options={options} value={cardId} onChange={v => setCardId(v ?? '')} onSearch={setQ} loading={loading} placeholder="Pilih jamaah tersimpan…" ariaLabel="Jamaah tersimpan pelanggan" className="min-w-64" />
            <Button size="sm" onClick={() => call('PUT', { cardId }, 'Kartu ditautkan; data jamaah terisi dari kartu.')} disabled={busy || !cardId}><Link2 className="h-3.5 w-3.5" /> Tautkan</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!self.usedHere && <Button size="sm" variant="secondary" onClick={pickSelf} disabled={busy}><UserCheck className="h-3.5 w-3.5" /> Jadikan pemesan jamaah</Button>}
            <Button size="sm" variant="secondary" onClick={() => { setNotice(null); setCreating('new') }} disabled={busy}><Plus className="h-3.5 w-3.5" /> Tambah jamaah baru</Button>
          </div>
        </>
      )}
      {notice && <p className={`m-0 text-[12px] ${notice.error ? 'text-admin-danger' : 'text-admin-muted'}`} role="status">{notice.text}</p>}

      {creating === 'edit' && linked && (
        <PilgrimCardDialog
          endpoint={cards}
          cardId={linked.id}
          intro="Perubahan tersimpan di data jamaah milik pelanggan dan langsung disalin ke jamaah booking ini."
          idPrefix={`sp-${pilgrimId}`}
          title="Ubah data kartu jamaah"
          showSelf={!self.cardId || self.cardId === linked.id}
          saveLabel="Simpan"
          onClose={() => setCreating(null)}
          onSaved={(id, warnings) => call('PUT', { cardId: id }, ['Data jamaah diperbarui.', ...warnings.map(w => WARNING_TEXT[w])].join(' '))}
        />
      )}
      {(creating === 'new' || creating === 'self') && (
        <PilgrimCardDialog
          endpoint={cards}
          intro="Data ini tersimpan di data jamaah milik pelanggan, jadi bisa dipakai lagi untuk pesanan berikutnya. Paspor dan KTP diunggah sesudah disimpan."
          idPrefix={`sp-${pilgrimId}`}
          title={creating === 'self' ? 'Pemesan sebagai jamaah' : 'Tambah jamaah baru'}
          initial={creating === 'self' ? selfForm() : EMPTY_PILGRIM_FORM}
          showSelf={creating === 'new' && !self.cardId}
          onClose={() => setCreating(null)}
          onSaved={linkNew}
        />
      )}
      {dialog}
    </div>
  )
}
