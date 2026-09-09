import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { getObjectBuffer } from '@/lib/storage/minio'
import { DOC_LABEL } from '@/lib/constants/booking'
import { err } from '@/lib/validators'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json(err('Forbidden'), { status: 403 })
  }

  const { id: bookingId } = await params

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      bookingCode: true,
      pilgrims: {
        select: {
          id: true,
          fieldValues: true,
          visaApplication: { select: { visaProductId: true } },
          documents: {
            select: { id: true, docType: true, fileName: true, filePath: true },
          },
        },
      },
    },
  })

  if (!booking) return NextResponse.json(err('Booking not found'), { status: 404 })

  // docs/arsitektur-manifest.md §4 — getFieldByRole() menggantikan p.fullName
  const fieldsByProduct = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const productId of new Set(booking.pilgrims.map(p => p.visaApplication?.visaProductId).filter((v): v is string => !!v))) {
    fieldsByProduct.set(productId, await getManifestFieldRequirements('visa', productId))
  }
  const allDocs = booking.pilgrims.flatMap(p => {
    const fields = p.visaApplication?.visaProductId ? fieldsByProduct.get(p.visaApplication.visaProductId) ?? [] : []
    const name = getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name')
    const pilgrimName = typeof name === 'string' && name ? name : p.id
    return p.documents.map(d => ({ ...d, pilgrimName }))
  })

  if (allDocs.length === 0) {
    return NextResponse.json(err('No documents to download'), { status: 404 })
  }

  const zip = new JSZip()

  await Promise.all(
    allDocs.map(async (doc) => {
      try {
        const buffer = await getObjectBuffer(doc.filePath)
        const label  = DOC_LABEL[doc.docType] ?? doc.docType
        // Safe folder name per pilgrim
        const folder = doc.pilgrimName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || doc.id
        const ext    = doc.fileName.split('.').pop() ?? 'bin'
        zip.file(`${folder}/${label}.${ext}`, buffer)
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
