import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { costComponentCreateSchema, costComponentSimulateSchema, costComponentUpdateSchema } from '@/lib/validators/costComponent'
import { simulateSellPrice } from './simulateSellPrice'
import { assertVendorUsable } from '@/lib/vendors/integrity'
import { vendorNotUsableResponse } from '@/lib/vendors/http'
import { COST_OWNERS, type CostOwnerKey } from './costComponentOwners'

// Handler CRUD Komponen Biaya yang dipakai semua pemilik (docs/arsitektur-komponen-biaya.md §3.1). Berkas route per modul hanya mengekspor
// ulang hasil `createCostComponentHandlers(...)`. Semua endpoint superadmin-only (HPP rahasia — sama seperti seluruh endpoint biaya lain).

const FLAT_TIER = { minDays: 0, maxDays: 9999 }
type CostTier = { minDays: number; maxDays: number; cost: number }
type Ctx = { params: Promise<{ id: string }> }
type ItemCtx = { params: Promise<{ id: string; costId: string }> }
export type CostHandlerOptions = { authorize?: () => Promise<unknown> }

const badRequest = (message: string) => NextResponse.json(err(message), { status: 400 })
const notFound = (message: string) => NextResponse.json(err(message), { status: 404 })

export function createCostComponentHandlers(key: CostOwnerKey, options: CostHandlerOptions = {}) {
  const owner = COST_OWNERS[key]
  const authorize = options.authorize ?? requireSuperAdmin
  const tag = (verb: string, item = false) => `admin/products/${owner.routeBase}/[id]/costs${item ? '/[costId]' : ''}/${verb}`

  async function collectionGET(_req: Request, { params }: Ctx) {
    try {
      await authorize()
      const { id } = await params
      const costs = await prisma.productCost.findMany({
        where: { productType: owner.productType, productId: id, isActive: true },
        include: { vendor: { select: { id: true, name: true } } },
        orderBy: { costComponent: 'asc' },
      })
      // hppRupiah/sellPrice per baris (bukan hanya di /breakdown) supaya setiap baris langsung tampil dengan harga terhitung.
      const data = await Promise.all(costs.map(async (c) => {
        const cost = (c.costTiers as unknown as CostTier[])[0]?.cost ?? 0
        const preview = await simulateSellPrice(owner.productType, [{ currency: c.currency, cost }])
        return {
          id: c.id, costComponent: c.costComponent, vendorId: c.vendorId, vendorName: c.vendor.name,
          currency: c.currency, cost,
          hppRupiah: preview?.hppRupiah ?? null, sellPrice: preview?.sellPrice ?? null,
        }
      }))
      return NextResponse.json(ok(data))
    } catch (e) {
      return authFailureResponse(e, tag('GET'))
    }
  }

  async function collectionPOST(req: Request, { params }: Ctx) {
    try {
      await authorize()
      const { id } = await params
      const parsed = costComponentCreateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? 'Data tidak valid')
      const { costComponent, vendorId, currency, cost } = parsed.data

      // Induk dan vendor diperiksa SEBELUM menulis: tanpa ini komponen yatim tertulis lalu refresh gagal 500 (G2/G3).
      if (!(await owner.exists(id))) return notFound('Produk tidak ditemukan')
      await assertVendorUsable(vendorId) // ada DAN aktif (ADR-0003) — pesan jelas, bukan galat FK 500

      const costTiers: CostTier[] = [{ ...FLAT_TIER, cost }]
      const created = await prisma.productCost.create({
        data: { productType: owner.productType, productId: id, costComponent, vendorId, currency, costTiers },
      })
      await owner.refresh(id)
      return NextResponse.json(ok(created), { status: 201 })
    } catch (e) {
      return vendorNotUsableResponse(e) ?? authFailureResponse(e, tag('POST'))
    }
  }

  async function itemPUT(req: Request, { params }: ItemCtx) {
    try {
      await authorize()
      const { id, costId } = await params
      const parsed = costComponentUpdateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? 'Data tidak valid')
      const { cost, ...rest } = parsed.data
      if (rest.vendorId) await assertVendorUsable(rest.vendorId)

      // Dicakup ke (productType, productId): komponen milik produk/modul lain tidak boleh tersentuh lewat URL ini (G1).
      const updated = await prisma.productCost.updateMany({
        where: { id: costId, productType: owner.productType, productId: id },
        data: { ...rest, ...(cost !== undefined ? { costTiers: [{ ...FLAT_TIER, cost }] as CostTier[] } : {}) },
      })
      if (updated.count !== 1) return notFound('Komponen biaya tidak ditemukan')
      await owner.refresh(id)
      return NextResponse.json(ok(null))
    } catch (e) {
      if (isRecordNotFound(e)) return notFound('Komponen biaya tidak ditemukan')
      return vendorNotUsableResponse(e) ?? authFailureResponse(e, tag('PUT', true))
    }
  }

  async function itemDELETE(_req: Request, { params }: ItemCtx) {
    try {
      await authorize()
      const { id, costId } = await params
      const deleted = await prisma.productCost.deleteMany({ where: { id: costId, productType: owner.productType, productId: id } })
      if (deleted.count !== 1) return notFound('Komponen biaya tidak ditemukan')
      await owner.refresh(id)
      return NextResponse.json(ok(null))
    } catch (e) {
      if (isRecordNotFound(e)) return notFound('Komponen biaya tidak ditemukan')
      return authFailureResponse(e, tag('DELETE', true))
    }
  }

  // Preview HPP → harga jual dari angka yang sedang diketik, memakai margin tipe pemilik ini (bukan tipe modul lain — G4).
  async function simulateGET(req: Request) {
    try {
      await authorize()
      const parsed = costComponentSimulateSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
      if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? 'Parameter tidak valid')
      const result = await simulateSellPrice(owner.productType, [{ currency: parsed.data.currency, cost: parsed.data.cost }])
      return NextResponse.json(ok(result))
    } catch (e) {
      return authFailureResponse(e, tag('simulate/GET'))
    }
  }

  return { collectionGET, collectionPOST, itemPUT, itemDELETE, simulateGET }
}
