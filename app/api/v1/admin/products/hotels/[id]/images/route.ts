import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import {
  buildObjectKey, uploadBuffer, validateUpload,
  deleteObject, getPresignedUrl,
} from '@/lib/storage/minio'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'

type Params = { params: Promise<{ id: string }> }

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES   = 5 * 1024 * 1024

// ─── GET — list images as presigned URLs (60 min admin TTL) ──────────────────
export async function GET(_: NextRequest, { params }: Params) {
  try { await requireManager() }
  catch (e) { return authFailureResponse(e, 'v1/admin/products/hotels/[id]/images/GET') }

  const { id } = await params
  const hotel = await prisma.hotel.findUnique({ where: { id }, select: { images: true } })
  if (!hotel) return NextResponse.json(err('Hotel not found'), { status: 404 })

  const keys   = hotel.images as string[]
  const images = await Promise.all(
    keys.map(async (key) => ({
      key,
      url: await getPresignedUrl(key, 3600).catch(() => null),
    })),
  )

  return NextResponse.json(ok(images.filter(i => i.url !== null)))
}

// ─── POST — upload one image ──────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  try { await requireManager() }
  catch (e) { return authFailureResponse(e, 'v1/admin/products/hotels/[id]/images/POST') }

  const { id } = await params
  const hotel = await prisma.hotel.findUnique({ where: { id }, select: { id: true, images: true } })
  if (!hotel) return NextResponse.json(err('Hotel not found'), { status: 404 })

  let formData: FormData
  try { formData = await req.formData() }
  catch { return NextResponse.json(err('Invalid form data'), { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json(err('file is required'), { status: 400 })

  if (!IMAGE_MIMES.has(file.type)) {
    return NextResponse.json(err('Gunakan format JPG, PNG, atau WebP.'), { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(err('Ukuran file maksimal 5 MB.'), { status: 400 })
  }

  const buffer    = Buffer.from(await file.arrayBuffer())
  const objectKey = buildObjectKey('hotels', id, 'images', file.name)

  try { await uploadBuffer(objectKey, buffer, file.type) }
  catch { return NextResponse.json(err('Storage error. Please try again.'), { status: 500 }) }

  const keys = [...(hotel.images as string[]), objectKey]
  await prisma.hotel.update({ where: { id }, data: { images: keys } })

  const url = await getPresignedUrl(objectKey, 3600).catch(() => null)
  return NextResponse.json(ok({ key: objectKey, url }), { status: 201 })
}

// ─── DELETE — remove one image by key ────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  try { await requireManager() }
  catch (e) { return authFailureResponse(e, 'v1/admin/products/hotels/[id]/images/DELETE') }

  const { id } = await params
  const payload = await req.json().catch(() => null) as { key?: unknown } | null
  const key = typeof payload?.key === 'string' ? payload.key : ''
  if (!key) return NextResponse.json(err('key is required'), { status: 400 })

  const hotel = await prisma.hotel.findUnique({ where: { id }, select: { images: true } })
  if (!hotel) return NextResponse.json(err('Hotel not found'), { status: 404 })

  await deleteObject(key).catch(() => {})

  const keys = (hotel.images as string[]).filter(k => k !== key)
  await prisma.hotel.update({ where: { id }, data: { images: keys } })

  return NextResponse.json(ok(null))
}
