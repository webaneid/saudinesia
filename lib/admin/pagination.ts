import { z } from 'zod'

// Murni (tanpa Prisma/next/*) — aman dipakai Server Component, Client Component, dan Route Handler.

export const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_PAGE = 100_000 // jaga skip = (page-1)*limit tetap di dalam Int Postgres

export type ListParams = { page: number; limit: number; skip: number }
export type PageMeta = { page: number; limit: number; total: number; totalPages: number }

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams

function readParam(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined
  const v = raw[key]
  return Array.isArray(v) ? v[0] : v
}

/** Param rusak/hilang jatuh ke default (bukan 400/500) — URL list admin ditulis tangan & bisa basi. */
export function parseListParams(raw: RawParams, defaultLimit = DEFAULT_PAGE_SIZE): ListParams {
  const { page, limit } = z
    .object({
      page: z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(defaultLimit),
    })
    .parse({ page: readParam(raw, 'page'), limit: readParam(raw, 'limit') })
  return { page, limit, skip: (page - 1) * limit }
}

export function buildPageMeta(total: number, page: number, limit: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

/**
 * Hitung total dulu, lalu jepit `page` ke halaman terakhir — pengguna tidak pernah mendarat di halaman kosong
 * (mis. URL lama `?page=9` setelah data berkurang, atau filter yang menyempitkan hasil).
 */
export async function paginate<T>(
  params: ListParams,
  count: () => Promise<number>,
  find: (range: { skip: number; take: number }) => Promise<T[]>,
): Promise<{ items: T[]; meta: PageMeta }> {
  const total = await count()
  const meta = buildPageMeta(total, 1, params.limit)
  const page = Math.min(params.page, meta.totalPages)
  const items = total === 0 ? [] : await find({ skip: (page - 1) * params.limit, take: params.limit })
  return { items, meta: { ...meta, page } }
}

/** URL list dengan query yang dipertahankan; nilai kosong dibuang, `page=1` tidak ditulis. */
export function buildListHref(basePath: string, query: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue
    if (k === 'page' && Number(v) === 1) continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${basePath}?${s}` : basePath
}
