import { defineRouting } from 'next-intl/routing'

// SATU-SATUNYA sumber daftar locale (docs/rencana-next-intl-4.md). Sebelumnya terduplikasi di middleware.ts, app/[locale]/layout.tsx,
// dan i18n/request.ts (yang tanpa validasi sama sekali).
export const routing = defineRouting({
  locales: ['id', 'en'],
  defaultLocale: 'id',
  // Bawaan SELALU Indonesia (pemilik 2026-11-11, docs/arsitektur-i18n-frontend.md K1): `/` → `/id` untuk semua pengunjung, bahasa browser
  // (Accept-Language) tidak dipakai. Bahasa Inggris hanya lewat pengalih (`LocaleSwitcher`), dan pilihan diingat lewat URL saja (K2) — karena itu
  // tanpa cookie NEXT_LOCALE.
  localeDetection: false,
  localeCookie: false,
})

export type AppLocale = (typeof routing.locales)[number]
