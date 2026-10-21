'use client'

import { useCallback, useEffect, useState } from 'react'

/** Hitung mundur detik untuk tombol "Kirim ulang" (mencegah klik beruntun; batas sebenarnya tetap di server). */
export function useCooldown(initialSeconds: number) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])
  const start = useCallback(() => setSeconds(initialSeconds), [initialSeconds])
  return { seconds, start }
}
