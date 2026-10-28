'use client'

import type { ReactNode } from 'react'
import { Modal } from '@/components/admin/ui/Modal'
import { Button } from '@/components/admin/ui/Button'

type ConfirmDialogProps = {
  open: boolean
  title: string
  /** Penjelasan akibat tindakan. */
  children?: ReactNode
  confirmLabel?: string
  /** `danger` untuk tindakan yang menghapus. */
  tone?: 'danger' | 'primary'
  busy?: boolean
  /** Galat dari server — ditampilkan apa adanya, dialog tetap terbuka. */
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

/** Konfirmasi standar admin (pengganti `window.confirm`): satu dialog untuk hapus/nonaktifkan, galat server tampil di dalamnya. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Ya, lanjutkan', tone = 'primary', busy, error, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="space-y-4">
        {children && <div className="text-sm text-admin-muted">{children}</div>}
        {error && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} size="sm" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  )
}
