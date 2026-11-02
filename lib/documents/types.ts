import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { deleteOrDeactivate, type DeleteOutcome } from '@/lib/admin/safeDelete'
import type { DocumentTypeCreate, DocumentTypeUpdate } from '@/lib/validators/documents'

// Katalog jenis dokumen (docs/arsitektur-jamaah.md §7.1) — SATU-SATUNYA penulis `document_types`. Jenis bawaan (`isSystem`, diisi migrasi) dipakai
// kode lewat `key`-nya: tidak bisa dihapus dan perilakunya (`reusable`/`hasExpiry`/`allowMultiple`) tetap; label, ikon, urutan, aturan masa
// berlaku, kode referensi, dan status aktif boleh diubah. Kunci tak pernah berubah.

export type TypeResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string; field?: string }

const LOCKED_ON_SYSTEM = ['reusable', 'hasExpiry', 'allowMultiple'] as const

export async function createDocumentType(input: DocumentTypeCreate): Promise<TypeResult<{ id: string }>> {
  try {
    const row = await prisma.documentType.create({ data: { ...input, isSystem: false }, select: { id: true } })
    return { ok: true, value: row }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, status: 409, error: 'Kunci jenis dokumen sudah dipakai', field: 'key' }
    throw e
  }
}

export async function updateDocumentType(id: string, input: DocumentTypeUpdate): Promise<TypeResult<{ id: string }>> {
  return prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    const rows = await tx.$queryRaw<{ isSystem: boolean; hasExpiry: boolean; referenceLabel: string | null }[]>`SELECT "isSystem", "hasExpiry", "referenceLabel" FROM "document_types" WHERE "id" = ${id} FOR UPDATE`
    const cur = rows[0]
    if (!cur) return { ok: false as const, status: 404 as const, error: 'Jenis dokumen tidak ditemukan' }
    if (cur.isSystem) {
      const locked = LOCKED_ON_SYSTEM.find(k => input[k] !== undefined)
      if (locked) return { ok: false as const, status: 400 as const, error: 'Sifat jenis dokumen bawaan tidak bisa diubah', field: locked }
    }
    // Kombinasi akhir (masukan + nilai tersimpan) harus konsisten — CHECK DB menjaga juga, di sini pesannya ramah.
    const hasExpiry = input.hasExpiry ?? cur.hasExpiry
    if (input.minValidityMonths != null && !hasExpiry) return { ok: false as const, status: 400 as const, error: 'Masa berlaku minimum hanya untuk dokumen bermasa berlaku', field: 'minValidityMonths' }
    const refLabel = input.referenceLabel !== undefined ? input.referenceLabel : cur.referenceLabel
    if (input.referencePattern && !refLabel) return { ok: false as const, status: 400 as const, error: 'Isi label kode referensi', field: 'referenceLabel' }
    const data: Prisma.DocumentTypeUpdateInput = { ...input }
    if (input.hasExpiry === false) data.minValidityMonths = null
    if (input.referenceLabel === null) data.referencePattern = null
    await tx.documentType.update({ where: { id }, data })
    return { ok: true as const, value: { id } }
  })
}

/** Hapus-aman: bawaan atau yang sudah dipakai dokumen jamaah → nonaktif; selain itu dihapus sungguhan. */
export async function deleteDocumentType(id: string): Promise<DeleteOutcome> {
  const lock = async (tx: Prisma.TransactionClient) => {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    const rows = await tx.$queryRaw<{ isSystem: boolean }[]>`SELECT "isSystem" FROM "document_types" WHERE "id" = ${id} FOR UPDATE`
    if (!rows[0]) throw Object.assign(new Error('not found'), { code: 'P2025' })
    return rows[0].isSystem
  }
  // Bawaan dihitung sebagai "dirujuk kode" — tak pernah dihapus fisik.
  const references = async (db: Prisma.TransactionClient | typeof prisma, isSystem: boolean) => (isSystem ? 1 : 0) + await db.pilgrimDocument.count({ where: { documentTypeId: id } })
  return deleteOrDeactivate({
    references: async () => references(prisma, await prisma.$transaction(lock)),
    remove: () => prisma.$transaction(async (tx) => {
      if ((await references(tx, await lock(tx))) > 0) throw Object.assign(new Error('referenced'), { code: 'P2003' })
      await tx.documentType.delete({ where: { id } })
    }),
    deactivate: () => prisma.documentType.update({ where: { id }, data: { isActive: false } }),
    usedBy: () => 'Jenis dokumen ini bawaan sistem atau sudah dipakai dokumen jamaah',
  })
}
