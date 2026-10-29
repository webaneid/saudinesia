// Combobox seragam (docs/arsitektur-combobox.md): aturan cari/urut (tabel nilai dihitung tangan), render nyata daftar kode negara, dan penjaga sumber
// (latar daftar padat — token `popover` TIDAK ada di Tailwind; satu definisi kode negara; semua formulir lewat komponen bersama). Tanpa database.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { matchOptions, normalizeSearch, type ComboOption } from '@/lib/ui/combobox'
import { COUNTRY_OPTIONS } from '@/lib/ui/countryOptions'
import { COUNTRIES } from '@/lib/constants/countries'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync } from 'node:fs'
import { Flag } from '@/components/shared/Flag'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 10).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`
    if (statSync(join(root, rel)).isDirectory()) { if (e !== 'node_modules' && e !== '.next') walk(rel, out) } else if (/\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}

const opt = (id: string, label: string, extra: Partial<ComboOption> = {}): ComboOption => ({ id, label, ...extra })

t('normalizeSearch: huruf kecil, tanpa diakritik, "+" di depan dibuang, spasi pinggir dipangkas', () => {
  assert.equal(normalizeSearch('  +966 '), '966')
  assert.equal(normalizeSearch('++62'), '62')
  assert.equal(normalizeSearch('Café'), 'cafe')
  assert.equal(normalizeSearch('ARAB Saudi'), 'arab saudi')
  assert.equal(normalizeSearch(''), '')
})

t('matchOptions (tabel nilai): kosong = semua urutan asal; diawali > awal kata > kode panggilan > di mana saja; tak cocok dibuang; urutan asal stabil di tiap tingkat', () => {
  const list: ComboOption[] = [opt('a', 'Jawa Barat'), opt('b', 'Jawa Tengah'), opt('c', 'Kabupaten Jawa Timur'), opt('d', 'Banjarmasin'), opt('e', 'Bali')]
  const ids = (q: string) => matchOptions(list, q).map(o => o.id)
  assert.deepEqual(ids(''), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(ids('   '), ['a', 'b', 'c', 'd', 'e'], 'hanya spasi = semua')
  assert.deepEqual(ids('jawa'), ['a', 'b', 'c'], 'diawali (a,b) lebih dulu, lalu awal kata (c)')
  assert.deepEqual(ids('ba'), ['d', 'e', 'a'], 'diawali (Banjarmasin, Bali) sebelum awal kata (Jawa Barat); Tengah/Timur tak cocok')
  assert.deepEqual(ids('jarma'), ['d'], 'di tengah kata')
  assert.deepEqual(ids('xyz'), [])
  assert.deepEqual(ids('JAWA  '), ['a', 'b', 'c'], 'tak peka huruf, spasi pinggir diabaikan')
})

t('matchOptions: kode panggilan ("+966", "966", "96") dan kode ISO ikut dicari; tanda "+" tak mengubah hasil; kode bendera (`flag`) TIDAK dicari', () => {
  const list: ComboOption[] = [
    opt('SA', 'Arab Saudi', { hint: '+966', keywords: 'SA', flag: 'SA' }),
    opt('IQ', 'Irak', { hint: '+964', keywords: 'IQ', flag: 'IQ' }),
    opt('US', 'Amerika Serikat', { hint: '+1', keywords: 'US', flag: 'US' }),
    opt('ID', 'Indonesia', { hint: '+62', keywords: 'ID', flag: 'ID' }),
  ]
  const ids = (q: string) => matchOptions(list, q).map(o => o.id)
  assert.deepEqual(ids('+966'), ['SA'])
  assert.deepEqual(ids('966'), ['SA'])
  assert.deepEqual(ids('+96'), ['SA', 'IQ'], 'urutan asal untuk skor sama')
  assert.deepEqual(ids('us'), ['US'], 'kode ISO')
  assert.deepEqual(ids('id'), ['ID'], 'kode ISO "ID" (tanpa "Indonesia" yang diawali "in")')
  assert.deepEqual(matchOptions([opt('X', 'Nama', { flag: 'ZZ' })], 'zz'), [], 'kode bendera tidak dicari kecuali ada di keywords')
  assert.deepEqual(ids('arab'), ['SA'])
})

t('daftar negara nyata: semua negara punya bendera + kode ISO; "Indonesia" dicari lewat "indo", "62" menemukan Indonesia, "saudi" menemukan Arab Saudi', () => {
  assert.equal(COUNTRY_OPTIONS.length, COUNTRIES.length)
  assert.ok(COUNTRY_OPTIONS.every(o => o.flag === o.id && o.keywords === o.id), 'tiap opsi: kode bendera + kunci ISO')
  assert.equal(matchOptions(COUNTRY_OPTIONS, 'indo')[0]?.id, 'ID')
  assert.equal(matchOptions(COUNTRY_OPTIONS, 'saudi')[0]?.id, 'SA')
  const withDial: ComboOption[] = COUNTRIES.map(c => ({ id: c.code, label: c.name, hint: `+${c.dialCode}`, keywords: c.code }))
  assert.equal(matchOptions(withDial, '+62')[0]?.id, 'ID', '"+62" menemukan Indonesia di urutan pertama')
  assert.equal(matchOptions(withDial, '966')[0]?.id, 'SA')
})

const comp = read('components/shared/AutocompleteSelect.tsx')
t('penjaga sumber komponen: latar daftar PADAT (bg-background), lewat portal, tanpa token `popover` yang tak ada di Tailwind, ARIA combobox/listbox, Esc/Tab/panah/Home/End, buka ke atas, rata kanan', () => {
  assert.match(comp, /fixed z-50[^']*bg-background[^']*shadow-xl/, 'panel berlatar padat, fixed di atas segalanya')
  assert.match(comp, /createPortal\([\s\S]*document\.body/, 'lewat portal: tak terpotong overflow-hidden induk')
  assert.match(comp, /inAdmin && 'brand-scope'/, 'warna merek admin ikut ke portal')
  assert.match(read('app/globals.css'), /\.admin-canvas,\s*\.brand-scope \{\s*--primary/, 'brand-scope membawa variabel merek')
  for (const f of walk('app').concat(walk('components'))) assert.doesNotMatch(read(f), /\b(bg|text|border|ring)-popover\b/, `${f}: kelas popover tak didefinisikan → latar transparan`)
  for (const needle of ['role="combobox"', 'role="listbox"', 'role="option"', 'aria-activedescendant', 'aria-selected', "e.key === 'Escape'", "e.key === 'Tab'", "e.key === 'Home'", "e.key === 'End'", 'scrollIntoView', 'createPortal', 'reposition', 'if (open && placed)', "'scroll'", 'window.innerHeight', 'matchOptions']) assert.ok(comp.includes(needle), needle)
  assert.doesNotMatch(comp, /\.toLowerCase\(\)\.includes/, 'pencarian hanya lewat matchOptions (satu aturan)')
})

t('satu definisi kode negara telepon: ContactPicker dan kolom telepon manifest memakai CountryCodeSelect; tak ada daftar opsi kode negara buatan sendiri; kode negara wajib ada (tak bisa dikosongkan)', () => {
  const cc = read('components/shared/CountryCodeSelect.tsx')
  assert.match(cc, /clearable=\{false\}/)
  assert.match(cc, /Number\(b\.code === 'ID'\) - Number\(a\.code === 'ID'\)/, 'Indonesia paling atas')
  for (const f of ['components/shared/ContactPicker.tsx', 'components/booking/ManifestFieldsForm.tsx']) {
    const src = read(f)
    assert.equal((src.match(/<CountryCodeSelect/g) ?? []).length, f.includes('Contact') ? 2 : 1, `${f}: tiap kolom telepon/WhatsApp memakai CountryCodeSelect`)
    assert.doesNotMatch(src, /COUNTRY_CODE_OPTIONS|isoToFlagEmoji|from '@\/lib\/constants\/countries'/, `${f}: tak boleh membuat opsi sendiri`)
  }
  assert.ok(!walk('components').concat(walk('app')).some(f => /COUNTRY_CODE_OPTIONS/.test(read(f))), 'tak ada sisa COUNTRY_CODE_OPTIONS')
  for (const f of ['components/shared/AddressPicker.tsx', 'components/admin/vendor/VendorForm.tsx']) assert.match(read(f), /from '@\/lib\/ui\/countryOptions'/, `${f}: opsi negara bersama`)
})

t('Fase 2+3: TIDAK ADA `<select>` polos di app/ maupun components/ (selain implementasi combobox itu sendiri) — daftar data dan enum pendek sama-sama lewat ChoiceSelect/CurrencySelect', () => {
  const bad: string[] = []
  for (const f of walk('app').concat(walk('components'))) {
    if (f === 'components/shared/AutocompleteSelect.tsx') continue
    if (/<select\b/.test(read(f).replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))) bad.push(f)
  }
  assert.deepEqual(bad, [], 'ganti dengan <ChoiceSelect> (components/shared/ChoiceSelect.tsx)')
  const mods = ['packages/[id]/page.tsx', 'tour-packages/[id]/page.tsx', 'transport/trips/[id]/page.tsx', 'flight/new/page.tsx', 'flight/[id]/page.tsx']
  for (const m of mods) assert.match(read(`app/[locale]/admin/(protected)/products/${m}`), /<ChoiceSelect/, m)
  for (const m of ['MuthowifAssignPanel', 'CostActualsPanel']) assert.match(read(`app/[locale]/admin/(protected)/bookings/[id]/${m}.tsx`), /<ChoiceSelect/, m)
  assert.match(read('components/shared/ChoiceSelect.tsx'), /value=\{value \|\| null\} onChange=\{id => onChange\(id \?\? ''\)\}/, 'adaptor string ↔ null')
})

t('Fase 3: kotak cari otomatis hanya untuk daftar > 7 pilihan atau onSearch; enum pendek memakai daftar berfokus keyboard; mata uang satu komponen; baris vendor+mata uang bertumpuk (tak menyempit)', () => {
  assert.match(comp, /searchable \?\? \(!!onSearch \|\| options\.length > 7\)/)
  assert.match(comp, /\(hasSearch \? inputRef : listRef\)\.current\?\.focus\(\)/, 'daftar tanpa kotak cari menerima fokus keyboard')
  assert.match(comp, /tabIndex=\{hasSearch \? undefined : -1\} onKeyDown=\{hasSearch \? undefined : onInputKey\}/)
  assert.match(comp, /findIndex\(o => o\.id === value\)/, 'sorotan awal = pilihan terpilih')
  const cur = read('components/shared/CurrencySelect.tsx')
  assert.match(cur, /clearable=\{false\}/)
  for (const f of ['components/admin/pricing/VendorCurrencyField.tsx', 'app/[locale]/admin/(protected)/products/visa/[id]/CostTiersTab.tsx', 'app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx', 'app/[locale]/admin/(protected)/products/flight/[id]/page.tsx', 'app/[locale]/admin/(protected)/products/transport/trips/[id]/page.tsx', 'app/[locale]/admin/(protected)/products/muthowif/page.tsx']) {
    const src = read(f)
    assert.match(src, /<CurrencySelect/, f)
    assert.doesNotMatch(src, /CURRENCIES\.map|currencies\.map/, `${f}: tak boleh membuat opsi mata uang sendiri`)
  }
  for (const f of ['components/admin/pricing/VendorCurrencyField.tsx', 'app/[locale]/admin/(protected)/products/visa/[id]/CostTiersTab.tsx']) assert.doesNotMatch(read(f), /flex items-start gap-2/, `${f}: vendor dan mata uang tidak berbagi baris`)
})

t('bendera SVG (Windows tak menggambar emoji bendera): tiap negara punya berkas, berkas aman dan kecil, sinkron dengan paket sumber, LICENSE ikut, emoji bendera tak dipakai lagi', () => {
  const missing = COUNTRIES.filter(c => !existsSync(join(root, `public/flags/${c.code}.svg`))).map(c => c.code)
  assert.deepEqual(missing, [], 'jalankan `bun scripts/sync-flags.ts`')
  for (const c of COUNTRIES) {
    const svg = read(`public/flags/${c.code}.svg`)
    assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, c.code)
    assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+\s*=|javascript:|<image|<use[^>]*href=["']https?:|<style/i, `${c.code}: SVG tak boleh memuat skrip/sumber luar`)
    assert.ok(svg.length < 20_000, `${c.code}: terlalu besar (${svg.length})`)
    assert.equal(svg, read(`node_modules/country-flag-icons/3x2/${c.code}.svg`), `${c.code}: tak sinkron dengan paket (sync ulang)`)
  }
  assert.match(read('public/flags/LICENSE'), /MIT/)
  const html = renderToStaticMarkup(createElement(Flag, { code: 'id' }))
  assert.match(html, /<img src="\/flags\/ID\.svg" alt="" aria-hidden="true"[^>]*loading="lazy"/, 'dekoratif, huruf besar, malas-muat')
  assert.ok(!existsSync(join(root, 'lib/utils/flag.ts')), 'util emoji bendera sudah dihapus')
  const emojiFlag = /[\u{1F1E6}-\u{1F1FF}]{2}/u
  const offenders = walk('app').concat(walk('components'), walk('lib')).filter(f => emojiFlag.test(read(f)))
  assert.deepEqual(offenders, [], 'emoji bendera tak boleh dipakai (Windows menampilkannya sebagai huruf)')
  const comp2 = read('components/shared/AutocompleteSelect.tsx')
  assert.match(comp2, /<Flag code=\{selected\.flag\} \/>/)
  assert.match(comp2, /<Flag code=\{o\.flag\} \/>/)
})

if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
