// Penjaga KONSISTENSI tabel/daftar (docs/arsitektur-tabel.md Fase 5). Bukan daftar halaman yang dihafal: tes MENEMUKAN sendiri setiap pemakai `<DataTable>`, route admin `GET`, dan halaman
// server, lalu membandingkannya dengan pengecualian yang TERTULIS BERALASAN di bawah. Halaman/route baru yang menyimpang dari kit (tak berpaginasi, aksi bertulis, kolom aksi non-baku,
// `window.confirm`, daftar tak berbatas) membuat tes merah sampai diperbaiki ATAU didaftarkan di sini dengan alasan. Entri basi (berkas hilang/sudah patuh) juga merah — daftar tak bisa membusuk.
//
// Tak membutuhkan database.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 14).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(join(root, dir))) return out
  for (const f of readdirSync(join(root, dir))) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(join(root, p)).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const SOURCES = [...walk('app'), ...walk('components')]
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length
const KIT = (f: string) => f.startsWith('components/shared/data-table/') || f.startsWith('components/admin/data-table/')

// ── PENGECUALIAN (setiap entri WAJIB beralasan) ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Jumlah `<DataTable>` per berkas yang SENGAJA tanpa `<Pagination>`: ringkasan turunan berukuran tetap (bukan daftar yang tumbuh). */
const UNPAGINATED_TABLES: Record<string, { count: number; reason: string }> = {
  'app/[locale]/admin/(protected)/page.tsx': { count: 1, reason: 'Overview: ringkasan tetap 5 booking terbaru; daftar lengkap berpaginasi di /admin/bookings' },
  'app/[locale]/admin/(protected)/quotas/page.tsx': { count: 1, reason: 'tabel pool Muthowif = 31 hari turunan dari kalender; tabel hotel di halaman yang sama berpaginasi' },
  'app/[locale]/admin/(protected)/reports/page.tsx': { count: 3, reason: 'ringkasan per produk/vendor/bulan = agregat berukuran tetap; daftar per booking berpaginasi' },
  'app/[locale]/admin/(protected)/reports/variance/page.tsx': { count: 4, reason: 'ringkasan per produk/bulan/vendor/komponen = agregat berukuran tetap; daftar per baris rencana berpaginasi' },
}

/** Berkas berisi `<DataTable>` yang tidak punya kolom aksi: tampilan baca-saja. */
const READ_ONLY_TABLES: Record<string, string> = {
  'app/[locale]/(public)/flight/page.tsx': 'katalog publik baca-saja (tak ada aksi per baris)',
  'app/[locale]/(public)/hotels/[id]/page.tsx': 'rate sheet publik baca-saja',
  'app/[locale]/admin/(protected)/notifications/page.tsx': 'log pengiriman baca-saja',
  'components/admin/data-table/CatalogList.tsx': 'pembungkus generik: kolom & aksi ditentukan halaman pemakai (CatalogActions)',
}

/** Route admin GET yang boleh memuat `findMany` tanpa paginasi: daftar bersarang milik SATU induk atau pencarian untuk editor/picker. */
const UNBOUNDED_ADMIN_GET: Record<string, string> = {
  'app/api/v1/admin/bookings/[id]/muthowif/assign/route.ts': 'kandidat muthowif untuk satu booking (picker penugasan)',
  'app/api/v1/admin/products/hotels/[id]/periods/[periodId]/prices/route.ts': 'harga satu periode hotel (editor rate sheet)',
  'app/api/v1/admin/products/hotels/[id]/periods/route.ts': 'periode milik SATU hotel (editor)',
  'app/api/v1/admin/products/hotels/[id]/services/route.ts': 'layanan milik SATU hotel (editor)',
  'app/api/v1/admin/products/hotels/room-types/route.ts': 'master tipe kamar kecil untuk editor/picker',
  'app/api/v1/admin/products/hotels/schedules/route.ts': 'pemilih jadwal kamar untuk editor paket',
  'app/api/v1/admin/products/transport/pricing/route.ts': 'harga kendaraan milik SATU trip (editor)',
  'app/api/v1/admin/products/visa/[id]/cost-tiers/route.ts': 'tier biaya milik SATU produk visa (editor)',
  'app/api/v1/admin/products/visa/[id]/preview/route.ts': 'simulasi harga satu produk visa (editor)',
}

/** Halaman server dengan `findMany` tanpa paginasi: katalog KARTU kurasi (bukan tabel) — operator memegang seluruh inventori; atau pilihan checkout satu produk. */
const UNPAGINATED_PAGES: Record<string, string> = {
  'app/[locale]/(pilgrim)/bookings/checkout/transport/page.tsx': 'pilihan trip pada checkout (daftar kurasi kecil)',
  'app/[locale]/(pilgrim)/bookings/checkout/visa/page.tsx': 'pilihan produk visa pada checkout (daftar kurasi kecil)',
  'app/[locale]/(public)/catering/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/haji/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/hotels/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/muthowif/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/packages/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/tours/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/transport/page.tsx': 'katalog kartu kurasi',
  'app/[locale]/(public)/visa/page.tsx': 'katalog kartu kurasi',
}

/** `<table>` di luar DataTable bersama: sengaja KOSONG (prototipe /campaigns dihapus 2026-10-30) — entri baru butuh alasan kuat. */
const RAW_TABLE_EXCEPTIONS: Record<string, string> = {}

for (const [name, table] of Object.entries({ UNPAGINATED_TABLES, READ_ONLY_TABLES, UNBOUNDED_ADMIN_GET, UNPAGINATED_PAGES, RAW_TABLE_EXCEPTIONS })) {
  t(`pengecualian ${name}: tiap entri beralasan dan berkasnya ada`, () => {
    for (const [f, v] of Object.entries(table)) {
      assert.ok(existsSync(join(root, f)), `berkas hilang: ${f}`)
      const reason = typeof v === 'string' ? v : v.reason
      assert.ok(reason.trim().length >= 10, `alasan kosong: ${f}`)
    }
  })
}

const TABLE_FILES = SOURCES.filter(f => !f.startsWith('components/shared/data-table/') && /<DataTable\b/.test(read(f)))

t('PAGINASI (temuan otomatis): setiap `<DataTable>` berpasangan dengan <Pagination>/<CatalogList>, kecuali ringkasan turunan yang terdaftar — jumlahnya PERSIS', () => {
  const unpaginated: Record<string, number> = {}
  for (const f of TABLE_FILES) {
    const src = read(f)
    const n = count(src, /<DataTable\b/g) - count(src, /<Pagination\b|<CatalogList\b/g)
    if (n > 0) unpaginated[f] = n
  }
  const expected = Object.fromEntries(Object.entries(UNPAGINATED_TABLES).map(([f, v]) => [f, v.count]))
  assert.deepEqual(unpaginated, expected, 'tabel baru tanpa paginasi (atau pengecualian basi) — berpaginasilah atau daftarkan dengan alasan')
})

t('AKSI (temuan otomatis): kolom `key: \'actions\'` selalu `actions: true`; berkas bertabel memakai RowActions/CatalogActions kecuali baca-saja yang terdaftar; tak ada aksi bertulis (Edit/Kelola/Hapus/…)', () => {
  const noRowActions: string[] = []
  for (const f of TABLE_FILES) {
    const src = read(f)
    assert.equal(count(src, /key: 'actions'/g), count(src, /actions: true/g), `${f}: kolom aksi non-baku (butuh \`actions: true\`)`)
    assert.doesNotMatch(src, />\s*(Edit|Kelola|Nonaktifkan|Aktifkan|Hapus|Lihat|Ubah)\s*<\/(button|a|Link)>/, `${f}: aksi harus berikon (RowActions), bukan teks`)
    const hasActions = /RowActions|CatalogActions/.test(src) && /actions: true/.test(src)
    if (!hasActions && !(f in READ_ONLY_TABLES)) noRowActions.push(f)
  }
  assert.deepEqual(noRowActions, [], 'tabel tanpa kolom aksi baku (tambahkan RowActions atau daftarkan sebagai baca-saja beralasan)')
  for (const f of Object.keys(READ_ONLY_TABLES)) {
    const src = read(f)
    assert.ok(!/RowActions/.test(src) || f === 'components/admin/data-table/CatalogList.tsx', `${f}: sudah punya aksi — keluarkan dari READ_ONLY_TABLES`)
  }
})

t('DILARANG di seluruh app/ dan components/: window.confirm / confirm(), FilterPills, <select> sebagai filter daftar di berkas bertabel yang memakai FilterBar', () => {
  const bad: string[] = []
  for (const f of SOURCES.filter(f => !KIT(f))) {
    const src = read(f)
    if (/window\.confirm|(?<![\w.])confirm\(/.test(src)) bad.push(`${f}: window.confirm — pakai ConfirmDialog`)
    if (/FilterPills/.test(src)) bad.push(`${f}: FilterPills sudah dipensiunkan — pakai FilterSelect`)
    if (/<FilterBar\b/.test(src) && /<select\b/.test(src) && /<DataTable|<CatalogList/.test(src) && !/ClientSelectAllowed/.test(src)) bad.push(`${f}: <select> polos di halaman berfilter — pakai FilterSelect`)
  }
  assert.deepEqual(bad, [])
})

t('SATU-SATUNYA <table>: DataTable bersama + pengecualian terdaftar', () => {
  const tables = SOURCES.filter(f => /<table\b|<thead\b/.test(read(f))).sort()
  assert.deepEqual(tables, [...Object.keys(RAW_TABLE_EXCEPTIONS), 'components/shared/data-table/DataTable.tsx'].sort())
})

t('API ADMIN (temuan otomatis): setiap route GET dengan `findMany` memakai paginasi/`take`, kecuali daftar bersarang/picker yang terdaftar — jumlahnya PERSIS (tanpa entri basi)', () => {
  const routes = walk('app/api/v1/admin').filter(f => f.endsWith('/route.ts'))
  const unbounded: string[] = []
  for (const f of routes) {
    const src = read(f)
    const m = /export async function GET\b[\s\S]*?(?=\nexport async function |$)/.exec(src)
    if (!m) continue
    const get = m[0]
    if (/findMany\(/.test(get) && !/paginate|readCatalogQuery|parseListParams|\btake:/.test(get)) unbounded.push(f)
  }
  assert.deepEqual(unbounded.sort(), Object.keys(UNBOUNDED_ADMIN_GET).sort(), 'route GET baru yang memuat semua baris — paginasi atau daftarkan beralasan')
})

t('HALAMAN SERVER (temuan otomatis): `findMany` pada halaman memakai paginasi/`take`, kecuali katalog kartu kurasi yang terdaftar — jumlahnya PERSIS', () => {
  const pages = SOURCES.filter(f => /\/page\.tsx$/.test(f) && f.startsWith('app/[locale]/'))
  const unbounded = pages.filter(f => { const s = read(f); return /findMany\(/.test(s) && !/take:|\.\.\.range|paginate\(/.test(s) }).sort()
  assert.deepEqual(unbounded, Object.keys(UNPAGINATED_PAGES).sort(), 'halaman baru memuat semua baris — paginasi atau daftarkan beralasan')
})

t('ATURAN TERTULIS: CLAUDE.md memuat bagian "Tabel & daftar" (kit bersama, filter dropdown, aksi ikon, paginasi, pengecualian beralasan) dan merujuk dokumen + tes ini', () => {
  const doc = read('CLAUDE.md')
  assert.match(doc, /Tabel & daftar \(docs\/arsitektur-tabel\.md\)/)
  for (const must of ['DataTable', 'FilterSelect', 'RowActions', 'Pagination', 'CatalogList', 'ConfirmDialog', 'scripts/test-table-consistency.ts', 'components/shared/data-table']) assert.ok(doc.includes(must), `CLAUDE.md belum menyebut ${must}`)
  assert.ok(existsSync(join(root, 'docs/arsitektur-tabel.md')))
  assert.ok(relative(root, join(root, 'scripts/test-table-consistency.ts')) === 'scripts/test-table-consistency.ts')
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
