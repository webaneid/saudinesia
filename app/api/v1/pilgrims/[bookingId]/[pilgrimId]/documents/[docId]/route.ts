import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, ADMIN_ROLES } from '@/lib/auth/session'
import { getPresignedUrl, deleteObject } from '@/lib/storage/minio'
import { ok, err } from '@/lib/validators'

type Params = { params: Promise<{ bookingId: string; pilgrimId: string; docId: string }> }

async function authorise(bookingId: string, pilgrimId: string, docId: string) {
  const session = await getSession()
  if (!session) return null

  const isAdmin = ADMIN_ROLES.includes(session.role)

  const pilgrim = await prisma.bookingPilgrim.findUnique({
    where: { id: pilgrimId },
    include: { booking: { select: { id: true, userId: true } } },
  })
  if (!pilgrim || pilgrim.booking.id !== bookingId) return null
  if (!isAdmin && pilgrim.booking.userId !== session.userId) return null

  const doc = await prisma.document.findUnique({ where: { id: docId } })
  if (!doc || doc.bookingPilgrimId !== pilgrimId) return null

  return { session, isAdmin, doc }
}

// ─── GET — generate presigned preview URL ─────────────────────────────────────
// Admin gets 60-min TTL; pilgrim gets 15-min TTL
export async function GET(req: NextRequest, { params }: Params) {
  const { bookingId, pilgrimId, docId } = await params

  const auth = await authorise(bookingId, pilgrimId, docId)
  if (!auth) return NextResponse.json(err('Unauthorized'), { status: 401 })

  const expirySeconds = auth.isAdmin ? 3600 : 900

  try {
    const url = await getPresignedUrl(auth.doc.filePath, expirySeconds)
    return NextResponse.json(ok({ url, expiresIn: expirySeconds }))
  } catch {
    return NextResponse.json(err('Could not generate preview URL'), { status: 500 })
  }
}

// ─── DELETE — remove from MinIO + DB ─────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const { bookingId, pilgrimId, docId } = await params

  const auth = await authorise(bookingId, pilgrimId, docId)
  if (!auth) return NextResponse.json(err('Unauthorized'), { status: 401 })

  // Delete from MinIO first (non-fatal if object already gone)
  await deleteObject(auth.doc.filePath).catch(() => {})

  // Delete DB record
  await prisma.document.delete({ where: { id: docId } })

  // Revert visa status back to pending_documents if it was documents_complete
  await prisma.visaApplication.updateMany({
    where: { bookingPilgrimId: pilgrimId, status: 'documents_complete' },
    data:  { status: 'pending_documents' },
  })

  return NextResponse.json(ok(null))
}
