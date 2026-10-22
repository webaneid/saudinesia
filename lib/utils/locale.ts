import { routing, type AppLocale } from '@/i18n/routing'

/** Locale dari segmen path belum tentu valid saat dipakai membangun redirect (mis. `/%2Fevil.com/...` → `//evil.com`) — allow-list dulu. Daftar berasal dari i18n/routing.ts (satu-satunya sumber). */
export function safeLocale(locale: string): AppLocale {
  return (routing.locales as readonly string[]).includes(locale) ? (locale as AppLocale) : routing.defaultLocale
}
