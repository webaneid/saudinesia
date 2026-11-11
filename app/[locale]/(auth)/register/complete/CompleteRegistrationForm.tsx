'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PasswordHints, passwordMeetsHints } from '../../PasswordHints'

type Preview = { email: string; fullName: string; phone: string; whatsapp: string; next: string | null }

// Menampilkan isian pendaftaran dari token (hanya baca) lalu meminta password. Token baru dikonsumsi saat tombol ditekan —
// membuka halaman ini (juga oleh pemindai tautan email) tidak menghanguskan tautan.
export function CompleteRegistrationForm({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations('authPages.complete')
  const c = useTranslations('authPages.common')
  const router = useRouter()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [whatsappConsent, setWhatsappConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setInvalid(true); return }
    fetch('/api/v1/auth/registration/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((j) => (j.success ? setPreview(j.data) : setInvalid(true)))
      .catch(() => setInvalid(true))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/registration/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, privacyConsent, whatsappConsent }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? t('failed')); return }
      router.push(preview?.next ?? `/${locale}/dashboard`) // jalur kembali sudah disaring server (lib/auth/nextPath.ts)
    } catch {
      setError(c('networkError'))
    } finally {
      setLoading(false)
    }
  }

  if (invalid) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>{t('invalidTitle')}</CardTitle>
          <CardDescription>{t('invalidDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push(`/${locale}/register`)}>{t('registerAgain')}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!preview ? (
          <p className="text-center text-sm text-muted-foreground">{t('checking')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('name')}</dt><dd className="text-right font-medium">{preview.fullName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{c('email')}</dt><dd className="text-right font-medium break-all">{preview.email}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('phone')}</dt><dd className="text-right font-medium">+{preview.phone}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('whatsapp')}</dt><dd className="text-right font-medium">+{preview.whatsapp}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">{t('notYou')}</p>

            <div className="space-y-2">
              <Label htmlFor="password">{c('password')}</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)} className="pr-10" required autoFocus autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? c('hidePassword') : c('showPassword')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <PasswordHints password={password} />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={whatsappConsent} onChange={(e) => setWhatsappConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>{c('whatsappConsent')}</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>{c.rich('privacyAgree', { link: chunks => <a href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{chunks}</a> })}</span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !privacyConsent || !whatsappConsent || !passwordMeetsHints(password)}>
              {loading ? t('submitting') : t('submit')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
