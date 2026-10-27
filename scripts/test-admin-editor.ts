// Penjaga tata letak editor ala WordPress (docs/arsitektur-admin-editor.md). Tanpa database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')
const ADMIN = 'app/[locale]/admin/(protected)/'

// Halaman edit yang sudah dimigrasi ke tata letak editor. Halaman berikutnya WAJIB ditambahkan di sini saat dimigrasi (fase F2).
const EDITORS = ['products/packages/[id]']

await t('halaman edit memakai EditorShell + PublishBox + MetaBox + useUnsavedGuard', () => {
  for (const e of EDITORS) {
    const src = read(ADMIN + e + '/page.tsx')
    for (const c of ['EditorShell', 'PublishBox', 'MetaBox']) assert.match(src, new RegExp(`<${c}\\b`), `${e}: tidak memakai <${c}>`)
    assert.match(src, /useUnsavedGuard\(/, `${e}: tidak memasang penjaga perubahan belum disimpan`)
  }
})

await t('halaman edit tidak kembali ke panel tersebar (admin-card/admin-form-panel mentah)', () => {
  for (const e of EDITORS) {
    const src = read(ADMIN + e + '/page.tsx')
    assert.doesNotMatch(src, /className="admin-form-panel/, `${e}: masih ada admin-form-panel — pakai MetaBox`)
    assert.doesNotMatch(src, /className="admin-card p-4 space-y-3"/, `${e}: masih ada kartu komponen manual — pakai MetaBox`)
  }
})

await t('simpan memeriksa respons (galat server tampil, baseline tidak maju bila gagal)', () => {
  for (const e of EDITORS) {
    const src = read(ADMIN + e + '/page.tsx')
    assert.match(src, /if \(!res\.ok\)/, `${e}: respons simpan tidak diperiksa`)
    assert.match(src, /if \(!okSaved\) return/, `${e}: baseline maju walau simpan gagal`)
  }
})

await t('muat-ulang akibat kotak komponen tidak menimpa isian info (hanya muat awal yang mereset)', () => {
  const src = read(ADMIN + 'products/packages/[id]/page.tsx')
  assert.match(src, /loadPackage\(p\.id, true\)/, 'muat awal harus mereset info')
  assert.match(src, /if \(resetInfo\)/, 'loadPackage harus menjaga isian lewat resetInfo')
})

await t('komponen editor: MetaBox menjaga isi tetap ter-mount saat dilipat', () => {
  const src = read('components/admin/editor/MetaBox.tsx')
  assert.match(src, /hidden=\{!expanded\}/, 'isi harus disembunyikan, bukan di-unmount')
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua lulus')
