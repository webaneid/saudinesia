// Penjaga bahasa front-end (docs/arsitektur-i18n-frontend.md §3.6): MENEMUKAN SENDIRI pelanggaran di app/, components/, lib/ — tanpa database.
//  1. Setiap kunci pesan ada di SEMUA locale (`routing.locales`), dengan argumen ICU yang sama (teks dwibahasa tak boleh kehilangan `{nama}`).
//  2. Setiap namespace + kunci literal yang dipakai kode (`useTranslations`/`getTranslations` → `t('…')`) ada di berkas pesan.
//  3. Berkas di area yang SUDAH dimigrasi (`MIGRATED_AREAS`, bertambah per fase I2–I5) tak memuat teks tampilan langsung di JSX.
//  4. Pengalih bahasa membangun alamat HANYA lewat `switchLocalePath`, dan fungsi itu tak pernah menghasilkan alamat luar.
// Teks halaman katalog (`getPageText`/`getPageContent`) dijaga `scripts/test-site-content.ts`, bukan di sini.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { routing } from '@/i18n/routing'
import { switchLocalePath } from '@/lib/i18n/switch'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { REVIEW_LABEL } from '@/lib/pilgrims/reviewState'
import { WARNING_TEXT } from '@/components/shared/pilgrims/warningText'
import { ACTION_LABELS } from '@/components/shared/data-table/RowActions'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 16).join('\n     ')}`)
  }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`
    if (statSync(join(root, rel)).isDirectory()) { if (e !== 'node_modules' && !e.startsWith('.next')) walk(rel, out) } else if (/\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const FILES = ['app', 'components', 'lib'].flatMap(d => walk(d))

type Tree = { [k: string]: string | Tree }
const MESSAGES = Object.fromEntries(routing.locales.map(l => [l, JSON.parse(read(`i18n/messages/${l}.json`)) as Tree]))
function leaves(tree: Tree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v); else leaves(v, key, out)
  }
  return out
}
const nodeAt = (tree: Tree, path: string): string | Tree | undefined =>
  path.split('.').reduce<string | Tree | undefined>((n, seg) => (n && typeof n === 'object' ? n[seg] : undefined), tree)
/** Nama tag rich text (`<strong>…</strong>`, `<link>…</link>`) — harus sama di semua locale supaya `t.rich` tak kehilangan pembungkus. */
const richTags = (msg: string): string[] => [...new Set([...msg.matchAll(/<([A-Za-z][\w]*)>/g)].map(m => m[1]!))].sort()
/** Nama argumen ICU tingkat atas (`{name}`, `{count, plural, …}`), tanpa isi cabang plural/select. */
function icuArgs(msg: string): string[] {
  const out = new Set<string>()
  let depth = 0
  for (let i = 0; i < msg.length; i++) {
    const c = msg[i]
    if (c === "'") { const end = msg.indexOf("'", i + 1); if (end > i + 1) { i = end; continue } }
    if (c === '{') {
      if (depth % 2 === 0) { const m = /^\{\s*([A-Za-z_][\w]*)/.exec(msg.slice(i)); if (m) out.add(m[1]!) }
      depth++
    } else if (c === '}') depth--
  }
  return [...out].sort()
}

// ── 1. kunci & argumen ICU sama di semua locale ─────────────────────────────────────────────────────────────────────
t('setiap kunci pesan ada di semua locale dengan argumen ICU yang sama', () => {
  const [base, ...rest] = routing.locales
  const ref = leaves(MESSAGES[base]!)
  const problems: string[] = []
  for (const l of rest) {
    const other = leaves(MESSAGES[l]!)
    for (const k of ref.keys()) if (!other.has(k)) problems.push(`${l}: kunci hilang ${k}`)
    for (const k of other.keys()) if (!ref.has(k)) problems.push(`${base}: kunci hilang ${k} (ada di ${l})`)
    for (const [k, v] of ref) {
      const w = other.get(k)
      if (w !== undefined && icuArgs(v).join() !== icuArgs(w).join()) problems.push(`${k}: argumen ${base}=[${icuArgs(v)}] ${l}=[${icuArgs(w)}]`)
      if (w !== undefined && richTags(v).join() !== richTags(w).join()) problems.push(`${k}: tag ${base}=[${richTags(v)}] ${l}=[${richTags(w)}]`)
      if (w !== undefined && (v.trim() === '' || w.trim() === '')) problems.push(`${k}: teks kosong`)
    }
  }
  assert.deepEqual(problems, [])
})

t('pemeriksa argumen ICU sendiri bekerja (kasus kontrol)', () => {
  assert.deepEqual(icuArgs('Halo {name}, {count, plural, one {# hari} other {# hari}}'), ['count', 'name'])
  assert.deepEqual(icuArgs("Kurung '{literal}' bukan argumen {x}"), ['x'])
  assert.deepEqual(richTags('Jika <strong>{email}</strong> lalu <link>x</link>'), ['link', 'strong'])
})

// ── 2. namespace & kunci yang dipakai kode ada ──────────────────────────────────────────────────────────────────────
type Use = { file: string; ns: string; key: string | null }
function translationUses(): Use[] {
  const out: Use[] = []
  for (const f of FILES.filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))) {
    const src = code(read(f))
    const vars = new Map<string, string>()
    const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']+)'|\{[^}]*?namespace:\s*'([^']+)'[^}]*\})\s*\)/g
    for (const m of src.matchAll(decl)) { const ns = m[2] ?? m[3]!; vars.set(m[1]!, ns); out.push({ file: f, ns, key: null }) }
    for (const [v, ns] of vars) {
      const call = new RegExp(`\\b${v}(?:\\.(?:rich|markup|raw|has))?\\(\\s*'([^']+)'`, 'g')
      for (const m of src.matchAll(call)) out.push({ file: f, ns, key: m[1]! })
    }
  }
  return out
}

t('setiap namespace dan kunci literal yang dipakai kode ada di semua locale', () => {
  const uses = translationUses()
  assert.ok(uses.some(u => u.ns === 'nav' && u.key === 'language'), 'penemu pemakaian tak menemukan pengalih (nav.language) — pola penemu rusak')
  const problems: string[] = []
  for (const l of routing.locales) for (const u of uses) {
    const path = u.key ? `${u.ns}.${u.key}` : u.ns
    if (nodeAt(MESSAGES[l]!, path) === undefined) problems.push(`${l}: ${path} tidak ada (${u.file})`)
  }
  assert.deepEqual([...new Set(problems)], [])
})

t('kunci pesan yang dipilih lewat peta (bukan literal) ada di semua locale: galat Google di halaman masuk, petunjuk password', () => {
  const login = read('app/[locale]/(auth)/login/page.tsx')
  const map = login.slice(login.indexOf('const GOOGLE_ERRORS'), login.indexOf('} as const'))
  const keys = [...map.matchAll(/:\s*'([^']+)'/g)].map(m => `authPages.login.errors.${m[1]}`)
  assert.ok(keys.length >= 9, 'peta galat Google tak terbaca')
  const hints = read('app/[locale]/(auth)/PasswordHints.tsx')
  keys.push(...[...hints.matchAll(/key: '([^']+)'/g)].map(m => `authPages.passwordHints.${m[1]}`))
  const problems = routing.locales.flatMap(l => keys.filter(k => typeof nodeAt(MESSAGES[l]!, k) !== 'string').map(k => `${l}: ${k}`))
  assert.deepEqual(problems, [])
})

// Checkout & keranjang (I3): kunci dirangkai dari NILAI (alasan blokir, penolakan keranjang, ringkasan entri, jenis, komponen…). Daftar nilainya dibaca dari
// SUMBER (union tipe / konstanta), bukan dihafal di sini — nilai baru tanpa pesan = merah.
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]!)
/** Anggota union string `type Nama = 'a' | 'b'` atau literal `key: 'a' | 'b'` di dalam deklarasi tipe. */
function unionOf(file: string, decl: RegExp): string[] {
  const m = decl.exec(code(read(file)))
  assert.ok(m?.[1], `${decl} tak ditemukan di ${file} — penjaga basi`)
  return quoted(m[1])
}
/** Isi `const NAMA = [...]`. */
const listOf = (file: string, name: string) => unionOf(file, new RegExp(`const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`))

t('kunci checkout/keranjang yang dirangkai dari nilai ada di semua locale (dibaca dari sumber nilainya)', () => {
  const D = 'app/[locale]/(public)/checkout/[kind]'
  const groups: Array<[string, string[]]> = [
    ['checkout.kinds', listOf('lib/checkout/kinds.ts', 'CHECKOUT_KINDS')],
    ['checkout.page.back', listOf('lib/checkout/kinds.ts', 'CHECKOUT_KINDS')],
    ['checkout.components', listOf('lib/validators/visa.ts', 'REQUIRED_COMPONENT_TYPES')],
    ['checkout.blocked', unionOf('lib/checkout/options.ts', /type BlockedReason\s*=([^\n]+)/)],
    ['checkout.package.includedItem', unionOf('lib/checkout/options.ts', /type IncludedItem\s*=\s*\{\s*key:([^;}]+)/)],
    ['checkout.cartRefusal', unionOf('lib/checkout/cartStore.ts', /type CartRefusal\s*=([^\n]+)/)],
    ['checkout.cartRefusal', listOf('lib/checkout/cartStore.ts', 'CART_REFUSALS')],
    ['checkout.entry', unionOf(`${D}/fields.ts`, /type EntrySummary\s*=\s*\{\s*key:([^;}]+)/)],
    ['checkout.days', unionOf(`${D}/fields.ts`, /type DaysMissing\s*=([^\n]+)/)],
    ['checkout.package.slot', listOf(`${D}/PackageFields.tsx`, 'SLOTS')],
    ['checkout.package.slotNone', listOf(`${D}/PackageFields.tsx`, 'SLOTS')],
    ['checkout.catering.season', listOf(`${D}/CateringFields.tsx`, 'SEASONS')],
    ['checkout.intro.menu', listOf(`${D}/ProductIntro.tsx`, 'MENU')],
    ['checkout.intro.board', listOf(`${D}/ProductIntro.tsx`, 'BOARD')],
    ['cart.catalogs', listOf('lib/catalog/availability.ts', 'CATALOG_KEYS')],
  ]
  const problems: string[] = []
  for (const [ns, values] of groups) {
    assert.ok(values.length > 0, `${ns}: daftar nilai kosong — penjaga basi`)
    for (const l of routing.locales) for (const v of values) if (typeof nodeAt(MESSAGES[l]!, `${ns}.${v}`) !== 'string') problems.push(`${l}: ${ns}.${v}`)
  }
  assert.deepEqual(problems, [])
  // Kasus kontrol: nilai yang tak punya pesan memang terdeteksi.
  assert.equal(nodeAt(MESSAGES.id!, 'checkout.blocked.tidakAda'), undefined)
})

t('checkout/keranjang tak menyimpan teks antarmuka di lib (alasan & isi = kunci, bukan kalimat Indonesia)', () => {
  // Setiap literal string/template di modul data checkout yang berisi kata antarmuka Indonesia = merah. Satu pengecualian beralasan: nama cadangan
  // layanan muthowif (halaman menimpanya dengan `checkout.common.muthowifService`).
  const ALLOWED = new Set(['Layanan Muthowif'])
  const WORDS = /\b(sudah|belum|tidak|tak|pilih|hubungi|penuh|habis|lewat|malam|hari|orang|kursi|keranjang|dipesan|maksimal|tiket|kendaraan)\b/i
  const literals = (file: string): string[] => {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const out: string[] = []
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text)
      else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map(x => x.literal.text))
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return out
  }
  const problems = ['lib/checkout/options.ts', 'lib/checkout/cartStore.ts']
    .flatMap(f => literals(f).filter(x => WORDS.test(x) && !ALLOWED.has(x)).map(x => `${f}: "${x}"`))
  assert.deepEqual(problems, [])
  assert.ok(WORDS.test('Periode jadwal tiket ini sudah lewat.'), 'kasus kontrol')
})

/** Anggota `enum Nama { … }` di skema Prisma. */
function prismaEnum(name: string): string[] {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(read('prisma/schema.prisma'))
  assert.ok(m?.[1], `enum ${name} tak ditemukan — penjaga basi`)
  return m[1].split('\n').map(l => l.trim()).filter(l => /^[a-z_]+$/.test(l))
}

t('area jamaah (I4): kunci yang dirangkai dari nilai ada di semua locale (dibaca dari sumber nilainya)', () => {
  const B = 'app/[locale]/(pilgrim)/bookings/[id]'
  const groups: Array<[string, string[]]> = [
    ['shared.bookingStatus', unionOf('lib/booking/lifecycle.ts', /type DisplayStatus\s*=([^\n]+)/)],
    ['shared.review', prismaEnum('PilgrimReviewStatus')],
    ['pilgrimArea.trip.hint', prismaEnum('PilgrimReviewStatus')],
    ['shared.documents.status', prismaEnum('DocumentReviewStatus')],
    ['shared.documents.reject', prismaEnum('DocumentRejectReason')],
    ['shared.pilgrims.warning', Object.keys(WARNING_TEXT)],
    ['shared.table.action', unionOf('components/shared/data-table/RowActions.tsx', /type ActionKind\s*=([^\n]+)/)],
    ['pilgrimArea.booking.seasons', listOf(`${B}/page.tsx`, 'SEASONS')],
    ['pilgrimArea.summary.formula', unionOf(`${B}/OrderSummaryCard.tsx`, /type SummaryUnit\s*=([^\n]+)/)],
    // Status dokumen di popup ringkasan jamaah (PilgrimSlotsTable): empat keadaan yang dirangkai di satu ekspresi berkas itu.
    ['shared.pilgrims.slots.docState', quoted(/t\(`docState\.\$\{([^`]+)\}`\)/.exec(code(read('components/shared/pilgrims/PilgrimSlotsTable.tsx')))?.[1] ?? '')],
  ]
  const problems: string[] = []
  for (const [ns, values] of groups) {
    assert.ok(values.length > 0, `${ns}: daftar nilai kosong — penjaga basi`)
    for (const l of routing.locales) for (const v of values) if (typeof nodeAt(MESSAGES[l]!, `${ns}.${v}`) !== 'string') problems.push(`${l}: ${ns}.${v}`)
  }
  assert.deepEqual(problems, [])
})

t('area jamaah (I4): teks Indonesia di pesan = teks peta lib yang masih dipakai admin (satu kalimat, tak bercabang)', () => {
  const pairs: Array<[string, Record<string, string>]> = [
    ['shared.bookingStatus', Object.fromEntries(Object.entries(BOOKING_STATUS).map(([k, v]) => [k, v.label]))],
    ['shared.review', REVIEW_LABEL],
    ['shared.pilgrims.warning', WARNING_TEXT],
    ['shared.table.action', ACTION_LABELS],
  ]
  const problems = pairs.flatMap(([ns, map]) => Object.entries(map).filter(([k, v]) => nodeAt(MESSAGES.id!, `${ns}.${k}`) !== v).map(([k, v]) => `${ns}.${k}: pesan "${String(nodeAt(MESSAGES.id!, `${ns}.${k}`))}" ≠ lib "${v}"`))
  assert.deepEqual(problems, [])
})

// ── 3. area yang sudah dimigrasi tanpa teks JSX langsung ────────────────────────────────────────────────────────────
// Bertambah per fase (I2 auth, I3 checkout, I4 jamaah, I5 komponen bersama). Awalan path; berkas `.tsx` di bawahnya diperiksa.
const MIGRATED_AREAS = [
  'components/shared/Header.tsx',
  'components/shared/PublicMobileNav.tsx',
  'components/shared/PublicFooter.tsx',
  'components/shared/LocaleSwitcher.tsx',
  // I2 (2026-11-11): halaman auth + komponen bersama yang tampil di alur daftar/masuk.
  'app/[locale]/(auth)',
  'components/shared/ContactPicker.tsx',
  'components/shared/CountryCodeSelect.tsx',
  'components/shared/AutocompleteSelect.tsx',
  'components/shared/GoogleButton.tsx',
  // I3 (2026-11-11): checkout semua jenis + keranjang + ikon keranjang di header.
  'app/[locale]/(public)/checkout',
  'app/[locale]/(public)/keranjang',
  'components/shared/CartButton.tsx',
  // I4 (2026-11-11): area jamaah + komponen bersama yang tampil di sana (kit tabel, Modal, AddressPicker dimajukan dari I5).
  'app/[locale]/(pilgrim)',
  'components/shared/pilgrims',
  'components/shared/documents',
  'components/shared/data-table',
  'components/shared/Modal.tsx',
  'components/shared/AddressPicker.tsx',
  'components/shared/WhatsappVerifyCard.tsx',
  'components/booking/ManifestFieldsForm.tsx',
]
// Teks yang memang sama di semua bahasa (nama merek, kode). Berkas → teks → alasan.
const ALLOWED_TEXT: Record<string, Record<string, string>> = {
  'components/shared/Header.tsx': { Saudinesia: 'nama merek', S: 'monogram logo' },
  'components/shared/PublicFooter.tsx': { Saudinesia: 'nama merek', '©': 'simbol hak cipta', 'Saudinesia.': 'nama merek + titik sebelum teks pesan hak cipta' },
  'components/shared/ContactPicker.tsx': { '8xx xxxx xxxx': 'contoh format nomor, sama di semua bahasa', 'email@example.com': 'contoh format email, sama di semua bahasa' },
  'components/booking/ManifestFieldsForm.tsx': { '8xx xxxx xxxx': 'contoh format nomor, sama di semua bahasa', 'email@example.com': 'contoh format email, sama di semua bahasa' },
  'components/shared/AddressPicker.tsx': { 'https://maps.app.goo.gl/…': 'contoh format tautan, sama di semua bahasa' },
  'components/shared/WhatsappVerifyCard.tsx': { VERIF: 'kata kunci yang dikirim pengguna dan dibaca webhook — harus persis sama di semua bahasa' },
}
// Pemindai berbasis parser TypeScript (bukan regex): setiap node `JsxText` berisi huruf, dan atribut teks literal yang tampil ke pengguna.
const TEXT_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt', 'label'])
function hardcodedText(file: string): string[] {
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const allowed = ALLOWED_TEXT[file] ?? {}
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf).replace(/\s+/g, ' ').trim()
      if (/\p{L}/u.test(text) && !(text in allowed)) out.push(`>${text}<`)
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf)
      const value = node.initializer.text
      if (TEXT_ATTRS.has(name) && /\p{L}/u.test(value) && !(value in allowed)) out.push(`${name}="${value}"`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

t('area yang sudah dimigrasi tak memuat teks tampilan langsung (hanya lewat pesan)', () => {
  const files = FILES.filter(f => f.endsWith('.tsx') && MIGRATED_AREAS.some(a => f === a || f.startsWith(`${a}/`)))
  assert.ok(files.length >= MIGRATED_AREAS.length, 'berkas area termigrasi tak ditemukan — path MIGRATED_AREAS basi')
  const problems = files.flatMap(f => hardcodedText(f).map(p => `${f}: ${p}`))
  assert.deepEqual(problems, [])
})

// ── 4. pengalih bahasa ──────────────────────────────────────────────────────────────────────────────────────────────
t('pengalih membangun alamat HANYA lewat switchLocalePath (tanpa template alamat sendiri)', () => {
  const src = code(read('components/shared/LocaleSwitcher.tsx'))
  assert.match(src, /href=\{switchLocalePath\(/)
  assert.ok(!/href=\{`/.test(src) && !/href="\//.test(src), 'href dirangkai sendiri')
  assert.ok(!/next\/link/.test(src), 'pengalih memakai <a> (muat ulang penuh) — <Link> tak merender ulang <html lang>')
  for (const f of ['components/shared/Header.tsx', 'components/shared/PublicMobileNav.tsx', 'components/shared/PublicFooter.tsx', 'app/[locale]/(auth)/layout.tsx'])
    assert.match(read(f), /<LocaleSwitcher\b/, `${f} tidak memasang pengalih`)
})

t('switchLocalePath: halaman sama di locale lain, path + query dipertahankan', () => {
  assert.equal(switchLocalePath('/id/hotels/abc', '?page=2&q=x', 'en'), '/en/hotels/abc?page=2&q=x')
  assert.equal(switchLocalePath('/en/hotels', '', 'id'), '/id/hotels')
  assert.equal(switchLocalePath('/id', '', 'en'), '/en')
  assert.equal(switchLocalePath('/', '', 'en'), '/en')
  assert.equal(switchLocalePath('/EN/visa', 'a=1', 'id'), '/id/visa?a=1')
  assert.equal(switchLocalePath('/hotels', '', 'en'), '/en/hotels', 'tanpa awalan locale')
  // Jalur kembali sesudah masuk ikut pindah bahasa; selain awalan locale relatif, tak disentuh.
  assert.equal(switchLocalePath('/en/login', '?next=%2Fen%2Fcheckout%2Fvisa%3Fid%3D1', 'id'), '/id/login?next=%2Fid%2Fcheckout%2Fvisa%3Fid%3D1')
  assert.equal(switchLocalePath('/id/login', 'next=/id', 'en'), '/en/login?next=%2Fen')
  assert.equal(switchLocalePath('/id/login', 'next=%2F%2Fevil.com', 'en'), '/en/login?next=%2F%2Fevil.com', 'bukan locale → dibiarkan (server menolak)')
  assert.equal(switchLocalePath('/id/login', 'next=%2Fidx%2Fa', 'en'), '/en/login?next=%2Fidx%2Fa', 'awalan mirip locale bukan locale')
  assert.equal(switchLocalePath('/id/x', 'a=1&b=2', 'en'), '/en/x?a=1&b=2', 'tanpa next: query tak diserialisasi ulang')
})

t('switchLocalePath: masukan jahat tak pernah menghasilkan alamat luar atau scheme-relative', () => {
  const evil = ['//evil.com', '/id//evil.com/x', '\\\\evil.com', '/id/\\evil.com', 'https://evil.com/a', '/id/http://evil.com', '/id/%2F%2Fevil.com', '/id/x?y=//evil.com#//z', '']
  for (const to of routing.locales) for (const p of evil) for (const q of ['', '?next=//evil.com', '#frag']) {
    const out = switchLocalePath(p, q, to)
    assert.ok(out === `/${to}` || out.startsWith(`/${to}/`) || out.startsWith(`/${to}?`), `${p} → ${out}`)
    const pathPart = out.split('?')[0]!
    assert.ok(!pathPart.includes('//') && !pathPart.includes('\\') && !pathPart.includes('#'), `${p} → ${out}`)
  }
})

t('halaman bertoken (aktivasi, atur ulang password) tetap no-referrer setelah metadata dibuat per bahasa — pengalih membawa token di query', () => {
  for (const f of ['app/[locale]/(auth)/register/complete/page.tsx', 'app/[locale]/(auth)/reset-password/page.tsx'])
    assert.match(read(f), /authMetadata\(params, '\w+', \{ referrer: 'no-referrer' \}\)/, f)
})

// ── 5. routing (K1/K2) — properti kunci juga dijaga scripts/test-i18n-routing.ts ─────────────────────────────────────
t('bawaan selalu Indonesia, pilihan bahasa lewat URL saja (tanpa deteksi browser/cookie)', () => {
  assert.equal(routing.defaultLocale, 'id')
  assert.equal(routing.localeDetection, false)
  assert.equal(routing.localeCookie, false)
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
