'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Logika simpan halaman "Buat baru" (docs/arsitektur-admin-create.md) — SATU tempat yang memeriksa respons: gagal → pesan server tampil dan
 * formulir tetap; berhasil (ada `data.id`) → pindah ke halaman edit entitas baru. Mengirim `POST` JSON ke `endpoint`.
 */
export function useCreateEntity(endpoint: string, editHref: (id: string, data: Record<string, unknown>) => string, failMessage: string) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(body: unknown) {
    setSaving(true); setError(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.id) { setError(json?.error ?? failMessage); return }
      router.push(editHref(json.data.id as string, json.data as Record<string, unknown>))
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
  }

  return { saving, error, clearError: () => setError(null), submit }
}
