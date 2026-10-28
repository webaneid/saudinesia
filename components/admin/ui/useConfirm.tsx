'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/admin/ui/ConfirmDialog'

type AskOptions = { title: string; body?: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary' }
type Pending = AskOptions & { resolve: (ok: boolean) => void }

/**
 * Konfirmasi berbasis janji untuk kode yang sudah berbentuk `if (!(await ...)) return`: `const { ask, dialog } = useConfirm()`, panggil `await ask({ title })`, dan render `{dialog}`
 * di JSX. Pengganti dialog bawaan peramban (docs/arsitektur-tabel.md §2.4) tanpa mengubah alur fungsi pemanggil.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)
  const ask = useCallback((options: AskOptions) => new Promise<boolean>(resolve => setPending({ ...options, resolve })), [])
  const settle = (ok: boolean) => { pending?.resolve(ok); setPending(null) }
  const dialog = (
    <ConfirmDialog
      open={pending !== null} title={pending?.title ?? ''} tone={pending?.tone ?? 'danger'} confirmLabel={pending?.confirmLabel ?? 'Ya, hapus'}
      onConfirm={() => settle(true)} onClose={() => settle(false)}
    >
      {pending?.body}
    </ConfirmDialog>
  )
  return { ask, dialog }
}
