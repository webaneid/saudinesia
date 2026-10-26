'use client'

import Link from 'next/link'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'

type DeleteConfig = {
  /** Kalimat konfirmasi ("Hapus … secara permanen? Bila sudah dipakai, ia dinonaktifkan."). */
  confirmText: string
  onDelete: () => void | Promise<void>
  deleting: boolean
}

type EditPageProps = {
  title: string
  description?: string
  icon?: LucideIcon
  backHref: string
  backLabel: string
  onSubmit: () => void | Promise<void>
  saving: boolean
  canSubmit: boolean
  /** Galat (merah) dan pesan sukses (netral) — keduanya selalu tampil di atas formulir. */
  error?: string | null
  notice?: string | null
  /** Ada = tampilkan zona hapus dengan konfirmasi inline. */
  remove?: DeleteConfig
  /** Elemen di samping judul (mis. lencana status). */
  headerAside?: ReactNode
  children: ReactNode
}

/**
 * Halaman "Ubah" admin sepadan CreatePage (docs/arsitektur-admin-create.md §6): kembali, banner galat/pesan, formulir milik modul (children),
 * bilah simpan `sticky`, dan zona hapus dengan konfirmasi inline (CRUD lengkap: hapus bila tak dirujuk, selain itu dinonaktifkan oleh server).
 */
export function EditPage({ title, description, icon, backHref, backLabel, onSubmit, saving, canSubmit, error, notice, remove, headerAside, children }: EditPageProps) {
  const [confirming, setConfirming] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSubmit && !saving) void onSubmit()
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="space-y-2">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-admin-muted hover:text-admin-ink">
          <ArrowLeft className="size-3.5" /> {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><PageHeader title={title} description={description} icon={icon} /></div>
          {headerAside}
        </div>
      </div>

      {error && <p role="alert" className="m-0 rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm font-medium text-admin-danger">{error}</p>}
      {notice && <p role="status" className="m-0 rounded-xl border border-admin-line bg-admin-spot px-3 py-2 text-sm font-medium text-admin-ink">{notice}</p>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="admin-form-panel">{children}</div>
        <div className="sticky bottom-3 z-10 rounded-2xl border border-admin-line bg-white/95 px-3 py-2.5 shadow-admin backdrop-blur">
          <div className="flex items-center justify-end gap-2">
            <Link href={backHref} className="admin-btn-ghost text-sm">Kembali</Link>
            <button type="submit" disabled={!canSubmit || saving} className="admin-btn disabled:opacity-50">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Menyimpan…' : 'Simpan perubahan'}
            </button>
          </div>
        </div>
      </form>

      {remove && (
        <section aria-label="Hapus" className="space-y-2 rounded-2xl border border-admin-danger/30 p-4">
          <h2 className="m-0 text-sm font-bold text-admin-danger">Hapus</h2>
          {confirming ? (
            <div className="space-y-2">
              <p className="m-0 text-sm text-admin-ink">{remove.confirmText}</p>
              <div className="flex gap-2">
                <button type="button" disabled={remove.deleting} onClick={() => void remove.onDelete()} className="admin-btn bg-admin-danger hover:opacity-90 disabled:opacity-50">
                  {remove.deleting && <Loader2 className="size-4 animate-spin" />} Ya, hapus
                </button>
                <button type="button" disabled={remove.deleting} onClick={() => setConfirming(false)} className="admin-btn-ghost text-sm">Batal</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="admin-btn-sm flex items-center gap-1.5 border border-admin-danger/40 bg-white text-admin-danger hover:bg-admin-danger/10">
              <Trash2 className="size-3.5" /> Hapus
            </button>
          )}
        </section>
      )}
    </div>
  )
}
