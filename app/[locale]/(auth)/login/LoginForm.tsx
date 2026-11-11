'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Mail, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GoogleButton, OrDivider } from '@/components/shared/GoogleButton'

/** `next` = jalur kembali yang SUDAH disaring server (lib/auth/nextPath.ts), atau null. */
interface LoginFormProps { locale: string; next?: string | null; googleEnabled?: boolean; initialError?: string }

export function LoginForm({ locale, next = null, googleEnabled = false, initialError = '' }: LoginFormProps) {
  const t = useTranslations('authPages.login')
  const c = useTranslations('authPages.common')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? t('failed')); return }
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
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {googleEnabled && (
          <>
            <GoogleButton locale={locale} next={next} label={t('google')} />
            <OrDivider />
          </>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{c('email')}</Label>
            <Input
              id="email" type="email" placeholder={c('emailPlaceholder')}
              value={email} onChange={(e) => setEmail(e.target.value)}
              required autoFocus
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{c('password')}</Label>
              <a href={`/${locale}/forgot-password`} className="text-xs text-primary hover:underline">
                {t('forgot')}
              </a>
            </div>
            <div className="relative">
              <Input
                id="password" type={showPassword ? 'text' : 'password'}
                placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10" required
              />
              <button
                type="button" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? c('hidePassword') : c('showPassword')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email || !password}>
            {loading ? t('submitting') : t('submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <a href={next ? `/${locale}/register?next=${encodeURIComponent(next)}` : `/${locale}/register`} className="text-primary hover:underline">{c('register')}</a>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
