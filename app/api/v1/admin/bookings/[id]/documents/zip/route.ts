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
    return p.documents.map(d => ({ ...d, pilgrimName, pilgrimId: p.id }))
  })

  if (allDocs.length === 0) {
    return NextResponse.json(err('No documents to download'), { status: 404 })
  }

  // Nama berkas di ZIP = label katalog jenis dokumen (kunci bila tak dikenal), dibersihkan — label diatur admin, jangan jadi path.
  const labelOf = new Map((await prisma.documentType.findMany({ where: { key: { in: [...new Set(allDocs.map(d => d.docType))] } }, select: { key: true, label: true } })).map(t => [t.key, t.label]))
  // Path unik ditetapkan sebelum unduhan paralel (SEC-187): nama jamaah sama, label sama, atau label kosong setelah disaring tak boleh saling
  // menimpa entri ZIP — folder diberi awalan id jamaah, nama berkas ganda diberi sufiks -2, -3, …
  const used = new Set<string>()
  const entries = allDocs.map(doc => {
    const label  = (labelOf.get(doc.docType) ?? doc.docType).replace(/[^a-zA-Z0-9 ()-]/g, '').trim() || 'dokumen'
    const folder = `${doc.pilgrimName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'jamaah'}-${doc.pilgrimId.slice(0, 8)}`
    const ext    = (doc.fileName.split('.').pop() ?? 'bin').replace(/[^a-zA-Z0-9]/g, '') || 'bin'
    let path = `${folder}/${label}.${ext}`
    for (let n = 2; used.has(path); n++) path = `${folder}/${label}-${n}.${ext}`
    used.add(path)
    return { doc, path }
  })
  const zip = new JSZip()

  await Promise.all(
    entries.map(async ({ doc, path }) => {
      try {
        zip.file(path, await getObjectBuffer(doc.filePath))
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
