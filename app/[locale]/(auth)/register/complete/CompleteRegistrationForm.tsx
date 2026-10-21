'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Preview = { email: string; fullName: string; phone: string; whatsapp: string }

// Menampilkan isian pendaftaran dari token (hanya baca) lalu meminta password. Token baru dikonsumsi saat tombol ditekan —
// membuka halaman ini (juga oleh pemindai tautan email) tidak menghanguskan tautan.
export function CompleteRegistrationForm({ locale, token }: { locale: string; token: string }) {
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

  const hints = [
    { ok: password.length >= 8, text: 'Minimal 8 karakter' },
    { ok: /[a-zA-Z]/.test(password), text: 'Ada huruf' },
    { ok: /[0-9]/.test(password), text: 'Ada angka' },
    { ok: /[^a-zA-Z0-9]/.test(password), text: 'Ada karakter spesial' },
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/registration/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, privacyConsent, whatsappConsent }),
      })
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Gagal mengaktifkan akun.'); return }
      router.push(`/${locale}/dashboard`)
    } catch {
      setError('Terjadi kesalahan. Periksa koneksi internet.')
    } finally {
      setLoading(false)
    }
  }

  if (invalid) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Tautan tidak berlaku</CardTitle>
          <CardDescription>Tautan sudah dipakai atau kedaluwarsa (berlaku 24 jam).</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push(`/${locale}/register`)}>Daftar ulang</Button>
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
        <CardTitle>Buat Password</CardTitle>
        <CardDescription>Satu langkah lagi untuk mengaktifkan akun Anda</CardDescription>
      </CardHeader>
      <CardContent>
        {!preview ? (
          <p className="text-center text-sm text-muted-foreground">Memeriksa tautan...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Nama</dt><dd className="text-right font-medium">{preview.fullName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Email</dt><dd className="text-right font-medium break-all">{preview.email}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Telepon</dt><dd className="text-right font-medium">+{preview.phone}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">WhatsApp</dt><dd className="text-right font-medium">+{preview.whatsapp}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Bukan Anda yang mendaftar? Tutup halaman ini — tidak ada akun yang dibuat.</p>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)} className="pr-10" required autoFocus autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {password && (
                <div className="grid grid-cols-2 gap-1 pt-1">
                  {hints.map((h) => (
                    <p key={h.text} className={`text-xs ${h.ok ? 'text-green-600' : 'text-muted-foreground'}`}>{h.ok ? '✓' : '○'} {h.text}</p>
                  ))}
                </div>
              )}
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={whatsappConsent} onChange={(e) => setWhatsappConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>Saya setuju Saudinesia mengirim notifikasi pembayaran dan pembaruan pesanan ke nomor WhatsApp di atas, selain lewat email.</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>
                Saya telah membaca dan menyetujui{' '}
                <a href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Kebijakan Privasi</a>
              </span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !privacyConsent || !whatsappConsent || hints.some((h) => !h.ok)}>
              {loading ? 'Mengaktifkan...' : 'Aktifkan akun'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
