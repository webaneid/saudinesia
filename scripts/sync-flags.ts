// Menyalin bendera SVG (rasio 3:2) untuk daftar `COUNTRIES` dari paket `country-flag-icons` (MIT, devDependency) ke `public/flags/`.
// Berkas SVG di-commit supaya produksi tak bergantung pada node_modules dan bendera dilayani sebagai berkas statis (docs/arsitektur-combobox.md §4d).
// Jalankan ulang bila daftar negara berubah: `bun scripts/sync-flags.ts`. Gagal keras bila ada negara tanpa bendera.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { COUNTRIES } from '@/lib/constants/countries'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const src = join(root, 'node_modules/country-flag-icons')
const dest = join(root, 'public/flags')
mkdirSync(dest, { recursive: true })

const missing = COUNTRIES.map(c => c.code).filter(code => !existsSync(join(src, '3x2', `${code}.svg`)))
if (missing.length) { console.error(`Bendera tidak ditemukan untuk: ${missing.join(', ')}`); process.exit(1) }
for (const { code } of COUNTRIES) copyFileSync(join(src, '3x2', `${code}.svg`), join(dest, `${code}.svg`))
copyFileSync(join(src, 'LICENSE'), join(dest, 'LICENSE'))
console.log(`${COUNTRIES.length} bendera disalin ke public/flags/`)
