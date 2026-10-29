'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhoneCall } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ContactPicker, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { e164FromCountry } from '@/lib/utils/phone'

interface Props { locale: string; name: string; phone: string; whatsapp: string; needsConsent: boolean; needsPrivacy: boolean }

export function LengkapiDataForm({ locale, name, phone, whatsapp, needsConsent, needsPrivacy }: Props) {
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
    if (!p || !w) { setError('Isi nomor telepon dan nomor WhatsApp.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/contact', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p, whatsapp: w, ...(needsConsent ? { whatsappConsent: consent } : {}), ...(needsPrivacy ? { privacyConsent: privacy } : {}) }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal menyimpan.'); return }
      router.push(`/${locale}/dashboard`)
      router.refresh()
    } catch {
      setError('Terjadi kesalahan. Periksa koneksi internet.')
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
        <CardTitle>Lengkapi Data</CardTitle>
        <CardDescription>Halo {name.split(' ')[0]}, isi nomor telepon dan WhatsApp Anda untuk melanjutkan.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ContactPicker value={contact} onChange={setContact} showEmail={false} />
          <p className="text-xs text-muted-foreground">
            Kami mengirim notifikasi pembayaran dan pembaruan pesanan ke nomor WhatsApp ini, selain lewat email. Nomor tidak diverifikasi — pastikan benar.
          </p>
          {needsConsent && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>Saya setuju Saudinesia mengirim notifikasi pembayaran dan pembaruan pesanan ke nomor WhatsApp di atas.</span>
            </label>
          )}
          {needsPrivacy && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>Saya telah membaca dan menyetujui <a href={`/${locale}/privacy`} target="_blank" rel="noreferrer" className="underline">Kebijakan Privasi</a> Saudinesia.</span>
            </label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !consent || !privacy}>{loading ? 'Menyimpan...' : 'Simpan & lanjutkan'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
