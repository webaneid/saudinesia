// Kit tabel seragam (docs/arsitektur-tabel.md): jendela nomor halaman (tabel nilai dihitung tangan), autocomplete filter, tautan filter, dan render nyata komponen server-safe
// (Pagination, DataTable dengan kolom aksi, RowActions). Interaksi klien (FilterSelect, ApiAction) dibuktikan di browser + penjaga sumber; Tak membutuhkan database.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Pagination, pageWindow } from '@/components/admin/data-table/Pagination'
import { DataTable } from '@/components/admin/data-table/DataTable'
import { ACTION_ICONS, ACTION_LABELS, ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { filterHref, filterOptions } from '@/lib/admin/filter'
import { matchPreset, periodPresets, wibDate } from '@/lib/admin/period'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'

let failed = 0
const pending: Promise<void>[] = []
function t(name: string, fn: () => void | Promise<void>) {
  const bad = (e: unknown) => { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 10).join('\n     ')}`) }
  try {
    const r = fn()
    if (r instanceof Promise) pending.push(r.then(() => console.log(`PASS ${name}`)).catch(bad))
    else console.log(`PASS ${name}`)
  } catch (e) { bad(e) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const G = 'gap' as const

t('pageWindow (tabel nilai): tiga halaman di tiap ujung + aktif ±1; celah satu halaman diisi angka, celah lebih besar jadi elipsis', () => {
  const table: Array<[number, number, Array<number | 'gap'>]> = [
    [1, 1, [1]],
    [1, 5, [1, 2, 3, 4, 5]],
    [1, 7, [1, 2, 3, 4, 5, 6, 7]],            // celah tepat satu halaman (4) diisi
    [1, 8, [1, 2, 3, G, 6, 7, 8]],            // celah dua halaman → elipsis
    [10, 22, [1, 2, 3, G, 9, 10, 11, G, 20, 21, 22]],
    [5, 22, [1, 2, 3, 4, 5, 6, G, 20, 21, 22]],
    [12, 22, [1, 2, 3, G, 11, 12, 13, G, 20, 21, 22]],
    [22, 22, [1, 2, 3, G, 20, 21, 22]],
    [6, 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    [2, 3, [1, 2, 3]],
  ]
  for (const [page, total, expected] of table) assert.deepEqual(pageWindow(page, total), expected, `halaman ${page} dari ${total}`)
})

t('filterOptions: tak peka huruf, cocok di mana saja pada label, kosong = semua, tak ada hasil = []; urutan asli terjaga', () => {
  const opts = [{ value: 'a', label: 'Menunggu Pembayaran' }, { value: 'b', label: 'Dikonfirmasi' }, { value: 'c', label: 'Dibatalkan' }]
  assert.deepEqual(filterOptions(opts, '').map(o => o.value), ['a', 'b', 'c'])
  assert.deepEqual(filterOptions(opts, '  ').map(o => o.value), ['a', 'b', 'c'])
  assert.deepEqual(filterOptions(opts, 'DI').map(o => o.value), ['b', 'c'])
  assert.deepEqual(filterOptions(opts, 'bayar').map(o => o.value), ['a'])
  assert.deepEqual(filterOptions(opts, 'xyz'), [])
})

t('filterHref: param lain dipertahankan, halaman kembali ke 1 (tak ditulis), "Semua" membuang param', () => {
  const base = '/id/admin/bookings'
  assert.equal(filterHref(base, { q: 'ahmad', limit: '50', page: 4 }, 'status', 'confirmed'), '/id/admin/bookings?q=ahmad&limit=50&status=confirmed')
  assert.equal(filterHref(base, { q: 'ahmad', status: 'confirmed' }, 'status', ''), '/id/admin/bookings?q=ahmad')
  assert.equal(filterHref(base, {}, 'status', ''), '/id/admin/bookings')
  assert.ok(!filterHref(base, { page: 9 }, 'status', 'x').includes('page='))
})

t('Pagination (render nyata): panah kiri/kanan, angka, ringkas HP, teks rentang; halaman pertama/terakhir menonaktifkan panah; satu halaman tanpa navigasi; total 0 tanpa apa pun', () => {
  const html = renderToStaticMarkup(createElement(Pagination, { page: 10, limit: 20, total: 440, totalPages: 22, hrefFor: p => `/x?page=${p}` }))
  assert.match(html, /Menampilkan[\s\S]*181–200[\s\S]*dari[\s\S]*440/)
  assert.match(html, /aria-label="Halaman sebelumnya"[^>]*href="\/x\?page=9"|href="\/x\?page=9"[^>]*aria-label="Halaman sebelumnya"/)
  assert.match(html, /href="\/x\?page=11"[^>]*aria-label="Halaman berikutnya"|aria-label="Halaman berikutnya"[^>]*href="\/x\?page=11"/)
  for (const n of [1, 2, 3, 9, 11, 20, 21, 22]) assert.ok(html.includes(`aria-label="Halaman ${n}"`), `angka ${n}`)
  assert.ok(!html.includes('aria-label="Halaman 5"'), 'tengah disembunyikan elipsis')
  assert.match(html, /aria-current="page"[^>]*>10<|>10<\/span>/)
  assert.match(html, /10 \/ 22/)
  assert.match(html, /…/)
  const first = renderToStaticMarkup(createElement(Pagination, { page: 1, limit: 20, total: 440, totalPages: 22, hrefFor: p => `/x?page=${p}` }))
  assert.match(first, /aria-label="Halaman sebelumnya"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Halaman sebelumnya"/)
  const last = renderToStaticMarkup(createElement(Pagination, { page: 22, limit: 20, total: 440, totalPages: 22, hrefFor: p => `/x?page=${p}` }))
  assert.match(last, /aria-label="Halaman berikutnya"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Halaman berikutnya"/)
  const one = renderToStaticMarkup(createElement(Pagination, { page: 1, limit: 20, total: 5, totalPages: 1 }))
  assert.ok(one.includes('Menampilkan') && !one.includes('Paginasi'))
  assert.equal(renderToStaticMarkup(createElement(Pagination, { page: 1, limit: 20, total: 0, totalPages: 1 })), '')
})

t('RowActions/ActionLink (render nyata): hanya ikon + teks aksesibel (title/aria-label), tautan, urutan; ikon dan label satu tempat', () => {
  const html = renderToStaticMarkup(createElement(RowActions, null,
    createElement(ActionLink, { kind: 'view', href: '/a/1' }), createElement(ActionLink, { kind: 'edit', href: '/a/1/edit', label: 'Edit Hotel Safwah' })))
  assert.match(html, /<a [^>]*href="\/a\/1"[^>]*>/)
  assert.ok(html.includes('aria-label="Lihat detail"') && html.includes('title="Lihat detail"'))
  assert.ok(html.includes('aria-label="Edit Hotel Safwah"'))
  assert.equal((html.match(/<svg/g) ?? []).length, 2, 'dua ikon')
  assert.ok(!/>\s*(Lihat detail|Edit)\s*</.test(html), 'tak ada teks tampak — hanya ikon')
  assert.deepEqual(Object.keys(ACTION_ICONS).sort(), Object.keys(ACTION_LABELS).sort())
  assert.deepEqual(Object.keys(ACTION_LABELS).sort(), ['activate', 'deactivate', 'delete', 'edit', 'view'])
})

t('DataTable (render nyata): kolom `actions` berjudul "Aksi", rata kanan, lebar pas, dan di kartu HP pindah ke dasar; baris kosong memakai teks kosong; loading tak merender data', () => {
  type Row = { id: string; name: string }
  const cols = [
    { key: 'name', header: 'Nama', cell: (r: Row) => createElement('span', null, r.name) },
    { key: 'a', header: '', actions: true, cell: (r: Row) => createElement(RowActions, null, createElement(ActionLink, { kind: 'view', href: `/x/${r.id}` })) },
  ]
  const html = renderToStaticMarkup(createElement(DataTable<Row>, { columns: cols, rows: [{ id: '1', name: 'Ahmad' }], getRowId: r => r.id }))
  assert.match(html, /<th[^>]*w-px[^>]*>Aksi<\/th>/)
  assert.match(html, /<td[^>]*text-right[^>]*w-px|<td[^>]*w-px[^>]*text-right/)
  const card = html.slice(html.indexOf('<ul'))
  assert.match(card, /justify-end[\s\S]*href="\/x\/1"/, 'aksi di dasar kartu HP')
  assert.ok(!/<dt[^>]*>Aksi/.test(card), 'aksi bukan baris "label: nilai" di kartu')
  // `actions: true` menang atas header berisi: tetap di dasar kartu, bukan baris "label: nilai"
  const named = renderToStaticMarkup(createElement(DataTable<Row>, { columns: [cols[0]!, { ...cols[1]!, header: 'Tindakan' }], rows: [{ id: '1', name: 'Ahmad' }], getRowId: r => r.id }))
  assert.ok(!/<dt[^>]*>Tindakan/.test(named.slice(named.indexOf('<ul'))), 'actions:true + header berisi tetap di dasar kartu')
  assert.match(renderToStaticMarkup(createElement(DataTable<Row>, { columns: cols, rows: [], getRowId: r => r.id, empty: 'Belum ada.' })), /Belum ada\./)
  assert.ok(!renderToStaticMarkup(createElement(DataTable<Row>, { columns: cols, rows: [{ id: '1', name: 'Ahmad' }], getRowId: r => r.id, loading: true })).includes('Ahmad'))
})

t('periodPresets (tabel nilai dihitung tangan, WIB): bulan ini, bulan lalu, 90 hari, tahun ini; pergantian hari WIB; matchPreset', () => {
  const p = periodPresets(new Date('2026-10-29T12:00:00Z')) // WIB 19:00, hari yang sama
  assert.deepEqual(p.map(x => [x.key, x.from, x.to]), [
    ['month', '2026-10-01', '2026-10-29'], ['prev', '2026-09-01', '2026-09-30'], ['90', '2026-08-01', '2026-10-29'], ['year', '2026-01-01', '2026-10-29'],
  ])
  // 20:00 UTC tanggal 31 Des = 03:00 WIB tanggal 1 Jan: periode ikut hari WIB, bukan UTC
  assert.equal(wibDate(new Date('2026-12-31T20:00:00Z')), '2027-01-01')
  const ny = periodPresets(new Date('2026-12-31T20:00:00Z'))
  assert.deepEqual(ny.map(x => [x.from, x.to]), [['2027-01-01', '2027-01-01'], ['2026-12-01', '2026-12-31'], ['2026-10-04', '2027-01-01'], ['2027-01-01', '2027-01-01']])
  assert.equal(matchPreset(p, '2026-09-01', '2026-09-30'), 'prev')
  assert.equal(matchPreset(p, '2026-09-02', '2026-09-30'), '', 'rentang kustom')
})

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const ADMIN = 'app/[locale]/admin/(protected)/'
// Halaman yang sudah memakai kit penuh (Fase 1–2). Tambahkan halaman baru di sini tiap fase.
const MIGRATED = ['customers', 'bookings', 'system/users', 'visa', 'payments', 'quotas', 'margin', 'reports', 'reports/variance', 'system/vendors', 'system/deletion-requests', 'notifications'].map(d => `${ADMIN}${d}/page.tsx`)
// Log baca-saja tanpa aksi per baris: satu-satunya halaman tanpa kolom aksi.
const NO_ACTIONS = new Set([`${ADMIN}notifications/page.tsx`])

t('PENJAGA SUMBER (halaman bermigrasi): tak ada FilterPills/window.confirm/<table> mentah; tiap daftar memakai DataTable + RowActions (kolom `actions`) kecuali log baca-saja; filter lewat FilterSelect', () => {
  assert.ok(!walk(join(root, 'app')).concat(walk(join(root, 'components'))).some(f => /FilterPills/.test(readFileSync(f, 'utf8'))), 'FilterPills sudah dipensiunkan')
  for (const f of MIGRATED) {
    const src = readFileSync(join(root, f), 'utf8')
    assert.doesNotMatch(src, /FilterPills|window\.confirm|\bconfirm\(|<table/, f)
    assert.match(src, /DataTable/, f)
    if (!NO_ACTIONS.has(f)) { assert.match(src, /RowActions/, f); assert.match(src, /actions: true/, f) }
  }
  // halaman yang punya filter memakai FilterBar + FilterSelect
  for (const f of MIGRATED.filter(x => !/system\/users/.test(x))) assert.match(readFileSync(join(root, f), 'utf8'), /<FilterBar[\s\S]*<FilterSelect|PeriodFilter/, f)
  // halaman server memakai `nav` (props data biasa), bukan fungsi, untuk FilterSelect
  for (const f of MIGRATED) {
    const src = readFileSync(join(root, f), 'utf8')
    if (/'use client'/.test(src)) continue
    assert.doesNotMatch(src.match(/<FilterSelect[^>]*>/g)?.join('') ?? '', /hrefFor=|onChange=/, `${f}: FilterSelect di halaman server memakai nav`)
  }
})

t('PENJAGA SUMBER: Pembayaran tak lagi membuat daftar sendiri; filter status permintaan hapus akun tak memercayai nilai mentah; PeriodFilter dipakai kedua laporan (tak ada salinan preset)', () => {
  const pay = readFileSync(join(root, `${ADMIN}payments/page.tsx`), 'utf8')
  assert.doesNotMatch(pay, /bookings\.map\(/)
  const api = readFileSync(join(root, 'app/api/v1/admin/deletion-requests/route.ts'), 'utf8')
  assert.match(api, /STATUSES as readonly string\[\]\)\.includes/)
  for (const f of ['reports', 'reports/variance']) {
    const src = readFileSync(join(root, `${ADMIN}${f}/page.tsx`), 'utf8')
    assert.match(src, /<PeriodFilter/, f)
    assert.doesNotMatch(src, /const presets|function presets|wibDate = /, `${f}: preset periode satu tempat (lib/admin/period.ts)`)
  }
})

t('readCatalogQuery: paginasi OPT-IN (tanpa page/limit = semua), page/limit rusak jatuh ke bawaan, q dipangkas, status/param asing diabaikan', () => {
  const rq = (qs: string) => readCatalogQuery(new URLSearchParams(qs))
  assert.equal(rq('').list, null, 'tanpa page/limit: picker memuat daftar utuh')
  assert.equal(rq('q=abc').list, null, 'q saja bukan permintaan paginasi')
  assert.deepEqual(rq('page=3&limit=10').list, { page: 3, limit: 10, skip: 20 })
  assert.deepEqual(rq('limit=5').list, { page: 1, limit: 5, skip: 0 })
  assert.deepEqual(rq('page=abc&limit=zzz').list, { page: 1, limit: 20, skip: 0 })
  assert.equal(rq('page=1&limit=100000').list!.limit, 20, 'di atas batas jatuh ke bawaan, bukan 500')
  assert.equal(rq(`q=${'x'.repeat(300)}`).q.length, 100)
  assert.equal(rq('q=%20%20abc%20').q, 'abc')
  assert.deepEqual([rq('status=active').status, rq('status=inactive').status, rq('status=ngawur').status, rq('').status], ['active', 'inactive', undefined, undefined])
  assert.equal(pickParam(new URLSearchParams('city=makkah'), 'city', ['makkah', 'madinah'] as const), 'makkah')
  assert.equal(pickParam(new URLSearchParams('city=toString'), 'city', ['makkah', 'madinah'] as const), undefined, 'bukan lewat prototype')
  assert.deepEqual([activeFilter('active'), activeFilter('inactive'), activeFilter(undefined)], [{ isActive: true }, { isActive: false }, {}])
})

t('paginateCatalog: tanpa list = semua baris tanpa meta; dengan list = halaman terjepit + meta (total, halaman terakhir)', async () => {
  const data = Array.from({ length: 45 }, (_, i) => i + 1)
  const find = async (range?: { skip: number; take: number }) => (range ? data.slice(range.skip, range.skip + range.take) : data)
  const all = await paginateCatalog(null, async () => data.length, find)
  assert.deepEqual([all.items.length, all.meta], [45, undefined])
  const p2 = await paginateCatalog({ page: 2, limit: 20, skip: 20 }, async () => data.length, find)
  assert.deepEqual([p2.items[0], p2.items.length, p2.meta?.page, p2.meta?.total, p2.meta?.totalPages], [21, 20, 2, 45, 3])
  const over = await paginateCatalog({ page: 99, limit: 20, skip: 1960 }, async () => data.length, find)
  assert.deepEqual([over.meta?.page, over.items[0], over.items.length], [3, 41, 5], 'halaman melewati batas dijepit ke terakhir')
  const empty = await paginateCatalog({ page: 1, limit: 20, skip: 0 }, async () => 0, find)
  assert.deepEqual([empty.items.length, empty.meta?.total], [0, 0])
})

const CATALOG_PAGES = ['catering', 'haji', 'hotels', 'packages', 'seasons', 'tour-packages', 'tourism-sites', 'visa', 'muthowif', 'transport', 'flight'].map(d => `${ADMIN}products/${d}/page.tsx`)
const CATALOG_ROUTES = ['catering', 'haji', 'hotels', 'packages', 'seasons', 'tour-packages', 'tourism-sites', 'visa', 'muthowif', 'flight/routes', 'flight/schedules', 'transport/vehicles', 'transport/trips'].map(d => `app/api/v1/admin/products/${d}/route.ts`)

t('PENJAGA SUMBER (katalog, Fase 3): halaman memakai CatalogList + CatalogActions (tanpa fetch/DataTable/window.confirm sendiri); API GET memakai readCatalogQuery + paginateCatalog dan tiap orderBy ber-tie-breaker id; CategoryManager berikon dan berpaginasi', () => {
  for (const f of CATALOG_PAGES) {
    const src = readFileSync(join(root, f), 'utf8')
    assert.match(src, /<CatalogList/, f)
    assert.match(src, /CatalogActions/, f)
    assert.doesNotMatch(src, /<DataTable|window\.confirm|\bconfirm\(|<table|\.then\(r => r\.json\(\)\)\.then\(j => setList/, f)
  }
  assert.match(readFileSync(join(root, `${ADMIN}products/flight/page.tsx`), 'utf8'), /<CatalogList<FlightRoute> ns="r" endpoint="[^"]*flight\/routes"[\s\S]*<CatalogList<FlightSchedule> ns="s" endpoint="[^"]*flight\/schedules"/, 'rute dan jadwal sama-sama berpaginasi, halaman terpisah')
  assert.match(readFileSync(join(root, `${ADMIN}products/transport/page.tsx`), 'utf8'), /ns="v"[\s\S]*ns="t"/, 'kendaraan dan trip: halaman terpisah')
  for (const f of CATALOG_ROUTES) {
    const src = readFileSync(join(root, f), 'utf8')
    const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
    assert.match(get, /readCatalogQuery\(/, f)
    assert.match(get, /paginateCatalog\(/, f)
    assert.match(get, /id: '(asc|desc)'/, `${f}: orderBy butuh tie-breaker id`)
    assert.doesNotMatch(get, /contains: cq\.q|contains: q\b/, `${f}: pencarian wajib escapeLike`)
  }
  const cm = readFileSync(join(root, 'components/admin/vendor/CategoryManager.tsx'), 'utf8')
  assert.match(cm, /ApiAction/); assert.match(cm, /<Pagination/); assert.doesNotMatch(cm, /confirmingDelete|window\.confirm/)
})

const PUBLIC_PAGES = ['app/[locale]/(public)/flight/page.tsx', 'app/[locale]/(public)/hotels/[id]/page.tsx', 'app/[locale]/(pilgrim)/dashboard/page.tsx']

t('PENJAGA SUMBER (Fase 4): satu-satunya <table> adalah DataTable bersama (+ prototipe /campaigns yang terdaftar sebagai pengecualian); halaman publik/jamaah memakai kit BERSAMA; batas admin ↔ jamaah/publik terjaga', () => {
  const all = [...walk(join(root, 'app')), ...walk(join(root, 'components'))]
  const tables = all.filter(f => /<table|<thead/.test(readFileSync(f, 'utf8'))).map(f => f.slice(root.length + 1)).sort()
  assert.deepEqual(tables, ['components/campaigns/CampaignTable.tsx', 'components/shared/data-table/DataTable.tsx'], '<table> baru wajib lewat DataTable bersama')
  for (const f of PUBLIC_PAGES) {
    const src = readFileSync(join(root, f), 'utf8')
    assert.match(src, /@\/components\/shared\/data-table\/DataTable/, f)
    assert.match(src, /@\/components\/shared\/data-table\/Pagination/, f)
    assert.match(src, /<DataTable\b/, f)
    assert.match(src, /<Pagination\b/, f)
    assert.doesNotMatch(src, /<table|<thead/, f)
  }
  // kit generik hidup di shared; folder admin hanya meneruskan (re-export) untuk berkas yang dipindah
  for (const k of ['DataTable', 'Pagination', 'FilterBar', 'FilterSelect', 'SearchForm', 'RowActions']) {
    assert.equal(readFileSync(join(root, `components/admin/data-table/${k}.tsx`), 'utf8').trim(), `export * from '@/components/shared/data-table/${k}'`)
    assert.ok(readFileSync(join(root, `components/shared/data-table/${k}.tsx`), 'utf8').length > 200, k)
  }
  // area jamaah/publik/auth/bersama tak boleh mengimpor folder admin (CLAUDE.md) — kit bersama tak menarik apa pun dari admin
  const NON_ADMIN = [
    ...walk(join(root, 'app/[locale]/(pilgrim)')), ...walk(join(root, 'app/[locale]/(public)')), ...walk(join(root, 'app/[locale]/(auth)')),
    ...walk(join(root, 'components/shared')), ...walk(join(root, 'components/booking')), ...walk(join(root, 'lib/table')),
  ]
  const bad = NON_ADMIN.filter(f => /from '@\/(components|lib)\/admin\//.test(readFileSync(f, 'utf8'))).map(f => f.slice(root.length + 1))
  assert.deepEqual(bad, [], 'impor silang admin ↔ jamaah/publik')
})

await Promise.all(pending)
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
