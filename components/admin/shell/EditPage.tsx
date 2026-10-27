'use client'

import { useEffect, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ImageIcon } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { DeleteBox } from '@/components/admin/editor/DeleteBox'

type DeleteConfig = {
  /** Kalimat konfirmasi ("Hapus … secara permanen? Bila sudah dipakai, ia dinonaktifkan."). */
  confirmText: string
  onDelete: () => unknown
  deleting: boolean
  label?: string
}

type EditPageProps = {
  title: string
  description?: string
  icon?: LucideIcon
  backHref: string
  backLabel: string
  onSubmit: () => unknown
  saving: boolean
  canSubmit: boolean
  /** Galat (merah) dan pesan sukses (netral) — keduanya selalu tampil di atas formulir. */
  error?: string | null
  notice?: string | null
  /** Ada = tampilkan zona hapus dengan konfirmasi inline. */
  remove?: DeleteConfig
  /** Elemen di samping judul (mis. lencana status). */
  headerAside?: ReactNode
  /** Status aktif di kotak Terbitkan (keduanya, atau tak ada). */
  active?: boolean
  onActiveChange?: (active: boolean) => void
  /** Pelacakan "belum disimpan" (useDirtyForm); tidak diisi = tidak dilacak. */
  dirty?: boolean
  /** Kotak "Foto" di kolom kanan (mis. MediaField — punya tombol/unggahan sendiri, di luar `<form>`). */
  media?: ReactNode
  mediaTitle?: string
  /** Kotak tambahan di kolom kanan, di bawah Foto (ringkasan, atribut). */
  sidebar?: ReactNode
  /** Bagian di bawah formulir di kolom utama tetapi di luar `<form>` (mis. Komponen Biaya — tombolnya tidak boleh ikut menyubmit formulir). */
  after?: ReactNode
  children: ReactNode
}

/**
 * Halaman "Ubah" admin ala WordPress (docs/arsitektur-admin-editor.md §5): formulir milik modul (children) di kolom kiri; kolom kanan lengket berisi
 * Terbitkan (status + Simpan), Foto, kotak tambahan, dan Hapus dengan konfirmasi inline (CRUD lengkap: hapus bila tak dirujuk, selain itu dinonaktifkan oleh server).
 */
export function EditPage({
  title, description, icon, backHref, backLabel, onSubmit, saving, canSubmit, error, notice, remove, headerAside,
  active, onActiveChange, dirty, media, mediaTitle = 'Foto Unggulan', sidebar, after, children,
}: EditPageProps) {
  const submit = () => { if (canSubmit && !saving) void Promise.resolve(onSubmit()) }

  // Tekan Enter di kolom teks menyimpan (perilaku formulir lama); Enter di editor teks kaya / textarea tidak.
  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'submit') { e.preventDefault(); submit() }
  }

  useEffect(() => {
    if (dirty === undefined || !dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  return (
    <EditorShell
      backHref={backHref}
      backLabel={backLabel}
      banner={
        <>
          {error && <p role="alert" className="m-0 rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm font-medium text-admin-danger">{error}</p>}
          {notice && <p role="status" className="m-0 rounded-xl border border-admin-line bg-admin-spot px-3 py-2 text-sm font-medium text-admin-ink">{notice}</p>}
        </>
      }
      title={
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><PageHeader title={title} description={description} icon={icon} /></div>
          {headerAside}
        </div>
      }
      main={
        <>
          <form onSubmit={e => { e.preventDefault(); submit() }} onKeyDown={onKeyDown} className="admin-form-panel">{children}</form>
          {after}
        </>
      }
      sidebar={
        <>
          <PublishBox active={active} onActiveChange={onActiveChange} onSave={submit} saving={saving} dirty={dirty} canSave={canSubmit} />
          {media && <MetaBox title={mediaTitle} icon={ImageIcon} collapsible={false}>{media}</MetaBox>}
          {sidebar}
          {remove && <DeleteBox confirmText={remove.confirmText} onDelete={remove.onDelete} deleting={remove.deleting} label={remove.label} />}
        </>
      }
      mobileBar={
        <button type="button" onClick={submit} disabled={!canSubmit || saving || dirty === false} className="admin-btn w-full disabled:opacity-50">
          {saving ? 'Menyimpan…' : 'Simpan perubahan'}
        </button>
      }
    />
  )
}
