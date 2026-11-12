'use client'

import { useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { routing } from '@/i18n/routing'
import { resolveApiError } from '@/lib/errors/params'

/**
 * Teks galat dari respons API untuk pelanggan (docs/arsitektur-i18n-frontend.md §6.6, I6) — aturan di `resolveApiError`.
 * SATU-SATUNYA cara klien area pelanggan membaca `error` dari API (dijaga scripts/test-api-errors.ts).
 */
export function useApiError(): (body: unknown, fallback: string) => string {
  const t = useTranslations('apiErrors')
  const locale = useLocale()
  return useCallback(
    (body: unknown, fallback: string) => resolveApiError(body, fallback, { locale, defaultLocale: routing.defaultLocale, has: k => t.has(k), t: (k, p) => t(k, p) }),
    [t, locale],
  )
}
