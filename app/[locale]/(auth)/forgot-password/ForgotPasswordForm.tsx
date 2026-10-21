'use client'

import { useState } from 'react'
import { KeyRound, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCooldown } from '@/components/shared/useCooldown'

interface ForgotPasswordFormProps { locale: string }

export function ForgotPasswordForm({ locale }: ForgotPasswordFormProps) {
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
      if (!json.success) { setError(json.error ?? 'Gagal.'); return }
      setSent(true)
      startCooldown()
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
          {sent ? <MailCheck className="h-6 w-6 text-primary" /> : <KeyRound className="h-6 w-6 text-primary" />}
        </div>
        <CardTitle>{sent ? 'Cek Email Anda' : 'Lupa Password'}</CardTitle>
        <CardDescription>
          {sent
            ? <>Jika <strong>{email}</strong> terdaftar, kami mengirim tautan untuk memilih password baru. Tautan berlaku 30 menit.</>
            : 'Masukkan email akun Anda, kami kirim tautan untuk memilih password baru'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sent ? (
          <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="nama@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !email}>
              {loading ? 'Mengirim...' : 'Kirim tautan reset'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Ingat password? <a href={`/${locale}/login`} className="text-primary hover:underline">Masuk</a>
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Tidak menerima email? Periksa folder spam, atau kirim ulang.</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="outline" className="w-full" disabled={loading || seconds > 0} onClick={() => void submit()}>
              {seconds > 0 ? `Kirim ulang dalam ${seconds} detik` : loading ? 'Mengirim...' : 'Kirim ulang email'}
            </Button>
            <Button variant="ghost" className="w-full text-sm" onClick={() => { setSent(false); setError('') }}>Ganti email</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
