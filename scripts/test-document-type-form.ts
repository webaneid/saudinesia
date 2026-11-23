// Penjaga isian jenis dokumen (docs/arsitektur-jamaah.md §7.6): SEMUA tempat yang membuat/mengubah jenis dokumen memakai SATU komponen
// `components/admin/documents/DocumentTypeFields` — halaman Produk → Jenis Dokumen (buat/ubah) dan tab "Berkas custom" di popup syarat produk.
// Tes MENEMUKAN sendiri penulis API katalog jenis dokumen (bukan daftar yang dihafal). Tanpa database.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []
})
const SOURCES = [...walk('app'), ...walk('components')].filter(f => !f.startsWith('app/api/'))
const read = (f: string) => readFileSync(f, 'utf8')

const FIELDS = 'components/admin/documents/DocumentTypeFields.tsx'
const FORM = 'components/admin/documents/documentTypeForm.ts'
const API = /\/api\/v1\/admin\/products\/document-types/
/** Menulis ke API katalog: POST/PUT/PATCH eksplisit, atau kait buat/ubah entitas admin. */
const WRITES = /method:\s*'(POST|PUT|PATCH)'|useCreateEntity\(|useEditEntity</

t('setiap penulis jenis dokumen (temuan otomatis) merender <DocumentTypeFields> dan mengirim badan lewat bodyFromTypeForm', () => {
  const writers = SOURCES.filter(f => { const s = read(f); return API.test(s) && WRITES.test(s) })
  assert.ok(writers.length >= 3, `penulis yang ditemukan terlalu sedikit (${writers.length}) — pola pencarian basi?`)
  for (const f of writers) {
    const s = read(f)
    assert.match(s, /<DocumentTypeFields\b/, `${f}: menulis jenis dokumen tanpa <DocumentTypeFields>`)
    assert.match(s, /bodyFromTypeForm\(/, `${f}: badan permintaan tidak lewat bodyFromTypeForm`)
  }
  const found = new Set(writers)
  for (const must of ['components/admin/documents/RequirementsTable.tsx', 'app/[locale]/admin/(protected)/products/document-types/new/page.tsx', 'app/[locale]/admin/(protected)/products/document-types/[id]/page.tsx']) {
    assert.ok(found.has(must), `${must}: tidak terdeteksi sebagai penulis — pola pencarian basi?`)
  }
})

t('tak ada isian jenis dokumen kedua: pemilih ikon dan kode-dari-label hanya di DocumentTypeFields/documentTypeForm', () => {
  for (const f of SOURCES) {
    if (f === FIELDS || f === FORM) continue
    const s = read(f)
    assert.ok(!/DOCUMENT_ICON_NAMES/.test(s), `${f}: pemilih ikon jenis dokumen sendiri — pakai DocumentTypeFields`)
    if (/keyFromLabel|TYPE_KEY_RE/.test(s)) assert.match(s, /from '(\.\/|@\/components\/admin\/documents\/)documentTypeForm'/, `${f}: aturan kode jenis dokumen sendiri — impor dari documentTypeForm`)
    assert.ok(!/\^\[a-z\]\[a-z0-9_\]\{1,39\}\$/.test(s), `${f}: pola kode jenis dokumen ditulis ulang — pakai TYPE_KEY_RE`)
  }
})

t('komponen lama tidak hidup lagi: RequirementsEditor dan DocumentTypeFields di folder halaman', () => {
  for (const f of SOURCES) {
    assert.ok(!/RequirementsEditor\b/.test(read(f)) || f === 'components/admin/documents/RequirementsTable.tsx', `${f}: memakai RequirementsEditor (sudah diganti RequirementsTable)`)
  }
  assert.ok(!SOURCES.includes('app/[locale]/admin/(protected)/products/document-types/DocumentTypeFields.tsx'), 'DocumentTypeFields kembali ke folder halaman — pakai components/admin/documents')
})

if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
