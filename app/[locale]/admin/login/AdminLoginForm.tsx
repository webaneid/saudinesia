'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { Button } from '@/components/admin/ui/Button'
import { FormField } from '@/components/admin/ui/FormField'

interface AdminLoginFormProps { locale: string }

export function AdminLoginForm({ locale }: AdminLoginFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()

      if (!json.success) { setError(json.error ?? 'Login gagal.'); return }

      if (!ADMIN_ROLES.includes(json.data.role)) {
        await fetch('/api/v1/auth/logout', { method: 'POST' })
        setError('Akun ini tidak memiliki akses admin.')
        return
      }

      // All admin roles → unified /admin dashboard
      router.push(`/${locale}/admin`)
    } catch {
      setError('Terjadi kesalahan. Periksa koneksi internet.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <FormField label="Email" htmlFor="email" required>
        <input
          id="email" type="email" autoComplete="username" placeholder="admin@saudinesia.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          required autoFocus className="admin-input"
        />
      </FormField>

      <FormField
        label="Password" htmlFor="password" required
        labelAside={
          <a href={`/${locale}/forgot-password`} className="text-xs font-semibold text-admin-accent-strong hover:underline">
            Lupa password?
          </a>
        }
      >
        <div className="relative">
          <input
            id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
            placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
            required className="admin-input pr-11"
          />
          <button
            type="button" onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-ink"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </FormField>

      {error && (
        <p role="alert" className="m-0 flex items-start gap-2 rounded-xl bg-admin-danger/10 px-3 py-2 text-sm font-medium text-admin-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <Button type="submit" loading={loading} disabled={!email || !password} className="w-full">
        {loading ? 'Memverifikasi...' : 'Masuk'}
      </Button>

      <p className="m-0 border-t border-admin-line pt-4 text-center text-xs text-admin-muted">
        Akun hanya dapat dibuat oleh Super Admin
      </p>
    </form>
  )
}
