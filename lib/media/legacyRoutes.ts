import { NextResponse, type NextRequest } from 'next/server'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { ownerOf, type MediaProductType } from './owners'
import { mediaService } from './service'
import { minioMediaStorage } from './storage'

// JEMBATAN SEMENTARA (docs/arsitektur-media.md §3, F1→F2): route foto lama (`…/hotels/[id]/images`, `…/vehicles/[id]/images`, `…/muthowif/[id]/photo`,
// `…/tourism-sites/[id]/photo`) dipertahankan SAMPAI `MediaField` (F2) menggantikan UI-nya, tetapi isinya hanya penerjemah ke layanan media baru — TIDAK
// ada penulisan kolom foto lama, jadi tak ada dualisme data. Dihapus di F2.

type Params = { params: Promise<{ id: string }> }
const bad = (message: string, status = 400) => NextResponse.json(err(message), { status })

async function listShape(type: MediaProductType, id: string) {
  const rows = await mediaService.list(type, id)
  const items = await Promise.all(rows.map(async r => ({ key: r.key, url: await minioMediaStorage.url(r.key, 3600).catch(() => null) })))
  return items.filter(i => i.url !== null)
}

async function upload(req: NextRequest, type: MediaProductType, id: string) {
  let form: FormData
  try { form = await req.formData() } catch { return bad('Invalid form data') }
  const file = form.get('file')
  if (!(file instanceof File)) return bad('file is required')
  const result = await mediaService.add(type, id, Buffer.from(await file.arrayBuffer()))
  if (!result.ok) return bad(result.message, result.status)
  return NextResponse.json(ok({ key: result.image.key, url: await minioMediaStorage.url(result.image.key, 3600).catch(() => null) }), { status: 201 })
}

export function legacyGalleryRoutes(type: 'hotel' | 'vehicle', tag: string) {
  return {
    async GET(_req: NextRequest, { params }: Params) {
      try { await requireManager() } catch (e) { return authFailureResponse(e, `${tag}/GET`) }
      const { id } = await params
      if (!(await ownerOf(type).exists(id))) return bad(`${ownerOf(type).label} tidak ditemukan`, 404)
      return NextResponse.json(ok(await listShape(type, id)))
    },
    async POST(req: NextRequest, { params }: Params) {
      try { await requireManager() } catch (e) { return authFailureResponse(e, `${tag}/POST`) }
      const { id } = await params
      return upload(req, type, id)
    },
    async DELETE(req: NextRequest, { params }: Params) {
      try { await requireManager() } catch (e) { return authFailureResponse(e, `${tag}/DELETE`) }
      const { id } = await params
      const payload = await req.json().catch(() => null) as { key?: unknown } | null
      const key = typeof payload?.key === 'string' ? payload.key : ''
      if (!key) return bad('key is required')
      const img = (await mediaService.list(type, id)).find(i => i.key === key)
      if (!img) return bad('Gambar tidak ditemukan', 404) // SEC-62: hanya foto yang tercatat pada entitas ini
      const result = await mediaService.remove(type, id, img.id)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(null))
    },
  }
}

export function legacySingleRoutes(type: 'muthowif' | 'tourism_site', tag: string) {
  return {
    async POST(req: NextRequest, { params }: Params) {
      try { await requireManager() } catch (e) { return authFailureResponse(e, `${tag}/POST`) }
      const { id } = await params
      return upload(req, type, id)
    },
    async DELETE(_req: NextRequest, { params }: Params) {
      try { await requireManager() } catch (e) { return authFailureResponse(e, `${tag}/DELETE`) }
      const { id } = await params
      if (!(await ownerOf(type).exists(id))) return bad(`${ownerOf(type).label} tidak ditemukan`, 404)
      await mediaService.removeAll(type, id)
      return NextResponse.json(ok(null))
    },
  }
}

/** Kunci foto sampul (padanan `featuredImageKey` lama) — dipakai route hotel selama jembatan. */
export async function featuredKeyOf(type: MediaProductType, id: string): Promise<string | null> {
  return (await mediaService.list(type, id)).find(i => i.isFeatured)?.key ?? null
}

/** Padanan `PUT { featuredImageKey }` lama: tandai foto ber-kunci itu sebagai sampul. null/kunci tak dikenal → tak berbuat apa-apa / galat teks. */
export async function setFeaturedByKey(type: MediaProductType, id: string, key: string | null): Promise<string | null> {
  if (key === null) return null
  const img = (await mediaService.list(type, id)).find(i => i.key === key)
  if (!img) return 'Foto tidak ditemukan'
  const r = await mediaService.update(type, id, img.id, { isFeatured: true })
  return r.ok ? null : r.message
}
