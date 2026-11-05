import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { RequirementRejected } from '@/lib/documents/requirements'
import type { ManifestFieldInput } from '@/lib/validators/manifest'
import { fieldKeyFromLabel, STANDARD_FIELDS, standardFieldOf, uniqueFieldKey, type ManifestOption } from './fieldDefs'

// Kolom data jamaah per produk (docs/arsitektur-manifest.md §9) — SATU-SATUNYA penulis `manifest_field_requirements` di aplikasi (dijaga scripts/test-manifest-fields.ts).
// Kunci kolom mengikat nilai `booking_pilgrims.fieldValues`, jadi kunci yang ada tak pernah berubah. Baris `core` tidak dikelola di sini.

type Tx = Prisma.TransactionClient

type Owner = {
  /** Kunci baris produk (FOR UPDATE) supaya dua penyimpanan ganti-semua terserialkan; false bila produk tak ada. */
  lock: (tx: Tx, id: string) => Promise<boolean>
  /** Produk sudah pernah dipesan: nilai jamaah sudah terikat ke kolomnya. */
  used: (db: Tx | typeof prisma, id: string) => Promise<boolean>
}

export const MANIFEST_OWNERS = {
  visa: {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    lock: async (tx, id) => (await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "visa_products" WHERE "id" = ${id} FOR UPDATE`).length > 0,
    used: async (db, id) => (await db.visaApplication.count({ where: { visaProductId: id } })) > 0,
  },
} satisfies Record<string, Owner>

export type ManifestOwner = keyof typeof MANIFEST_OWNERS

/** Dilempar di dalam transaksi supaya produk + kolom ter-rollback bersama. Turunan `RequirementRejected`: route menjawab 400 dengan cara yang sama. */
export class ManifestFieldsRejected extends RequirementRejected {}

export type ManifestFieldView = { fieldKey: string; label: string; fieldType: string; required: boolean; role: string | null; options: ManifestOption[] | null }

function optionsOf(raw: Prisma.JsonValue): ManifestOption[] | null {
  if (!Array.isArray(raw)) return null
  return raw.flatMap(o => (o && typeof o === 'object' && !Array.isArray(o) && typeof o.label === 'string' && typeof o.value === 'string' ? [{ label: o.label, value: o.value }] : []))
}

/** Kolom satu produk untuk editor admin, urut tampil. */
export async function manifestFieldsForEditor(productType: ManifestOwner, productId: string): Promise<{ fields: ManifestFieldView[]; used: boolean }> {
  const [rows, used] = await Promise.all([
    prisma.manifestFieldRequirement.findMany({ where: { productType, productId }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { fieldKey: true, label: true, fieldType: true, required: true, role: true, options: true } }),
    MANIFEST_OWNERS[productType].used(prisma, productId),
  ])
  return { fields: rows.map(r => ({ ...r, options: optionsOf(r.options) })), used }
}

/** Ganti seluruh kolom satu produk (urutan = urutan daftar) di dalam transaksi pemanggil. Masukan sudah lolos `manifestFieldListSchema`. */
export async function writeManifestFields(tx: Tx, productType: ManifestOwner, productId: string, items: readonly ManifestFieldInput[]): Promise<void> {
  const owner = MANIFEST_OWNERS[productType]
  if (!(await owner.lock(tx, productId))) throw new ManifestFieldsRejected('Produk tidak ditemukan')
  const current = await tx.manifestFieldRequirement.findMany({ where: { productType, productId }, select: { fieldKey: true, fieldType: true, role: true } })
  const byKey = new Map(current.map(c => [c.fieldKey, c]))
  const used = await owner.used(tx, productId)

  for (const [i, item] of items.entries()) {
    // Kolom standar tanpa kunci memakai kunci standarnya: kalau kunci itu sudah ada, ia menimpa baris lama dan wajib lolos kunci tipe yang sama.
    const cur = byKey.get(item.fieldKey ?? standardFieldOf(item.role)?.fieldKey ?? '')
    if (!cur) {
      if (item.fieldKey) throw new ManifestFieldsRejected('Daftar kolom sudah berubah. Muat ulang halaman lalu coba lagi.', `manifestFields.${i}.fieldKey`)
      continue
    }
    // Nilai jamaah yang sudah tersimpan mengikuti tipe dan peran lama (telepon = objek, NIK/paspor = samaran bersegel) — mengubahnya merusak nilai itu.
    if (used && (cur.fieldType !== item.fieldType || cur.role !== item.role)) {
      throw new ManifestFieldsRejected(`Kolom ${item.label} sudah dipakai pesanan: tipenya tidak bisa diubah. Buat kolom baru bila perlu.`, `manifestFields.${i}.fieldType`)
    }
  }

  const taken = new Set(items.flatMap(i => (i.fieldKey ? [i.fieldKey] : [])))
  for (const s of STANDARD_FIELDS) taken.add(s.fieldKey)
  const rows = items.map((item, order) => {
    let fieldKey = item.fieldKey
    if (!fieldKey) {
      const std = standardFieldOf(item.role)
      if (std) {
        fieldKey = std.fieldKey
      } else {
        // Produk yang sudah dipesan: sufiks acak supaya kolom baru tak menempel ke nilai kolom lama yang pernah dihapus (kunci yang sama, makna lain).
        const base = fieldKeyFromLabel(item.label)
        fieldKey = uniqueFieldKey(used ? `${base}_${randomBytes(3).toString('hex')}` : base, taken)
        taken.add(fieldKey)
      }
    }
    return {
      productType, productId, order, fieldKey, label: item.label, fieldType: item.fieldType, required: item.required, role: item.role,
      options: item.options ? (item.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    }
  })

  // Tak ada indeks unik kunci di DB: dua baris berkunci sama akan berbagi satu nilai jamaah.
  if (new Set(rows.map(r => r.fieldKey)).size !== rows.length) throw new ManifestFieldsRejected('Ada kolom yang bentrok. Hapus salah satunya lalu simpan lagi.')
  await tx.manifestFieldRequirement.deleteMany({ where: { productType, productId } })
  if (rows.length > 0) await tx.manifestFieldRequirement.createMany({ data: rows })
}

/** Daftar bawaan untuk produk BARU — tanpa ini form jamaah kosong, termasuk nama. */
export function writeDefaultManifestFields(tx: Tx, productType: ManifestOwner, productId: string): Promise<void> {
  return writeManifestFields(tx, productType, productId, STANDARD_FIELDS.filter(f => f.isDefault).map(f => ({
    fieldKey: null, label: f.label, fieldType: f.fieldType, required: f.required, role: f.role, options: f.options ? [...f.options] : null,
  })))
}
