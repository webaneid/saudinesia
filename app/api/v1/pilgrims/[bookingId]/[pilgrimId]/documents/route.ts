import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, ADMIN_ROLES } from '@/lib/auth/session'
import {
  buildObjectKey, uploadBuffer, validateUpload,
  deleteObject,
} from '@/lib/storage/minio'
import { ok, err } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { REQUIRED_DOCUMENTS } from '@/lib/constants/booking'
import { getDocumentRequirements } from '@/lib/documents/getRequirements'

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

  // docs/arsitektur-dokumen.md §4 — getDocumentRequirements() menggantikan
  // parseRequirements(visaProduct.requirements), sumber kebenaran per productType+productId.
  const visaApp = await prisma.visaApplication.findUnique({
    where: { bookingPilgrimId: pilgrimId },
    select: { visaProductId: true },
  })
  const requirements = visaApp?.visaProductId
    ? await getDocumentRequirements('visa', visaApp.visaProductId)
    : null

  const requiredTypes = requirements
    ? requirements.filter(r => r.required).map(r => r.docType)
    : [...REQUIRED_DOCUMENTS]

  const uploaded = new Set(documents.map(d => d.docType))
  const missing  = requiredTypes.filter(t => !uploaded.has(t))

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

  // Validate docType against visa product requirements or fallback to REQUIRED_DOCUMENTS
  const visaApp = await prisma.visaApplication.findUnique({
    where: { bookingPilgrimId: pilgrimId },
    select: { visaProductId: true },
  })
  const requirements = visaApp?.visaProductId
    ? await getDocumentRequirements('visa', visaApp.visaProductId)
    : null

  const allowedDocTypes = requirements
    ? requirements.map(r => r.docType)
    : [...REQUIRED_DOCUMENTS] as string[]

  if (!allowedDocTypes.includes(docType)) {
    return NextResponse.json(err(`docType tidak valid`), { status: 400 })
  }

  try {
    validateUpload(file.type, file.size)
  } catch (e) {
    return NextResponse.json(err((e as Error).message), { status: 400 })
  }

  const buffer    = Buffer.from(await file.arrayBuffer())
  const objectKey = buildObjectKey('pilgrims', pilgrimId, docType, file.name)

  const existing = await prisma.document.findFirst({
    where: { bookingPilgrimId: pilgrimId, docType },
  })
  if (existing) {
    await deleteObject(existing.filePath).catch(() => {})
    await prisma.document.delete({ where: { id: existing.id } })
  }

  try {
    await uploadBuffer(objectKey, buffer, file.type)
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
        fileName:      file.name,
        filePath:      objectKey,
        fileSizeBytes: file.size,
      },
      select: { id: true, docType: true, fileName: true, fileSizeBytes: true, uploadedAt: true },
    })
  })
  if (!doc) {
    await deleteObject(objectKey).catch(() => {})
    return NextResponse.json(err('Jamaah tidak ditemukan'), { status: 404 })
  }

  // Auto-advance: check all required docs are now uploaded
  const requiredTypes = requirements
    ? requirements.filter(r => r.required).map(r => r.docType)
    : [...REQUIRED_DOCUMENTS] as string[]

  const uploadedDocs = await prisma.document.findMany({
    where: { bookingPilgrimId: pilgrimId },
    select: { docType: true },
  })
  const uploadedSet = new Set(uploadedDocs.map(d => d.docType))
  const allRequired = requiredTypes.every(t => uploadedSet.has(t))

  if (allRequired) {
    await prisma.visaApplication.updateMany({
      where: { bookingPilgrimId: pilgrimId, status: 'pending_documents' },
      data:  { status: 'documents_complete' },
    })
  }

  return NextResponse.json(ok(doc), { status: 201 })
}
