import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { isMediaProductType, ownerOf, type MediaProductType } from './owners'
import { createMediaService, type MediaImage } from './service'
import { MAX_UPLOAD_BYTES } from './image'
import { minioMediaStorage, type MediaStorage } from './storage'

// Handler API media universal. Berkas route hanya mengekspor ulang hasil `createMediaHandlers()`. Otorisasi (`requireWrite`) dan penyimpanan dapat
// disuntik agar bisa diuji tanpa cookie/MinIO. Semua verb: manager+ (halaman produk dipakai manager).

type CollectionCtx = { params: Promise<{ productType: string; productId: string }> }
type ItemCtx = { params: Promise<{ productType: string; productId: string; imageId: string }> }
type Options = { requireWrite?: () => Promise<unknown>; storage?: MediaStorage }

const uuid = z.string().uuid()
const patchSchema = z.object({ alt: z.string().max(200).nullable().optional(), isFeatured: z.boolean().optional() }).strict()
  .refine(v => v.alt !== undefined || v.isFeatured !== undefined, { message: 'Tidak ada perubahan' })
const orderSchema = z.object({ order: z.array(uuid).min(1).max(50) }).strict()

const bad = (message: string, status = 400) => NextResponse.json(err(message), { status })

export function createMediaHandlers(options: Options = {}) {
  const requireWrite = options.requireWrite ?? requireManager
  const storage = options.storage ?? minioMediaStorage
  const service = createMediaService(storage)

  async function view(img: MediaImage) {
    const url = await storage.url(img.key, 3600).catch(() => null)
    const cardUrl = img.cardKey ? await storage.url(img.cardKey, 3600).catch(() => null) : url
    return { id: img.id, url, cardUrl: cardUrl ?? url, alt: img.alt, sortOrder: img.sortOrder, isFeatured: img.isFeatured, width: img.width, height: img.height }
  }

  /** Validasi parameter rute: tipe terdaftar + id uuid; selain itu 404 (tak membocorkan bentuk registry). */
  async function target(ctx: CollectionCtx | ItemCtx): Promise<{ type: MediaProductType; productId: string; imageId?: string } | null> {
    const p = await ctx.params
    if (!isMediaProductType(p.productType) || !uuid.safeParse(p.productId).success) return null
    const imageId = 'imageId' in p ? p.imageId : undefined
    if (imageId !== undefined && !uuid.safeParse(imageId).success) return null
    return { type: p.productType, productId: p.productId, imageId }
  }

  async function listGET(_req: Request, ctx: CollectionCtx) {
    try {
      await requireWrite()
      const t = await target(ctx)
      if (!t) return bad('Tidak ditemukan', 404)
      const owner = ownerOf(t.type)
      if (!(await owner.exists(t.productId))) return bad(`${owner.label} tidak ditemukan`, 404)
      const images = await Promise.all((await service.list(t.type, t.productId)).map(view))
      return NextResponse.json(ok(images, { mode: owner.mode, max: owner.max }))
    } catch (e) { return authFailureResponse(e, 'admin/media/GET') }
  }

  async function listPOST(req: Request, ctx: CollectionCtx) {
    try {
      await requireWrite()
      const t = await target(ctx)
      if (!t) return bad('Tidak ditemukan', 404)
      let form: FormData
      try { form = await req.formData() } catch { return bad('Form tidak valid') }
      const file = form.get('file')
      if (!(file instanceof File)) return bad('File wajib diisi')
      if (file.size > MAX_UPLOAD_BYTES) return bad('Ukuran file maksimal 5 MB.')
      const alt = form.get('alt')
      const result = await service.add(t.type, t.productId, Buffer.from(await file.arrayBuffer()), typeof alt === 'string' ? alt : null)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(await view(result.image)), { status: 201 })
    } catch (e) { return authFailureResponse(e, 'admin/media/POST') }
  }

  async function orderPATCH(req: Request, ctx: CollectionCtx) {
    try {
      await requireWrite()
      const t = await target(ctx)
      if (!t) return bad('Tidak ditemukan', 404)
      const parsed = orderSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Data tidak valid')
      const result = await service.reorder(t.type, t.productId, parsed.data.order)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(null))
    } catch (e) { return authFailureResponse(e, 'admin/media/order/PATCH') }
  }

  async function itemPATCH(req: Request, ctx: ItemCtx) {
    try {
      await requireWrite()
      const t = await target(ctx)
      if (!t?.imageId) return bad('Tidak ditemukan', 404)
      const parsed = patchSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Data tidak valid')
      const result = await service.update(t.type, t.productId, t.imageId, parsed.data)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(await view(result.image)))
    } catch (e) { return authFailureResponse(e, 'admin/media/item/PATCH') }
  }

  async function itemDELETE(_req: Request, ctx: ItemCtx) {
    try {
      await requireWrite()
      const t = await target(ctx)
      if (!t?.imageId) return bad('Tidak ditemukan', 404)
      const result = await service.remove(t.type, t.productId, t.imageId)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(null))
    } catch (e) { return authFailureResponse(e, 'admin/media/item/DELETE') }
  }

  return { listGET, listPOST, orderPATCH, itemPATCH, itemDELETE, service }
}
