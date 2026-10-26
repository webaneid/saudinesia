'use client'

import Link from 'next/link'
import type { FormEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'

type CreatePageProps = {
  title: string
  description?: string
  icon?: LucideIcon
  /** Tujuan tombol kembali dan Batal (halaman daftar modul). */
  backHref: string
  backLabel: string
  /** Dipanggil saat formulir dikirim (tombol atau Enter di kolom teks). */
  onSubmit: () => void | Promise<void>
  saving: boolean
  /** false = tombol simpan nonaktif (mis. kolom wajib belum terisi). */
  canSubmit: boolean
  /** Pesan galat dari server/validasi; SELALU tampil, formulir tidak pernah menutup sendiri saat gagal. */
  error?: string | null
  submitLabel?: string
  children: ReactNode
}

/**
 * Halaman "Buat baru" admin (docs/arsitektur-admin-create.md): pengganti panel sebaris di atas daftar. Judul + kembali, isi formulir milik
 * modul (children), banner galat, dan bilah aksi `sticky` di dasar area konten supaya Simpan/Batal selalu terjangkau pada formulir panjang.
 */
export function CreatePage({ title, description, icon, backHref, backLabel, onSubmit, saving, canSubmit, error, submitLabel = 'Simpan', children }: CreatePageProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSubmit && !saving) void onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-5">
      <div className="space-y-2">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-admin-muted hover:text-admin-ink">
          <ArrowLeft className="size-3.5" /> {backLabel}
        </Link>
        <PageHeader title={title} description={description} icon={icon} />
      </div>

      {error && <p role="alert" className="m-0 rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm font-medium text-admin-danger">{error}</p>}

      <div className="admin-form-panel">{children}</div>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-admin-line bg-white/95 px-3 py-2.5 shadow-admin backdrop-blur">
        <div className="flex items-center justify-end gap-2">
          <Link href={backHref} className="admin-btn-ghost text-sm">Batal</Link>
          <button type="submit" disabled={!canSubmit || saving} className="admin-btn disabled:opacity-50">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Menyimpan…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
