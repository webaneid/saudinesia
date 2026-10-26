import { randomUUID } from 'node:crypto'
import { Prisma, type ProductImage } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ownerOf, type MediaProductType } from './owners'
import { processImage, ImageRejectedError } from './image'
import { minioMediaStorage, type MediaStorage } from './storage'

// Layanan media produk universal (docs/arsitektur-media.md). SATU-SATUNYA penulis tabel `product_images` dan objek foto produk. Invarian yang
// ditegakkan di sini (bukan indeks DB): mode featured = tepat satu baris (unggah baru MENGGANTI); gallery = ≤ `max` baris dan, bila tidak kosong,
// TEPAT satu bertanda sampul. Objek dibersihkan best-effort setelah transaksi — kegagalan hapus objek tak boleh membatalkan perubahan data.

export type ServiceError = { ok: false; status: 400 | 404 | 409; message: string }
const fail = (status: ServiceError['status'], message: string): ServiceError => ({ ok: false, status, message })
const isConflict = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002')

export type MediaImage = Pick<ProductImage, 'id' | 'key' | 'cardKey' | 'alt' | 'sortOrder' | 'isFeatured' | 'width' | 'height'>
const order = [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] as const satisfies Prisma.ProductImageOrderByWithRelationInput[]

export function createMediaService(storage: MediaStorage = minioMediaStorage) {
  const cleanup = async (keys: Array<string | null>) => { await Promise.all(keys.filter((k): k is string => !!k).map(k => storage.remove(k).catch(() => {}))) }

  async function list(type: MediaProductType, productId: string): Promise<MediaImage[]> {
    return prisma.productImage.findMany({ where: { productType: type, productId }, orderBy: [...order] })
  }

  async function add(type: MediaProductType, productId: string, file: Buffer, alt?: string | null): Promise<{ ok: true; image: MediaImage } | ServiceError> {
    const owner = ownerOf(type)
    if (!(await owner.exists(productId))) return fail(404, `${owner.label} tidak ditemukan`)
    let processed
    try { processed = await processImage(file) } catch (e) {
      if (e instanceof ImageRejectedError) return fail(400, e.message)
      throw e
    }
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const key = storage.newKey(type, productId, `${stamp}-display.webp`)
    const cardKey = storage.newKey(type, productId, `${stamp}-card.webp`)
    try {
      await storage.put(key, processed.display, 'image/webp')
      await storage.put(cardKey, processed.card, 'image/webp')
    } catch {
      await cleanup([key, cardKey])
      return fail(409, 'Penyimpanan gagal. Coba lagi.')
    }

    let replaced: Array<string | null> = []
    try {
      const image = await prisma.$transaction(async (tx) => {
        const current = await tx.productImage.findMany({ where: { productType: type, productId }, select: { id: true, key: true, cardKey: true, sortOrder: true } })
        if (owner.mode === 'featured') {
          replaced = current.flatMap(c => [c.key, c.cardKey])
          await tx.productImage.deleteMany({ where: { productType: type, productId } })
        } else if (current.length >= owner.max) {
          throw new LimitError(`Maksimal ${owner.max} foto.`)
        }
        return tx.productImage.create({
          data: {
            productType: type, productId, key, cardKey, width: processed.width, height: processed.height,
            alt: normalizeAlt(alt),
            sortOrder: owner.mode === 'featured' ? 0 : (current.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1),
            isFeatured: owner.mode === 'featured' ? true : current.length === 0,
          },
        })
      }, { isolationLevel: 'Serializable' })
      await cleanup(replaced)
      return { ok: true, image }
    } catch (e) {
      await cleanup([key, cardKey])
      if (e instanceof LimitError) return fail(409, e.message)
      if (isConflict(e)) return fail(409, 'Perubahan bersamaan terdeteksi. Coba lagi.')
      throw e
    }
  }

  async function update(type: MediaProductType, productId: string, imageId: string, change: { alt?: string | null; isFeatured?: boolean }): Promise<{ ok: true; image: MediaImage } | ServiceError> {
    const owner = ownerOf(type)
    const img = await prisma.productImage.findFirst({ where: { id: imageId, productType: type, productId } })
    if (!img) return fail(404, 'Foto tidak ditemukan')
    if (change.isFeatured === false) {
      return fail(400, owner.mode === 'featured' ? 'Foto unggulan selalu bertanda sampul.' : 'Pilih foto lain sebagai sampul — satu foto harus selalu menjadi sampul.')
    }
    const image = await prisma.$transaction(async (tx) => {
      if (change.isFeatured === true && !img.isFeatured) {
        await tx.productImage.updateMany({ where: { productType: type, productId, isFeatured: true }, data: { isFeatured: false } })
      }
      return tx.productImage.update({
        where: { id: imageId },
        data: { ...(change.alt !== undefined ? { alt: normalizeAlt(change.alt) } : {}), ...(change.isFeatured === true ? { isFeatured: true } : {}) },
      })
    }, { isolationLevel: 'Serializable' })
    return { ok: true, image }
  }

  async function reorder(type: MediaProductType, productId: string, orderedIds: string[]): Promise<{ ok: true } | ServiceError> {
    const current = await prisma.productImage.findMany({ where: { productType: type, productId }, select: { id: true } })
    const a = [...current.map(c => c.id)].sort(), b = [...orderedIds].sort()
    if (a.length !== b.length || a.some((id, i) => id !== b[i])) return fail(400, 'Urutan harus memuat tepat semua foto produk ini.')
    await prisma.$transaction(orderedIds.map((id, i) => prisma.productImage.update({ where: { id }, data: { sortOrder: i } })))
    return { ok: true }
  }

  async function remove(type: MediaProductType, productId: string, imageId: string): Promise<{ ok: true } | ServiceError> {
    const img = await prisma.productImage.findFirst({ where: { id: imageId, productType: type, productId } })
    if (!img) return fail(404, 'Foto tidak ditemukan') // SEC-62: hanya foto yang TERCATAT pada produk ini yang bisa dihapus
    await prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } })
      if (img.isFeatured) {
        const next = await tx.productImage.findFirst({ where: { productType: type, productId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
        if (next) await tx.productImage.update({ where: { id: next.id }, data: { isFeatured: true } })
      }
    }, { isolationLevel: 'Serializable' })
    await cleanup([img.key, img.cardKey])
    return { ok: true }
  }

  /** Dipanggil saat produk dihapus: baris dan objek foto ikut bersih (tak ada objek yatim di bucket). */
  async function removeAll(type: MediaProductType, productId: string): Promise<number> {
    const rows = await prisma.productImage.findMany({ where: { productType: type, productId }, select: { key: true, cardKey: true } })
    await prisma.productImage.deleteMany({ where: { productType: type, productId } })
    await cleanup(rows.flatMap(r => [r.key, r.cardKey]))
    return rows.length
  }

  return { list, add, update, reorder, remove, removeAll }
}

class LimitError extends Error {}
function normalizeAlt(alt: string | null | undefined): string | null {
  const t = (alt ?? '').trim().slice(0, 200)
  return t === '' ? null : t
}

export const mediaService = createMediaService()
