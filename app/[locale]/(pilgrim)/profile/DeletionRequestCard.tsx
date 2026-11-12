'use client'

import { useState, useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ShieldAlert } from 'lucide-react'
import { DATE_NUMERIC, formatInstant } from '@/lib/time'
import { useApiError } from '@/components/shared/useApiError'

type DeletionRequest = { status: 'pending' | 'completed' | 'rejected' | 'withdrawn'; requestedAt: string; minWaitHours?: number } | null

export function DeletionRequestCard() {
  const t = useTranslations('pilgrimArea.deletion')
  const errorText = useApiError()
  const locale = useLocale()
  const [request, setRequest] = useState<DeletionRequest>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch('/api/v1/account/deletion-requests')
    const j = await r.json()
    setRequest(j.data ?? null)
  }
  useEffect(() => { load() }, [])

  async function call(method: 'POST' | 'DELETE') {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/v1/account/deletion-requests', { method })
      const j = await r.json().catch(() => null)
      if (!r.ok) setError(errorText(j, (r.status === 429 ? t('tooMany') : t('failed'))))
      await load()
      setConfirming(false)
    } finally {
      setLoading(false)
    }
  }
  const handleSubmit = () => call('POST')
  const handleWithdraw = () => call('DELETE')

  return (
    <div className="rounded-xl border bg-card p-6 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold text-sm">{t('title')}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t('intro')}</p>

      {request?.status === 'pending' && (
        <div className="space-y-2">
          <p className="text-xs text-amber-600">{t('pending', { date: formatInstant(request.requestedAt, DATE_NUMERIC, undefined, locale) })}</p>
          <Button variant="outline" size="sm" disabled={loading} onClick={handleWithdraw}>
            {loading ? t('processing') : t('withdraw')}
          </Button>
        </div>
      )}
      {request?.status === 'withdrawn' && (
        <p className="text-xs text-muted-foreground">{t('withdrawn')}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {request?.status === 'completed' && (
        <p className="text-xs text-green-600">{t('completed')}</p>
      )}
      {request?.status === 'rejected' && (
        <p className="text-xs text-destructive">{t('rejected')}</p>
      )}

      {!request || request.status === 'rejected' || request.status === 'withdrawn' ? (
        confirming ? (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={loading} onClick={handleSubmit}>
              {loading ? t('sending') : t('confirm')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t('cancel')}</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>{t('request')}</Button>
        )
      ) : null}
    </div>
  )
}
