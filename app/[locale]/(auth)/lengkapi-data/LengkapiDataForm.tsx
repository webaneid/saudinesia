'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { PhoneCall } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ContactPicker, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { e164FromCountry } from '@/lib/utils/phone'
import { useApiError } from '@/components/shared/useApiError'

/** `next` = jalur kembali yang SUDAH disaring server, atau null. */
interface Props { locale: string; next?: string | null; name: string; phone: string; whatsapp: string; needsConsent: boolean; needsPrivacy: boolean }

export function LengkapiDataForm({ locale, next = null, name, phone, whatsapp, needsConsent, needsPrivacy }: Props) {
  const t = useTranslations('authPages.contactData')
  const c = useTranslations('authPages.common')
  const errorText = useApiError()
  const router = useRouter()
  const [contact, setContact] = useState<ContactValue>(() => contactFromStored(phone, whatsapp))
  const [consent, setConsent] = useState(!needsConsent)
  const [privacy, setPrivacy] = useState(!needsPrivacy)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const p = e164FromCountry(contact.phoneCountryCode, contact.phone)
    const w = e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)
    if (!p || !w) { setError(t('contactRequired')); return }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/contact', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p, whatsapp: w, ...(needsConsent ? { whatsappConsent: consent } : {}), ...(needsPrivacy ? { privacyConsent: privacy } : {}) }),
      })
      const json = await res.json()
      if (!json.success) { setError(errorText(json, t('failed'))); return }
      router.push(next ?? `/${locale}/dashboard`)
      router.refresh()
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
          <PhoneCall className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { name: name.split(' ')[0] ?? '' })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ContactPicker value={contact} onChange={setContact} showEmail={false} />
          <p className="text-xs text-muted-foreground">{t('whatsappNote')}</p>
          {needsConsent && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>{t('whatsappConsent')}</span>
            </label>
          )}
          {needsPrivacy && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>{c.rich('privacyAgree', { link: chunks => <a href={`/${locale}/privacy`} target="_blank" rel="noreferrer" className="underline">{chunks}</a> })}</span>
            </label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !consent || !privacy}>{loading ? c('saving') : t('submit')}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
