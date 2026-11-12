'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useApiError } from '@/components/shared/useApiError'

/** `next` = jalur kembali yang SUDAH disaring server (cookie pendaftaran bertanda tangan), atau null. */
export function GoogleSignupForm({ locale, next = null, email, initialName }: { locale: string; next?: string | null; email: string; initialName: string }) {
  const t = useTranslations('authPages.google')
  const c = useTranslations('authPages.common')
  const errorText = useApiError()
  const router = useRouter()
  const [fullName, setFullName] = useState(initialName)
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/google/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName, privacyConsent }),
      })
      const json = await res.json()
      if (!json.success) { setError(errorText(json, t('failed'))); return }
      router.push(next ?? `/${locale}/dashboard`)
    } catch {
      setError(c('networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <UserRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input id="email" value={email} disabled className="opacity-70" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName">{c('fullName')}</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={c('fullNamePlaceholder')} required autoFocus />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
            <span>{c.rich('privacyAgree', { link: chunks => <a href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{chunks}</a> })}</span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !privacyConsent || fullName.trim().length < 2}>
            {loading ? t('submitting') : t('submit')}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t('contactLater')}</p>
        </form>
      </CardContent>
    </Card>
  )
}
