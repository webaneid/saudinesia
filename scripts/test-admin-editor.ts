// Penjaga tata letak editor ala WordPress (docs/arsitektur-admin-editor.md). Tanpa database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')
const ADMIN = 'app/[locale]/admin/(protected)/'

// Halaman edit bespoke yang memakai EditorShell langsung (halaman dengan banyak kotak komponen yang tersimpan sendiri-sendiri).
const SHELL_PAGES = ['products/packages/[id]', 'products/hotels/[id]', 'products/tour-packages/[id]']
// Halaman edit berbasis EditPage (yang sendirinya EditorShell) + useEditEntity: formulir tunggal + Foto + Hapus.
const EDITPAGE_PAGES = ['products/catering/[id]', 'products/muthowif/[id]', 'products/tourism-sites/[id]', 'products/transport/vehicles/[id]', 'products/haji/[id]']

await t('halaman bespoke memakai EditorShell + PublishBox + MetaBox + useUnsavedGuard + useDirtyForm/baseline', () => {
  for (const e of SHELL_PAGES) {
    const src = read(ADMIN + e + '/page.tsx')
    for (const c of ['EditorShell', 'PublishBox', 'MetaBox']) assert.match(src, new RegExp(`<${c}\\b`), `${e}: tidak memakai <${c}>`)
    assert.match(src, /useUnsavedGuard\(/, `${e}: tidak memasang penjaga perubahan belum disimpan`)
    assert.ok(/useDirtyForm\(/.test(src) || /baseline/.test(src), `${e}: tidak melacak perubahan belum disimpan`)
  }
})

await t('halaman EditPage: useEditEntity + useDirtyForm; formulir diisi SEKALI (muat-ulang tak menimpa ketikan); media lewat prop media', () => {
  for (const e of EDITPAGE_PAGES) {
    const src = read(ADMIN + e + '/page.tsx')
    assert.match(src, /<EditPage\b/, `${e}: tidak memakai EditPage`)
    assert.match(src, /useEditEntity</, `${e}: tidak memakai useEditEntity`)
    assert.match(src, /useDirtyForm\(/, `${e}: tidak melacak perubahan belum disimpan`)
    assert.match(src, /!form\)/, `${e}: formulir harus diisi sekali (guard !form) — bukan setiap e.item berubah`)
    assert.match(src, /dirty=\{dirty\}/, `${e}: dirty tidak diteruskan ke EditPage`)
    assert.match(src, /media=\{<MediaField\b/, `${e}: foto harus lewat prop media (kolom kanan)`)
  }
})

await t('EditPage = EditorShell + PublishBox + DeleteBox; tidak ada panel tersebar', () => {
  const src = read('components/admin/shell/EditPage.tsx')
  for (const c of ['EditorShell', 'PublishBox', 'DeleteBox']) assert.match(src, new RegExp(`<${c}\\b`), `EditPage tidak memakai <${c}>`)
  assert.doesNotMatch(src, /top=\{|\btop\?:/, 'prop `top` (panel sebaris di atas formulir) sudah diganti `media`')
})

await t('halaman edit tidak kembali ke panel tersebar (kartu komponen manual)', () => {
  for (const e of [...SHELL_PAGES, ...EDITPAGE_PAGES]) {
    const src = read(ADMIN + e + '/page.tsx')
    assert.doesNotMatch(src, /className="admin-card p-4 space-y-3"/, `${e}: kartu komponen manual — pakai MetaBox`)
    assert.doesNotMatch(src, /<ArrowLeft\b/, `${e}: tombol kembali ad-hoc — EditorShell menyediakannya`)
  }
})

await t('halaman bespoke: simpan memeriksa respons dan galat tampil; muat-ulang kotak komponen tak menimpa isian info', () => {
  for (const e of SHELL_PAGES) {
    const src = read(ADMIN + e + '/page.tsx')
    assert.match(src, /if \(!res\.ok\)/, `${e}: respons simpan tidak diperiksa`)
    assert.match(src, /setError\(/, `${e}: galat simpan tidak ditampilkan`)
  }
  assert.match(read(ADMIN + 'products/packages/[id]/page.tsx'), /if \(!okSaved\) return/, 'Paket Umroh: baseline maju walau simpan gagal')
  for (const e of ['products/packages/[id]', 'products/tour-packages/[id]']) {
    const src = read(ADMIN + e + '/page.tsx')
    assert.match(src, /loadPackage\(p\.id, true\)/, `${e}: muat awal harus mereset info`)
    assert.match(src, /resetInfo/, `${e}: loadPackage harus menjaga isian lewat resetInfo`)
  }
  assert.match(read(ADMIN + 'products/hotels/[id]/page.tsx'), /markClean\(\{ form: f, address: a \}\)/, 'Hotel: baseline harus bergeser setelah muat')
})

await t('Visa: Foto Unggulan di kolom kanan (sidebar), bukan di atas formulir', () => {
  const src = read(ADMIN + 'products/visa/[id]/ProductInfoTab.tsx')
  const sidebarAt = src.indexOf('<div className="min-w-0 space-y-4">')
  const mediaAt = src.indexOf('<MediaField')
  assert.ok(sidebarAt > 0 && mediaAt > sidebarAt, 'MediaField harus berada setelah pembuka kolom kanan')
})

await t('komponen editor: MetaBox menjaga isi tetap ter-mount saat dilipat; DeleteBox memakai konfirmasi inline', () => {
  assert.match(read('components/admin/editor/MetaBox.tsx'), /hidden=\{!expanded\}/, 'isi harus disembunyikan, bukan di-unmount')
  const del = read('components/admin/editor/DeleteBox.tsx')
  assert.match(del, /setConfirming\(true\)/, 'hapus harus dikonfirmasi')
  assert.doesNotMatch(del, /window\.confirm|\bconfirm\(/, 'konfirmasi inline, bukan dialog peramban')
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua lulus')
