import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, ADMIN_ROLES } from '@/lib/auth/session'
import { buildObjectKey, uploadBuffer, deleteObject } from '@/lib/storage/minio'
import { DocumentFileRejected, prepareDocumentFile } from '@/lib/documents/file'
import { MAX_UPLOAD_BYTES } from '@/lib/media/image'
import { ok, err } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { requirementsOf } from '@/lib/documents/requirements'
import { evaluateCompleteness, type RequirementView } from '@/lib/documents/completeness'
import { todayInApp } from '@/lib/time'

type Params = { params: Promise<{ bookingId: string; pilgrimId: string }> }

async function authorise(bookingId: string, pilgrimId: string) {
  const session = await getSession()
  if (!session) return null

  const isAdmin = ADMIN_ROLES.includes(session.role)

  const pilgrim = await prisma.bookingPilgrim.findUnique({
    where: { id: pilgrimId },
    include: { booking: { select: { id: true, userId: true } } },
  })
  if (!pilgrim || pilgrim.booking.id !== bookingId) return null
  if (!isAdmin && pilgrim.booking.userId !== session.userId) return null

  return { session, pilgrim, isAdmin }
}

// ─── GET /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents ───────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { bookingId, pilgrimId } = await params

  const auth = await authorise(bookingId, pilgrimId)
  if (!auth) return NextResponse.json(err('Unauthorized'), { status: 401 })

  const documents = await prisma.document.findMany({
    where: { bookingPilgrimId: pilgrimId },
    orderBy: { uploadedAt: 'asc' },
    select: { id: true, docType: true, fileName: true, fileSizeBytes: true, uploadedAt: true },
  })

  const requirements = await legacyRequirements(pilgrimId)
  const missing = legacyCompleteness(requirements, documents).missingRequired.map(r => r.key)

  return NextResponse.json(ok({ documents, missing, requirements }))
}

// ─── POST /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents ─────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const { bookingId, pilgrimId } = await params

  const auth = await authorise(bookingId, pilgrimId)
  if (!auth) return NextResponse.json(err('Unauthorized'), { status: 401 })

  if (auth.isAdmin) {
    return NextResponse.json(err('Admins cannot upload on behalf of pilgrims'), { status: 403 })
  }
  const refusal = await onboardingRefusal(auth.session.userId, auth.session.role)
  if (refusal) return refusal

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(err('Invalid form data'), { status: 400 })
  }

  const file    = formData.get('file') as File | null
  const docType = formData.get('docType') as string | null

  if (!file || !docType) {
    return NextResponse.json(err('file and docType are required'), { status: 400 })
  }

  // Jenis yang boleh = syarat produk visa jamaah (lib/documents/requirements.ts); tanpa syarat = tak ada yang diunggah lewat rute lama.
  const requirements = await legacyRequirements(pilgrimId)
  const allowedDocTypes = requirements.map(r => r.key)

  if (!allowedDocTypes.includes(docType)) {
    return NextResponse.json(err(`docType tidak valid`), { status: 400 })
  }

  // D3 (docs/arsitektur-jamaah.md §3.2): jenis berkas dari ISI, bukan `file.type` klien; gambar dienkode ulang ke WebP (EXIF/GPS dibuang).
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json(err('Ukuran berkas maksimal 5 MB.'), { status: 400 })
  let prepared
  try {
    prepared = await prepareDocumentFile(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof DocumentFileRejected) return NextResponse.json(err(e.message), { status: 400 })
    throw e
  }
  const fileName  = `${(file.name.replace(/\.[^.]*$/, '') || docType).slice(0, 80)}.${prepared.ext}`
  const objectKey = buildObjectKey('pilgrims', pilgrimId, docType, fileName)

  const existing = await prisma.document.findFirst({
    where: { bookingPilgrimId: pilgrimId, docType },
  })
  if (existing) {
    await deleteObject(existing.filePath).catch(() => {})
    await prisma.document.delete({ where: { id: existing.id } })
  }

  try {
    await uploadBuffer(objectKey, prepared.body, prepared.mimeType)
  } catch {
    return NextResponse.json(err('Storage error. Please try again.'), { status: 500 })
  }

  // Penghapusan akun (SEC-57): sesi divalidasi di awal, tetapi akun bisa dianonimkan SELAMA unggahan berjalan. Cek ulang pemilik tepat
  // sebelum menulis baris; kalau sudah nonaktif, buang berkas yang baru diunggah dan jangan catat apa pun (sisa celah mikrodetik disapu cron).
  const owner = await prisma.user.findUnique({ where: { id: auth.pilgrim.booking.userId }, select: { isActive: true } })
  if (!owner?.isActive) {
    await deleteObject(objectKey).catch(() => {})
    return NextResponse.json(err('Unauthorized'), { status: 401 })
  }

  // Revisi booking dapat MENGHAPUS jamaah (docs/arsitektur-booking-engine-v2.md §10.4 6b, R3: hanya bila belum ada dokumen) di bawah kunci FOR UPDATE baris booking.
  // Baris dokumen ditulis di bawah kunci FOR SHARE baris booking yang sama: revisi dan unggahan terserialkan — revisi melihat dokumen ini (R3 menolak hapus), atau
  // unggahan melihat jamaah sudah tiada. Pada kasus kedua berkas yang baru diunggah dibuang, supaya scan paspor/KTP tak tertinggal tanpa pemilik di MinIO.
  const doc = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId} FOR SHARE` // Prisma ORM tak punya SELECT … FOR SHARE
    const still = await tx.bookingPilgrim.findFirst({ where: { id: pilgrimId, bookingId }, select: { id: true } })
    if (!still) return null
    return tx.document.create({
      data: {
        bookingPilgrimId: pilgrimId,
        docType,
        fileName,
        filePath:      objectKey,
        fileSizeBytes: prepared.sizeBytes,
      },
      select: { id: true, docType: true, fileName: true, fileSizeBytes: true, uploadedAt: true },
    })
  })
  if (!doc) {
    await deleteObject(objectKey).catch(() => {})
    return NextResponse.json(err('Jamaah tidak ditemukan'), { status: 404 })
  }

  // Auto-advance: semua syarat wajib sudah ada berkasnya (evaluator tunggal lib/documents/completeness.ts).
  const uploadedDocs = await prisma.document.findMany({
    where: { bookingPilgrimId: pilgrimId },
    select: { docType: true },
  })
  const allRequired = legacyCompleteness(requirements, uploadedDocs).ready

  if (allRequired) {
    await prisma.visaApplication.updateMany({
      where: { bookingPilgrimId: pilgrimId, status: 'pending_documents' },
      data:  { status: 'documents_complete' },
    })
  }

  return NextResponse.json(ok(doc), { status: 201 })
}

// Model `Document` lama (diganti Fase 7) tak punya status/tanggal: berkas = "menunggu pemeriksaan", masa berlaku tak dinilai.
async function legacyRequirements(pilgrimId: string): Promise<RequirementView[]> {
  const visaApp = await prisma.visaApplication.findUnique({ where: { bookingPilgrimId: pilgrimId }, select: { visaProductId: true } })
  return visaApp?.visaProductId ? requirementsOf('visa', visaApp.visaProductId) : []
}
function legacyCompleteness(requirements: RequirementView[], docs: { docType: string }[]) {
  const idByKey = new Map(requirements.map(r => [r.key, r.documentTypeId]))
  return evaluateCompleteness({
    requirements,
    documents: docs.flatMap(d => { const id = idByKey.get(d.docType); return id ? [{ documentTypeId: id, status: 'pending' as const, expiresAt: null }] : [] }),
    referenceDate: todayInApp(),
    checkValidity: false,
  })
}
