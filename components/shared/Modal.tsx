'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Bagian bawah yang tetap terlihat (tombol aksi) saat isi digulir. */
  footer?: ReactNode
  /** `wide` = untuk melihat berkas (gambar/PDF). */
  size?: 'md' | 'wide'
}

/**
 * Popup untuk area jamaah/publik (padanan `components/admin/ui/Modal`, yang tak boleh diimpor dari luar admin).
 * Elemen `<dialog>` bawaan: fokus terkunci, Esc menutup, latar tak bisa diklik; daftar AutocompleteSelect otomatis dipasang ke dialog ini.
 * Di HP tampil sebagai lembar dari bawah selebar layar; isi digulir di dalam, judul dan footer tetap.
 */
export function Modal({ open, title, onClose, children, footer, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const t = useTranslations('shared.modal')

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      className={size === 'wide' ? 'modal-sheet modal-sheet-wide' : 'modal-sheet'}
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="text-base font-bold">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t('close')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="border-t px-5 py-3">{footer}</div>}
    </dialog>,
    document.body,
  )
}
