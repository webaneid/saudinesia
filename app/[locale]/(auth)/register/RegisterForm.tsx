'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { UserRound, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ContactPicker, EMPTY_CONTACT, type ContactValue } from '@/components/shared/ContactPicker'
import { useCooldown } from '@/components/shared/useCooldown'
import { GoogleButton, OrDivider } from '@/components/shared/GoogleButton'
import { e164FromCountry } from '@/lib/utils/phone'

type Step = 'form' | 'sent'

/** `next` = jalur kembali yang SUDAH disaring server; ikut tersimpan di tautan pendaftaran (disaring lagi di server). */
interface RegisterFormProps { locale: string; next?: string | null; googleEnabled?: boolean }

export function RegisterForm({ locale, next = null, googleEnabled = false }: RegisterFormProps) {
  const t = useTranslations('authPages.register')
  const c = useTranslations('authPages.common')
  const [step, setStep] = useState<Step>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { seconds, start: startCooldown } = useCooldown(60)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState<ContactValue>(EMPTY_CONTACT)

  async function submit(): Promise<boolean> {
    setError('')
    const phone = e164FromCountry(contact.phoneCountryCode, contact.phone)
    const whatsapp = e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)
    if (!phone || !whatsapp) { setError(t('contactRequired')); return false }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, phone, whatsapp, locale, ...(next ? { next } : {}) }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? t('failed')); return false }
      startCooldown()
      return true
    } catch {
      setError(c('networkError'))
      return false
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (await submit()) setStep('sent')
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          {step === 'form' ? <UserRound className="h-6 w-6 text-primary" /> : <MailCheck className="h-6 w-6 text-primary" />}
        </div>
        <CardTitle>{step === 'form' ? t('title') : t('sentTitle')}</CardTitle>
        <CardDescription>
          {step === 'form'
            ? t('description')
            : t.rich('sentDescription', { email, strong: chunks => <strong>{chunks}</strong> })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'form' && googleEnabled && (
          <>
            <GoogleButton locale={locale} next={next} label={t('google')} />
            <OrDivider />
          </>
        )}
        {step === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">{c('fullName')}</Label>
              <Input id="fullName" placeholder={c('fullNamePlaceholder')} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{c('email')}</Label>
              <Input id="email" type="email" placeholder={c('emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} required />
              <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
            </div>

            <ContactPicker value={contact} onChange={setContact} showEmail={false} />

            <p className="text-xs text-muted-foreground">{t('whatsappNote')}</p>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? c('sending') : t('submit')}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t('haveAccount')} <a href={next ? `/${locale}/login?next=${encodeURIComponent(next)}` : `/${locale}/login`} className="text-primary hover:underline">{c('login')}</a>
            </p>
          </form>
        )}

        {step === 'sent' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('notReceived')}</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="outline" className="w-full" disabled={loading || seconds > 0} onClick={() => void submit()}>
              {seconds > 0 ? c('resendIn', { seconds }) : loading ? c('sending') : c('resend')}
            </Button>
            <Button variant="ghost" className="w-full text-sm" onClick={() => { setStep('form'); setError('') }}>
              {t('editData')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
