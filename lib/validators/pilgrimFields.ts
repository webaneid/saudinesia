import { z } from 'zod'
import { looksLikeSealedData, MANIFEST_FIELD_TYPES } from '@/lib/manifest/fieldDefs'

// Katalog Data Jamaah (docs/arsitektur-data-jamaah.md §3.1, D2) — bentuk masukan admin. Aturan yang butuh baris tersimpan (bawaan, sudah
// dipakai, nama wajib) dinilai penulisnya `lib/pilgrim-data/fields.ts`.

/** Kunci = kunci `fieldValues`/`extraValues`; bentuk sama dengan CHECK `pilgrim_fields_key_chk` (camelCase, diawali huruf kecil). */
export const PILGRIM_FIELD_KEY_RE = /^[a-z][A-Za-z0-9]{1,39}$/

/** Kolom buatan admin tidak memakai tipe `address` (alamat berjenjang hanya kolom bawaan berperan `address`). */
export const CUSTOM_FIELD_TYPES = MANIFEST_FIELD_TYPES.filter(t => t !== 'address')

const option = z.object({ label: z.string().trim().min(1, 'Pilihan tidak boleh kosong').max(80), value: z.string().trim().min(1).max(80) }).strict()
const options = z.array(option).max(30, 'Maksimal 30 pilihan')
const label = z.string().trim().min(2, 'Nama kolom minimal 2 karakter').max(80, 'Nama kolom maksimal 80 karakter')
const order = z.number().int().min(0).max(9999)

function checkOptions(fieldType: string | undefined, opts: { label: string; value: string }[] | null | undefined, ctx: z.RefinementCtx) {
  if (fieldType === 'select') {
    if (!opts || opts.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Isi minimal 2 pilihan' })
    else if (new Set(opts.map(o => o.value)).size !== opts.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Ada pilihan yang sama' })
  } else if (fieldType !== undefined && opts) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'Hanya tipe Pilihan yang punya daftar pilihan' })
  }
}

const sealedLabel = (l: string | undefined, ctx: z.RefinementCtx) => {
  if (l && looksLikeSealedData(l)) ctx.addIssue({ code: 'custom', path: ['label'], message: 'NIK dan paspor memakai kolom bawaan supaya tersimpan terenkripsi' })
}

export const pilgrimFieldCreateSchema = z.object({
  key: z.string().trim().regex(PILGRIM_FIELD_KEY_RE, 'Kode: huruf dan angka tanpa spasi, diawali huruf kecil (2–40 karakter)'),
  label,
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  options: options.nullish(),
  required: z.boolean().default(false),
  isActive: z.boolean().default(true),
  order: order.default(100),
}).strict().superRefine((f, ctx) => {
  sealedLabel(f.label, ctx)
  checkOptions(f.fieldType, f.options, ctx)
  if (f.key in Object.prototype) ctx.addIssue({ code: 'custom', path: ['key'], message: 'Kode ini tidak bisa dipakai' })
})

/** Ubah: kunci tak pernah berubah. Tipe/pilihan kolom bawaan dan tipe kolom yang sudah berisi data dikunci penulis. */
export const pilgrimFieldUpdateSchema = z.object({
  label: label.optional(),
  fieldType: z.enum(CUSTOM_FIELD_TYPES).optional(),
  options: options.nullish(),
  required: z.boolean().optional(),
  isActive: z.boolean().optional(),
  order: order.optional(),
}).strict()

export type PilgrimFieldCreate = z.infer<typeof pilgrimFieldCreateSchema>
export type PilgrimFieldUpdate = z.infer<typeof pilgrimFieldUpdateSchema>
export { checkOptions as checkPilgrimFieldOptions }
