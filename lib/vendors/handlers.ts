import { NextResponse } from 'next/server'
import { requireManager, requireSuperAdmin, SUPERADMIN_ROLES, type SessionPayload } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { buildPageMeta, parseListParams } from '@/lib/admin/pagination'
import { vendorCategoryCreateSchema, vendorCategoryUpdateSchema, vendorCreateSchema, vendorUpdateSchema } from '@/lib/validators/vendor'
import {
  countVendors, createCategory, createVendor, deleteOrDeactivateCategory, deleteOrDeactivateVendor, getVendor, listCategories, listVendors,
  toVendorDto, toVendorSlim, updateCategory, updateVendor, type VendorListQuery,
} from './service'

// Handler API vendor + kategori (ADR-0003). Berkas route hanya mengekspor ulang hasil `createVendorHandlers()`. Baca: manager+ (manager mendapat
// bentuk ramping untuk dropdown — SEC-61b); tulis dan detail: superadmin. `requireRead`/`requireWrite` dapat disuntik agar bisa diuji tanpa cookie.

type Ctx = { params: Promise<{ id: string }> }
type Options = { requireRead?: () => Promise<Pick<SessionPayload, 'role'>>; requireWrite?: () => Promise<unknown> }

const bad = (message: string, status = 400) => NextResponse.json(err(message), { status })
const firstIssue = (e: { errors: Array<{ message: string }> }) => e.errors[0]?.message ?? 'Data tidak valid'

export function createVendorHandlers(options: Options = {}) {
  const requireRead = options.requireRead ?? requireManager
  const requireWrite = options.requireWrite ?? requireSuperAdmin

  async function vendorsGET(req: Request) {
    try {
      const session = await requireRead()
      const sp = new URL(req.url).searchParams
      const list = parseListParams(sp)
      const status = sp.get('status')
      const filters = {
        q: sp.get('q') ?? undefined, category: sp.get('category') ?? undefined, country: sp.get('country') ?? undefined,
        status: (status === 'active' || status === 'inactive' ? status : 'all') as VendorListQuery['status'],
      }
      const total = await countVendors(filters)
      const meta = buildPageMeta(total, 1, list.limit)
      const page = Math.min(list.page, meta.totalPages)
      const rows = total === 0 ? [] : await listVendors({ ...filters, skip: (page - 1) * list.limit, take: list.limit })
      const slim = !SUPERADMIN_ROLES.includes(session.role)
      return NextResponse.json(ok(rows.map(slim ? toVendorSlim : toVendorDto), { ...meta, page }))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendors/GET')
    }
  }

  async function vendorsPOST(req: Request) {
    try {
      await requireWrite()
      const parsed = vendorCreateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return bad(firstIssue(parsed.error))
      const result = await createVendor(parsed.data)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(toVendorDto(result.vendor)), { status: 201 })
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendors/POST')
    }
  }

  async function vendorGET(_req: Request, { params }: Ctx) {
    try {
      await requireWrite() // detail memuat kontak dan pemakaian → superadmin
      const { id } = await params
      const found = await getVendor(id)
      if (!found) return bad('Vendor tidak ditemukan', 404)
      return NextResponse.json(ok({ ...toVendorDto(found.vendor), usage: found.usage }))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendors/[id]/GET')
    }
  }

  async function vendorPUT(req: Request, { params }: Ctx) {
    try {
      await requireWrite()
      const { id } = await params
      const parsed = vendorUpdateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return bad(firstIssue(parsed.error))
      const result = await updateVendor(id, parsed.data)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(toVendorDto(result.vendor)))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendors/[id]/PUT')
    }
  }

  async function vendorDELETE(_req: Request, { params }: Ctx) {
    try {
      await requireWrite()
      const { id } = await params
      const r = await deleteOrDeactivateVendor(id)
      if (!r.found) return bad('Vendor tidak ditemukan', 404)
      if ('blocked' in r) return bad('Vendor sistem tidak dapat dihapus atau dinonaktifkan', 409)
      if (r.deleted) return NextResponse.json(ok({ deleted: true }))
      return NextResponse.json(ok({
        deleted: false, deactivated: true, usage: r.usage,
        message: `Vendor dipakai di ${r.usage.costs} komponen biaya, ${r.usage.preferred} vendor pilihan, dan ${r.usage.visaSnapshots} riwayat visa sehingga tidak dihapus — vendor dinonaktifkan (tidak muncul di pilihan baru; riwayat harga tetap aman) dan dapat diaktifkan kembali.`,
      }))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendors/[id]/DELETE')
    }
  }

  async function categoriesGET() {
    try {
      await requireRead()
      return NextResponse.json(ok(await listCategories()))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendor-categories/GET')
    }
  }

  async function categoriesPOST(req: Request) {
    try {
      await requireWrite()
      const parsed = vendorCategoryCreateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return bad(firstIssue(parsed.error))
      const result = await createCategory(parsed.data)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(result.category), { status: 201 })
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendor-categories/POST')
    }
  }

  async function categoryPUT(req: Request, { params }: Ctx) {
    try {
      await requireWrite()
      const { id } = await params
      const parsed = vendorCategoryUpdateSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return bad(firstIssue(parsed.error))
      const result = await updateCategory(id, parsed.data)
      if (!result.ok) return bad(result.message, result.status)
      return NextResponse.json(ok(result.category))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendor-categories/[id]/PUT')
    }
  }

  async function categoryDELETE(_req: Request, { params }: Ctx) {
    try {
      await requireWrite()
      const { id } = await params
      const r = await deleteOrDeactivateCategory(id)
      if (!r.found) return bad('Kategori tidak ditemukan', 404)
      if ('blocked' in r) return bad('Kategori bawaan sistem tidak dapat dihapus', 409)
      if (r.deleted) return NextResponse.json(ok({ deleted: true }))
      return NextResponse.json(ok({
        deleted: false, deactivated: true, vendorCount: r.vendorCount,
        message: `Kategori dipakai ${r.vendorCount} vendor sehingga tidak dihapus — kategori dinonaktifkan (tidak muncul di pilihan baru) dan dapat diaktifkan kembali.`,
      }))
    } catch (e) {
      return authFailureResponse(e, 'admin/system/vendor-categories/[id]/DELETE')
    }
  }

  return { vendorsGET, vendorsPOST, vendorGET, vendorPUT, vendorDELETE, categoriesGET, categoriesPOST, categoryPUT, categoryDELETE }
}
