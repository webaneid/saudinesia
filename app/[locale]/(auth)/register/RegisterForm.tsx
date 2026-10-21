'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserRound, Eye, EyeOff, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OtpInput, OtpCountdown, useOtpCountdown } from '@/components/shared/OtpInput'
import { normalizePhone } from '@/lib/utils/phone'

type Step = 'form' | 'otp'
const IS_DEV = process.env.NODE_ENV === 'development'

interface RegisterFormProps { locale: string }

export function RegisterForm({ locale }: RegisterFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const { seconds, reset: resetCountdown } = useOtpCountdown(60)

  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' })
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, privacyConsent }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Pendaftaran gagal.'); return }
      setPhone(json.data.phone)
      setDevCode(json.data.devCode ?? null)
      resetCountdown()
      setStep('otp')
    } catch {
      setError('Terjadi kesalahan. Periksa koneksi internet.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, privacyConsent }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal mengirim ulang.'); return }
      setDevCode(json.data?.devCode ?? null)
      resetCountdown()
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  async function handleOtpComplete(code: string) {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Kode OTP tidak valid.'); return }
      router.push(`/${locale}/dashboard`)
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  const passwordHints = [
    { ok: form.password.length >= 8, text: 'Minimal 8 karakter' },
    { ok: /[a-zA-Z]/.test(form.password), text: 'Ada huruf' },
    { ok: /[0-9]/.test(form.password), text: 'Ada angka' },
    { ok: /[^a-zA-Z0-9]/.test(form.password), text: 'Ada karakter spesial' },
  ]

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <UserRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{step === 'form' ? 'Buat Akun' : 'Verifikasi WhatsApp'}</CardTitle>
        <CardDescription>
          {step === 'form'
            ? 'Daftar dan mulai rencanakan perjalanan ibadah Anda'
            : `Masukkan kode OTP yang dikirim ke +62${form.phone.replace(/^0/, '').replace(/^\+?62/, '')}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'form' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="fullName">Nama Lengkap</Label>
              <Input id="fullName" placeholder="Sesuai paspor" value={form.fullName} onChange={set('fullName')} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="nama@email.com" value={form.email} onChange={set('email')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password" type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••" value={form.password} onChange={set('password')}
                  className="pr-10" required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {form.password && (
                <div className="grid grid-cols-2 gap-1 pt-1">
                  {passwordHints.map((h) => (
                    <p key={h.text} className={`text-xs ${h.ok ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {h.ok ? '✓' : '○'} {h.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Nomor WhatsApp</Label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">+62</span>
                <Input id="phone" type="tel" placeholder="8xx xxxx xxxx" value={form.phone} onChange={set('phone')} className="rounded-l-none" required />
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={(e) => setPrivacyConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-input"
                required
              />
              <span>
                Saya telah membaca dan menyetujui{' '}
                <a href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Kebijakan Privasi
                </a>
              </span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !privacyConsent}>
              {loading ? 'Mendaftar...' : 'Daftar & Kirim OTP'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Sudah punya akun?{' '}
              <a href={`/${locale}/login`} className="text-primary hover:underline">Masuk</a>
            </p>
          </form>
        )}

        {step === 'otp' && (
          <div className="space-y-4">
            {IS_DEV && devCode && (
              <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                <Terminal className="h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-700">DEV — Kode OTP:</p>
                  <p className="text-lg font-mono font-bold tracking-widest text-amber-900">{devCode}</p>
                </div>
              </div>
            )}
            <OtpInput onComplete={handleOtpComplete} disabled={loading} error={error || undefined} />
            <OtpCountdown seconds={seconds} onResend={handleResend} disabled={loading} />
            <Button variant="ghost" className="w-full text-sm" onClick={() => { setStep('form'); setError('') }}>
              Ubah data pendaftaran
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
