'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Logika halaman "Ubah" (docs/arsitektur-admin-create.md §6) — SATU tempat yang memeriksa respons: memuat `GET endpoint`, menyimpan `PUT endpoint`
 * (galat server tampil, formulir tetap), dan menghapus `DELETE endpoint` (terhapus → kembali ke daftar; dirujuk → server menonaktifkan dan
 * pesannya ditampilkan, entitas dimuat ulang supaya status tampil benar).
 */
export function useEditEntity<T>(endpoint: string, listHref: string) {
  const router = useRouter()
  const [item, setItem] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint)
      const json = await res.json().catch(() => null)
      if (res.status === 404) { setMissing(true); return }
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Data gagal dimuat.'); return }
      setItem(json.data as T)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  const clearMessages = () => { setError(null); setNotice(null) }

  async function save(body: unknown) {
    setSaving(true); clearMessages()
    try {
      const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Perubahan gagal disimpan.'); return }
      setItem(prev => ({ ...(prev ?? {}), ...(json.data as object) }) as T) // PUT boleh mengembalikan subset baris — gabungkan, jangan timpa
      setNotice('Perubahan tersimpan.')
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true); clearMessages()
    try {
      const res = await fetch(endpoint, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) { setError(json?.error ?? 'Gagal menghapus.'); return }
      if (json.data.deleted) { router.push(listHref); return }
      setNotice(json.data.message ?? 'Dipakai sehingga dinonaktifkan.')
      await load()
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setDeleting(false)
    }
  }

  return { item, loading, missing, saving, deleting, error, notice, clearMessages, save, remove }
}
