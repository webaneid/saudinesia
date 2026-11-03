import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { DocumentRequirementInput } from '@/lib/validators/documents'
import type { RequirementView } from './completeness'

// Syarat dokumen per produk (docs/arsitektur-jamaah.md §7.2/§7.6) — SATU-SATUNYA penulis `document_requirements`. Jenis dari katalog
// `document_types`; label kosong = label katalog. Kelengkapan dinilai `lib/documents/completeness.ts`, bukan di sini.
//
// Registry pemilik: produk yang boleh punya syarat — Visa, Paket Umroh, Haji (docs/rencana-visa-produk.md §3.4). Syarat Haji milik produk Haji
// sendiri, BUKAN visa umroh ("Visa Haji" konsep tersendiri, CLAUDE.md). Syarat seorang jamaah = gabungan produk yang memuatnya (§3.2, V4c).
type Tx = Prisma.TransactionClient

type Owner = {
  /** Kunci baris produk (FOR UPDATE) supaya dua penyimpanan ganti-semua terserialkan; false bila produk tak ada. */
  lock: (tx: Tx, id: string) => Promise<boolean>
  /** Daftar bawaan untuk produk baru (kunci katalog, semuanya wajib) — bisa diubah admin. */
  defaults: readonly string[]
}

export const REQUIREMENT_OWNERS = {
  visa: {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    lock: async (tx, id) => (await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "visa_products" WHERE "id" = ${id} FOR UPDATE`).length > 0,
    defaults: ['passport', 'ktp', 'kk', 'flight_ticket'],
  },
  package: {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    lock: async (tx, id) => (await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "packages" WHERE "id" = ${id} FOR UPDATE`).length > 0,
    defaults: ['passport', 'ktp', 'kk', 'vaccine'], // K3 (pemilik 2026-11-04)
  },
  haji: {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    lock: async (tx, id) => (await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "haji_products" WHERE "id" = ${id} FOR UPDATE`).length > 0,
    defaults: ['passport', 'ktp', 'kk', 'vaccine'], // K3 (pemilik 2026-11-04)
  },
} satisfies Record<string, Owner>

export type RequirementOwner = keyof typeof REQUIREMENT_OWNERS
export type ProductRef = { productType: string; productId: string }

/** Dilempar pemanggil di dalam transaksi supaya produk + syarat ter-rollback bersama; route menjawab 400 dengan `field`. */
export class RequirementRejected extends Error { constructor(message: string, readonly field?: string) { super(message) } }

export type RequirementWriteResult = { ok: true } | { ok: false; status: 400 | 404; error: string; field?: string }

const viewSelect = {
  documentTypeId: true, label: true, description: true, required: true,
  documentType: { select: { key: true, label: true, icon: true, reusable: true, hasExpiry: true, minValidityMonths: true } },
} satisfies Prisma.DocumentRequirementSelect
type ViewRow = Prisma.DocumentRequirementGetPayload<{ select: typeof viewSelect }>

const toView = (r: ViewRow): RequirementView => ({
  documentTypeId: r.documentTypeId,
  key: r.documentType.key,
  label: r.label ?? r.documentType.label,
  typeLabel: r.documentType.label,
  description: r.description,
  required: r.required,
  icon: r.documentType.icon,
  reusable: r.documentType.reusable,
  hasExpiry: r.documentType.hasExpiry,
  minValidityMonths: r.documentType.minValidityMonths,
})

/** Syarat satu produk, urut tampil. */
export async function requirementsOf(productType: string, productId: string, db: Tx | typeof prisma = prisma): Promise<RequirementView[]> {
  const rows = await db.documentRequirement.findMany({ where: { productType, productId }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: viewSelect })
  return rows.map(toView)
}

/** Syarat banyak produk sekaligus (satu kueri) — kunci peta `${productType}:${productId}`; produk tanpa syarat → []. */
export async function requirementsOfMany(refs: readonly ProductRef[]): Promise<Map<string, RequirementView[]>> {
  const out = new Map<string, RequirementView[]>(refs.map(r => [`${r.productType}:${r.productId}`, []]))
  if (refs.length === 0) return out
  const rows = await prisma.documentRequirement.findMany({
    where: { OR: refs.map(r => ({ productType: r.productType, productId: r.productId })) },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: { ...viewSelect, productType: true, productId: true },
  })
  for (const r of rows) out.get(`${r.productType}:${r.productId}`)?.push(toView(r))
  return out
}

/** Ganti seluruh syarat satu produk (urutan = urutan daftar) di dalam transaksi pemanggil. Jenis harus ada; jenis NONAKTIF hanya boleh
 *  bila sudah menjadi syarat produk ini (supaya menyimpan ulang tak gagal sesudah admin menonaktifkan jenis). */
export async function writeRequirements(tx: Tx, productType: RequirementOwner, productId: string, items: readonly DocumentRequirementInput[]): Promise<RequirementWriteResult> {
  if (!(await REQUIREMENT_OWNERS[productType].lock(tx, productId))) return { ok: false, status: 404, error: 'Produk tidak ditemukan' }
  const ids = items.map(i => i.documentTypeId)
  const [types, current] = await Promise.all([
    tx.documentType.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } }),
    tx.documentRequirement.findMany({ where: { productType, productId }, select: { documentTypeId: true } }),
  ])
  const byId = new Map(types.map(t => [t.id, t]))
  const kept = new Set(current.map(c => c.documentTypeId))
  for (const [i, item] of items.entries()) {
    const t = byId.get(item.documentTypeId)
    if (!t || (!t.isActive && !kept.has(t.id))) return { ok: false, status: 400, error: 'Jenis dokumen tidak tersedia', field: `requirements.${i}.documentTypeId` }
  }
  await tx.documentRequirement.deleteMany({ where: { productType, productId } })
  if (items.length > 0) {
    await tx.documentRequirement.createMany({
      data: items.map((r, order) => ({ productType, productId, documentTypeId: r.documentTypeId, label: r.label, description: r.description, required: r.required, order })),
    })
  }
  return { ok: true }
}

/** Isi daftar bawaan untuk produk BARU (jenis bawaan yang aktif saja). */
export async function writeDefaultRequirements(tx: Tx, productType: RequirementOwner, productId: string): Promise<RequirementWriteResult> {
  const keys = REQUIREMENT_OWNERS[productType].defaults
  const types = await tx.documentType.findMany({ where: { key: { in: [...keys] }, isActive: true }, select: { id: true, key: true } })
  const ordered = keys.flatMap(k => types.filter(t => t.key === k))
  return writeRequirements(tx, productType, productId, ordered.map(t => ({ documentTypeId: t.id, label: null, description: '', required: true })))
}

/** Hapus syarat produk yang dihapus sungguhan (dipanggil penghapus produk di transaksinya). */
export async function deleteRequirementsOf(tx: Tx, productType: string, productIds: readonly string[]): Promise<number> {
  if (productIds.length === 0) return 0
  return (await tx.documentRequirement.deleteMany({ where: { productType, productId: { in: [...productIds] } } })).count
}
