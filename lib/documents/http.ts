import { NextResponse } from 'next/server'
import { z } from 'zod'
import { consume, clientIp, policy } from '@/lib/auth/rateLimit'
import { MAX_UPLOAD_BYTES } from '@/lib/media/image'
import { ok, err } from '@/lib/validators'
import { documentUploadFieldsSchema, type DocumentUploadFields } from '@/lib/validators/documents'
import type { DocServiceError } from './service'

// Lapisan HTTP bersama route dokumen jamaah — jamaah (`/api/v1/account/pilgrims/[id]/documents`) dan admin atas nama pelanggan
// (`/api/v1/admin/customers/[id]/pilgrims/[cardId]/documents`). Penulis tetap lib/documents/service.ts.

export const docIdSchema = z.string().uuid()

// Badan multipart = berkas ≤ 5 MB + beberapa kolom teks. Batas dicek dari Content-Length SEBELUM membaca badan, supaya permintaan raksasa
// tidak dimuat ke memori dulu (req.formData() membaca semuanya).
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024
const FIELD_KEYS = new Set(['documentTypeId', 'label', 'referenceCode', 'issuedAt', 'expiresAt'])

export function docFailure(r: DocServiceError): NextResponse {
  const res = NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
  if (r.retryAfterSec) res.headers.set('Retry-After', String(r.retryAfterSec))
  return res
}

export const docNotFound = () => NextResponse.json(err('Dokumen tidak ditemukan'), { status: 404 })

/** Baca unggahan: batas ukuran, satu `file`, kolom teks hanya dari daftar putih (kunci asing / ganda → 400). */
export async function readUpload(req: Request): Promise<{ fields: DocumentUploadFields; file: Buffer } | NextResponse> {
  const len = Number(req.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(len)) return NextResponse.json(err('Panjang permintaan wajib diketahui'), { status: 411 })
  if (len > MAX_BODY_BYTES) return NextResponse.json({ ...err('Ukuran berkas maksimal 5 MB.'), meta: { field: 'file' } }, { status: 413 })
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json(err('Form tidak valid'), { status: 400 }) }
  const raw: Record<string, string> = {}
  let file: File | null = null
  for (const [k, v] of form.entries()) {
    if (k === 'file') {
      if (file || !(v instanceof File)) return NextResponse.json({ ...err('Satu berkas per unggahan'), meta: { field: 'file' } }, { status: 400 })
      file = v
    } else if (!FIELD_KEYS.has(k) || typeof v !== 'string' || Object.hasOwn(raw, k)) {
      return NextResponse.json(err('Kolom tidak dikenal'), { status: 400 })
    } else if (v.trim() !== '') raw[k] = v
  }
  if (!file) return NextResponse.json({ ...err('Pilih berkas'), meta: { field: 'file' } }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ...err('Ukuran berkas maksimal 5 MB.'), meta: { field: 'file' } }, { status: 413 })
  const parsed = documentUploadFieldsSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
  }
  return { fields: parsed.data, file: Buffer.from(await file.arrayBuffer()) }
}

export const createdResponse = <T>(document: T) => NextResponse.json(ok(document), { status: 201 })

/** Batas unggah/hapus per IP untuk route jamaah (di atas batas per akun di layanan). */
export async function docIpLimited(req: Request): Promise<NextResponse | null> {
  const ip = clientIp(req)
  if (!ip) return null
  const hit = await consume(policy('pilgrimDocIp', ip))
  if (hit.allowed) return null
  const res = NextResponse.json(err('Terlalu banyak unggahan dokumen. Coba lagi nanti.'), { status: 429 })
  res.headers.set('Retry-After', String(hit.retryAfterSec))
  return res
}
