// Penjaga homepage publik (docs/arsitektur-frontend-publik.md F3). Bukan daftar berkas yang dihafal: tes menemukan sendiri setiap berkas homepage dan rute yang ada.
// Merah bila: palet warna mentah/token admin/inline style, harga modal terbaca, tautan menuju rute yang tak ada, pesan id/en tak sama, atau metadata/`<html lang>` hilang.
//
// Tak membutuhkan database. Bagian pertama menguji pemeriksanya sendiri dengan contoh yang HARUS ditolak.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLIC_NAV } from '../components/shared/publicNav'
import { LINK_TARGETS, targetHref } from '../lib/public-content/links'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 14).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const HOME_DIR = 'app/[locale]/(public)/_home'
const filesIn = (dir: string, ext: string) => readdirSync(join(root, dir)).filter(f => f.endsWith(ext)).map(f => `${dir}/${f}`)
// Namespace kosakata bersama yang boleh dibaca halaman katalog lewat getTranslations (bukan teks halaman; tak bisa diedit di Konten Situs). Nama → alasan di komentar.
const SHARED_VOCAB_NAMESPACES = new Set([
  'checkout.components', // nama jenis komponen (visa plus di kartu Visa) — sama dengan checkout/keranjang
])
/** Katalog yang sudah memakai pola hero + daftar + CTA (§6). Katalog yang dirombak di F6 WAJIB ditambahkan di sini. */
const REDESIGNED_CATALOGS = ['packages', 'visa', 'haji', 'hotels', 'transport', 'muthowif', 'tours', 'flight', 'catering']
const SHARED_SOURCES = [...filesIn('components/shared/public', '.tsx'), ...filesIn('lib/public-content', '.ts')]
const CATALOG_PAGES = REDESIGNED_CATALOGS.map(c => `app/[locale]/(public)/${c}/page.tsx`)
// Komponen klien milik satu katalog ikut dipindai gaya dan modal.
const CATALOG_SOURCES = [...CATALOG_PAGES, 'components/shared/TransportSearch.tsx']
const HOME_SOURCES = [
  'app/[locale]/(public)/page.tsx',
  'lib/catalog/home.ts',
  ...filesIn(HOME_DIR, '.tsx'),
  ...SHARED_SOURCES,
  ...CATALOG_SOURCES,
]

// ── Pemeriksa ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const RAW_COLOR = new RegExp(`\\b[a-z-]*(?:${PALETTE})-(?:50|[1-9]00|950)\\b|#[0-9a-fA-F]{3,8}\\b|\\b(?:bg|text|border|ring|fill)-admin-|style=\\{`)
function styleProblems(src: string): string[] { return src.match(new RegExp(RAW_COLOR, 'g')) ?? [] }

// Kolom modal/margin price_points dan price_snapshots, serta pembaca khusus admin (engine/read.ts).
const COST = /\b(?:costIdr|autoSellIdr|manualSellIdr|marginPctUsed|roundingUsed|manualNote|unitCostIdr|totalCostIdr|recommendedTotalIdr|productCost|pricePoint|priceSnapshot|getPricePoints?|hpp)\b/i
function costProblems(src: string): string[] { return src.match(new RegExp(COST, 'gi')) ?? [] }

/** Tiap rute `app/[locale]/**` sebagai segmen tanpa grup rute: `(public)/hotels/[id]/page.tsx` → ["hotels", "[id]"]. */
function discoverRoutes(): string[][] {
  const out: string[][] = []
  const walk = (dir: string, segs: string[]) => {
    for (const f of readdirSync(join(root, dir))) {
      const p = join(dir, f)
      if (statSync(join(root, p)).isDirectory()) {
        if (f.startsWith('_')) continue
        walk(p, /^\(.*\)$/.test(f) ? segs : [...segs, f])
      } else if (f === 'page.tsx') out.push(segs)
    }
  }
  walk('app/[locale]', [])
  return out
}

/** `/${locale}/hotels/${h.id}?x=1` → ["hotels", "*"]; `*` hanya cocok dengan segmen dinamis, atau segmen apa pun bila itu `${path}` dari menu (diuji terpisah). */
function linkSegments(tpl: string): string[] {
  return tpl.replace(/^\/\$\{locale\}\/?/, '').split(/[?#]/)[0]!.split('/').filter(Boolean).map(s => (s.includes('${') ? '*' : s))
}
function routeExists(segs: string[], routes: string[][]): boolean {
  return routes.some(r => r.length === segs.length && r.every((seg, i) => {
    const dynamic = seg.startsWith('[')
    return segs[i] === '*' ? dynamic : dynamic || seg === segs[i]
  }))
}

/** Tiap tautan: templat `/${locale}/…` di mana pun, dan `href` selain templat/variabel (teks tetap atau alamat luar). */
function homeLinks(src: string): { internal: string[]; bad: string[] } {
  const internal = [...src.matchAll(/`(\/\$\{locale\}[^`]*)`/g)].map(m => m[1]!)
  const bad = [...src.matchAll(/href=(?:"([^"]*)"|\{\s*(['"][^'"]*['"])\s*\})|`(https?:\/\/[^`]*)`/g)].map(m => m[1] ?? m[2] ?? m[3]!)
  return { internal, bad }
}

function keyPaths(o: unknown, prefix = ''): string[] {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return [prefix]
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
}

// ── Pemeriksa harus menolak contoh buruk ────────────────────────────────────────────────────────────────────────────────────────────────

t('pemeriksa warna menolak palet mentah, hex, token admin, inline style', () => {
  for (const bad of ['className="text-blue-600"', 'fill-amber-400', 'hover:bg-green-50', 'bg-[#04543e]', 'text-admin-muted', 'style={{ color: "x" }}']) {
    assert.ok(styleProblems(bad).length > 0, bad)
  }
  for (const ok of ['text-brand', 'fill-brand-gold', 'bg-brand-light', 'border-primary', 'text-muted-foreground']) assert.deepEqual(styleProblems(ok), [], ok)
})

t('pemeriksa modal menolak kolom modal dan pembaca admin', () => {
  for (const bad of ['p.costIdr', 'select: { unitCostIdr: true }', 'getPricePoints(ids)', 'prisma.pricePoint.findMany', 'hpp']) assert.ok(costProblems(bad).length > 0, bad)
  for (const ok of ['sellPrices', 'visaPriceSummary', 'priceLabel', 'pricePerDay']) assert.deepEqual(costProblems(ok), [], ok)
})

t('pemeriksa rute menolak tautan yang tak ada', () => {
  const routes = [['hotels'], ['hotels', '[id]'], ['checkout', '[kind]'], []]
  assert.ok(routeExists(linkSegments('/${locale}'), routes))
  assert.ok(routeExists(linkSegments('/${locale}/hotels/${h.id}'), routes))
  assert.ok(routeExists(linkSegments('/${locale}/checkout/visa?id=${v.id}'), routes))
  assert.ok(!routeExists(linkSegments('/${locale}/hotel'), routes))
  assert.ok(!routeExists(linkSegments('/${locale}/hotels/${h.id}/kamar'), routes))
  assert.ok(!routeExists(linkSegments('/${locale}/${path}'), [['hotels']]), 'segmen variabel tak boleh cocok dengan rute tetap')
  assert.deepEqual(homeLinks('href="/id/visa"').bad, ['/id/visa'])
  assert.deepEqual(homeLinks("href={'/id/visa'}").bad, ["'/id/visa'"])
  assert.equal(homeLinks('const u = `https://contoh.test/a`').bad.length, 1)
})

// ── Homepage ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

t('pemeriksa tujuan tautan menolak alamat di luar daftar putih', () => {
  for (const bad of ['https://contoh.test', '//contoh.test', 'admin', '../admin', 'javascript:alert(1)']) assert.throws(() => targetHref('id', bad), bad)
  assert.equal(targetHref('id', ''), '/id')
  assert.equal(targetHref('en', 'packages'), '/en/packages')
  assert.equal(targetHref('id', '#catalog'), '#catalog')
})

t('penemu berkas menemukan bagian homepage', () => {
  assert.ok(HOME_SOURCES.length >= 10, `hanya ${HOME_SOURCES.length} berkas`)
  assert.ok(SHARED_SOURCES.some(f => f.endsWith('PageHero.tsx')) && SHARED_SOURCES.some(f => f.endsWith('PageCta.tsx')))
  assert.ok(discoverRoutes().length > 10)
})

t('homepage tanpa palet mentah, token admin, inline style', () => {
  const problems = HOME_SOURCES.flatMap(f => styleProblems(read(f)).map(m => `${f}: ${m}`))
  assert.deepEqual(problems, [])
})

t('homepage tidak menyentuh modal; harga hanya lewat engine/read.ts', () => {
  const problems = HOME_SOURCES.flatMap(f => costProblems(read(f)).map(m => `${f}: ${m}`))
  assert.deepEqual(problems, [])
  const data = read('lib/catalog/home.ts')
  assert.match(data, /from '@\/lib\/pricing\/engine\/read'/)
  const imported = data.match(/import \{([^}]*)\} from '@\/lib\/pricing\/engine\/read'/)?.[1]?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  assert.deepEqual(imported.filter(n => !['getMuthowifServicePrice', 'sellPrices', 'visaPriceSummary'].includes(n)), [])
  assert.doesNotMatch(data, /from '@\/lib\/pricing\/(?!engine\/read')/)
})

t('tiap tautan homepage menuju rute yang ada', () => {
  const routes = discoverRoutes()
  const missing: string[] = []
  const bad: string[] = []
  for (const f of HOME_SOURCES) {
    const links = homeLinks(read(f))
    bad.push(...links.bad.map(b => `${f}: ${b}`))
    for (const tpl of links.internal) {
      if (tpl === '/${locale}/${path}') continue // dari PUBLIC_NAV, diuji di bawah
      if (!routeExists(linkSegments(tpl), routes)) missing.push(`${f}: ${tpl}`)
    }
  }
  for (const { path } of PUBLIC_NAV) if (!routeExists([path], routes)) missing.push(`PUBLIC_NAV: ${path}`)
  assert.deepEqual(missing, [])
  assert.deepEqual(bad, [], 'tautan homepage harus memakai locale; alamat luar belum ada')
})

t('tombol ajukan visa hanya untuk yang bisa dibeli langsung', () => {
  const src = read(`${HOME_DIR}/HomeVisa.tsx`)
  assert.match(src, /canBuyDirectly/)
  assert.ok(src.indexOf('canBuyDirectly') < src.indexOf("checkoutPath(locale, 'visa'"), 'checkout harus berada di dalam syarat canBuyDirectly')
})

t('pesan home dan catalog id dan en memiliki kunci yang sama', () => {
  for (const ns of ['home', 'catalog']) {
    const id = keyPaths(JSON.parse(read('i18n/messages/id.json'))[ns])
    const en = keyPaths(JSON.parse(read('i18n/messages/en.json'))[ns])
    assert.deepEqual([...id].sort(), [...en].sort(), ns)
  }
  const home = keyPaths(JSON.parse(read('i18n/messages/id.json')).home)
  assert.ok(home.includes('meta.title') && home.includes('meta.description'))
})

t('tiap tujuan tautan daftar putih menuju rute yang ada', () => {
  const routes = discoverRoutes()
  const missing = LINK_TARGETS.filter(x => !x.startsWith('#') && !routeExists(x ? x.split('/') : [], routes))
  assert.deepEqual(missing, [])
})

t('beranda dan katalog memakai hero dan CTA bersama, bukan buatan sendiri', () => {
  const content = read('lib/public-content/pages.ts')
  for (const f of ['app/[locale]/(public)/page.tsx', ...CATALOG_PAGES]) {
    const src = read(f)
    for (const part of ['<PageHero', '<PageCta', 'getPageContent(locale,']) assert.ok(src.includes(part), `${f}: ${part}`)
  }
  for (const c of REDESIGNED_CATALOGS) {
    const src = read(`app/[locale]/(public)/${c}/page.tsx`)
    assert.ok(new RegExp(`\\b${c}: \\{`).test(content), `${c}: belum terdaftar di lib/public-content/pages.ts`)
    assert.ok(src.includes('generateMetadata') && src.includes(`catalogMetadata((await params).locale, '${c}')`), `${c}: metadata harus lewat catalogMetadata`)
    for (const part of ['<PageHero', '<PageCta', '<CatalogSection', `getPageContent(locale, '${c}')`]) assert.ok(src.includes(part), `${c}: ${part}`)
    // Teks HALAMAN hanya lewat getPageText/getPageContent (bisa diedit superadmin). getTranslations hanya boleh untuk kosakata BERSAMA yang
    // terdaftar (bukan teks halaman, mis. nama jenis komponen visa plus — I5), dan selalu dengan namespace literal.
    const calls = [...src.matchAll(/getTranslations\(([^\n]*)/g)].map(m => m[1] ?? '')
    for (const args of calls) {
      const ns = /namespace:\s*'([^']+)'/.exec(args)?.[1]
      assert.ok(ns && SHARED_VOCAB_NAMESPACES.has(ns), `${c}: teks halaman hanya lewat getPageText/getPageContent (getTranslations namespace "${ns ?? '?'}" bukan kosakata bersama)`)
    }
  }
  // Metadata katalog dari satu pembantu: judul/deskripsi suntingan, hreflang, Open Graph.
  const meta = read('lib/public-content/metadata.ts')
  for (const part of ["getPageText(locale, page, 'meta')", 'localizedAlternates(locale, path)', 'openGraph']) assert.ok(meta.includes(part), `metadata.ts: ${part}`)
  // Tujuan #catalog: CatalogSection memasang jangkarnya.
  assert.match(read('components/shared/public/CatalogSection.tsx'), /id=\{CATALOG_ANCHOR\}/)
  // Hanya komponen bersama yang boleh merakit permukaan hero/CTA.
  const others = [...filesIn(HOME_DIR, '.tsx'), ...CATALOG_SOURCES].filter(f => /panel-brand|<BrandPattern/.test(read(f)))
  assert.deepEqual(others, [])
})

t('homepage punya metadata, Open Graph, dan hreflang dari satu sumber', () => {
  const page = read('app/[locale]/(public)/page.tsx')
  for (const part of ['generateMetadata', 'openGraph', 'alternates', 'localizedAlternates']) assert.ok(page.includes(part), part)
  assert.match(read('app/layout.tsx'), /metadataBase: new URL\(siteOrigin\(\)\)/)
})

t('<html lang> mengikuti locale, bukan teks tetap', () => {
  const layout = read('app/layout.tsx')
  assert.match(layout, /<html lang=\{locale\}/)
  assert.match(layout, /await getLocale\(\)/)
  const notFound = read('app/not-found.tsx')
  assert.match(notFound, /getTranslations/, '404 harus mengikuti bahasa yang sama dengan lang')
  assert.doesNotMatch(notFound, /href="\/id"/)
})

t('robots dan sitemap memakai satu sumber alamat dan locale', () => {
  for (const f of ['app/robots.ts', 'app/sitemap.ts']) {
    const src = read(f)
    assert.match(src, /siteOrigin\(\)/, f)
    assert.doesNotMatch(src, /NEXT_PUBLIC_APP_URL/, f)
  }
  assert.doesNotMatch(read('app/sitemap.ts'), /\['id', 'en'\]/)
  assert.ok(existsSync(join(root, 'lib/seo/site.ts')))
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua lolos')
