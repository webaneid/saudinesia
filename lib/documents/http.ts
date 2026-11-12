import { NextResponse } from 'next/server'
import { z } from 'zod'
import { consume, clientIp, policy } from '@/lib/auth/rateLimit'
import { MAX_UPLOAD_BYTES } from '@/lib/media/image'
import { ok } from '@/lib/validators'
import { apiErrorJson, failureJson, zodFailure } from '@/lib/errors/api'
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
  return failureJson(r)
}

export const docNotFound = () => apiErrorJson('documentNotFound', 404)

/** Baca unggahan: batas ukuran, satu `file`, kolom teks hanya dari daftar putih (kunci asing / ganda → 400). */
export async function readUpload(req: Request): Promise<{ fields: DocumentUploadFields; file: Buffer } | NextResponse> {
  const len = Number(req.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(len)) return apiErrorJson('lengthRequired', 411)
  if (len > MAX_BODY_BYTES) return apiErrorJson('fileTooLarge', 413, { field: 'file' })
  let form: FormData
  try { form = await req.formData() } catch { return apiErrorJson('formInvalid', 400) }
  const raw: Record<string, string> = {}
  let file: File | null = null
  for (const [k, v] of form.entries()) {
    if (k === 'file') {
      if (file || !(v instanceof File)) return apiErrorJson('oneFilePerUpload', 400, { field: 'file' })
      file = v
    } else if (!FIELD_KEYS.has(k) || typeof v !== 'string' || Object.hasOwn(raw, k)) {
      return apiErrorJson('unknownField', 400)
    } else if (v.trim() !== '') raw[k] = v
  }
  if (!file) return apiErrorJson('chooseFile', 400, { field: 'file' })
  if (file.size > MAX_UPLOAD_BYTES) return apiErrorJson('fileTooLarge', 413, { field: 'file' })
  const parsed = documentUploadFieldsSchema.safeParse(raw)
  if (!parsed.success) return zodFailure(parsed.error)
  return { fields: parsed.data, file: Buffer.from(await file.arrayBuffer()) }
}

/** Baca unggahan yang HANYA berisi satu `file` tanpa kolom lain (bukti transfer). Batas ukuran sama dengan `readUpload`, dicek sebelum badan dibaca. */
export async function readSingleFile(req: Request): Promise<Buffer | NextResponse> {
  const len = Number(req.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(len)) return apiErrorJson('lengthRequired', 411)
  if (len > MAX_BODY_BYTES) return apiErrorJson('fileTooLarge', 413)
  let form: FormData
  try { form = await req.formData() } catch { return apiErrorJson('formInvalid', 400) }
  const entries = [...form.entries()]
  const only = entries[0]
  if (entries.length !== 1 || !only || only[0] !== 'file' || !(only[1] instanceof File)) return apiErrorJson('chooseOneFile', 400)
  if (only[1].size > MAX_UPLOAD_BYTES) return apiErrorJson('fileTooLarge', 413)
  return Buffer.from(await only[1].arrayBuffer())
}

export const createdResponse = <T>(document: T) => NextResponse.json(ok(document), { status: 201 })

/** Batas unggah/hapus per IP untuk route jamaah (di atas batas per akun di layanan). */
export async function docIpLimited(req: Request): Promise<NextResponse | null> {
  const ip = clientIp(req)
  if (!ip) return null
  const hit = await consume(policy('pilgrimDocIp', ip))
  if (hit.allowed) return null
  const res = apiErrorJson('tooManyDocumentUploads', 429)
  res.headers.set('Retry-After', String(hit.retryAfterSec))
  return res
}
