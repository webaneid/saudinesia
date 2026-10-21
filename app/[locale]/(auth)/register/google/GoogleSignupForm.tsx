'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function GoogleSignupForm({ locale, email, initialName }: { locale: string; email: string; initialName: string }) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialName)
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/google/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName, privacyConsent }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal membuat akun.'); return }
      router.push(`/${locale}/dashboard`)
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
          <UserRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Lengkapi Pendaftaran</CardTitle>
        <CardDescription>Email Anda sudah diverifikasi Google. Satu langkah lagi untuk membuat akun.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email (dari Google)</Label>
            <Input id="email" value={email} disabled className="opacity-70" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName">Nama Lengkap</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Sesuai paspor" required autoFocus />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
            <span>
              Saya telah membaca dan menyetujui{' '}
              <a href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Kebijakan Privasi</a>
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !privacyConsent || fullName.trim().length < 2}>
            {loading ? 'Membuat akun...' : 'Buat akun'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Nomor telepon dan WhatsApp dilengkapi setelah akun dibuat.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
