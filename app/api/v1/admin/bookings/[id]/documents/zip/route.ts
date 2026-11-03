import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { getObjectBuffer } from '@/lib/storage/minio'
import { err } from '@/lib/validators'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'
import { authFailureResponse } from '@/lib/admin/errors'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
  } catch (e) { return authFailureResponse(e, 'v1/admin/bookings/[id]/documents/zip/GET') }

  const { id: bookingId } = await params

  // Berkas = dokumen milik orang di kartu tertaut (bookingId null) + dokumen perjalanan booking ini (docs/arsitektur-jamaah.md §5.3).
  // select, bukan include: kolom NIK/paspor tersegel tak pernah dimuat. Jamaah tanpa kartu tertaut tidak punya berkas.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      bookingCode: true,
      status: true,
      pilgrims: { select: { id: true, fieldValues: true, savedPilgrimId: true, visaApplication: { select: { visaProductId: true } } } },
    },
  })

  if (!booking || booking.status === 'draft') return NextResponse.json(err('Booking not found'), { status: 404 })

  const cardIds = [...new Set(booking.pilgrims.flatMap(p => (p.savedPilgrimId ? [p.savedPilgrimId] : [])))]
  const cardDocs = cardIds.length
    ? await prisma.pilgrimDocument.findMany({
        where: { savedPilgrimId: { in: cardIds }, OR: [{ bookingId: null }, { bookingId }] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { savedPilgrimId: true, objectKey: true, mimeType: true, documentType: { select: { key: true, label: true } } },
      })
    : []

  // docs/arsitektur-manifest.md §4 — getFieldByRole() menggantikan p.fullName
  const fieldsByProduct = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const productId of new Set(booking.pilgrims.map(p => p.visaApplication?.visaProductId).filter((v): v is string => !!v))) {
    fieldsByProduct.set(productId, await getManifestFieldRequirements('visa', productId))
  }
  const allDocs = booking.pilgrims.flatMap(p => {
    if (!p.savedPilgrimId) return []
    const fields = p.visaApplication?.visaProductId ? fieldsByProduct.get(p.visaApplication.visaProductId) ?? [] : []
    const name = getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name')
    const pilgrimName = typeof name === 'string' && name ? name : p.id
    return cardDocs.filter(d => d.savedPilgrimId === p.savedPilgrimId).map(d => ({ ...d, pilgrimName, pilgrimId: p.id }))
  })

  if (allDocs.length === 0) {
    return NextResponse.json(err('No documents to download'), { status: 404 })
  }

  // Nama berkas di ZIP = label katalog jenis dokumen (kunci bila kosong), dibersihkan — label diatur admin, jangan jadi path.
  // Path unik ditetapkan sebelum unduhan paralel (SEC-187): nama jamaah sama, label sama, atau label kosong setelah disaring tak boleh saling
  // menimpa entri ZIP — folder diberi awalan id jamaah, nama berkas ganda diberi sufiks -2, -3, …
  const used = new Set<string>()
  const entries = allDocs.map(doc => {
    const label  = (doc.documentType.label || doc.documentType.key).replace(/[^a-zA-Z0-9 ()-]/g, '').trim() || 'dokumen'
    const folder = `${doc.pilgrimName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'jamaah'}-${doc.pilgrimId.slice(0, 8)}`
    const ext    = doc.mimeType === 'application/pdf' ? 'pdf' : 'webp' // berkas tersimpan selalu WebP atau PDF (lib/documents/file.ts)
    let path = `${folder}/${label}.${ext}`
    for (let n = 2; used.has(path); n++) path = `${folder}/${label}-${n}.${ext}`
    used.add(path)
    return { doc, path }
  })
  const zip = new JSZip()

  await Promise.all(
    entries.map(async ({ doc, path }) => {
      try {
        zip.file(path, await getObjectBuffer(doc.objectKey))
      } catch {
        // Skip files that can't be fetched (log silently, don't break ZIP)
      }
    }),
  )

  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })

  return new NextResponse(zipBuffer as BodyInit, {
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="docs-${booking.bookingCode}.zip"`,
      'Content-Length':      String(zipBuffer.byteLength),
    },
  })
}
