import { NextResponse } from 'next/server'
import { z } from 'zod'
import { consume, clientIp, policy } from '@/lib/auth/rateLimit'
import { parseListParams } from '@/lib/table/pagination'
import { ok, err } from '@/lib/validators'
import type { DeleteResult, ListOptions, ServiceError, WriteResult } from './service'

// Lapisan HTTP bersama route kartu jamaah — jamaah (`/api/v1/account/pilgrims`) dan admin atas nama pelanggan
// (`/api/v1/admin/customers/[id]/pilgrims`). Penulis tetap lib/pilgrims/service.ts; di sini hanya pemetaan masukan/keluaran.

export const cardIdSchema = z.string().uuid()

/** Galat layanan → respons (429 membawa Retry-After). Pesan layanan sudah aman ditampilkan (tak memuat data akun lain). */
export function serviceFailure(r: ServiceError): NextResponse {
  const res = NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
  if (r.retryAfterSec) res.headers.set('Retry-After', String(r.retryAfterSec))
  return res
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
  const issue = error.issues[0]
  return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
}

/** Booking jamaah yang sudah batal/hangus/selesai tidak menerima data/berkas baru (lib/pilgrims/bookingLink.ts → pilgrimBookingState). */
export const closedBooking = () => NextResponse.json(err('Booking ini sudah tidak aktif — data dan dokumen tidak dapat ditambah lagi'), { status: 409 })
export const notFound = () => NextResponse.json(err('Data jamaah tidak ditemukan'), { status: 404 })

/** Batas tulis per IP untuk route jamaah (lapis di atas batas per akun di layanan). Tanpa IP (dev/langsung) → hanya batas per akun. */
export async function ipLimited(req: Request): Promise<NextResponse | null> {
  const ip = clientIp(req)
  if (!ip) return null
  const hit = await consume(policy('pilgrimWriteIp', ip))
  if (hit.allowed) return null
  const res = NextResponse.json(err('Terlalu banyak perubahan data jamaah. Coba lagi nanti.'), { status: 429 })
  res.headers.set('Retry-After', String(hit.retryAfterSec))
  return res
}

/** Route jamaah: 401 tanpa sesi, 403 bukan akun jamaah (staf tak punya daftar jamaah sendiri — pakai menu Pelanggan), selain itu 500 + log tanpa isi. */
export function routeFailure(e: unknown, tag: string): NextResponse {
  if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
  if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
  console.error(`[${tag}]`, e instanceof Error ? e.name : e) // nama galat saja — pesan bisa memuat data masukan
  return NextResponse.json(err('Internal server error'), { status: 500 })
}
