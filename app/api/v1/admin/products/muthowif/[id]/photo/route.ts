import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { buildObjectKey, uploadBuffer, deleteObject, getPresignedUrl } from '@/lib/storage/minio'
import { ok, err } from '@/lib/validators'

type Params = { params: Promise<{ id: string }> }

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

// Menutup Gap #2 (docs/arsitektur-muthowif.md §7): photoKey ada di schema tapi tidak pernah
// bisa diisi admin. Satu foto per muthowif (bukan galeri) — upload baru menggantikan yang lama.
export async function POST(req: NextRequest, { params }: Params) {
  try { await requireManager() }
  catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }

  const { id } = await params
  const muthowif = await prisma.muthowif.findUnique({ where: { id }, select: { photoKey: true } })
  if (!muthowif) return NextResponse.json(err('Muthowif tidak ditemukan'), { status: 404 })

  let formData: FormData
  try { formData = await req.formData() }
  catch { return NextResponse.json(err('Invalid form data'), { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json(err('file wajib diisi'), { status: 400 })
  if (!IMAGE_MIMES.has(file.type)) {
    return NextResponse.json(err('Gunakan format JPG, PNG, atau WebP.'), { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(err('Ukuran file maksimal 5 MB.'), { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const objectKey = buildObjectKey('muthowif', id, 'photo', file.name)

  try { await uploadBuffer(objectKey, buffer, file.type) }
  catch { return NextResponse.json(err('Storage error. Please try again.'), { status: 500 }) }

  if (muthowif.photoKey) await deleteObject(muthowif.photoKey).catch(() => {})
  await prisma.muthowif.update({ where: { id }, data: { photoKey: objectKey } })

  const url = await getPresignedUrl(objectKey, 3600).catch(() => null)
  return NextResponse.json(ok({ key: objectKey, url }), { status: 201 })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try { await requireManager() }
  catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }

  const { id } = await params
  const muthowif = await prisma.muthowif.findUnique({ where: { id }, select: { photoKey: true } })
  if (!muthowif) return NextResponse.json(err('Muthowif tidak ditemukan'), { status: 404 })

  if (muthowif.photoKey) await deleteObject(muthowif.photoKey).catch(() => {})
  await prisma.muthowif.update({ where: { id }, data: { photoKey: null } })

  return NextResponse.json(ok(null))
}
