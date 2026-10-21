'use client'

import { useState } from 'react'
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

interface RegisterFormProps { locale: string; googleEnabled?: boolean }

export function RegisterForm({ locale, googleEnabled = false }: RegisterFormProps) {
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
    if (!phone || !whatsapp) { setError('Isi nomor telepon dan nomor WhatsApp.'); return false }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, phone, whatsapp, locale }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Pendaftaran gagal.'); return false }
      startCooldown()
      return true
    } catch {
      setError('Terjadi kesalahan. Periksa koneksi internet.')
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
        <CardTitle>{step === 'form' ? 'Buat Akun' : 'Cek Email Anda'}</CardTitle>
        <CardDescription>
          {step === 'form'
            ? 'Daftar dan mulai rencanakan perjalanan ibadah Anda'
            : <>Kami mengirim tautan ke <strong>{email}</strong>. Klik tautan itu untuk membuat password dan mengaktifkan akun.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'form' && googleEnabled && (
          <>
            <GoogleButton locale={locale} label="Daftar dengan Google" />
            <OrDivider />
          </>
        )}
        {step === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Nama Lengkap</Label>
              <Input id="fullName" placeholder="Sesuai paspor" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="nama@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <p className="text-xs text-muted-foreground">Tautan aktivasi dan pemulihan akun dikirim ke email ini.</p>
            </div>

            <ContactPicker value={contact} onChange={setContact} showEmail={false} />

            <p className="text-xs text-muted-foreground">
              Kami mengirim notifikasi pembayaran dan pembaruan pesanan ke nomor WhatsApp di atas, selain lewat email. Persetujuan Anda diminta di langkah berikutnya, setelah email Anda terverifikasi.
            </p>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Mengirim...' : 'Daftar'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Sudah punya akun? <a href={`/${locale}/login`} className="text-primary hover:underline">Masuk</a>
            </p>
          </form>
        )}

        {step === 'sent' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tidak menerima email? Periksa folder spam, atau kirim ulang. Tautan berlaku 24 jam.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="outline" className="w-full" disabled={loading || seconds > 0} onClick={() => void submit()}>
              {seconds > 0 ? `Kirim ulang dalam ${seconds} detik` : loading ? 'Mengirim...' : 'Kirim ulang email'}
            </Button>
            <Button variant="ghost" className="w-full text-sm" onClick={() => { setStep('form'); setError('') }}>
              Ubah data pendaftaran
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
