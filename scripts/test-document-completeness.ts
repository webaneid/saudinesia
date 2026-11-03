// Uji evaluator kelengkapan dokumen (lib/documents/completeness.ts, docs/arsitektur-jamaah.md §7.6) — MURNI, tanpa DB. Dijalankan di beberapa
// `TZ` (package.json): hasil wajib identik karena masa berlaku dihitung atas tanggal kalender, bukan instan.
import assert from 'node:assert/strict'
import { evaluateCompleteness, mergeRequirements, validUntilNeeded, type DocumentForCompleteness, type RequirementView } from '@/lib/documents/completeness'
import { bodyFromRows, moveRow, rowFromView } from '@/components/admin/documents/requirementRows'
import { documentRequirementListSchema } from '@/lib/validators/documents'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}

const R = (key: string, over: Partial<RequirementView> = {}): RequirementView => ({
  documentTypeId: `id-${key}`, key, label: key, typeLabel: key, description: '', required: true, icon: 'FileText', reusable: true,
  hasExpiry: false, minValidityMonths: null, ...over,
})
const passport = R('passport', { hasExpiry: true, minValidityMonths: 6 })
const vaccine = R('vaccine', { hasExpiry: true, required: false })
const ktp = R('ktp')
const D = (r: RequirementView, status: DocumentForCompleteness['status'] = 'pending', expiresAt: string | null = null): DocumentForCompleteness =>
  ({ documentTypeId: r.documentTypeId, status, expiresAt })
const stateOf = (reqs: RequirementView[], docs: DocumentForCompleteness[], referenceDate: string, checkValidity?: boolean) =>
  Object.fromEntries(evaluateCompleteness({ requirements: reqs, documents: docs, referenceDate, checkValidity }).items.map(i => [i.key, i.state]))

t('PASPOR 6 BULAN (tabel): berangkat 1 Des 2026 → 31 Mei 2027 (5 bln 29 hr) kurang, 1 Jun 2027 (6 bln tepat) cukup; akhir bulan dijepit', () => {
  const table: [string, string, string][] = [
    ['2026-12-01', '2027-05-31', 'too_short'], ['2026-12-01', '2027-06-01', 'pending'], ['2026-12-01', '2028-01-01', 'pending'],
    ['2026-08-31', '2027-02-27', 'too_short'], ['2026-08-31', '2027-02-28', 'pending'], // 31 Agu + 6 bln = 28 Feb (2027 bukan kabisat)
    ['2027-08-31', '2028-02-28', 'too_short'], ['2027-08-31', '2028-02-29', 'pending'], // kabisat
    ['2026-12-01', '2026-11-30', 'expired'], ['2026-12-01', '2026-12-01', 'too_short'], // berlaku s.d. hari berangkat: belum habis, tapi < 6 bln
  ]
  for (const [dep, exp, want] of table) assert.equal(stateOf([passport], [D(passport, 'pending', exp)], dep).passport, want, `berangkat ${dep}, berlaku ${exp}`)
  assert.equal(validUntilNeeded(passport, '2026-12-01'), '2027-06-01')
  assert.equal(validUntilNeeded(ktp, '2026-12-01'), null, 'jenis tanpa masa berlaku')
  assert.equal(validUntilNeeded(vaccine, '2026-12-01'), '2026-12-01', 'bermasa berlaku tanpa minimum: cukup belum habis')
})

t('STATUS: tak ada berkas → missing; ditolak → rejected; diterima → accepted; masa berlaku mengalahkan status (paspor diterima tapi habis → expired)', () => {
  assert.deepEqual(stateOf([ktp], [], '2026-12-01'), { ktp: 'missing' })
  assert.deepEqual(stateOf([ktp], [D(ktp, 'rejected')], '2026-12-01'), { ktp: 'rejected' })
  assert.deepEqual(stateOf([ktp], [D(ktp, 'accepted')], '2026-12-01'), { ktp: 'accepted' })
  assert.deepEqual(stateOf([passport], [D(passport, 'accepted', '2026-01-01')], '2026-12-01'), { passport: 'expired' })
  assert.deepEqual(stateOf([passport], [D(passport, 'accepted', null)], '2026-12-01'), { passport: 'too_short' }, 'paspor tanpa tanggal berlaku tak bisa dinilai cukup')
  assert.deepEqual(stateOf([vaccine], [D(vaccine, 'pending', null)], '2026-12-01'), { vaccine: 'pending' }, 'vaksin tanpa tanggal: masa berlaku opsional')
})

t('BANYAK BERKAS satu jenis: yang TERBAIK dipakai (ditolak + menunggu → menunggu; habis + diterima → diterima)', () => {
  assert.equal(stateOf([ktp], [D(ktp, 'rejected'), D(ktp, 'pending')], '2026-12-01').ktp, 'pending')
  assert.equal(stateOf([passport], [D(passport, 'accepted', '2026-01-01'), D(passport, 'accepted', '2030-01-01')], '2026-12-01').passport, 'accepted')
  assert.equal(stateOf([ktp], [D(passport, 'accepted', '2030-01-01')], '2026-12-01').ktp, 'missing', 'berkas jenis lain tak dihitung')
})

t('READY / VERIFIED: hanya syarat WAJIB menentukan; opsional kosong tak menghalangi; menunggu = ready tapi belum verified', () => {
  const reqs = [passport, ktp, vaccine]
  const pending = evaluateCompleteness({ requirements: reqs, documents: [D(passport, 'pending', '2030-01-01'), D(ktp, 'pending')], referenceDate: '2026-12-01' })
  assert.deepEqual([pending.ready, pending.verified, pending.missingRequired.length], [true, false, 0])
  const accepted = evaluateCompleteness({ requirements: reqs, documents: [D(passport, 'accepted', '2030-01-01'), D(ktp, 'accepted')], referenceDate: '2026-12-01' })
  assert.deepEqual([accepted.ready, accepted.verified], [true, true])
  const short = evaluateCompleteness({ requirements: reqs, documents: [D(passport, 'accepted', '2027-05-31'), D(ktp, 'accepted')], referenceDate: '2026-12-01' })
  assert.deepEqual([short.ready, short.verified, short.missingRequired.map(m => m.key)], [false, false, ['passport']])
  const none = evaluateCompleteness({ requirements: [], documents: [], referenceDate: '2026-12-01' })
  assert.deepEqual([none.ready, none.verified], [true, true], 'tanpa syarat = lengkap (jamaah tanpa produk bersyarat)')
})

t('MODEL LAMA (checkValidity=false): berkas tanpa tanggal tetap dihitung ada', () => {
  assert.equal(stateOf([passport], [D(passport, 'pending', null)], '2026-12-01', false).passport, 'pending')
})

t('GABUNGAN syarat beberapa produk: per jenis, urutan kemunculan pertama, wajib bila salah satu mewajibkan, label dari yang pertama, petunjuk digabung tanpa duplikat, sumber per produk', () => {
  const pkg = [R('kk', { required: false, label: 'KK paket', description: 'Terbaru' }), R('flight_ticket', { reusable: false })]
  const haji = [R('kk', { description: 'Terbaru' }), R('vaccine', { description: 'Meningitis' })]
  const visaA = [R('passport', { label: 'Paspor (visa)' }), R('kk', { required: false, description: 'Legalisir' }), R('vaccine', { description: 'Meningitis' })]
  const merged = mergeRequirements([{ source: 'Paket Hemat', requirements: pkg }, { source: 'Haji Khusus', requirements: haji }, { source: 'Visa Reguler', requirements: visaA }])
  assert.deepEqual(merged.map(m => [m.key, m.required, m.label, m.description, m.sources]), [
    ['kk', true, 'KK paket', 'Terbaru · Legalisir', ['Paket Hemat', 'Haji Khusus', 'Visa Reguler']],
    ['flight_ticket', true, 'flight_ticket', '', ['Paket Hemat']],
    ['vaccine', true, 'vaccine', 'Meningitis', ['Haji Khusus', 'Visa Reguler']],
    ['passport', true, 'Paspor (visa)', '', ['Visa Reguler']],
  ])
  assert.equal(pkg[0]!.required, false, 'masukan tidak diubah')
  assert.equal(pkg[0]!.description, 'Terbaru', 'masukan tidak diubah')
  assert.deepEqual(mergeRequirements([{ source: 'Paket', requirements: [R('ktp')] }, { source: 'Paket', requirements: [R('ktp')] }])[0]!.sources, ['Paket'], 'nama produk sama tak dobel')
  assert.deepEqual(mergeRequirements([]), [])
})

t('EDITOR (nilai murni): label sama dengan katalog dikirim null, baris tanpa jenis dibuang, urutan bisa digeser', () => {
  const row = rowFromView(R('passport', { label: 'Paspor', typeLabel: 'Foto Paspor' }))
  assert.deepEqual(row, { documentTypeId: 'id-passport', typeLabel: 'Foto Paspor', label: 'Paspor', description: '', required: true })
  assert.equal(rowFromView(R('ktp', { label: 'Foto KTP', typeLabel: 'Foto KTP' })).label, '', 'label = katalog → kosong')
  const body = bodyFromRows([{ ...row, label: '  Foto Paspor ' }, { documentTypeId: '', typeLabel: '', label: 'x', description: '', required: true }, { ...row, documentTypeId: 'b', label: ' Khusus ', description: ' isi ' }])
  assert.deepEqual(body, [
    { documentTypeId: 'id-passport', label: null, description: '', required: true },
    { documentTypeId: 'b', label: 'Khusus', description: 'isi', required: true },
  ])
  assert.deepEqual(moveRow(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
  assert.deepEqual(moveRow(['a', 'b'], 1, 1), ['a', 'b'], 'di ujung: tetap')
})

t('VALIDATOR daftar syarat: jenis ganda, label 1 huruf, kolom asing, > 30 baris DITOLAK; label kosong → null', () => {
  const id = '6f1c2a40-0000-4000-8000-000000000001'
  const ok = documentRequirementListSchema.safeParse([{ documentTypeId: id, label: '', required: false }])
  assert.ok(ok.success && ok.data[0]!.label === null && ok.data[0]!.description === '')
  assert.equal(documentRequirementListSchema.safeParse([{ documentTypeId: id }, { documentTypeId: id }]).success, false)
  assert.equal(documentRequirementListSchema.safeParse([{ documentTypeId: id, label: 'x' }]).success, false)
  assert.equal(documentRequirementListSchema.safeParse([{ documentTypeId: id, docType: 'ktp' }]).success, false)
  assert.equal(documentRequirementListSchema.safeParse([{ documentTypeId: 'bukan-uuid' }]).success, false)
  const many = Array.from({ length: 31 }, (_, i) => ({ documentTypeId: `6f1c2a40-0000-4000-8000-${String(i).padStart(12, '0')}` }))
  assert.equal(documentRequirementListSchema.safeParse(many).success, false)
})

console.log(failed ? `\n[${process.env.TZ ?? 'TZ bawaan'}] ${failed} GAGAL` : `\n[${process.env.TZ ?? 'TZ bawaan'}] SEMUA LULUS`)
process.exit(failed ? 1 : 0)
