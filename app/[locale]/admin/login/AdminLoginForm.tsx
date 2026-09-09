'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const ADMIN_ROLES = ['admin', 'superadmin']

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
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
          <ShieldCheck className="h-7 w-7 text-slate-300" />
        </div>
        <h1 className="text-xl font-semibold text-white">Saudinesia Admin</h1>
        <p className="text-sm text-slate-400">Masuk dengan akun admin Anda</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300" htmlFor="email">Email</label>
            <input
              id="email" type="email" placeholder="admin@saudinesia.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required autoFocus
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-300" htmlFor="password">Password</label>
              <a href={`/${locale}/forgot-password`} className="text-xs text-slate-400 hover:text-slate-200">
                Lupa password?
              </a>
            </div>
            <div className="relative">
              <input
                id="password" type={showPassword ? 'text' : 'password'}
                placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                {showPassword
                  ? <EyeOff className="h-4 w-4" />
                  : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-800 bg-red-950/50 p-3">
              <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit" disabled={loading || !email || !password}
            className={cn(
              'w-full h-10 rounded-md text-sm font-medium transition-colors',
              'bg-slate-100 text-slate-900 hover:bg-white',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading ? 'Memverifikasi...' : 'Masuk'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-slate-600">
        Akun hanya dapat dibuat oleh Super Admin
      </p>
    </div>
  )
}
