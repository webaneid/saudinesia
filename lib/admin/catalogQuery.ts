import { paginate, parseListParams, type ListParams, type PageMeta } from '@/lib/admin/pagination'

// Murni (tanpa Prisma/next/*) — parameter daftar katalog admin (docs/arsitektur-tabel.md §2.5, Fase 3). Paginasi di API katalog bersifat OPT-IN: GET tanpa `page`/`limit`
// tetap mengembalikan SEMUA baris (picker di halaman edit — paket, ziarah, penerbangan — memuat daftar utuh dari URL yang sama); halaman tabel meminta `?page=&limit=`.

export type CatalogStatus = 'active' | 'inactive'
export type CatalogQuery = {
  /** null = tidak minta paginasi (kembalikan semua). */
  list: ListParams | null
  /** Pencarian teks bebas (≤ 100 karakter); pemanggil WAJIB meloloskannya lewat `escapeLike` sebelum `contains`. */
  q: string
  status?: CatalogStatus
  params: URLSearchParams
}

export function readCatalogQuery(params: URLSearchParams): CatalogQuery {
  const status = params.get('status')
  return {
    list: params.has('page') || params.has('limit') ? parseListParams(params) : null,
    q: (params.get('q') ?? '').trim().slice(0, 100),
    status: status === 'active' || status === 'inactive' ? status : undefined,
    params,
  }
}

/** Nilai param yang hanya boleh salah satu dari `allowed` (nilai asing = tanpa filter, bukan 500). */
export function pickParam<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = params.get(key)
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/** Filter `isActive` untuk model yang punya kolom itu. */
export const activeFilter = (status?: CatalogStatus): { isActive?: boolean } => (status ? { isActive: status === 'active' } : {})

/** Satu pintu: `list` null → semua baris tanpa `meta`; selain itu halaman terjepit + `meta`. `find` menerima rentang (atau tidak sama sekali). */
export async function paginateCatalog<T>(
  list: ListParams | null,
  count: () => Promise<number>,
  find: (range?: { skip: number; take: number }) => Promise<T[]>,
): Promise<{ items: T[]; meta?: PageMeta }> {
  if (!list) return { items: await find() }
  return paginate(list, count, range => find(range))
}
