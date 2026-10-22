// Tes editor teks kaya (docs/arsitektur-editor-teks.md): validator server (daftar putih + salinan bersih), helper dokumen,
// dan tampilan. Tanpa database/Redis. Yang dikunci: apa pun di luar daftar putih DITOLAK atau TERBUANG sebelum disimpan, dan
// tampilan tidak pernah menghasilkan HTML dari input mentah.
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyToNull, richTextField, sanitizeRichText, RichTextError } from '../lib/validators/richText'
import { hasContent, plainText, toEditorContent } from '../lib/rich-text/doc'
import { RichTextView } from '../components/shared/rich-text/RichTextView'
import { hajiProductCreateSchema, hajiProductUpdateSchema } from '../lib/validators/adminUpdates'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const text = (s: string, marks?: string[]) => ({ type: 'text', text: s, ...(marks ? { marks: marks.map(type => ({ type })) } : {}) })
const p = (...c: unknown[]) => ({ type: 'paragraph', content: c })
const doc = (...c: unknown[]) => JSON.stringify({ type: 'doc', content: c })
const rejects = (value: string, pattern: RegExp) => assert.throws(() => sanitizeRichText(value), (e: unknown) => e instanceof RichTextError && pattern.test(e.message))

await t('dokumen sah (judul, format, daftar) lolos dan hasilnya setara', () => {
  const input = doc(
    { type: 'heading', attrs: { level: 2 }, content: [text('Syarat')] },
    p(text('Tebal', ['bold']), text(' miring', ['italic', 'underline'])),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('satu'))] }] },
    { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p(text('dua'))] }] },
  )
  assert.deepEqual(JSON.parse(sanitizeRichText(input)), JSON.parse(input))
})

await t('teks polos lama lolos apa adanya; string kosong tetap kosong', () => {
  assert.equal(sanitizeRichText('Visa umroh\nproses 14 hari'), 'Visa umroh\nproses 14 hari')
  assert.equal(sanitizeRichText('   '), '')
})

await t('format di luar daftar ditolak: tautan, coret, kode', () => {
  for (const mark of ['link', 'strike', 'code', 'highlight', 'textStyle']) rejects(doc(p(text('x', [mark]))), /format/)
  assert.throws(() => sanitizeRichText(doc(p({ type: 'text', text: 'x', marks: [{ type: 'bold', attrs: { href: 'javascript:alert(1)' } }] }))))
})

await t('node di luar daftar ditolak: gambar, kutipan, kode, garis, tabel, script, H1', () => {
  for (const type of ['image', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'script', 'iframe']) rejects(doc({ type }), /tidak diizinkan/)
  rejects(doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] }), /H2 dan H3/)
  rejects(doc({ type: 'heading', content: [text('x')] }), /level/)
  rejects(doc({ type: 'heading', attrs: { level: 4 }, content: [text('x')] }), /H2 dan H3/)
})

await t('atribut di luar daftar ditolak (gaya, handler, href) dan nilai atribut divalidasi', () => {
  rejects(doc({ type: 'paragraph', attrs: { style: 'color:red' }, content: [text('x')] }), /atribut/)
  rejects(doc({ type: 'paragraph', attrs: { onclick: 'x()' }, content: [text('x')] }), /atribut/)
  rejects(doc({ type: 'orderedList', attrs: { start: -1 }, content: [] }), /nomor awal/)
  rejects(doc({ type: 'orderedList', attrs: { type: 'javascript:' }, content: [] }), /jenis daftar/)
})

await t('properti liar pada node yang sah TERBUANG (salinan bersih, bukan sekadar diperiksa)', () => {
  const dirty = JSON.stringify({ type: 'doc', onerror: 'x', content: [{ type: 'paragraph', evil: '<img src=x onerror=alert(1)>', content: [{ type: 'text', text: 'aman', extra: 1 }] }] })
  const clean = sanitizeRichText(dirty)
  assert.deepEqual(JSON.parse(clean), { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'aman' }] }] })
  assert.doesNotMatch(clean, /onerror|evil|extra/)
})

await t('struktur rusak ditolak: bukan JSON, akar bukan doc, doc bersarang, teks di luar node teks', () => {
  rejects('{ rusak', /JSON/)
  rejects('{"type":"paragraph"}', /akar/)
  rejects(doc({ type: 'doc', content: [] }), /bersarang/)
  rejects(doc({ type: 'paragraph', text: 'x' }), /di luar node teks/)
  rejects(doc({ type: 'text', text: 'x', content: [] }), /teks tidak boleh punya isi/)
  rejects(doc({ type: 'text' }), /teks tidak valid/)
})

await t('batas: kedalaman 12, 5.000 node, dan panjang ditolak', () => {
  let deep: unknown = p(text('x'))
  for (let i = 0; i < 14; i++) deep = { type: 'bulletList', content: [deep] }
  rejects(doc(deep), /terlalu dalam/)
  rejects(doc(...Array.from({ length: 5001 }, () => ({ type: 'hardBreak' }))), /terlalu panjang/)
  assert.equal(richTextField().safeParse('x'.repeat(100_001)).success, false)
})

await t('tipe/atribut bernama properti Object (constructor, __proto__, toString) ditolak; JSON bersarang ekstrem ditolak tanpa crash', () => {
  for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) rejects(doc({ type }), /tidak diizinkan/)
  rejects(doc({ type: 'paragraph', attrs: JSON.parse('{"__proto__":{"polluted":true}}'), content: [] }), /atribut/)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  rejects('{"type":"doc","content":' + '['.repeat(40_000) + ']'.repeat(40_000) + '}', /JSON|terlalu dalam|tidak diizinkan/)
})

await t('richTextField: transformasi ke salinan bersih, pesan galat jelas, dan dipakai di skema .strict()', async () => {
  const { z } = await import('zod')
  const schema = z.object({ description: richTextField().nullish() }).strict()
  const ok = schema.safeParse({ description: doc(p(text('halo'))) })
  assert.equal(ok.success, true)
  const bad = schema.safeParse({ description: doc({ type: 'image' }) })
  assert.equal(bad.success, false)
  assert.match(JSON.stringify(bad.error?.issues), /Isi teks tidak valid/)
  assert.equal(schema.safeParse({ description: null }).success, true)
  assert.equal(schema.safeParse({ nama: 'x' }).success, false)
})

await t('emptyToNull & hasContent: kosong, spasi, dan paragraf kosong → null; teks bermakna dipertahankan', () => {
  assert.equal(emptyToNull(''), null)
  assert.equal(emptyToNull(null), null)
  assert.equal(emptyToNull('   '), null)
  assert.equal(emptyToNull(doc(p())), null)
  assert.equal(emptyToNull(doc(p(text('   ')))), null)
  assert.notEqual(emptyToNull(doc(p(text('isi')))), null)
  assert.equal(hasContent('teks polos'), true)
})

await t('toEditorContent: teks polos → paragraf per baris; JSON dipertahankan; kosong → ""', () => {
  assert.equal(toEditorContent(''), '')
  assert.deepEqual(toEditorContent('a\n\nb'), { type: 'doc', content: [p(text('a')), { type: 'paragraph' }, p(text('b'))] })
  const d = doc(p(text('x')))
  assert.deepEqual(toEditorContent(d), JSON.parse(d))
})

await t('plainText: satu baris per blok, butir daftar berawalan, JSON rusak tidak bocor', () => {
  const d = doc(
    { type: 'heading', attrs: { level: 2 }, content: [text('Judul')] },
    p(text('Isi ', ['bold']), text('paragraf')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('a'))] }, { type: 'listItem', content: [p(text('b'))] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('x'))] }, { type: 'listItem', content: [p(text('y'))] }] },
  )
  assert.equal(plainText(d), 'Judul\nIsi paragraf\n• a\n• b\n1. x\n2. y')
  assert.equal(plainText('teks polos'), 'teks polos')
  assert.equal(plainText('{rusak'), '')
})

const render = (value: string | null) => renderToStaticMarkup(createElement(RichTextView, { value }))

await t('RichTextView: memetakan node sah ke elemen, node tak dikenal dibuang', () => {
  const html = render(doc(
    { type: 'heading', attrs: { level: 3 }, content: [text('Sub')] },
    p(text('a', ['bold', 'underline'])),
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(text('c'))] }] },
    { type: 'image', attrs: { src: 'x' } },
  ))
  assert.match(html, /<h3>Sub<\/h3>/)
  assert.match(html, /<p><u><strong>a<\/strong><\/u><\/p>/)
  assert.match(html, /<ol start="3"><li><p>c<\/p><\/li><\/ol>/)
  assert.doesNotMatch(html, /img|image/)
})

await t('RichTextView: teks berbahaya di-escape (tidak ada jalur HTML mentah), teks polos per baris, kosong tanpa keluaran', () => {
  const html = render(doc(p(text('<script>alert(1)</script><img src=x onerror=alert(1)>'))))
  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(render('<b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/)
  assert.equal(render(null), '')
  assert.equal(render('   '), '')
})

await t('skema Haji: payload form admin lolos; kunci liar, tipe salah, dan teks kaya berbahaya ditolak; deskripsi panjang sah', () => {
  const formPayload = {
    name: 'Haji Furoda 2027', hajiType: 'furoda', year: 2027, departureDate: null, returnDate: '2027-07-10', durationDays: 40,
    price: 150000000, totalQuota: 50, description: doc(p(text('Program lengkap'))), includes: ['Visa Haji', 'Akomodasi Makkah'],
  }
  assert.equal(hajiProductCreateSchema.safeParse(formPayload).success, true)
  assert.equal(hajiProductCreateSchema.safeParse({ ...formPayload, description: '' }).success, true) // editor dikosongkan
  assert.equal(hajiProductCreateSchema.safeParse({ ...formPayload, bookedQuota: 99 }).success, false) // kuota milik mesin booking
  assert.equal(hajiProductCreateSchema.safeParse({ ...formPayload, price: 'mahal' }).success, false)
  assert.equal(hajiProductCreateSchema.safeParse({ ...formPayload, year: NaN }).success, false)
  assert.equal(hajiProductCreateSchema.safeParse({ ...formPayload, description: doc(p(text('x', ['link']))) }).success, false)
  const long = doc(...Array.from({ length: 400 }, (_, i) => p(text(`Paragraf nomor ${i} dengan isi yang cukup panjang untuk menambah ukuran dokumen JSON.`))))
  assert.ok(long.length > 5000) // batas lama (5000) akan menolak ini
  assert.equal(hajiProductUpdateSchema.safeParse({ description: long }).success, true)
  assert.equal(hajiProductUpdateSchema.safeParse({ description: null }).success, true)
  assert.equal(hajiProductUpdateSchema.safeParse({ description: doc({ type: 'image' }) }).success, false)
})

await t('penjaga dependensi: bun.lock tanpa salinan ProseMirror/Tiptap bersarang (dua versi prosemirror-model = editor error saat Enter/daftar)', async () => {
  const { readFileSync } = await import('node:fs')
  const lock = readFileSync('bun.lock', 'utf8')
  // Entri bersarang berbentuk  "paket-induk/prosemirror-model": [...]  — satu paket seharusnya satu versi saja (disatukan lewat package.json `overrides`).
  const nested = [...lock.matchAll(/^ {4}"([^"]*\/)?(prosemirror-[a-z-]+|@tiptap\/[a-z-]+)": \[/gm)].filter(m => m[1]).map(m => m[0].trim().split(':')[0])
  assert.deepEqual(nested, [], `salinan bersarang: ${nested.join(', ')}`)
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
