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
import { repriceOwner } from './engine'
import { pricePointViews } from './engine/adminRead'
import { resolveMarginRule } from './pricingHelpers'

// Handler CRUD Komponen Biaya yang dipakai semua pemilik (docs/arsitektur-komponen-biaya.md §3.1). Berkas route per modul hanya mengekspor
// ulang hasil `createCostComponentHandlers(...)`. Semua endpoint superadmin-only (menyusun biaya = superadmin). Membaca modal/harga per komponen untuk semua peran
// admin lewat titik harga `cost_component` (`admin/pricing/points`, lib/pricing/policy.ts) — keputusan pemilik 2026-11-19 (SEC-299).

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
      // `price` = titik harga komponen (§22): rekomendasi (`autoSellIdr`), jual BERLAKU, mode, catatan — sumber harga baris; `sellPrice` = pratinjau rekomendasi saat titik belum ada.
      const points = await pricePointViews('cost_component', costs.map(c => c.id))
      const data = await Promise.all(costs.map(async (c) => {
        const cost = (c.costTiers as unknown as CostTier[])[0]?.cost ?? 0
        const preview = await simulateSellPrice(owner.productType, [{ currency: c.currency, cost }])
        const p = points.get(c.id)
        return {
          id: c.id, costComponent: c.costComponent, vendorId: c.vendorId, vendorName: c.vendor.name,
          currency: c.currency, cost,
          hppRupiah: preview?.hppRupiah ?? null, sellPrice: preview?.sellPrice ?? null,
          price: p ? { autoSellIdr: p.autoSellIdr, sellIdr: p.sellIdr, mode: p.mode, manualNote: p.manualNote } : null,
        }
      }))
      const rule = await resolveMarginRule(owner.productType)
      return NextResponse.json(ok(data, { marginPercent: rule.defaultMarginPercent }))
    } catch (e) {
      return authFailureResponse(e, tag('GET'))
    }
  }

  async function collectionPOST(req: Request, { params }: Ctx) {
    try {
      await authorize()
      const { id } = await params
      const parsed = costComponentCreateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Data tidak valid')
      const { costComponent, vendorId, currency, cost } = parsed.data

      // Induk dan vendor diperiksa SEBELUM menulis: tanpa ini komponen yatim tertulis lalu refresh gagal 500 (G2/G3).
      if (!(await owner.exists(id))) return notFound('Produk tidak ditemukan')
      await assertVendorUsable(vendorId) // ada DAN aktif (ADR-0003) — pesan jelas, bukan galat FK 500

      const costTiers: CostTier[] = [{ ...FLAT_TIER, cost }]
      const created = await prisma.productCost.create({
        data: { productType: owner.productType, productId: id, costComponent, vendorId, currency, costTiers },
      })
      await repriceOwner('cost_component', created.id) // titik harga komponen (rekomendasi) dulu, lalu induk (§22)
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
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Data tidak valid')
      const { cost, ...rest } = parsed.data
      if (rest.vendorId) await assertVendorUsable(rest.vendorId)

      // Dicakup ke (productType, productId): komponen milik produk/modul lain tidak boleh tersentuh lewat URL ini (G1).
      const updated = await prisma.productCost.updateMany({
        where: { id: costId, productType: owner.productType, productId: id },
        data: { ...rest, ...(cost !== undefined ? { costTiers: [{ ...FLAT_TIER, cost }] as CostTier[] } : {}) },
      })
      if (updated.count !== 1) return notFound('Komponen biaya tidak ditemukan')
      await repriceOwner('cost_component', costId) // modal/rekomendasi komponen berubah; harga manualnya (bila ada) tetap
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
      // Titik harga komponen (§22) dihapus di transaksi yang sama — tanpa FK, jadi tak boleh tertinggal yatim.
      // Hanya bila komponennya memang milik produk ini (dicakup, G1) — titik komponen produk lain tak boleh terhapus lewat URL ini.
      const deleted = await prisma.$transaction(async tx => {
        const d = await tx.productCost.deleteMany({ where: { id: costId, productType: owner.productType, productId: id } })
        if (d.count === 1) await tx.pricePoint.deleteMany({ where: { ownerType: 'cost_component', ownerId: costId } })
        return d
      })
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
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Parameter tidak valid')
      const result = await simulateSellPrice(owner.productType, [{ currency: parsed.data.currency, cost: parsed.data.cost }])
      return NextResponse.json(ok(result))
    } catch (e) {
      return authFailureResponse(e, tag('simulate/GET'))
    }
  }

  return { collectionGET, collectionPOST, itemPUT, itemDELETE, simulateGET }
}
