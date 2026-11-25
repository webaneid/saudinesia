// Formulir kartu jamaah (docs/arsitektur-jamaah.md §5.2) — murni, tanpa database: badan permintaan dari nilai formulir.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EMPTY_PILGRIM_FORM, bodyFromForm, hasCardOnlyData, missingRequired } from '@/components/shared/pilgrims/savedPilgrimForm'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message}`) }
}
const base = { ...EMPTY_PILGRIM_FORM, fullName: 'Budi', birthDate: '1985-07-15' }

t('NIK: kosong pada kartu ber-NIK = tidak dikirim (tetap); dicentang hapus = null; diisi = dikirim; WNA = null', () => {
  assert.equal('nik' in bodyFromForm({ ...base, hasNik: true }), false)
  assert.equal(bodyFromForm({ ...base, hasNik: true, clearNik: true }).nik, null)
  assert.equal(bodyFromForm({ ...base, nik: '3201011507851234' }).nik, '3201011507851234')
  assert.equal(bodyFromForm({ ...base, nationality: 'MY', hasNik: true }).nik, null)
})
t('Paspor: "Hapus data paspor" mengirim null walau tanggal masih di state (audit Fase 3, Medium)', () => {
  const v = { ...base, passportMask: '•••• 4321', passportIssuedAt: '2020-01-01', passportExpiry: '2030-01-01', clearPassport: true }
  assert.equal(bodyFromForm(v).passport, null)
  assert.deepEqual(bodyFromForm({ ...v, clearPassport: false }).passport, { issuedAt: '2020-01-01', expiry: '2030-01-01' }, 'tanpa centang: nomor tetap, tanggal diperbarui')
  assert.deepEqual(bodyFromForm({ ...v, passportNumber: 'C7654321' }).passport, { number: 'C7654321', issuedAt: '2020-01-01', expiry: '2030-01-01' })
  assert.equal(bodyFromForm(base).passport, null)
})
t('Alamat: kosong tanpa alamat lama = tidak dikirim; dikosongkan dari alamat lama = null', () => {
  assert.equal('address' in bodyFromForm(base), false)
  assert.equal(bodyFromForm({ ...base, hadAddress: true }).address, null)
})
t('Kolom wajib katalog: kosong/terisi per peran dan kolom admin; NIK WNA tak ditagih; NIK/paspor tersimpan dihitung terisi', () => {
  const f = (role: string | null, fieldKey = role ?? 'gol', required = true) => ({ id: fieldKey, fieldKey, label: fieldKey, fieldType: 'text', options: null, required, role, order: 0 })
  const miss = (v: typeof base, ...fields: ReturnType<typeof f>[]) => missingRequired(v, fields).map(x => x.fieldKey)
  assert.deepEqual(miss(base, f('display_name'), f('gender'), f('birth_date'), f('nik'), f(null), f('email', 'email', false)), ['gender', 'nik', 'gol'])
  assert.deepEqual(miss({ ...base, gender: 'male', hasNik: true, passportMask: '••••1', extra: { gol: 'A' } }, f('gender'), f('nik'), f('passport_number'), f(null)), [])
  assert.deepEqual(miss({ ...base, hasNik: true, clearNik: true }, f('nik')), ['nik'])
  assert.deepEqual(miss({ ...base, nationality: 'MY' }, f('nik')), [])
  assert.deepEqual(miss({ ...base, extra: { gol: '' } }, f(null)), ['gol'])
})
t('Profil: kartu "Saya sendiri" dibuat hanya bila ada data jamaah (bukan sekadar nama, kontak, email, alamat akun)', () => {
  assert.equal(hasCardOnlyData({ ...EMPTY_PILGRIM_FORM, fullName: 'Budi', email: 'a@b.c', isSelf: true }), false)
  assert.equal(hasCardOnlyData({ ...EMPTY_PILGRIM_FORM, gender: 'female' }), true)
  assert.equal(hasCardOnlyData({ ...EMPTY_PILGRIM_FORM, extra: { gol: 'A' } }), true)
  assert.equal(hasCardOnlyData({ ...EMPTY_PILGRIM_FORM, extra: { gol: '' } }), false)
})
t('?w= di halaman kartu: daftar putih hasOwn (bukan `in` — kunci prototipe seperti __proto__/toString ditolak)', () => {
  const src = readFileSync('app/[locale]/(pilgrim)/jamaah/[id]/page.tsx', 'utf8')
  assert.match(src, /Object\.hasOwn\(WARNING_TEXT, w\)/)
  assert.doesNotMatch(src, /w in WARNING_TEXT/)
})
t('halaman admin kartu: segmen URL divalidasi UUID sebelum membangun URL API (CSPT)', () => {
  for (const f of ['app/[locale]/admin/(protected)/customers/[id]/pilgrims/[cardId]/page.tsx', 'app/[locale]/admin/(protected)/customers/[id]/pilgrims/new/page.tsx']) {
    assert.match(readFileSync(f, 'utf8'), /UUID\.test\(id\)/, f)
  }
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSEMUA LULUS')
