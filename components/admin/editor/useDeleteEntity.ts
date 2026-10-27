'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type DeleteOutcome = 'deleted' | 'deactivated' | 'error'

/**
 * Hapus untuk halaman edit bespoke (EditorShell) — sepadan `useEditEntity.remove`: SATU tempat yang memeriksa respons DELETE. Terhapus → kembali ke
 * daftar; dirujuk → server menonaktifkan dan pesannya jadi `notice` (pemanggil menggeser status di formulir); galat server → `error`.
 */
export function useDeleteEntity(endpoint: string, listHref: string) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function run(): Promise<DeleteOutcome> {
    setDeleting(true); setError(null); setNotice(null)
    try {
      const res = await fetch(endpoint, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Gagal menghapus.'); return 'error' }
      if (json.data.deleted) { router.push(listHref); return 'deleted' }
      setNotice(json.data.message ?? 'Dipakai sehingga dinonaktifkan.')
      return 'deactivated'
    } catch {
      setError('Tidak dapat menghubungi server.')
      return 'error'
    } finally {
      setDeleting(false)
    }
  }

  return { deleting, error, notice, run, clear: () => { setError(null); setNotice(null) } }
}
