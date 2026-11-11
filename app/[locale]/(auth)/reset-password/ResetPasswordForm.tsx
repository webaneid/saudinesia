'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { KeyRound, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PasswordHints, passwordMeetsHints } from '../PasswordHints'

// Token dikonsumsi hanya saat tombol ditekan (POST) — membuka tautan oleh pemindai email tidak menghanguskannya.
export function ResetPasswordForm({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations('authPages.reset')
  const c = useTranslations('authPages.common')
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? t('failed')); return }
      router.push(`/${locale}/dashboard`)
    } catch {
      setError(c('networkError'))
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>{t('invalidTitle')}</CardTitle>
          <CardDescription>{t('invalidDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push(`/${locale}/forgot-password`)}>{t('requestNew')}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('newPassword')}</Label>
            <div className="relative">
              <Input id="newPassword" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} className="pr-10" required autoFocus autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? c('hidePassword') : c('showPassword')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <PasswordHints password={newPassword} />
          </div>
          {error && (
            <p className="text-sm text-destructive">
              {error} <a href={`/${locale}/forgot-password`} className="underline">{t('requestNew')}</a>
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading || !passwordMeetsHints(newPassword)}>
            {loading ? c('saving') : t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
