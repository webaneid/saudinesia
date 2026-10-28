import Link from 'next/link'
import { Search, X } from 'lucide-react'

type SearchFormProps = {
  /** Path halaman list (tanpa query), mis. `/id/admin/bookings`. */
  action: string
  q: string
  placeholder?: string
  /** Param lain yang dipertahankan saat mencari (mis. status). `page` sengaja tidak ikut — pencarian kembali ke halaman 1. */
  preserve?: Record<string, string | undefined>
  /** Tujuan tombol hapus pencarian; bawaan `action` (membuang semua filter). */
  clearHref?: string
}

/** Form GET biasa — jalan tanpa JavaScript, hasilnya bisa di-bookmark. */
export function SearchForm({ action, q, placeholder = 'Cari…', preserve = {}, clearHref = action }: SearchFormProps) {
  return (
    <form action={action} method="get" role="search" className="flex w-full max-w-md items-center gap-2">
      {Object.entries(preserve).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" />
        <input name="q" defaultValue={q} placeholder={placeholder} aria-label="Cari" className="admin-input pl-9" />
      </div>
      {q && (
        <Link
          href={clearHref}
          aria-label="Hapus pencarian"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-admin-line bg-white text-admin-muted hover:text-admin-ink"
        >
          <X className="size-4" />
        </Link>
      )}
    </form>
  )
}
