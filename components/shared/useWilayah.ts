'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AutocompleteOption } from './AutocompleteSelect'

type State = { options: AutocompleteOption[]; status: 'idle' | 'loading' | 'ready' | 'failed' }

/**
 * Satu tingkat daftar wilayah (docs/arsitektur-alamat.md §10). `path` null = induk belum dipilih. Ganti `path` langsung mengosongkan daftar lama
 * dan membatalkan permintaannya, jadi jawaban terlambat tak bisa menimpa daftar induk yang baru. Daftar kosong = gagal: setiap induk punya anak.
 */
export function useWilayah(path: string | null) {
  const [state, setState] = useState<State>({ options: [], status: 'idle' })
  const [tries, setTries] = useState(0)
  useEffect(() => {
    setState({ options: [], status: path ? 'loading' : 'idle' })
    if (!path) return
    const ctl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/v1/address/wilayah/${path}`, { signal: ctl.signal })
        const json = await res.json() as { success?: boolean; data?: { id: string; name: string }[] }
        if (ctl.signal.aborted) return
        const rows = res.ok && json.success === true && Array.isArray(json.data) ? json.data : []
        setState({ options: rows.map(r => ({ id: r.id, label: r.name })), status: rows.length > 0 ? 'ready' : 'failed' })
      } catch {
        if (!ctl.signal.aborted) setState({ options: [], status: 'failed' })
      }
    })()
    return () => ctl.abort()
  }, [path, tries])
  const retry = useCallback(() => setTries(n => n + 1), [])
  return { ...state, retry }
}
