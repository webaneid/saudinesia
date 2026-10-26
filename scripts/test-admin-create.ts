// Penjaga alur "Buat baru" admin (docs/arsitektur-admin-create.md): halaman khusus, bukan panel sebaris; galat tak pernah ditelan. Tanpa database.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')
const ADMIN = 'app/[locale]/admin/(protected)/'

// Halaman daftar → halaman(-halaman) buat yang dirujuk. Modul baru yang punya tombol "Tambah" WAJIB masuk daftar ini.
const MODULES: Array<{ list: string; news: string[] }> = [
  { list: 'products/haji', news: ['products/haji/new'] },
  { list: 'products/visa', news: ['products/visa/new'] },
  { list: 'products/packages', news: ['products/packages/new'] },
  { list: 'products/hotels', news: ['products/hotels/new'] },
  { list: 'products/muthowif', news: ['products/muthowif/new'] },
  { list: 'products/tour-packages', news: ['products/tour-packages/new'] },
  { list: 'products/tourism-sites', news: ['products/tourism-sites/new'] },
  { list: 'products/catering', news: ['products/catering/new'] },
  { list: 'products/seasons', news: ['products/seasons/new'] },
  { list: 'products/flight', news: ['products/flight/new', 'products/flight/routes/new'] },
  { list: 'products/transport', news: ['products/transport/vehicles/new', 'products/transport/trips/new'] },
  { list: 'system/users', news: ['system/users/new'] },
]

await t('setiap modul: halaman /new berbasis CreatePage + useCreateEntity; daftar menaut ke /new, tanpa panel sebaris', () => {
  for (const m of MODULES) {
    for (const n of m.news) {
      const file = ADMIN + n + '/page.tsx'
      assert.ok(existsSync(file), `${n}: halaman tidak ada`)
      const src = read(file)
      assert.match(src, /<CreatePage\b/, `${n}: tidak memakai CreatePage`)
      assert.match(src, /useCreateEntity\(/, `${n}: tidak memakai useCreateEntity`)
      assert.doesNotMatch(src, /method:\s*['"](POST|PUT|DELETE)['"]/, `${n}: menyimpan lewat fetch langsung — pakai useCreateEntity (satu-satunya pemeriksa respons)`)
    }
    const list = read(ADMIN + m.list + '/page.tsx')
    for (const n of m.news) assert.ok(list.includes(n.split('/').slice(-2).join('/') ) || list.includes("/new`"), `${m.list}: tak ada tautan ke ${n}`)
    assert.match(list, /<Link\b[^>]*\/new/, `${m.list}: tombol Tambah bukan tautan ke /new`)
    assert.doesNotMatch(list, /\bsetShow\w*\(|\{show\w* &&/, `${m.list}: daftar masih memuat formulir sebaris`)
  }
})

await t('useCreateEntity: respons diperiksa (galat server tampil, tak berpindah halaman) dan berpindah hanya bila ada id', () => {
  const src = read('components/admin/shell/useCreateEntity.ts')
  assert.match(src, /!res\.ok \|\| !json\?\.data\?\.id/); assert.match(src, /setError\(json\?\.error \?\? failMessage\)/)
  assert.ok(src.indexOf('!res.ok') < src.indexOf('router.push'), 'berpindah halaman sebelum memeriksa respons')
})

await t('CreatePage: galat role=alert, tombol kembali + Batal ke daftar, simpan nonaktif bila tak valid, Enter menyimpan lewat <form>', () => {
  const src = read('components/admin/shell/CreatePage.tsx')
  assert.match(src, /role="alert"/); assert.match(src, /<form onSubmit=\{handleSubmit\}/); assert.match(src, /disabled=\{!canSubmit \|\| saving\}/)
  assert.ok((src.match(/href=\{backHref\}/g) ?? []).length >= 2, 'kembali dan Batal harus menaut ke daftar')
})

await t('tak ada halaman daftar admin LAIN yang membuka formulir buat sebaris (state show*/panel) — modul baru wajib didaftarkan di atas', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('/page.tsx') ? [p] : [] })
  const offenders = walk(ADMIN).filter(f => /\bsetShow(Form)?\(\s*!?\w*/.test(read(f)) && /Tambah|Buat/.test(read(f)) && !f.includes('/vendors/'))
  assert.deepEqual(offenders, [], 'halaman daftar masih membuka formulir sebaris')
})

await t('regresi: skema POST trip menerima category null (formulir mengirim null saat kosong; dulu 400 diam-diam)', () => {
  assert.match(read('app/api/v1/admin/products/transport/trips/route.ts'), /category:\s+z\.string\(\)\.nullish\(\)/)
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nsemua lulus')
