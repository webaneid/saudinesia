'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'

/**
 * Halaman & ukuran halaman dari URL (`?page=&limit=`) untuk list admin berbasis Client Component.
 * Pola yang sama dengan halaman server: bisa di-bookmark, bertahan setelah reload.
 *
 * `ns` (opsional) = awalan param untuk halaman dengan LEBIH DARI SATU tabel (mis. `v` → `vpage`, `vq`, `vstatus`); tiap tabel punya halaman dan filter sendiri.
 */
export function useListPage(ns = '') {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const own = new URLSearchParams()
  const rawPage = searchParams.get(`${ns}page`), rawLimit = searchParams.get(`${ns}limit`)
  if (rawPage !== null) own.set('page', rawPage)
  if (rawLimit !== null) own.set('limit', rawLimit)
  const { page, limit } = parseListParams(own)

  const replace = useCallback((patch: Record<string, string | number | undefined>) => {
    const query: Record<string, string | number | undefined> = { ...Object.fromEntries(searchParams.entries()), ...patch }
    router.replace(buildListHref(pathname, query), { scroll: false })
  }, [router, pathname, searchParams])

  const setPage = useCallback((next: number) => replace({ [`${ns}page`]: next === 1 ? undefined : next }), [replace, ns])

  /** Ganti satu/lebih param filter (kunci TANPA awalan `ns`; nilai kosong membuangnya) dan kembali ke halaman 1. */
  const setParams = useCallback((patch: Record<string, string | undefined>) => {
    replace({ ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`${ns}${k}`, v])), [`${ns}page`]: undefined })
  }, [replace, ns])

  /** Nilai param filter milik tabel ini (kunci TANPA awalan). */
  const get = (name: string): string => searchParams.get(`${ns}${name}`) ?? ''

  /** Buang SEMUA filter milik tabel ini (halaman dan ukuran juga). */
  const reset = useCallback((names: string[]) => {
    replace(Object.fromEntries([...names, 'page', 'limit'].map(n => [`${ns}${n}`, undefined])))
  }, [replace, ns])

  return { page, limit, setPage, setParams, get, reset }
}
