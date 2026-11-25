'use client'

import { useEffect, useState } from 'react'
import type { CardField } from './cardFields'

// Kolom AKTIF katalog Data Jamaah untuk formulir kartu (docs/arsitektur-data-jamaah.md §3.4). `undefined` = sedang dimuat; `null` = gagal dimuat →
// formulir menampilkan semua kolom bawaan (kolom tak pernah hilang karena jaringan; nilai lama tak terhapus karena tak dikirim = tetap).
export function usePilgrimFields(initial?: CardField[]): CardField[] | null | undefined {
  const [fields, setFields] = useState<CardField[] | null | undefined>(initial)
  useEffect(() => {
    if (initial) return
    let alive = true
    fetch('/api/v1/pilgrim-fields')
      .then(r => r.json())
      .then(j => { if (alive) setFields(j?.success && Array.isArray(j.data) ? (j.data as CardField[]) : null) })
      .catch(() => { if (alive) setFields(null) })
    return () => { alive = false }
  }, [initial])
  return fields
}
