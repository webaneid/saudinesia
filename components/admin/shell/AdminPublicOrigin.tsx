'use client'

import { createContext, useContext } from 'react'
import { publicHref } from '@/lib/admin/href'

// Origin situs publik (`APP_URL`, env runtime) untuk tautan admin → halaman publik saat admin berada di domain sendiri
// (docs/rencana-domain-admin.md §3.1). Diisi layout admin dari server; klien tidak bisa membaca env runtime.
const Ctx = createContext('')

export function AdminPublicOriginProvider({ origin, children }: { origin: string; children: React.ReactNode }) {
  return <Ctx.Provider value={origin}>{children}</Ctx.Provider>
}

/** `(path) => href` ke halaman publik — relatif di mode jalur, absolut ke host app di mode domain. */
export function usePublicHref(): (path: string) => string {
  const origin = useContext(Ctx)
  return (path) => publicHref(path, origin)
}
