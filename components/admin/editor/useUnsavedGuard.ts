'use client'

import { useEffect } from 'react'

/** Peringatan peramban saat menutup/memuat ulang halaman dengan perubahan belum disimpan (kebiasaan WordPress). */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
