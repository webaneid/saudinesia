'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApiError } from '@/components/shared/useApiError'

// Unggah bukti transfer. Semua pemeriksaan berkas ada di server (isi berkas, ukuran); pesan penolakannya ditampilkan apa adanya.
export function PaymentProofUpload({ bookingId }: { bookingId: string }) {
  const router = useRouter()
  const t = useTranslations('pilgrimArea.payment')
  const errorText = useApiError()
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!file || saving) return
    setSaving(true); setError(null)
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch(`/api/v1/bookings/${bookingId}/payment/bukti`, { method: 'POST', body })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setError(errorText(json, t('failed'))); return }
      router.refresh()
    } catch {
      setError(t('network'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="bukti-transfer">{t('label')}</Label>
        <Input id="bukti-transfer" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="bg-white"
          onChange={e => { setError(null); setFile(e.target.files?.[0] ?? null) }} />
      </div>
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="button" className="w-full" disabled={!file || saving} onClick={submit}>
        <UploadCloud className="mr-2 h-4 w-4" /> {saving ? t('uploading') : t('submit')}
      </Button>
    </div>
  )
}
