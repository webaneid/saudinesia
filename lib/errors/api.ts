import { NextResponse } from 'next/server'
import { createTranslator } from 'next-intl'
import type { z } from 'zod'
import id from '@/i18n/messages/id.json'
import type { ApiResponse } from '@/lib/validators'
import { formatErrorParams, type ApiErrorParams } from './params'

// Galat API jalur pelanggan berkode (docs/arsitektur-i18n-frontend.md §6.6, I6). SATU sumber teks: pesan `apiErrors.<kode>` di
// i18n/messages/<locale>.json. Server menulis teks `id` di `error` (admin, log, klien lama tak berubah) dan kode + parameter di `meta`;
// klien pelanggan menerjemahkan kode lewat `useApiError` (components/shared). Khusus server — mengimpor berkas pesan.

const CATALOG = id.apiErrors
export type ApiErrorCode = keyof typeof CATALOG

const t = createTranslator({ locale: 'id', messages: { apiErrors: CATALOG }, namespace: 'apiErrors' })

/** Teks Indonesia sebuah kode (parameter `…Date` diformat). */
export function apiErrorText(code: ApiErrorCode, params?: ApiErrorParams): string {
  return t(code, formatErrorParams(params, 'id'))
}

/** Badan respons galat berkode. `field` (jalur kolom) ikut di `meta` seperti sebelumnya. */
export function apiError(code: ApiErrorCode, opts: { params?: ApiErrorParams; field?: string } = {}): ApiResponse {
  return {
    success: false,
    error: apiErrorText(code, opts.params),
    meta: { code, ...(opts.params ? { params: opts.params } : {}), ...(opts.field ? { field: opts.field } : {}) },
  }
}

/** `NextResponse` galat berkode. */
export function apiErrorJson(code: ApiErrorCode, status: number, opts: { params?: ApiErrorParams; field?: string; headers?: HeadersInit } = {}): NextResponse {
  return NextResponse.json(apiError(code, opts), { status, ...(opts.headers ? { headers: opts.headers } : {}) })
}

// Indeks balik teks statis → kode, HANYA untuk pesan Zod (validator dipakai juga di klien, jadi tidak bisa mengimpor berkas pesan).
// Penjaga (scripts/test-api-errors.ts) memastikan setiap pesan statis validator jalur pelanggan ada di katalog.
const BY_TEXT = new Map<string, ApiErrorCode>()
for (const [k, v] of Object.entries(CATALOG) as [ApiErrorCode, string][]) if (!v.includes('{')) BY_TEXT.set(v, k)

export const codeOfText = (text: string): ApiErrorCode | undefined => BY_TEXT.get(text)

// Pesan Zod bertemplat (mis. `Maksimal ${CHECKOUT_MAX_PEOPLE} orang per pesanan`): pola katalog dengan argumen SEDERHANA `{nama}` (tanpa select/plural)
// dicocokkan sebagai regex; argumen bilangan bulat dikembalikan sebagai angka. Teks statis tetap lewat `codeOfText`.
const PATTERNS: { code: ApiErrorCode; re: RegExp; names: string[] }[] = []
for (const [k, v] of Object.entries(CATALOG) as [ApiErrorCode, string][]) {
  if (!v.includes('{') || /\{\w+,/.test(v)) continue
  const names: string[] = []
  const parts = v.split(/\{(\w+)\}/)
  // Dua argumen tanpa teks pemisah = pola ambigu (backtracking berlipat) — tak dicocokkan; dijaga scripts/test-api-errors.ts.
  if (parts.some((part, i) => i % 2 === 0 && part === '' && i > 0 && i < parts.length - 1)) continue
  const re = parts.map((part, i) => (i % 2 ? (names.push(part), '(.+?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')
  PATTERNS.push({ code: k, re: new RegExp(`^${re}$`), names })
}

/** Pesan Zod di proyek ini pendek; teks lebih panjang tak pernah dicocokkan ke pola (batas kerja regex atas masukan tak tepercaya). */
export const MATCH_TEXT_MAX = 300

/** Teks (statis atau dari pola katalog berargumen sederhana) → kode + parameter. */
export function matchText(text: string): { code: ApiErrorCode; params?: ApiErrorParams } | undefined {
  const code = BY_TEXT.get(text)
  if (code) return { code }
  if (text.length > MATCH_TEXT_MAX) return undefined
  for (const p of PATTERNS) {
    const m = p.re.exec(text)
    if (!m) continue
    const params: ApiErrorParams = {}
    p.names.forEach((n, i) => { const v = m[i + 1]!; params[n] = /^\d{1,9}$/.test(v) ? Number(v) : v })
    return { code: p.code, params }
  }
  return undefined
}

/** Galat Zod → 400. Pesan dikenal → berkode; tak dikenal → teks apa adanya tanpa kode (klien `/en` memakai teks gagal bawaan, I6-1). */
export function zodFailure(error: z.ZodError, status = 400): NextResponse {
  const issue = error.issues[0]
  const field = issue?.path.length ? issue.path.join('.') : undefined
  const hit = issue ? matchText(issue.message) : { code: 'invalidInput' as const }
  if (hit) return apiErrorJson(hit.code, status, { ...(hit.params ? { params: hit.params } : {}), ...(field ? { field } : {}) })
  return NextResponse.json({ success: false, error: issue?.message ?? apiErrorText('invalidInput'), ...(field ? { meta: { field } } : {}) }, { status })
}

/** Isi galat berkode untuk hasil layanan `{ ok: false, status, … }`: `error` = teks Indonesia (admin), `code`/`params` untuk pelanggan. */
export function codedError(code: ApiErrorCode, params?: ApiErrorParams): { error: string; code: ApiErrorCode; params?: ApiErrorParams } {
  return { error: apiErrorText(code, params), code, ...(params ? { params } : {}) }
}

/** Hasil layanan gagal → respons. Tanpa `code` (galat khusus staf) → teks saja. 429 membawa Retry-After. */
export function failureJson(r: { status: number; error: string; code?: ApiErrorCode; params?: ApiErrorParams; field?: string; retryAfterSec?: number }): NextResponse {
  const meta = { ...(r.code ? { code: r.code } : {}), ...(r.params ? { params: r.params } : {}), ...(r.field ? { field: r.field } : {}) }
  const res = NextResponse.json({ success: false, error: r.error, ...(Object.keys(meta).length ? { meta } : {}) }, { status: r.status })
  if (r.retryAfterSec) res.headers.set('Retry-After', String(r.retryAfterSec))
  return res
}
