'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCooldown } from '@/components/shared/useCooldown'
import { useApiError } from '@/components/shared/useApiError'

interface ForgotPasswordFormProps { locale: string }

export function ForgotPasswordForm({ locale }: ForgotPasswordFormProps) {
  const t = useTranslations('authPages.forgot')
  const c = useTranslations('authPages.common')
  const errorText = useApiError()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { seconds, start: startCooldown } = useCooldown(60)

  async function submit(): Promise<void> {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      })
      const json = await res.json()
      if (!json.success) { setError(errorText(json, t('failed'))); return }
      setSent(true)
      startCooldown()
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
          {sent ? <MailCheck className="h-6 w-6 text-primary" /> : <KeyRound className="h-6 w-6 text-primary" />}
        </div>
        <CardTitle>{sent ? t('sentTitle') : t('title')}</CardTitle>
        <CardDescription>
          {sent ? t.rich('sentDescription', { email, strong: chunks => <strong>{chunks}</strong> }) : t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sent ? (
          <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{c('email')}</Label>
              <Input id="email" type="email" placeholder={c('emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !email}>
              {loading ? c('sending') : t('submit')}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t('remember')} <a href={`/${locale}/login`} className="text-primary hover:underline">{c('login')}</a>
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('notReceived')}</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="outline" className="w-full" disabled={loading || seconds > 0} onClick={() => void submit()}>
              {seconds > 0 ? c('resendIn', { seconds }) : loading ? c('sending') : c('resend')}
            </Button>
            <Button variant="ghost" className="w-full text-sm" onClick={() => { setSent(false); setError('') }}>{t('changeEmail')}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
