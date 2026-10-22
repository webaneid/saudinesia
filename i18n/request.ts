import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  // Locale divalidasi terhadap daftar sebelum dipakai di impor dinamis berkas pesan (nilai mentah dari URL tak boleh menjadi nama berkas).
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
