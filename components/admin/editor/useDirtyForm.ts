'use client'

import { useCallback, useState } from 'react'

/**
 * Penanda "ada perubahan belum disimpan" untuk halaman edit (docs/arsitektur-admin-editor.md §5). Bentuk formulir = nilai yang dibandingkan
 * dengan baseline; baseline diatur EKSPLISIT lewat `markClean(nilai)` — setelah data dimuat dan setelah simpan berhasil — sehingga muat-ulang
 * bagian lain halaman (mis. kotak komponen) tidak pernah dianggap perubahan dan tidak menimpa ketikan.
 */
export function useDirtyForm<T>(form: T | null) {
  const [baseline, setBaseline] = useState<string | null>(null)
  const dirty = form !== null && baseline !== null && JSON.stringify(form) !== baseline
  const markClean = useCallback((value: T) => setBaseline(JSON.stringify(value)), [])
  /** Menggeser baseline sebagian tanpa menyentuh ketikan (mis. server menonaktifkan entitas saat hapus → isActive=false di formulir dan baseline). */
  const patchClean = useCallback((patch: Partial<T>) => setBaseline(prev => (prev === null ? prev : JSON.stringify({ ...(JSON.parse(prev) as object), ...patch }))), [])
  return { dirty, markClean, patchClean }
}
