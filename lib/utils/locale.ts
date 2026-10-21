/** Locale dari segmen path belum tentu valid saat dipakai membangun redirect (mis. `/%2Fevil.com/...` → `//evil.com`) — allow-list dulu. */
export function safeLocale(locale: string): 'id' | 'en' {
  return locale === 'en' ? 'en' : 'id'
}
