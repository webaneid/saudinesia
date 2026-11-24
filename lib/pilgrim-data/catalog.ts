import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isEmptyValue } from '@/lib/manifest/values'

// Katalog Data Jamaah (docs/arsitektur-data-jamaah.md §3.1) — SATU daftar kolom untuk semua produk. Pembaca; penulis katalog = `fields.ts`.
// Bentuk `PilgrimFieldDef` sengaja sama dengan definisi kolom manifest lama (`fieldKey`/`label`/`fieldType`/`options`/`required`/`role`),
// jadi helper `lib/manifest/*` (validasi, kelengkapan, tampilan, pengikat kartu) dipakai apa adanya.

type Db = Pick<Prisma.TransactionClient, 'pilgrimField'>

export type PilgrimFieldDef = {
  id: string
  fieldKey: string
  label: string
  fieldType: string
  options: unknown
  required: boolean
  role: string | null
  isSystem: boolean
  isActive: boolean
  order: number
}

/** Seluruh katalog (aktif dan nonaktif) dalam urutan tampil. */
export async function pilgrimCatalog(db: Db = prisma): Promise<PilgrimFieldDef[]> {
  const rows = await db.pilgrimField.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] })
  return rows.map(r => ({
    id: r.id, fieldKey: r.key, label: r.label, fieldType: r.fieldType, options: r.options, required: r.required,
    role: r.role, isSystem: r.isSystem, isActive: r.isActive, order: r.order,
  }))
}

export const activeFields = (catalog: readonly PilgrimFieldDef[]): PilgrimFieldDef[] => catalog.filter(f => f.isActive)

/** Kolom buatan admin yang AKTIF — diisi di kartu Jamaah Saya (`SavedPilgrim.extraValues`, docs/arsitektur-data-jamaah.md §3.4). */
export const cardExtraFields = (catalog: readonly PilgrimFieldDef[]): PilgrimFieldDef[] => catalog.filter(f => f.isActive && !f.isSystem && f.role === null)

/**
 * Kolom untuk DITAMPILKAN: kolom yang diminta dari jamaah ini, ditambah kolom katalog lain (termasuk nonaktif) yang sudah punya nilai —
 * data tersimpan tetap terlihat walau kolomnya kini tak diminta. Kolom yang tak diminta tak pernah ditandai wajib.
 */
export function displayFields(catalog: readonly PilgrimFieldDef[], demanded: readonly PilgrimFieldDef[], values: Record<string, unknown>): PilgrimFieldDef[] {
  const asked = new Set(demanded.map(f => f.fieldKey))
  return catalog.flatMap(f => asked.has(f.fieldKey) ? [f] : isEmptyValue(values[f.fieldKey]) ? [] : [{ ...f, required: false }])
}

/** Nilai kolom ber-peran tertentu (mis. `display_name`) dari `fieldValues` — tanpa menghafal kunci kolom. Tak ada kolom berperan itu → null. */
export function valueByRole(fields: readonly { fieldKey: string; role: string | null }[], values: Record<string, unknown>, role: string): unknown {
  const field = fields.find(f => f.role === role)
  return field ? (values[field.fieldKey] ?? null) : null
}
