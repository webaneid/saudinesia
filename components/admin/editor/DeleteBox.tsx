'use client'

import { useState, type ReactNode } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

type Props = {
  /** Kalimat konfirmasi — sebut semantik aman (hapus bila tak dirujuk, selain itu dinonaktifkan). */
  confirmText: ReactNode
  onDelete: () => unknown
  deleting: boolean
  /** Label tombol (mis. "Nonaktifkan produk" bila server pasti hanya menonaktifkan). */
  label?: string
  disabled?: boolean
}

/** Zona hapus dengan konfirmasi inline — satu bentuk untuk semua halaman edit (CRUD lengkap, hapus selalu dikonfirmasi). */
export function DeleteBox({ confirmText, onDelete, deleting, label = 'Hapus', disabled }: Props) {
  const [confirming, setConfirming] = useState(false)
  return (
    <section aria-label="Hapus" className="space-y-2 rounded-2xl border border-admin-danger/30 bg-white p-4">
      <h2 className="m-0 text-sm font-bold text-admin-danger">Hapus</h2>
      {confirming ? (
        <div className="space-y-2">
          <p className="m-0 text-sm text-admin-ink">{confirmText}</p>
          <div className="flex gap-2">
            <button type="button" disabled={deleting} onClick={async () => { await onDelete(); setConfirming(false) }} className="admin-btn bg-admin-danger hover:opacity-90 disabled:opacity-50">
              {deleting && <Loader2 className="size-4 animate-spin" />} Ya, {label.toLowerCase()}
            </button>
            <button type="button" disabled={deleting} onClick={() => setConfirming(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => setConfirming(true)} className="admin-btn-sm flex items-center gap-1.5 border border-admin-danger/40 bg-white text-admin-danger hover:bg-admin-danger/10 disabled:opacity-50">
          <Trash2 className="size-3.5" /> {label}
        </button>
      )}
    </section>
  )
}
