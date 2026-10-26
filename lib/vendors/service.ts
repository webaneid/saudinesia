import { Prisma, type Vendor, type VendorCategory, type Address } from '@prisma/client'
import { prisma } from '@/lib/db'
import { slugifyCategoryName, vendorNameKey } from '@/lib/constants/vendor'
import { prepareAddressData } from '@/lib/address/prepare'
import type { AddressInput } from '@/lib/validators/address'
import type { VendorCreate, VendorUpdate } from '@/lib/validators/vendor'
import { getVendorUsage, type VendorUsage } from './integrity'

// Layanan vendor + kategori (ADR-0003, docs/arsitektur-vendor.md §3). SATU-SATUNYA tempat yang menulis tabel `vendors` dan `vendor_categories`
// (route hanya memanggil fungsi ini). Kolom teks bebas lama sudah dihapus (migrasi kontraksi F5).

export type ServiceError = { ok: false; status: 400 | 404 | 409; message: string }
const fail = (status: ServiceError['status'], message: string): ServiceError => ({ ok: false, status, message })

type VendorRow = Vendor & { categories: VendorCategory[]; address: Address | null }
const vendorInclude = { categories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }, address: true } satisfies Prisma.VendorInclude

export type CategoryRef = { id: string; slug: string; name: string; isActive: boolean }
const toRef = (c: VendorCategory): CategoryRef => ({ id: c.id, slug: c.slug, name: c.name, isActive: c.isActive })

/** Bentuk vendor yang keluar dari API — kolom legacy, `nameKey`, dan `addressId` tidak ikut. */
export function toVendorDto(v: VendorRow) {
  return {
    id: v.id, name: v.name, countryCode: v.countryCode, isActive: v.isActive, isSystem: v.systemKey !== null, systemKey: v.systemKey,
    contactName: v.contactName, phoneCountryCode: v.phoneCountryCode, phone: v.phone, whatsappCountryCode: v.whatsappCountryCode, whatsapp: v.whatsapp,
    email: v.email, website: v.website, notes: v.notes, createdAt: v.createdAt, updatedAt: v.updatedAt,
    categories: v.categories.map(toRef), address: v.address,
  }
}
export type VendorDto = ReturnType<typeof toVendorDto>

/** Bentuk ramping untuk manager (dropdown): tanpa kontak/alamat/catatan. */
export function toVendorSlim(v: VendorRow) {
  return { id: v.id, name: v.name, countryCode: v.countryCode, isActive: v.isActive, categories: v.categories.map(toRef) }
}

// ───────────────────────── vendor ─────────────────────────

export type VendorListQuery = { q?: string; category?: string; country?: string; status?: 'active' | 'inactive' | 'all'; skip: number; take: number }

function listWhere(query: Omit<VendorListQuery, 'skip' | 'take'>): Prisma.VendorWhereInput {
  const q = query.q?.trim()
  return {
    ...(query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {}),
    ...(query.category ? { categories: { some: { slug: query.category } } } : {}),
    ...(query.country ? { countryCode: query.country } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
  }
}

export const countVendors = (query: Omit<VendorListQuery, 'skip' | 'take'>) => prisma.vendor.count({ where: listWhere(query) })

export async function listVendors(query: VendorListQuery): Promise<VendorRow[]> {
  return prisma.vendor.findMany({
    where: listWhere(query), include: vendorInclude,
    orderBy: [{ name: 'asc' }, { id: 'asc' }], // id sebagai tie-breaker: halaman harus stabil
    skip: query.skip, take: query.take,
  })
}

export async function getVendor(id: string): Promise<{ vendor: VendorRow; usage: VendorUsage } | null> {
  const vendor = await prisma.vendor.findUnique({ where: { id }, include: vendorInclude })
  if (!vendor) return null
  return { vendor, usage: await getVendorUsage(id) }
}

async function checkCategories(ids: string[]): Promise<ServiceError | null> {
  const found = await prisma.vendorCategory.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })
  return found.length === ids.length ? null : fail(400, 'Kategori tidak ditemukan atau sudah nonaktif')
}

/** Tabrakan (nameKey, countryCode) dengan vendor LAIN → pesan menyebut vendor yang sudah ada. */
async function nameConflict(name: string, countryCode: string, exceptId?: string): Promise<ServiceError | null> {
  const existing = await prisma.vendor.findFirst({
    where: { nameKey: vendorNameKey(name), countryCode, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true, isActive: true },
  })
  return existing ? fail(409, `Vendor "${existing.name}" sudah ada di negara ini${existing.isActive ? '' : ' (nonaktif — aktifkan kembali daripada membuat baru)'}`) : null
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

async function prepareAddress(input: AddressInput | undefined): Promise<{ ok: true; data: Prisma.AddressCreateInput | null } | ServiceError> {
  if (!input) return { ok: true, data: null }
  const prepared = await prepareAddressData(input)
  return prepared.ok ? { ok: true, data: prepared.data } : fail(400, prepared.message)
}

export async function createVendor(input: VendorCreate): Promise<{ ok: true; vendor: VendorRow } | ServiceError> {
  const { categoryIds, address, name, ...rest } = input
  const bad = (await checkCategories(categoryIds)) ?? (await nameConflict(name, input.countryCode))
  if (bad) return bad
  const addr = await prepareAddress(address)
  if (!addr.ok) return addr
  try {
    const vendor = await prisma.$transaction(async (tx) => {
      const createdAddress = addr.data ? await tx.address.create({ data: addr.data }) : null
      return tx.vendor.create({
        data: { ...rest, name, nameKey: vendorNameKey(name), addressId: createdAddress?.id ?? null, categories: { connect: categoryIds.map(id => ({ id })) } },
        include: vendorInclude,
      })
    })
    return { ok: true, vendor }
  } catch (e) {
    if (isUniqueViolation(e)) return fail(409, 'Vendor dengan nama yang sama sudah ada di negara ini') // balapan dua pembuat bersamaan
    throw e
  }
}

export async function updateVendor(id: string, input: VendorUpdate): Promise<{ ok: true; vendor: VendorRow } | ServiceError> {
  const existing = await prisma.vendor.findUnique({ where: { id }, select: { name: true, countryCode: true, addressId: true, systemKey: true } })
  if (!existing) return fail(404, 'Vendor tidak ditemukan')
  const { categoryIds, address, ...fields } = input
  if (existing.systemKey && fields.isActive === false) return fail(409, 'Vendor sistem tidak dapat dinonaktifkan')

  const name = fields.name ?? existing.name
  const countryCode = fields.countryCode ?? existing.countryCode
  const identityChanged = (fields.name !== undefined && vendorNameKey(fields.name) !== vendorNameKey(existing.name)) || (fields.countryCode !== undefined && fields.countryCode !== existing.countryCode)
  const bad = (categoryIds ? await checkCategories(categoryIds) : null) ?? (identityChanged && countryCode ? await nameConflict(name, countryCode, id) : null)
  if (bad) return bad
  const addr = await prepareAddress(address)
  if (!addr.ok) return addr

  try {
    const vendor = await prisma.$transaction(async (tx) => {
      let addressId = existing.addressId
      if (addr.data) addressId = existing.addressId ? (await tx.address.update({ where: { id: existing.addressId }, data: addr.data })).id : (await tx.address.create({ data: addr.data })).id
      return tx.vendor.update({
        where: { id },
        data: {
          ...fields,
          ...(fields.name !== undefined ? { nameKey: vendorNameKey(fields.name) } : {}),
          ...(addr.data ? { addressId } : {}),
          ...(categoryIds ? { categories: { set: categoryIds.map(cid => ({ id: cid })) } } : {}),
        },
        include: vendorInclude,
      })
    })
    return { ok: true, vendor }
  } catch (e) {
    if (isUniqueViolation(e)) return fail(409, 'Vendor dengan nama yang sama sudah ada di negara ini')
    throw e
  }
}

export type VendorDeleteResult =
  | { found: false }
  | { found: true; blocked: 'system' }
  | { found: true; deleted: true }
  | { found: true; deleted: false; usage: VendorUsage }

/**
 * Hapus aman (aturan CRUD lengkap): hapus SUNGGUHAN hanya bila vendor tidak dirujuk biaya, vendor pilihan, maupun snapshot visa; selain itu NONAKTIF
 * (riwayat harga tak boleh yatim) dan pemanggil mendapat rincian pemakaian. Vendor sistem tidak pernah dihapus/dinonaktifkan. Alamat 1:1 milik
 * vendor ikut terhapus. Rujukan baru yang masuk di antara pemeriksaan dan penghapusan ditangkap FK (P2003) lalu jatuh ke jalur nonaktif.
 */
export async function deleteOrDeactivateVendor(id: string): Promise<VendorDeleteResult> {
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { systemKey: true, addressId: true } })
  if (!vendor) return { found: false }
  if (vendor.systemKey) return { found: true, blocked: 'system' }

  const usage = await getVendorUsage(id)
  const deactivate = async (u: VendorUsage): Promise<VendorDeleteResult> => {
    await prisma.vendor.update({ where: { id }, data: { isActive: false } })
    return { found: true, deleted: false, usage: u }
  }
  if (usage.total > 0) return deactivate(usage)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vendor.delete({ where: { id } }) // tautan kategori ikut lepas (cascade pivot)
      if (vendor.addressId) await tx.address.delete({ where: { id: vendor.addressId } })
    })
    return { found: true, deleted: true }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return deactivate(await getVendorUsage(id))
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { found: false }
    throw e
  }
}

// ───────────────────────── kategori ─────────────────────────

export type CategoryDto = CategoryRef & { sortOrder: number; isSystem: boolean; vendorCount: number }
type CategoryRow = VendorCategory & { _count: { vendors: number } }
const toCategoryDto = (c: CategoryRow): CategoryDto => ({ ...toRef(c), sortOrder: c.sortOrder, isSystem: c.isSystem, vendorCount: c._count.vendors })
const categoryInclude = { _count: { select: { vendors: true } } } satisfies Prisma.VendorCategoryInclude

export async function listCategories(): Promise<CategoryDto[]> {
  const rows = await prisma.vendorCategory.findMany({ include: categoryInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }] })
  return rows.map(toCategoryDto)
}

async function categoryNameConflict(name: string, exceptId?: string): Promise<ServiceError | null> {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase()
  const slug = slugifyCategoryName(name)
  const rows = await prisma.vendorCategory.findMany({ where: { ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true, slug: true } })
  const clash = rows.find(r => r.name.trim().replace(/\s+/g, ' ').toLowerCase() === key || r.slug === slug)
  return clash ? fail(409, `Kategori "${clash.name}" sudah ada`) : null
}

export async function createCategory(input: { name: string; sortOrder?: number }): Promise<{ ok: true; category: CategoryDto } | ServiceError> {
  const slug = slugifyCategoryName(input.name)
  if (!slug) return fail(400, 'Nama kategori harus memuat huruf atau angka')
  const clash = await categoryNameConflict(input.name)
  if (clash) return clash
  const max = await prisma.vendorCategory.aggregate({ _max: { sortOrder: true } })
  try {
    const row = await prisma.vendorCategory.create({ data: { name: input.name, slug, sortOrder: input.sortOrder ?? (max._max.sortOrder ?? 0) + 10 }, include: categoryInclude })
    return { ok: true, category: toCategoryDto(row) }
  } catch (e) {
    if (isUniqueViolation(e)) return fail(409, 'Kategori dengan nama yang sama sudah ada')
    throw e
  }
}

/** Slug TIDAK pernah berubah (kode dan tautan memakainya) — mengganti nama hanya mengubah tampilan. */
export async function updateCategory(id: string, input: { name?: string; sortOrder?: number; isActive?: boolean }): Promise<{ ok: true; category: CategoryDto } | ServiceError> {
  const existing = await prisma.vendorCategory.findUnique({ where: { id } })
  if (!existing) return fail(404, 'Kategori tidak ditemukan')
  if (existing.isSystem && input.isActive === false) return fail(409, 'Kategori bawaan sistem tidak dapat dinonaktifkan')
  if (input.name !== undefined) {
    if (!slugifyCategoryName(input.name)) return fail(400, 'Nama kategori harus memuat huruf atau angka')
    const clash = await categoryNameConflict(input.name, id)
    if (clash) return clash
  }
  const row = await prisma.vendorCategory.update({ where: { id }, data: input, include: categoryInclude })
  return { ok: true, category: toCategoryDto(row) }
}

export type CategoryDeleteResult =
  | { found: false }
  | { found: true; blocked: 'system' }
  | { found: true; deleted: true }
  | { found: true; deleted: false; vendorCount: number }

/** Hapus sungguhan bila tak ada vendor tertaut; selain itu nonaktif (vendor tetap berkategori). Kategori sistem tidak dapat dihapus. */
export async function deleteOrDeactivateCategory(id: string): Promise<CategoryDeleteResult> {
  const row = await prisma.vendorCategory.findUnique({ where: { id }, include: categoryInclude })
  if (!row) return { found: false }
  if (row.isSystem) return { found: true, blocked: 'system' }
  if (row._count.vendors > 0) {
    await prisma.vendorCategory.update({ where: { id }, data: { isActive: false } })
    return { found: true, deleted: false, vendorCount: row._count.vendors }
  }
  // Penghapusan BERSYARAT dalam satu statement: bila vendor baru menaut di antara pemeriksaan dan hapus, tak ada baris terhapus → jatuh ke nonaktif
  // (tautan pivot tidak boleh hilang diam-diam lewat cascade).
  const removed = await prisma.vendorCategory.deleteMany({ where: { id, vendors: { none: {} } } })
  if (removed.count === 1) return { found: true, deleted: true }
  const again = await prisma.vendorCategory.findUnique({ where: { id }, include: categoryInclude })
  if (!again) return { found: false }
  await prisma.vendorCategory.update({ where: { id }, data: { isActive: false } })
  return { found: true, deleted: false, vendorCount: again._count.vendors }
}
