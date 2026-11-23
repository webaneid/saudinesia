import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { deleteOrDeactivate, type DeleteOutcome } from '@/lib/admin/safeDelete'
import { looksLikeSealedData } from '@/lib/manifest/fieldDefs'
import type { PilgrimFieldCreate, PilgrimFieldUpdate } from '@/lib/validators/pilgrimFields'

// Katalog Data Jamaah (docs/arsitektur-data-jamaah.md §3.1, D2) — SATU-SATUNYA penulis `pilgrim_fields`. Kolom bawaan (`isSystem`, berperan,
// diisi migrasi) dipakai kode lewat perannya: tak bisa dihapus, tipe/pilihan tetap; label, wajib, urutan, aktif boleh diubah — kecuali Nama
// Lengkap yang selalu aktif dan wajib. Kunci tak pernah berubah (mengikat `fieldValues` booking dan `extraValues` kartu).

export type FieldResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string; field?: string }

type Db = Prisma.TransactionClient | typeof prisma

/** Kolom yang dikirim ke admin (daftar & editor). */
export const PILGRIM_FIELD_SELECT = { id: true, key: true, label: true, fieldType: true, options: true, role: true, required: true, isSystem: true, isActive: true, order: true } as const

type Locked = { key: string; role: string | null; isSystem: boolean; fieldType: string; options: unknown }

const bad = (error: string, field?: string) => ({ ok: false as const, status: 400 as const, error, ...(field ? { field } : {}) })

async function lockField(tx: Prisma.TransactionClient, id: string): Promise<Locked | null> {
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
  const rows = await tx.$queryRaw<Locked[]>`SELECT "key", "role", "isSystem", "fieldType", "options" FROM "pilgrim_fields" WHERE "id" = ${id} FOR UPDATE`
  return rows[0] ?? null
}

/** Berapa jamaah booking dan kartu yang sudah menyimpan nilai untuk kunci ini (nilai kosong dihitung juga — kuncinya sudah dipakai). */
export async function fieldUsage(key: string, db: Db = prisma): Promise<{ bookingPilgrims: number; cards: number }> {
  // $queryRaw: Prisma ORM tidak bisa memfilter "kunci ada di objek JSON" (jsonb_exists).
  const [b, c] = await Promise.all([
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "booking_pilgrims" WHERE jsonb_exists("fieldValues", ${key})`,
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "saved_pilgrims" WHERE jsonb_exists("extraValues", ${key})`,
  ])
  return { bookingPilgrims: b[0]?.n ?? 0, cards: c[0]?.n ?? 0 }
}

const usedCount = async (key: string, db: Db) => { const u = await fieldUsage(key, db); return u.bookingPilgrims + u.cards }

export async function createPilgrimField(input: PilgrimFieldCreate): Promise<FieldResult<{ id: string }>> {
  try {
    const row = await prisma.pilgrimField.create({
      data: {
        key: input.key, label: input.label, fieldType: input.fieldType, required: input.required, isActive: input.isActive, order: input.order,
        options: input.fieldType === 'select' && input.options ? input.options : Prisma.DbNull, role: null, isSystem: false,
      },
      select: { id: true },
    })
    return { ok: true, value: row }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, status: 409, error: 'Kode kolom sudah dipakai', field: 'key' }
    throw e
  }
}

export async function updatePilgrimField(id: string, input: PilgrimFieldUpdate): Promise<FieldResult<{ id: string }>> {
  return prisma.$transaction(async (tx) => {
    const cur = await lockField(tx, id)
    if (!cur) return { ok: false as const, status: 404 as const, error: 'Kolom data jamaah tidak ditemukan' }
    if (cur.isSystem) {
      if (input.fieldType !== undefined && input.fieldType !== cur.fieldType) return bad('Tipe kolom bawaan tidak bisa diubah', 'fieldType')
      if (input.options !== undefined) return bad('Pilihan kolom bawaan tidak bisa diubah', 'options')
      if (cur.role === 'display_name' && (input.isActive === false || input.required === false)) return bad('Nama Lengkap selalu aktif dan wajib diisi', input.isActive === false ? 'isActive' : 'required')
    } else {
      if (input.label && looksLikeSealedData(input.label)) return bad('NIK dan paspor memakai kolom bawaan supaya tersimpan terenkripsi', 'label')
      if (input.fieldType !== undefined && input.fieldType !== cur.fieldType && await usedCount(cur.key, tx) > 0) {
        return bad('Tipe kolom yang sudah berisi data jamaah tidak bisa diubah', 'fieldType')
      }
    }
    // Kombinasi akhir tipe + pilihan (CHECK DB menjaga juga; di sini pesannya ramah).
    const fieldType = input.fieldType ?? cur.fieldType
    const options = fieldType !== 'select' ? null : input.options !== undefined ? input.options : (cur.options as { label: string; value: string }[] | null)
    if (!cur.isSystem && fieldType === 'select') {
      if (!options || options.length < 2) return bad('Isi minimal 2 pilihan', 'options')
      if (new Set(options.map(o => o.value)).size !== options.length) return bad('Ada pilihan yang sama', 'options')
    }
    if (!cur.isSystem && fieldType !== 'select' && input.options) return bad('Hanya tipe Pilihan yang punya daftar pilihan', 'options')
    await tx.pilgrimField.update({
      where: { id },
      data: {
        ...(input.label !== undefined && { label: input.label }),
        ...(input.required !== undefined && { required: input.required }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.order !== undefined && { order: input.order }),
        ...(!cur.isSystem && { fieldType, options: options ?? Prisma.DbNull }),
      },
    })
    return { ok: true as const, value: { id } }
  })
}

/** Hapus-aman: kolom bawaan, atau yang kuncinya sudah berisi data jamaah/kartu → nonaktif; selain itu dihapus sungguhan. */
export async function deletePilgrimField(id: string): Promise<DeleteOutcome> {
  const lock = async (tx: Prisma.TransactionClient) => {
    const cur = await lockField(tx, id)
    if (!cur) throw Object.assign(new Error('not found'), { code: 'P2025' })
    return cur
  }
  const references = async (tx: Prisma.TransactionClient) => { const cur = await lock(tx); return (cur.isSystem ? 1 : 0) + await usedCount(cur.key, tx) }
  return deleteOrDeactivate({
    references: () => prisma.$transaction(references),
    remove: () => prisma.$transaction(async (tx) => {
      if ((await references(tx)) > 0) throw Object.assign(new Error('referenced'), { code: 'P2003' })
      await tx.pilgrimField.delete({ where: { id } })
    }),
    deactivate: () => prisma.pilgrimField.update({ where: { id }, data: { isActive: false } }), // Nama Lengkap ditolak route lebih dulu (CHECK DB)
    usedBy: () => 'Kolom ini bawaan sistem atau sudah berisi data jamaah',
  })
}
