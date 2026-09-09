'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Eye, EyeOff, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OtpInput, OtpCountdown, useOtpCountdown } from '@/components/shared/OtpInput'

type Step = 'email' | 'otp' | 'password'
const IS_DEV = process.env.NODE_ENV === 'development'

interface ForgotPasswordFormProps { locale: string }

export function ForgotPasswordForm({ locale }: ForgotPasswordFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const { seconds, reset: resetCountdown } = useOtpCountdown(60)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal.'); return }
      if (!json.data?.masked) {
        setError('Email tidak terdaftar atau nomor WhatsApp belum diverifikasi.')
        return
      }
      setMaskedPhone(json.data.masked)
      setPhone(json.data.phone)
      setDevCode(json.data.devCode ?? null)
      resetCountdown()
      setStep('otp')
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    setDevCode(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (json.success) { setDevCode(json.data?.devCode ?? null); resetCountdown() }
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }

  async function handleOtpComplete(code: string) {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/verify-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Kode OTP tidak valid.'); return }
      setResetToken(json.data.resetToken)
      setStep('password')
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal mengubah password.'); return }
      router.push(`/${locale}/dashboard`)
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  const passwordHints = [
    { ok: newPassword.length >= 8, text: 'Min 8 karakter' },
    { ok: /[a-zA-Z]/.test(newPassword), text: 'Ada huruf' },
    { ok: /[0-9]/.test(newPassword), text: 'Ada angka' },
    { ok: /[^a-zA-Z0-9]/.test(newPassword), text: 'Ada karakter spesial' },
  ]

  const titles: Record<Step, string> = {
    email: 'Lupa Password',
    otp: 'Verifikasi WhatsApp',
    password: 'Buat Password Baru',
  }
  const descs: Record<Step, string> = {
    email: 'Masukkan email terdaftar Anda',
    otp: `Masukkan kode OTP yang dikirim ke ${maskedPhone}`,
    password: 'Buat password baru yang kuat',
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>{titles[step]}</CardTitle>
        <CardDescription>{descs[step]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="nama@email.com"
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !email}>
              {loading ? 'Memproses...' : 'Kirim OTP ke WhatsApp'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Ingat password?{' '}
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
            <Button variant="ghost" className="w-full text-sm" onClick={() => { setStep('email'); setError('') }}>
              Kembali
            </Button>
          </div>
        )}

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Password Baru</Label>
              <div className="relative">
                <Input
                  id="newPassword" type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••" value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-10" required autoFocus
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPassword && (
                <div className="grid grid-cols-2 gap-1 pt-1">
                  {passwordHints.map((h) => (
                    <p key={h.text} className={`text-xs ${h.ok ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {h.ok ? '✓' : '○'} {h.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full"
              disabled={loading || passwordHints.some((h) => !h.ok)}>
              {loading ? 'Menyimpan...' : 'Simpan Password Baru'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
