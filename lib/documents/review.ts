import type { DocumentRejectReason, DocumentReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { consume, policy } from '@/lib/auth/rateLimit'
import { lockCardOwner, type Actor } from '@/lib/pilgrims/service'
import { reopenForChangedDocument } from '@/lib/pilgrims/review'
import { documentService, type DocServiceError } from './service'

// Pemeriksaan dokumen jamaah oleh petugas (docs/arsitektur-jamaah.md §8.4 butir 3) — bagian dari penulis tunggal lib/documents/: hanya di sini
// `status/rejectReason/reviewNote/reviewedById/reviewedAt` berubah. Dicakup lewat jamaah booking: dokumen milik kartu yang ditautkannya, yaitu
// dokumen orang (tanpa booking) atau dokumen perjalanan booking itu. Urutan kunci sama dengan layanan dokumen: pemilik FOR SHARE → kartu FOR UPDATE
// → (bila menolak) jamaah booking yang memakainya dibuka ulang.

export type DocumentReviewInput = { status: Exclude<DocumentReviewStatus, 'pending'>; rejectReason?: DocumentRejectReason | null; note?: string | null }
export type DocumentReviewResult = { ok: true; status: DocumentReviewStatus } | DocServiceError

class Abort extends Error {
  constructor(readonly result: DocServiceError) { super(result.error) }
}
const notFound = (): DocServiceError => ({ ok: false, status: 404, error: 'Dokumen tidak ditemukan' })

export async function reviewDocument(actor: Actor, bookingId: string, bookingPilgrimId: string, docId: string, input: DocumentReviewInput): Promise<DocumentReviewResult> {
  if (!ADMIN_ROLES.includes(actor.role)) return notFound()
  if (input.status === 'rejected' && !input.rejectReason) return { ok: false, status: 400, error: 'Pilih alasan penolakan', field: 'rejectReason' }
  const hit = await consume(policy('pilgrimWriteStaff', actor.userId))
  if (!hit.allowed) return { ok: false, status: 429, error: 'Terlalu banyak perubahan data jamaah. Coba lagi nanti.', retryAfterSec: hit.retryAfterSec }

  const bp = await prisma.bookingPilgrim.findFirst({
    where: { id: bookingPilgrimId, bookingId, booking: { status: { not: 'draft' } } },
    select: { savedPilgrimId: true, booking: { select: { userId: true } } },
  })
  if (!bp?.savedPilgrimId) return notFound()
  const cardId = bp.savedPilgrimId
  const ownerId = bp.booking.userId
  const note = input.note?.trim() || null

  try {
    const status = await prisma.$transaction(async (tx) => {
      const refusal = await lockCardOwner(tx, actor, ownerId)
      if (refusal) throw new Abort(refusal.status === 404 ? notFound() : refusal)
      // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kartu dikunci seperti unggah/hapus dokumen (berurutan dengannya).
      const held = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "ownerId" = ${ownerId} FOR UPDATE`
      if (!held[0]) throw new Abort(notFound())
      // Tautan diperiksa ulang di dalam kunci: kartu yang sudah dilepas/diganti tak lagi dalam cakupan jamaah booking ini.
      const still = await tx.bookingPilgrim.findFirst({ where: { id: bookingPilgrimId, bookingId, savedPilgrimId: cardId }, select: { id: true } })
      if (!still) throw new Abort(notFound())
      const doc = await tx.pilgrimDocument.findFirst({
        where: { id: docId, savedPilgrimId: cardId, OR: [{ bookingId: null }, { bookingId }] },
        select: { bookingId: true, documentTypeId: true },
      })
      if (!doc) throw new Abort(notFound())
      const row = await tx.pilgrimDocument.update({
        where: { id: docId },
        data: {
          status: input.status, rejectReason: input.status === 'rejected' ? input.rejectReason : null, reviewNote: note,
          reviewedById: actor.userId, reviewedAt: new Date(),
        },
        select: { status: true },
      })
      // Sesudah mengubah dokumen (SEC-200): keputusan yang memegang FOR SHARE atas dokumen ini selesai dulu, reopen melihat hasilnya.
      if (input.status === 'rejected') {
        await reopenForChangedDocument(tx, { savedPilgrimId: cardId, bookingId: doc.bookingId, documentTypeId: doc.documentTypeId }, actor.userId, 'Dokumen ditolak petugas')
      }
      return row.status
    })
    return { ok: true, status }
  } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }
}

/** URL presigned 15 menit untuk melihat dokumen yang diperiksa — cakupan sama dengan `reviewDocument` (kartu tertaut atau perjalanan booking ini). */
export async function reviewPreviewUrl(actor: Actor, bookingId: string, bookingPilgrimId: string, docId: string, docs = documentService) {
  if (!ADMIN_ROLES.includes(actor.role)) return notFound()
  const bp = await prisma.bookingPilgrim.findFirst({
    where: { id: bookingPilgrimId, bookingId, booking: { status: { not: 'draft' } } },
    select: { savedPilgrimId: true, booking: { select: { userId: true } } },
  })
  if (!bp?.savedPilgrimId) return notFound()
  const doc = await prisma.pilgrimDocument.findFirst({ where: { id: docId, savedPilgrimId: bp.savedPilgrimId, OR: [{ bookingId: null }, { bookingId }] }, select: { bookingId: true } })
  if (!doc) return notFound()
  return docs.previewUrl(actor, bp.booking.userId, bp.savedPilgrimId, docId, { bookingId: doc.bookingId })
}
