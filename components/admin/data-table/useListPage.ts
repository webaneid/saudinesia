'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'

/**
 * Halaman & ukuran halaman dari URL (`?page=&limit=`) untuk list admin berbasis Client Component.
 * Pola yang sama dengan halaman server: bisa di-bookmark, bertahan setelah reload.
 */
export function useListPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { page, limit } = parseListParams(searchParams)

  const setPage = useCallback((next: number) => {
    const query: Record<string, string | number | undefined> = Object.fromEntries(searchParams.entries())
    router.replace(buildListHref(pathname, { ...query, page: next }), { scroll: false })
  }, [router, pathname, searchParams])

  /** Ganti satu/lebih param filter (nilai kosong membuangnya) dan kembali ke halaman 1. */
  const setParams = useCallback((patch: Record<string, string | undefined>) => {
    const query: Record<string, string | number | undefined> = { ...Object.fromEntries(searchParams.entries()), ...patch }
    router.replace(buildListHref(pathname, { ...query, page: 1 }), { scroll: false })
  }, [router, pathname, searchParams])

  return { page, limit, setPage, setParams }
}
