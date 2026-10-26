'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type ModalProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * Dialog modal di atas elemen `<dialog>` bawaan (fokus terkunci di dalam, Esc menutup, latar belakang tak bisa diklik). Dirender lewat portal
 * ke body supaya tidak terkurung overflow/stacking induk; klik di dalam tidak diteruskan ke induk React (mis. baris yang bisa dilipat).
 */
export function Modal({ open, title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

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
      className="m-auto max-h-[92vh] w-[min(46rem,94vw)] overflow-y-auto rounded-2xl border border-admin-line bg-white p-0 text-admin-ink shadow-admin backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between gap-3 border-b border-admin-line px-5 py-3">
        <h2 className="m-0 text-base font-bold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Tutup" className="inline-flex size-9 items-center justify-center rounded-lg text-admin-muted hover:bg-admin-spot hover:text-admin-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>,
    document.body,
  )
}
