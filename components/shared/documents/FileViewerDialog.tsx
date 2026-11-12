'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/shared/Modal'
import { useApiError } from '@/components/shared/useApiError'

// Melihat berkas pribadi (dokumen jamaah, bukti transfer) DI DALAM aplikasi — permintaan pemilik 2026-11-10: membuka berkas di tab baru
// (alamat penyimpanan) terasa keluar dari lingkungan kita. SATU komponen untuk jamaah dan admin (tanpa impor admin).
// `endpoint` = route yang sudah ada dan memeriksa hak akses, menjawab `{ url, mimeType }` (URL presigned 15 menit); gambar tampil sebagai
// <img>, PDF di <iframe> (host berkas mengizinkan dibingkai hanya oleh aplikasi — Caddyfile `(files)` frame-ancestors).
// `children` = isi tambahan di samping berkas (status/keputusan petugas), `footer` = tombol aksi yang tetap terlihat.

type Props = {
  title: string
  endpoint: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
}
type Source = { url: string; mimeType: string }

export function FileViewerDialog({ title, endpoint, onClose, children, footer }: Props) {
  const t = useTranslations('shared.documents.viewer')
  const errorText = useApiError()
  const [source, setSource] = useState<Source | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(endpoint, { cache: 'no-store' })
      .then(async r => ({ ok: r.ok, json: await r.json().catch(() => null) as { data?: Partial<Source>; error?: string } | null }))
      .then(({ ok, json }) => {
        if (!alive) return
        if (ok && json?.data?.url) setSource({ url: json.data.url, mimeType: json.data.mimeType ?? '' })
        else setError(errorText(json, t('loadFailed')))
      })
      .catch(() => alive && setError(t('network')))
    return () => { alive = false }
  }, [endpoint, t, errorText])

  return (
    <Modal open title={title} onClose={onClose} footer={footer} size="wide">
      <div className={children ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start' : ''}>
        <div className="min-w-0">
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : !source ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}</p>
        ) : source.mimeType.startsWith('image/') ? (
          <div className="flex justify-center rounded-lg border bg-muted/40 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO berumur pendek (bucket private); tak lewat optimizer */}
            <img src={source.url} alt={title} referrerPolicy="no-referrer" className="max-h-[65dvh] w-auto max-w-full rounded object-contain" />
          </div>
        ) : (
          <iframe src={source.url} title={title} referrerPolicy="no-referrer" className="h-[65dvh] w-full rounded-lg border bg-muted/40" />
        )}
        </div>
        {/* Keputusan petugas di samping berkas (layar lebar) atau di atasnya (HP) — tak perlu menggulir melewati gambar. */}
        {children && <div className="order-first space-y-3 lg:order-none">{children}</div>}
      </div>
    </Modal>
  )
}
