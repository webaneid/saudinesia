// Pembagian anggota Paket Umroh / Haji per jamaah (lib/booking/members.ts, docs/rencana-visa-produk.md §3.3). Murni (tanpa DB).
// Yang dikunci: siapa yang mendapat visa paket SAMA PERSIS dengan pembagian sebelum V4 (pembanding menyeluruh atas kasus kecil); jamaah kurang dari jumlah
// orang paket/haji → ditolak; anggota paket bervisa yang ber-visa sendiri → ditolak (K4); anggota lama dipertahankan saat revisi; kursi dikurangi → yang paling
// belakang dilepas; item hilang → anggotanya lepas.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { assignInGroups, assignMembers, memberProblem, type MemberPilgrim, type MemberSlot } from '../lib/booking/members'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`) }
}

const fresh = (ownVisa: boolean): MemberPilgrim => ({ key: '', ownVisa, packageVisa: null, currentPackage: null, currentHaji: null })
const ok = (r: ReturnType<typeof assignMembers>) => { if (!r.ok) throw new Error(`tak diharapkan: ${JSON.stringify(r)}`); return r.members }

/** Pembagian visa paket SEBELUM V4 (lib/booking/lineItems.ts lama): antrean slot visa per paket bervisa (urut item), diberikan ke jamaah TANPA visa sendiri, urut. */
function legacyVisa(packages: readonly MemberSlot[], own: readonly boolean[]): Array<string | null> {
  const slots = packages.flatMap(r => (r.visaProductId ? Array.from({ length: r.numPeople }, () => r.visaProductId!) : []))
  return own.map(o => (o ? null : slots.shift() ?? null))
}

await t('PEMBANDING: siapa mendapat visa paket = pembagian lama, untuk SEMUA kombinasi kecil (≤ 4 jamaah, ≤ 3 paket bervisa/tanpa visa) yang tetap sah', () => {
  const visas = [null, 'A', 'B'] as const
  let compared = 0
  for (let n = 1; n <= 4; n++) {
    for (let mask = 0; mask < 1 << n; mask++) {
      const own = Array.from({ length: n }, (_, i) => !!(mask & (1 << i)))
      const rowsets: MemberSlot[][] = [[]]
      for (let k = 0; k < 3; k++) {
        for (const base of [...rowsets]) for (const v of visas) for (const ppl of [1, 2]) if (base.length === k) rowsets.push([...base, { key: `r${k}`, numPeople: ppl, visaProductId: v }])
      }
      for (const rows of rowsets) {
        const r = assignMembers(rows, [], own.map(fresh))
        if (!r.ok) continue // jamaah kurang / visa dobel: kini ditolak (diuji terpisah)
        const visaOf = new Map(rows.map(x => [x.key, x.visaProductId]))
        const now = r.members.map((m, i) => (own[i] ? null : (m.package && visaOf.get(m.package)) || null))
        assert.deepEqual(now, legacyVisa(rows, own), JSON.stringify({ own, rows }))
        compared++
      }
    }
  }
  assert.ok(compared > 500, `kasus dibandingkan: ${compared}`)
})

await t('JUMLAH: Σ orang paket > jamaah → ditolak (paket); Σ orang haji > jamaah → ditolak (haji); pas = sah', () => {
  const r = assignMembers([{ key: 'p', numPeople: 3, visaProductId: null }], [], [fresh(false), fresh(false)])
  assert.deepEqual(r, { ok: false, reason: 'too_few_pilgrims', what: 'package', needed: 3, pilgrims: 2 })
  assert.match(memberProblem(r as Extract<typeof r, { ok: false }>, () => 'x').message, /Jumlah jamaah \(2\) kurang dari jumlah orang di Paket Umroh \(3\)/)
  const h = assignMembers([], [{ key: 'h', numPeople: 2 }], [fresh(false)])
  assert.equal(!h.ok && h.reason === 'too_few_pilgrims' && h.what, 'haji')
  assert.deepEqual(ok(assignMembers([], [{ key: 'h', numPeople: 2 }], [fresh(false), fresh(true)])).map(m => m.haji), ['h', 'h'])
})

await t('K4: anggota paket BERVISA yang ber-visa sendiri → ditolak (Jamaah ke-N); paket TANPA visa boleh berisi jamaah ber-visa sendiri', () => {
  const r = assignMembers([{ key: 'p', numPeople: 2, visaProductId: 'A' }], [], [fresh(false), fresh(true)])
  assert.deepEqual(r, { ok: false, reason: 'double_visa', pilgrimIndex: 1, packageKey: 'p' })
  assert.match(memberProblem(r as Extract<typeof r, { ok: false }>, () => 'Paket Hemat').message, /Jamaah ke-2 anggota Paket Hemat yang visanya sudah termasuk paket/)
  assert.deepEqual(ok(assignMembers([{ key: 'p', numPeople: 2, visaProductId: null }], [], [fresh(true), fresh(true)])).map(m => m.package), ['p', 'p'])
})

await t('REVISI: anggota lama dipertahankan walau ada jamaah lebih awal yang bebas; kursi dikurangi → yang paling belakang dilepas; item hilang → lepas', () => {
  const ps: MemberPilgrim[] = [fresh(false), { ...fresh(false), currentPackage: 'p', packageVisa: 'A' }, { ...fresh(false), currentPackage: 'p', packageVisa: 'A' }]
  assert.deepEqual(ok(assignMembers([{ key: 'p', numPeople: 2, visaProductId: 'A' }], [], ps)).map(m => m.package), [null, 'p', 'p'])
  assert.deepEqual(ok(assignMembers([{ key: 'p', numPeople: 1, visaProductId: 'A' }], [], ps)).map(m => m.package), [null, 'p', null])
  assert.deepEqual(ok(assignMembers([], [], ps)).map(m => m.package), [null, null, null])
  // Item diganti (id baru): pemegang visa paket yang sama didahulukan, jadi visanya tak berpindah orang.
  assert.deepEqual(ok(assignMembers([{ key: 'p2', numPeople: 2, visaProductId: 'A' }], [], ps)).map(m => m.package), [null, 'p2', 'p2'])
  assert.deepEqual(ok(assignMembers([], [{ key: 'h', numPeople: 1 }], [fresh(false), { ...fresh(false), currentHaji: 'h' }])).map(m => m.haji), [null, 'h'])
})

await t('PAKET TANPA VISA mendahulukan jamaah tanpa visa paket (visa paket orang lain tak hilang sia-sia); haji independen dari paket', () => {
  const ps: MemberPilgrim[] = [{ ...fresh(false), packageVisa: 'A' }, fresh(false)]
  assert.deepEqual(ok(assignMembers([{ key: 'q', numPeople: 1, visaProductId: null }], [], ps)).map(m => m.package), [null, 'q'])
  const m = ok(assignMembers([{ key: 'p', numPeople: 1, visaProductId: 'A' }], [{ key: 'h', numPeople: 2 }], [fresh(false), fresh(false)]))
  assert.deepEqual(m, [{ package: 'p', haji: 'h' }, { package: null, haji: 'h' }])
})

await t('PENJAGA: kolom anggota (`bookingPackageId`/`bookingHajiId`) ditulis HANYA lib/booking/lineItems.ts dan lib/booking/revise.ts — keduanya lewat assignInGroups (aturan tunggal di atas assignMembers)', () => {
  const root = new URL('..', import.meta.url).pathname
  const walk = (d: string): string[] => readdirSync(join(root, d)).flatMap(f => { const p = join(d, f); return statSync(join(root, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [] })
  const writers = ['app', 'lib', 'components'].flatMap(walk).filter(f => /booking(Package|Haji)Id\s*:\s*(?!true\b)/.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(writers.sort(), ['lib/booking/lineItems.ts', 'lib/booking/revise.ts'])
  for (const f of writers) assert.match(readFileSync(join(root, f), 'utf8'), /assignInGroups\(/, f)
})

await t('assignInGroups: paket per rombongan dibagi di dalam rombongannya; nomor jamaah di galat K4 = nomor di booking; campuran "semua" + per rombongan → mixed_groups', () => {
  const g = (group: number, ownVisa = false) => ({ ...fresh(ownVisa), group })
  const r = assignInGroups([{ key: 'pA', numPeople: 1, visaProductId: null, group: 0 }, { key: 'pB', numPeople: 2, visaProductId: null, group: 1 }], [], [g(1), g(0), g(1)], 2)
  assert.deepEqual(ok(r as ReturnType<typeof assignMembers>).map(m => m.package), ['pB', 'pA', 'pB'])
  const dv = assignInGroups([{ key: 'pB', numPeople: 1, visaProductId: 'A', group: 1 }], [], [g(0), g(1, true)], 2)
  assert.ok(!dv.ok && dv.reason === 'double_visa' && dv.pilgrimIndex === 1)
  const mixed = assignInGroups([{ key: 'all', numPeople: 1, visaProductId: null }, { key: 'pB', numPeople: 1, visaProductId: null, group: 1 }], [], [g(0), g(1)], 2)
  assert.ok(!mixed.ok && mixed.reason === 'mixed_groups'); assert.match(memberProblem(mixed, () => 'x').message, /tidak dapat digabung/)
  assert.deepEqual(assignInGroups([{ key: 'p', numPeople: 2, visaProductId: null }], [], [fresh(false), fresh(false)], 0), assignMembers([{ key: 'p', numPeople: 2, visaProductId: null }], [], [fresh(false), fresh(false)]), 'tanpa rombongan = assignMembers')
})

if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
