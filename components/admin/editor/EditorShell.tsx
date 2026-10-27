import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

type Props = {
  backHref: string
  backLabel: string
  /** Judul besar yang dapat diedit (input nama ala WordPress). */
  title: ReactNode
  /** Kolom kiri: konten + kotak meta. */
  main: ReactNode
  /** Kolom kanan (lengket di layar lebar): Terbitkan, Gambar Unggulan, atribut, ringkasan. */
  sidebar: ReactNode
  /** Bilah aksi lengket di dasar HP (mis. tombol Simpan) karena kotak Terbitkan ada di bawah halaman. */
  mobileBar?: ReactNode
  /** Banner galat/pesan di atas kedua kolom. */
  banner?: ReactNode
}

/**
 * Tata letak editor ala WordPress (docs/arsitektur-admin-editor.md): judul besar + konten dan kotak meta di kiri, kotak samping di kanan.
 * Layar lebar: dua kolom dengan sidebar lengket; HP: satu kolom, sidebar di bawah konten dan bilah simpan lengket di dasar.
 */
export function EditorShell({ backHref, backLabel, title, main, sidebar, mobileBar, banner }: Props) {
  return (
    <div className="space-y-4">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-admin-muted hover:text-admin-ink">
        <ArrowLeft className="size-3.5" /> {backLabel}
      </Link>
      {banner}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {title}
          {main}
        </div>
        <aside aria-label="Pengaturan samping" className="space-y-4 lg:sticky lg:top-20">{sidebar}</aside>
      </div>
      {mobileBar && <div className="sticky bottom-3 z-10 rounded-2xl border border-admin-line bg-white/95 px-3 py-2.5 shadow-admin backdrop-blur lg:hidden">{mobileBar}</div>}
    </div>
  )
}
