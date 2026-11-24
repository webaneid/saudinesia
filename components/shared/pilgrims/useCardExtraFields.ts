'use client'

import { useEffect, useState } from 'react'
import type { ManifestField } from '@/components/booking/ManifestFieldsForm'

// Kolom buatan admin di katalog Data Jamaah yang diisi di kartu (docs/arsitektur-data-jamaah.md §3.4) — dimuat sekali per formulir.
// Gagal memuat = tanpa kolom tambahan (kolom bawaan kartu tetap bisa disimpan; nilai lama tak hilang karena kunci tak dikirim tetap).
export function useCardExtraFields(): ManifestField[] {
  const [fields, setFields] = useState<ManifestField[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/v1/pilgrim-fields')
      .then(r => r.json())
      .then(j => { if (alive && j?.success && Array.isArray(j.data)) setFields(j.data as ManifestField[]) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return fields
}
