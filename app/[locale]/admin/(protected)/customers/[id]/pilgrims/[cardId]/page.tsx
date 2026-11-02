'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { Badge } from '@/components/admin/ui/Badge'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { DocumentRepeater } from '@/components/shared/documents/DocumentRepeater'
import { bodyFromForm, canSubmitPilgrim, formFromCard, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import type { SavedPilgrimView } from '@/lib/pilgrims/service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i // segmen URL dipakai membangun URL API — jangan biarkan '../' atau '?' lewat

// Ubah jamaah tersimpan pelanggan (staf). NIK/paspor tersimpan hanya tampil tersamar; membuka NIK utuh = gudang identitas (Fase 8, berjejak).
export default function CustomerPilgrimEditPage() {
  const { locale, id, cardId } = useParams() as { locale: string; id: string; cardId: string }
  const valid = UUID.test(id) && UUID.test(cardId)
  const customerHref = `/${locale}/admin/customers/${valid ? id : ''}`
  const endpoint = valid ? `/api/v1/admin/customers/${id}/pilgrims/${cardId}` : '/api/v1/admin/customers/invalid/pilgrims/invalid' // route menjawab 404
  const e = useEditEntity<SavedPilgrimView>(endpoint, customerHref)
  const [form, setForm] = useState<SavedPilgrimFormValue | null>(null)
  const { dirty, markClean } = useDirtyForm(form)
  const resync = useRef(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  // Formulir diisi SEKALI dari data muat; sesudah simpan/pulihkan diisi ulang dari jawaban server (kolom NIK/paspor kembali kosong = tetap).
  useEffect(() => {
    const c = e.item
    if (c && (!form || resync.current)) {
      resync.current = false
      const f = formFromCard(c)
      setForm(f); markClean(f)
    }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Data jamaah tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={customerHref}>Kembali ke pelanggan</a></p>
  if (e.loading || !form || !e.item) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>
  const archived = e.item.archived

  async function restore() {
    setRestoring(true); setRestoreError(null)
    try {
      const res = await fetch(`${endpoint}/restore`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) { setRestoreError(json?.error ?? 'Gagal memulihkan.'); return }
      resync.current = true
      await e.reload()
    } catch {
      setRestoreError('Tidak dapat menghubungi server.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <EditPage
      icon={UserRound} title={e.item.fullName} backHref={customerHref} backLabel="Detail pelanggan"
      headerAside={<>{e.item.isSelf && <Badge tone="neutral">Pemilik akun</Badge>}{archived && <Badge tone="warning">Diarsipkan</Badge>}</>}
      dirty={dirty}
      onSubmit={async () => { resync.current = true; if (!(await e.save(bodyFromForm(form)))) resync.current = false }}
      saving={e.saving} canSubmit={!archived && canSubmitPilgrim(form)} error={e.error ?? restoreError} notice={e.notice}
      remove={archived ? undefined : {
        confirmText: 'Hapus data jamaah ini? Bila pernah dipakai booking, ia hanya diarsipkan (riwayat pesanan tetap utuh, bisa dipulihkan).',
        onDelete: async () => { await e.remove() },
        deleting: e.deleting,
      }}
      sidebar={
        archived ? (
          <MetaBox title="Arsip" collapsible={false}>
            <p className="m-0 text-[12px] text-admin-muted">Diarsipkan karena pernah dipakai booking. Pulihkan dulu untuk mengubahnya.</p>
            <button type="button" onClick={restore} disabled={restoring} className="admin-btn-sm mt-2 disabled:opacity-50">{restoring ? 'Memulihkan…' : 'Pulihkan dari arsip'}</button>
          </MetaBox>
        ) : (
          <p className="m-0 rounded-2xl border border-admin-line bg-white p-4 text-[11px] text-admin-muted">
            Kosongkan kolom NIK atau nomor paspor untuk mempertahankan nilai tersimpan. Perubahan dicatat atas nama Anda.
          </p>
        )
      }
      after={
        <section className="admin-form-panel space-y-3">
          <div>
            <h2 className="m-0 text-sm font-semibold text-admin-ink">Dokumen</h2>
            <p className="m-0 text-[12px] text-admin-muted">Unggah atas nama pelanggan — tercatat sebagai unggahan petugas. Pemeriksaan dokumen menyusul di antrean verifikasi.</p>
          </div>
          <DocumentRepeater endpoint={`${endpoint}/documents`} readOnly={archived} />
        </section>
      }
    >
      <fieldset disabled={archived} className="m-0 min-w-0 border-0 p-0">
        <SavedPilgrimFields value={form} onChange={v => { e.clearMessages(); setForm(v) }} />
      </fieldset>
    </EditPage>
  )
}
