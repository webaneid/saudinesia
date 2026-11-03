'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Kirim aksi gudang identitas (docs/arsitektur-jamaah.md §4.4): respons SELALU diperiksa, galat server ditampilkan, halaman disegarkan bila berhasil.
export function useIdentityAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  async function send(url: string, method: 'POST' | 'DELETE', body: object | undefined, done: string, refresh = true): Promise<{ ok: boolean; data?: unknown }> {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(url, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setNotice({ text: json?.error ?? 'Gagal menyimpan.', error: true }); return { ok: false } }
      if (done) setNotice({ text: done, error: false })
      if (refresh) router.refresh()
      return { ok: true, data: json?.data }
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
      return { ok: false }
    } finally { setBusy(false) }
  }
  return { busy, notice, setNotice, send }
}
