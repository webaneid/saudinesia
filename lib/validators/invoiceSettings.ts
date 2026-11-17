import { isUsableQrisPayload } from '@/lib/qris/emv'
import { z } from 'zod'
import { addressSchema } from '@/lib/validators/address'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { NUMBER_PREFIX_RE, numberPatternError } from '@/lib/invoice/numberPattern'
import { isCanonicalTimezone } from '@/lib/time'

// docs/arsitektur-booking-engine-v2.md §6. Semua `.strict()` (tak ada kolom liar). Batas sama dengan CHECK di migrasi `invoice_settings`.
const noControl = (v: string) => !/[\u0000-\u001f\u007f]/.test(v)
const text = (max: number) => z.string().trim().max(max, `Maksimal ${max} karakter`).refine(noControl, 'Karakter kontrol/baris baru tidak diperbolehkan')
const req = (max: number, message: string) => z.string().trim().min(1, message).max(max, `Maksimal ${max} karakter`).refine(noControl, 'Karakter kontrol/baris baru tidak diperbolehkan')
const optionalText = (max: number) => text(max).nullish().transform(v => (v ? v : null))
// Pesan tipe salah saja (setara `invalid_type_error` Zod 3): kunci yang hilang tetap memakai pesan bawaan.
const typeError = (message: string) => ({ error: (iss: { input?: unknown }) => (iss.input === undefined ? undefined : message) })
const percent = (label: string) => z.number(typeError(`${label} harus angka`)).min(0, `${label} minimal 0`).max(100, `${label} maksimal 100`)
const int = (label: string, min: number, max: number) => z.number(typeError(`${label} harus angka`)).int(`${label} harus bilangan bulat`).min(min, `${label} minimal ${min}`).max(max, `${label} maksimal ${max}`)

export const invoiceSettingsSchema = z.object({
  numberPrefix: z.string().trim().regex(NUMBER_PREFIX_RE, 'Awalan maksimal 12 karakter: huruf, angka, titik, garis bawah, garis miring, tanda hubung'),
  numberPattern: z.string().trim(),
  numberPadding: int('Panjang urut', 1, 10),
  numberResetYearly: z.boolean(),

  appTimezone: z.string().refine(isCanonicalTimezone, 'Zona waktu tidak dikenal (pilih dari daftar, mis. Asia/Jakarta)'),
  defaultDueDays: int('Jatuh tempo bawaan', 0, 365),
  expireDaysBeforeReference: int('Batas hangus', 0, 365),
  minimumFirstPaymentPercent: percent('Pembayaran minimum'),

  uniqueCodeEnabled: z.boolean(),
  uniqueCodeMin: int('Kode unik minimum', 1, 9998),
  uniqueCodeMax: int('Kode unik maksimum', 2, 9999),

  methodBankTransfer: z.boolean(),
  methodQris: z.boolean(),
  methodIpaymu: z.boolean(),
  methodXendit: z.boolean(),
  gatewaySandbox: z.boolean(),

  companyName: optionalText(160),
  companyTaxId: optionalText(40),
  companyPhone: optionalText(40),
  companyEmail: z.string().trim().max(160).nullish().transform(v => (v ? v : null)).refine(v => v === null || z.string().email().safeParse(v).success, 'Format email perusahaan tidak valid'),
  companyWebsite: z.string().trim().max(200).nullish().transform(v => (v ? v : null)).transform((v, ctx) => {
    if (v === null) return null
    // Dinormalkan lewat URL (href yang pasti sah) supaya aman ditempel ke templat HTML/email kelak; hanya http(s), tanpa tanda kutip/kurung sudut/spasi.
    try {
      const u = new URL(v)
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || /["'<>\s]/.test(v)) throw new Error('x')
      return u.toString()
    } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Situs harus alamat http:// atau https:// yang sah' }); return z.NEVER }
  }),
  address: addressSchema.nullish(),

  // Token konkurensi optimistis: `updatedAt` yang dimuat halaman; bila baris sudah berubah → 409 (SEC-117).
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),

  termsDoc: richTextField(20_000).nullish().transform(v => emptyToNull(v)),
  footerNoteDoc: richTextField(5_000).nullish().transform(v => emptyToNull(v)),
}).strict().superRefine((d, ctx) => {
  const e = numberPatternError(d.numberPattern, d.numberResetYearly)
  if (e) ctx.addIssue({ code: z.ZodIssueCode.custom, message: e, path: ['numberPattern'] })
  if (d.uniqueCodeMin >= d.uniqueCodeMax) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Kode unik minimum harus lebih kecil dari maksimum', path: ['uniqueCodeMax'] })
})
export type InvoiceSettingsInput = z.infer<typeof invoiceSettingsSchema>

const sortOrder = z.number().int().min(0).max(10_000)

// Skema BUAT memakai bawaan (aktif, urutan 0); skema UBAH (PUT = penggantian penuh) MEWAJIBKAN keduanya supaya klien yang menghilangkannya tak menghidupkan kembali baris yang
// dinonaktifkan (SEC-112). Aksi ikon aktif/nonaktif memakai bentuk `{isActive}` terpisah di list handler.
const bankFields = {
  bankName: req(80, 'Nama bank wajib diisi'),
  accountNumber: req(40, 'Nomor rekening wajib diisi').refine(v => /^[0-9A-Za-z .-]+$/.test(v), 'Nomor rekening hanya angka/huruf, spasi, titik, tanda hubung'),
  accountHolder: req(120, 'Nama pemilik rekening wajib diisi'),
  branch: optionalText(120),
}
export const bankAccountSchema = z.object({ ...bankFields, isActive: z.boolean().default(true), sortOrder: sortOrder.default(0) }).strict()
export const bankAccountUpdateSchema = z.object({ ...bankFields, isActive: z.boolean(), sortOrder }).strict()
export type BankAccountInput = z.infer<typeof bankAccountSchema>

const qrisFields = {
  name: req(80, 'Nama QRIS wajib diisi'),
  // Payload QRIS statis (diawali "000201"); dibaca otomatis dari gambar di Fase 8. Opsional di sini.
  // Fase 8: bentuk + CRC diperiksa (`isUsableQrisPayload`, juga harus bisa dijadikan dinamis) — payload salah salin akan menghasilkan QR yang ditolak aplikasi bank.
  emvPayload: z.string().trim().max(1000).nullish().transform(v => (v ? v : null)).refine(v => v === null || isUsableQrisPayload(v), 'Payload QRIS tidak sah (harus diawali 000201, CRC di akhir cocok, dan berisi Tag 53 mata uang)'),
}
export const qrisAccountSchema = z.object({ ...qrisFields, isActive: z.boolean().default(true), sortOrder: sortOrder.default(0) }).strict()
export const qrisAccountUpdateSchema = z.object({ ...qrisFields, isActive: z.boolean(), sortOrder }).strict()
export type QrisAccountInput = z.infer<typeof qrisAccountSchema>

const taxFields = {
  name: req(60, 'Nama pajak wajib diisi'),
  ratePercent: z.number(typeError('Tarif harus angka')).min(0, 'Tarif minimal 0').max(100, 'Tarif maksimal 100').refine(v => Number.isFinite(v) && Math.round(v * 1000) / 1000 === v, 'Tarif maksimal 3 angka desimal'),
  basisPercent: z.number(typeError('Dasar pengenaan harus angka')).gt(0, 'Dasar pengenaan lebih dari 0').max(100, 'Dasar pengenaan maksimal 100').refine(v => Math.round(v * 1000) / 1000 === v, 'Dasar maksimal 3 angka desimal'),
  mode: z.enum(['added', 'included']),
}
export const taxRuleSchema = z.object({ ...taxFields, isActive: z.boolean().default(true), sortOrder: sortOrder.default(0) }).strict()
export const taxRuleUpdateSchema = z.object({ ...taxFields, isActive: z.boolean(), sortOrder }).strict()
export type TaxRuleInput = z.infer<typeof taxRuleSchema>

// Biaya layanan gateway per kelompok kanal (Fase 9, K9-2). Batas sama dengan CHECK `gateway_fee_rules_bounds`.
const gatewayFeeFields = {
  gateway: z.enum(['ipaymu', 'xendit']),
  channelGroup: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/, 'Kelompok kanal: huruf kecil, angka, - atau _ (mis. va, qris, cstore)'),
  percent: percent('Biaya persen').refine(v => Math.round(v * 100) / 100 === v, 'Biaya persen maksimal 2 angka desimal'),
  flatIdr: int('Biaya tetap', 0, 10_000_000),
}
export const gatewayFeeRuleSchema = z.object({ ...gatewayFeeFields, isActive: z.boolean().default(true), sortOrder: sortOrder.default(0) }).strict()
export const gatewayFeeRuleUpdateSchema = z.object({ ...gatewayFeeFields, isActive: z.boolean(), sortOrder }).strict()
export type GatewayFeeRuleInput = z.infer<typeof gatewayFeeRuleSchema>
