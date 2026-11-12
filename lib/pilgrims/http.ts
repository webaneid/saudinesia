import { NextResponse } from 'next/server'
import { z } from 'zod'
import { consume, clientIp, policy } from '@/lib/auth/rateLimit'
import { parseListParams } from '@/lib/table/pagination'
import { ok } from '@/lib/validators'
import { apiErrorJson, failureJson, zodFailure } from '@/lib/errors/api'
import type { DeleteResult, ListOptions, ServiceError, WriteResult } from './service'

// Lapisan HTTP bersama route kartu jamaah — jamaah (`/api/v1/account/pilgrims`) dan admin atas nama pelanggan
// (`/api/v1/admin/customers/[id]/pilgrims`). Penulis tetap lib/pilgrims/service.ts; di sini hanya pemetaan masukan/keluaran.

export const cardIdSchema = z.string().uuid()

/** Galat layanan → respons (429 membawa Retry-After). Pesan layanan sudah aman ditampilkan (tak memuat data akun lain). */
export function serviceFailure(r: ServiceError): NextResponse {
  return failureJson(r)
}

export function writeResponse(r: WriteResult, created = false): NextResponse {
  if (!r.ok) return serviceFailure(r)
  return NextResponse.json({ ...ok(r.card), meta: { warnings: r.warnings } }, { status: created ? 201 : 200 })
}

/** Bentuk sama dengan hapus-aman admin (useEditEntity): `deleted` = hilang; selain itu diarsipkan karena pernah dipakai booking. */
export function deleteResponse(r: DeleteResult): NextResponse {
  if (!r.ok) return serviceFailure(r)
  return r.result === 'deleted'
    ? NextResponse.json(ok({ deleted: true }))
    : NextResponse.json(ok({ deleted: false, archived: true, message: 'Data jamaah ini pernah dipakai booking, jadi diarsipkan (riwayat tetap utuh). Bisa dipulihkan dari arsip.' }))
}

/** Param daftar: page/limit, cari nama `q`, `archived=1`. Param rusak jatuh ke default. */
export function listOptionsOf(url: URL): ListOptions {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  return { ...parseListParams(url.searchParams), ...(q ? { q } : {}), archived: url.searchParams.get('archived') === '1' }
}

export const parseBody = async (req: Request): Promise<unknown> => req.json().catch(() => null)

export function badRequest(error: z.ZodError): NextResponse {
  return zodFailure(error)
}

/** Booking jamaah yang sudah batal/hangus/selesai tidak menerima data/berkas baru (lib/pilgrims/bookingLink.ts → pilgrimBookingState). */
export const closedBooking = () => apiErrorJson('bookingNotActive', 409)
export const notFound = () => apiErrorJson('pilgrimNotFound', 404)

/** Batas tulis per IP untuk route jamaah (lapis di atas batas per akun di layanan). Tanpa IP (dev/langsung) → hanya batas per akun. */
export async function ipLimited(req: Request): Promise<NextResponse | null> {
  const ip = clientIp(req)
  if (!ip) return null
  const hit = await consume(policy('pilgrimWriteIp', ip))
  if (hit.allowed) return null
  const res = apiErrorJson('tooManyPilgrimChanges', 429)
  res.headers.set('Retry-After', String(hit.retryAfterSec))
  return res
}

/** Route jamaah: 401 tanpa sesi, 403 bukan akun jamaah (staf tak punya daftar jamaah sendiri — pakai menu Pelanggan), selain itu 500 + log tanpa isi. */
export function routeFailure(e: unknown, tag: string): NextResponse {
  if (e instanceof Error && e.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
  if (e instanceof Error && e.message === 'Forbidden') return apiErrorJson('forbidden', 403)
  console.error(`[${tag}]`, e instanceof Error ? e.name : e) // nama galat saja — pesan bisa memuat data masukan
  return apiErrorJson('internal', 500)
}
