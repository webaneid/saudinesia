'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Token dikonsumsi hanya saat tombol ditekan (POST) — membuka tautan oleh pemindai email tidak menghanguskannya.
export function ResetPasswordForm({ locale, token }: { locale: string; token: string }) {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hints = [
    { ok: newPassword.length >= 8, text: 'Min 8 karakter' },
    { ok: /[a-zA-Z]/.test(newPassword), text: 'Ada huruf' },
    { ok: /[0-9]/.test(newPassword), text: 'Ada angka' },
    { ok: /[^a-zA-Z0-9]/.test(newPassword), text: 'Ada karakter spesial' },
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal mengubah password.'); return }
      router.push(`/${locale}/dashboard`)
    } catch {
      setError('Terjadi kesalahan. Periksa koneksi internet.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Tautan tidak valid</CardTitle>
          <CardDescription>Minta tautan reset password yang baru.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push(`/${locale}/forgot-password`)}>Minta tautan baru</Button>
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
        <CardTitle>Buat Password Baru</CardTitle>
        <CardDescription>Pilih password baru yang kuat</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">Password Baru</Label>
            <div className="relative">
              <Input id="newPassword" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} className="pr-10" required autoFocus autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {newPassword && (
              <div className="grid grid-cols-2 gap-1 pt-1">
                {hints.map((h) => (
                  <p key={h.text} className={`text-xs ${h.ok ? 'text-green-600' : 'text-muted-foreground'}`}>{h.ok ? '✓' : '○'} {h.text}</p>
                ))}
              </div>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive">
              {error} <a href={`/${locale}/forgot-password`} className="underline">Minta tautan baru</a>
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading || hints.some((h) => !h.ok)}>
            {loading ? 'Menyimpan...' : 'Simpan Password Baru'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
