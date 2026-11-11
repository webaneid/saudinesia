'use client'

import { Check, Circle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

// Petunjuk kekuatan password untuk aktivasi akun dan atur ulang password — satu daftar aturan, satu tampilan.
// Hanya bantuan tampilan; aturan sebenarnya diperiksa server.
const RULES = [
  { key: 'minLength', test: (p: string) => p.length >= 8 },
  { key: 'letter', test: (p: string) => /[a-zA-Z]/.test(p) },
  { key: 'digit', test: (p: string) => /[0-9]/.test(p) },
  { key: 'special', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
] as const

export const passwordMeetsHints = (password: string) => RULES.every(r => r.test(password))

export function PasswordHints({ password }: { password: string }) {
  const t = useTranslations('authPages.passwordHints')
  if (!password) return null
  return (
    <ul className="grid grid-cols-2 gap-1 pt-1">
      {RULES.map(r => {
        const ok = r.test(password)
        const Icon = ok ? Check : Circle
        return (
          <li key={r.key} className={cn('flex items-center gap-1 text-xs', ok ? 'text-brand' : 'text-muted-foreground')}>
            <Icon className="h-3 w-3 shrink-0" aria-hidden />{t(r.key)}
          </li>
        )
      })}
    </ul>
  )
}
