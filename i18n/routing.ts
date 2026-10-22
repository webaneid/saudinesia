import { defineRouting } from 'next-intl/routing'

// SATU-SATUNYA sumber daftar locale (docs/rencana-next-intl-4.md). Sebelumnya terduplikasi di middleware.ts, app/[locale]/layout.tsx,
// dan i18n/request.ts (yang tanpa validasi sama sekali).
export const routing = defineRouting({
  locales: ['id', 'en'],
  defaultLocale: 'id',
  // Tidak ada pengalih bahasa di UI (LocaleSwitcher hanyalah stub), jadi cookie NEXT_LOCALE tak berguna: deteksi lewat Accept-Language tiap
  // kunjungan. Aktifkan kembali (objek `{ maxAge }`) bila pengalih bahasa dibangun.
  localeCookie: false,
})

export type AppLocale = (typeof routing.locales)[number]
