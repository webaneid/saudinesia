import { LocaleSwitcher } from '@/components/shared/LocaleSwitcher'

// Halaman masuk/daftar tak memakai header publik; pengalih bahasa ditaruh di pojok kanan atas (docs/arsitektur-i18n-frontend.md I2).
// Pengalih mempertahankan query (mis. `next`, token tautan email) — tautan same-origin, halaman bertoken sudah `referrer: no-referrer`.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="absolute right-4 top-4 z-10">
        <LocaleSwitcher />
      </div>
      {children}
    </>
  )
}
