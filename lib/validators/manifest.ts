import { z } from 'zod'
import { allowedTypesForRole, looksLikeSealedData, MANIFEST_FIELD_TYPES } from '@/lib/manifest/fieldDefs'
import { MANIFEST_ROLES } from '@/lib/manifest/roles'

// Kolom data jamaah per produk (docs/arsitektur-manifest.md §9). Bentuk dan aturan peran di sini; keberadaan kunci lama dan penguncian produk yang
// sudah dipesan diperiksa penulisnya (lib/manifest/fields.ts).

const option = z.object({ label: z.string().trim().min(1, 'Pilihan tidak boleh kosong').max(80), value: z.string().trim().min(1).max(80) }).strict()

export const manifestFieldInputSchema = z.object({
  /** null = kolom baru, kuncinya dibuat server. */
  fieldKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/, 'Kunci kolom tidak valid').nullable(),
  label: z.string().trim().min(2, 'Nama kolom minimal 2 karakter').max(80, 'Nama kolom maksimal 80 karakter'),
  fieldType: z.enum(MANIFEST_FIELD_TYPES),
  required: z.boolean(),
  role: z.enum(MANIFEST_ROLES).nullable(),
  options: z.array(option).max(30, 'Maksimal 30 pilihan').nullable(),
}).strict().superRefine((f, ctx) => {
  if (f.role && !allowedTypesForRole(f.role).includes(f.fieldType)) ctx.addIssue({ code: 'custom', path: ['fieldType'], message: `${f.label}: tipe kolom tidak sesuai peran` })
  if (!f.role && looksLikeSealedData(f.label)) ctx.addIssue({ code: 'custom', path: ['label'], message: `${f.label}: NIK dan paspor harus memakai kolom standar supaya tersimpan terenkripsi` })
  if (f.fieldType === 'select') {
    if (!f.options || f.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: `${f.label}: isi minimal 2 pilihan` })
    else if (new Set(f.options.map(o => o.value)).size !== f.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: `${f.label}: ada pilihan yang sama` })
    if (f.role === 'gender' && !['male', 'female'].every(v => f.options?.some(o => o.value === v))) ctx.addIssue({ code: 'custom', path: ['options'], message: `${f.label}: pilihan harus memuat laki-laki dan perempuan` })
  } else if (f.options) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: `${f.label}: hanya tipe Pilihan yang punya daftar pilihan` })
  }
})

export const manifestFieldListSchema = z.array(manifestFieldInputSchema).max(40, 'Maksimal 40 kolom').superRefine((list, ctx) => {
  const name = list.find(f => f.role === 'display_name')
  if (!name) ctx.addIssue({ code: 'custom', message: 'Kolom Nama Lengkap wajib ada' })
  else if (!name.required) ctx.addIssue({ code: 'custom', message: 'Kolom Nama Lengkap harus wajib diisi' })
  const roles = new Set<string>()
  const keys = new Set<string>()
  list.forEach((f, i) => {
    if (f.role && roles.has(f.role)) ctx.addIssue({ code: 'custom', path: [i, 'role'], message: `Kolom ${f.label} dipilih dua kali` })
    if (f.role) roles.add(f.role)
    if (f.fieldKey && keys.has(f.fieldKey)) ctx.addIssue({ code: 'custom', path: [i, 'fieldKey'], message: `Kolom ${f.label} dikirim dua kali` })
    if (f.fieldKey) keys.add(f.fieldKey)
  })
})

export type ManifestFieldInput = z.infer<typeof manifestFieldInputSchema>
