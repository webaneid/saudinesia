import { z } from 'zod'
import { isCalendarDate } from '@/lib/time'
import { isDocumentIconName } from '@/lib/documents/icons'

// Jenis dokumen (katalog admin) dan unggahan dokumen jamaah — docs/arsitektur-jamaah.md §7. `.strict()` di semua skema (SEC-03).

/**
 * Pola kode referensi (mis. PNR) ditulis admin dan dijalankan server. Supaya tak bisa menjadi ReDoS, hanya bentuk sederhana yang diterima:
 * berjangkar `^…$`, kelas karakter, literal huruf/angka/tanda hubung, dan pengulang `{n}`/`{n,m}` — tanpa grup, alternatif, `*`, `+`, atau
 * garis miring terbalik. Tanpa kuantor bersarang pun, beberapa pengulang VARIABEL berdampingan atas kelas yang tumpang tindih
 * (`[A]{0,9}[A]{0,9}…`) memicu backtracking polinomial (SEC-182) — maka pola diurai per segmen: setiap kuantor berbatas (`{n}` atau
 * `{n,m}`, maks 40, tak ada `{n,}`) dan paling banyak SATU kuantor variabel per pola (backtracking tetap linear).
 */
const SEGMENT = /\[(?:[A-Za-z0-9]-[A-Za-z0-9]|[A-Za-z0-9])+\](?:\{(\d{1,2})(?:,(\d{1,2}))?\})?|[A-Za-z0-9-]/y
const MAX_REPEAT = 40
export function referencePatternProblem(p: string): string | null {
  if (p.length > 100) return 'Pola terlalu panjang'
  const shapeError = 'Pola hanya boleh berisi ^ di awal, $ di akhir, kelas [ ], huruf, angka, tanda hubung, dan {n} / {n,m}'
  if (!p.startsWith('^') || !p.endsWith('$') || p.length < 3) return shapeError
  const body = p.slice(1, -1)
  let variable = 0
  SEGMENT.lastIndex = 0
  while (SEGMENT.lastIndex < body.length) {
    const at = SEGMENT.lastIndex
    const m = SEGMENT.exec(body)
    if (!m || m.index !== at) return shapeError
    if (m[1] !== undefined) {
      const min = Number(m[1])
      const max = m[2] !== undefined ? Number(m[2]) : min
      if (max > MAX_REPEAT || min > max) return `Pengulang {n,m} harus berbatas 0–${MAX_REPEAT} dengan n ≤ m`
      if (max > min && ++variable > 1) return 'Hanya satu pengulang bervariasi {n,m} per pola; sisanya gunakan {n}'
    }
  }
  try { new RegExp(p) } catch { return 'Pola tidak valid' }
  return null
}

const label = z.string().trim().min(2, 'Label minimal 2 karakter').max(80)
const icon = z.string().refine(isDocumentIconName, 'Ikon tidak dikenal')
const referenceLabel = z.string().trim().min(2).max(60)
const referencePattern = z.string().trim().superRefine((p, ctx) => { const m = referencePatternProblem(p); if (m) ctx.addIssue({ code: 'custom', message: m }) })
const months = z.number().int().min(1).max(120)

const typeFields = {
  label,
  icon,
  minValidityMonths: months.nullish(),
  referenceLabel: referenceLabel.nullish(),
  referencePattern: referencePattern.nullish(),
  isActive: z.boolean().optional(),
  order: z.number().int().min(0).max(9999).optional(),
}

const consistent = <T extends { hasExpiry?: boolean; minValidityMonths?: number | null; referenceLabel?: string | null; referencePattern?: string | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.minValidityMonths != null && v.hasExpiry === false) ctx.addIssue({ code: 'custom', path: ['minValidityMonths'], message: 'Masa berlaku minimum hanya untuk dokumen bermasa berlaku' })
  if (v.referencePattern && !v.referenceLabel) ctx.addIssue({ code: 'custom', path: ['referenceLabel'], message: 'Isi label kode referensi' })
}

export const documentTypeCreateSchema = z.object({
  ...typeFields,
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Kunci: huruf kecil, angka, garis bawah (2–40 karakter, diawali huruf)'),
  reusable: z.boolean(),
  hasExpiry: z.boolean().default(false),
  allowMultiple: z.boolean().default(false),
}).strict().superRefine(consistent)

/** Ubah: `key` tak pernah berubah. Jenis bawaan (`isSystem`) juga tak boleh mengubah `reusable`/`hasExpiry`/`allowMultiple` — dicek di route. */
export const documentTypeUpdateSchema = z.object({
  ...typeFields,
  label: label.optional(),
  icon: icon.optional(),
  reusable: z.boolean().optional(),
  hasExpiry: z.boolean().optional(),
  allowMultiple: z.boolean().optional(),
}).strict().superRefine(consistent)

export type DocumentTypeCreate = z.infer<typeof documentTypeCreateSchema>
export type DocumentTypeUpdate = z.infer<typeof documentTypeUpdateSchema>

const calendarDate = z.string().refine(isCalendarDate, 'Tanggal tidak valid (YYYY-MM-DD)')

/** Kolom teks unggahan (multipart, selain `file`). Kunci asing ditolak. */
export const documentUploadFieldsSchema = z.object({
  documentTypeId: z.string().uuid('Jenis dokumen tidak valid'),
  label: z.string().trim().min(2, 'Nama dokumen minimal 2 karakter').max(80).optional(),
  referenceCode: z.string().trim().max(40).optional(),
  issuedAt: calendarDate.optional(),
  expiresAt: calendarDate.optional(),
}).strict()

export type DocumentUploadFields = z.infer<typeof documentUploadFieldsSchema>

/** Satu syarat dokumen produk (docs/arsitektur-jamaah.md §7.6). Jenis dari katalog; `label` kosong = label katalog. */
export const documentRequirementInputSchema = z.object({
  documentTypeId: z.string().uuid('Jenis dokumen tidak valid'),
  label: z.string().trim().max(80).nullish().transform(v => (v ? v : null)).refine(v => v === null || v.length >= 2, 'Label minimal 2 karakter'),
  description: z.string().trim().max(300).default(''),
  required: z.boolean().default(true),
}).strict()

/** Daftar syarat satu produk (urutan = urutan tampil). Satu jenis paling banyak sekali. */
export const documentRequirementListSchema = z.array(documentRequirementInputSchema).max(30, 'Maksimal 30 syarat dokumen')
  .superRefine((list, ctx) => {
    const seen = new Set<string>()
    list.forEach((r, i) => {
      if (seen.has(r.documentTypeId)) ctx.addIssue({ code: 'custom', path: [i, 'documentTypeId'], message: 'Jenis dokumen yang sama dipilih dua kali' })
      seen.add(r.documentTypeId)
    })
  })

export type DocumentRequirementInput = z.infer<typeof documentRequirementInputSchema>
