// Penjaga alur "Buat baru" admin (docs/arsitektur-admin-create.md): halaman khusus, bukan panel sebaris; galat tak pernah ditelan. Tanpa database.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')
const BASE = 'app/[locale]/admin/(protected)/'

// Modul yang sudah dimigrasi ke halaman khusus. Fase berikutnya menambah entri di sini.
const MIGRATED = ['products/haji', 'products/visa', 'products/packages']

await t('modul termigrasi: ada new/page.tsx berbasis CreatePage; daftar menaut ke /new, tanpa panel sebaris', () => {
  for (const m of MIGRATED) {
    const newPage = BASE + m + '/new/page.tsx'
    assert.ok(existsSync(newPage), `${m}: new/page.tsx tidak ada`)
    assert.match(read(newPage), /<CreatePage\b/, `${m}: halaman baru tidak memakai CreatePage`)
    const list = read(BASE + m + '/page.tsx')
    assert.match(list, new RegExp(`href=\\{\`/\\$\\{locale\\}/admin/${m}/new\`\\}`), `${m}: tombol Tambah bukan tautan ke /new`)
    assert.doesNotMatch(list, /\bsetShow\(|\{show &&|\bshowForm\b|admin-form-panel/, `${m}: daftar masih memuat formulir sebaris`)
  }
})

await t('halaman buat memeriksa respons (galat server tampil, formulir tak menutup) dan pindah ke halaman edit hanya bila ada id', () => {
  for (const m of MIGRATED) {
    const src = read(BASE + m + '/new/page.tsx')
    assert.match(src, /!res\.ok \|\| !json\?\.data\?\.id/, `${m}: respons simpan tidak diperiksa`)
    assert.match(src, /setError\(json\?\.error \?\?/, `${m}: pesan galat server tidak ditampilkan`)
    assert.ok(src.indexOf('!res.ok') < src.indexOf('router.push'), `${m}: berpindah halaman sebelum memeriksa respons`)
  }
})

await t('CreatePage: galat role=alert, tombol kembali + Batal ke daftar, simpan nonaktif bila tak valid, Enter menyimpan lewat <form>', () => {
  const src = read('components/admin/shell/CreatePage.tsx')
  assert.match(src, /role="alert"/); assert.match(src, /<form onSubmit=\{handleSubmit\}/); assert.match(src, /disabled=\{!canSubmit \|\| saving\}/)
  assert.ok((src.match(/href=\{backHref\}/g) ?? []).length >= 2, 'kembali dan Batal harus menaut ke daftar')
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nsemua lulus')
