import { z } from 'zod'
import { boundedKeys } from '@/lib/validators'
import { routing } from '@/i18n/routing'
import { isLinkTarget } from '@/lib/public-content/links'
import { MAX_TEXT_LENGTH } from '@/lib/public-content/pages'

// Masukan editor Konten Situs (docs/arsitektur-frontend-publik.md §6.5 C3). Kunci dicocokkan dengan kolom yang bisa diedit di layanan
// (bergantung halaman); di sini hanya bentuk, batas, dan isi yang aman.

// Karakter kontrol selain baris baru dan tab ditolak (teks polos untuk tampilan).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/

const text = z.string().max(MAX_TEXT_LENGTH, { error: `Teks maksimal ${MAX_TEXT_LENGTH} karakter` })
  .refine(s => !CONTROL.test(s), { error: 'Teks memuat karakter yang tidak diizinkan' })

// Segmen camelCase berawalan huruf kecil (bentuk kunci berkas pesan) — menolak `__proto__`, `constructor.x`, dan sejenisnya sejak bentuk.
const key = z.string().min(1).max(80).regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/, { error: 'Kunci tidak valid' })

const localeTexts = boundedKeys(200, 'Terlalu banyak kolom', z.record(key, text))

export const pageContentInputSchema = z.object({
  text: z.object(Object.fromEntries(routing.locales.map(l => [l, localeTexts.optional()]))).strict(),
  links: boundedKeys(20, 'Terlalu banyak tombol', z.record(key, z.string().max(40).refine(isLinkTarget, { error: 'Tujuan tombol tidak diizinkan' }).nullable())),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict()

export type PageContentInput = z.infer<typeof pageContentInputSchema>
