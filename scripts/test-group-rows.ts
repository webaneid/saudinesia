// Rombongan di editor booking admin (docs/arsitektur-booking-engine-v2.md §10.8, 11d-2a). Murni (tanpa DB). Yang dikunci: baris berrombongan membawa
// rombongannya dan jumlah orangnya = ukuran sasaran; baris Visa berrombongan hanya mengambil slot rombongannya; mulai/tambah/hapus rombongan menjaga rujukan
// (hapus → "semua"/geser indeks, tinggal satu → tanpa rombongan); ukuran draf tak pernah membuang slot bervisa; pindah jamaah membawa visanya.
import assert from 'node:assert/strict'
import { rowFromItem, rowToItem, type ItemRow } from '../app/[locale]/admin/(protected)/bookings/drafts/[id]/ItemRows'
import { applyVisaRows, visaRowsFromSlots, type VisaSlot } from '../app/[locale]/admin/(protected)/bookings/drafts/[id]/visaRows'
import { grouping, groupChoices, groupsInput, moveSlot, removeGroup, resizeGroup, startGroups, type GroupDraft } from '../app/[locale]/admin/(protected)/bookings/drafts/[id]/groupRows'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`)
  }
}

const G = (n: number): GroupDraft[] => Array.from({ length: n }, () => ({ label: '', plannedTravelDate: '' }))
const flightRow = (group?: number): ItemRow => ({ key: `f${group ?? 'all'}`, module: 'flight', ...(group !== undefined && { group }), f: { pick: 'fs', start: '2090-06-05', end: '', people: '1', rooms: '1', extra: {} } })
const visa = (people: number, group?: number): ItemRow => ({ key: `v${group ?? 'all'}`, module: 'visa', ...(group !== undefined && { group }), f: { pick: 'vp', start: '', end: '', people: String(people), rooms: '1', extra: {} } })

await t('grouping: < 2 rombongan = tanpa rombongan; nama kosong → Rombongan A/B; ukuran = slot per rombongan; groupsInput membuang isian kosong', () => {
  assert.equal(grouping(G(1), [{}]), null)
  const g = grouping([{ label: ' Kel. Ahmad ', plannedTravelDate: '' }, { label: '', plannedTravelDate: '2090-06-20' }], [{ group: 0 }, { group: 1 }, { group: 1 }])!
  assert.deepEqual(g, { names: ['Kel. Ahmad', 'Rombongan B'], sizes: [1, 2], total: 3 })
  assert.deepEqual(groupsInput([{ id: 'x', label: ' a ', plannedTravelDate: '' }, { label: '', plannedTravelDate: '2090-06-20' }]), [{ id: 'x', label: 'a' }, { plannedTravelDate: '2090-06-20' }])
  assert.deepEqual(groupChoices(['A', 'B'], true).map(o => o.id), ['all', '0', '1'])
  assert.deepEqual(groupChoices(['A', 'B'], false).map(o => o.id), ['0', '1'], 'baris Visa: tanpa "semua"')
})

await t('rowToItem berrombongan: item membawa rombongan; jumlah orang = ukuran sasaran (isian diabaikan); "semua" = total; rombongan kosong → galat; tanpa rombongan = perilaku lama', () => {
  const g = { names: ['A', 'B'], sizes: [3, 0], total: 3 }
  const a = rowToItem(flightRow(0), {}, g)
  assert.ok('item' in a && a.item.itemType === 'flight' && a.item.numPassengers === 3 && a.item.group === 0)
  const all = rowToItem(flightRow(), {}, g)
  assert.ok('item' in all && all.item.itemType === 'flight' && all.item.numPassengers === 3 && all.item.group === undefined)
  assert.deepEqual(rowToItem(flightRow(1), {}, g), { error: 'Rombongan ini belum punya jamaah' })
  const plain = rowToItem(flightRow(), {})
  assert.ok('item' in plain && plain.item.itemType === 'flight' && plain.item.numPassengers === 1 && !('group' in plain.item))
  const back = rowFromItem({ itemType: 'flight', flightScheduleId: 'fs', departureDate: '2090-06-05', numPassengers: 3, group: 1 })
  assert.equal(back.group, 1, 'rombongan item tersimpan dimuat kembali ke baris')
})

await t('baris Visa berrombongan hanya mengisi slot rombongannya; slot baru ikut rombongan baris; ganti rombongan baris → anggota lama dilepas', () => {
  const slots: VisaSlot[] = [{ group: 0 }, { group: 1 }, { group: 1 }]
  const rows = [visa(2, 1)]
  const next = applyVisaRows<VisaSlot>(slots, rows, () => ({}))
  assert.deepEqual(next.map(s => [s.group, !!s.visaProductId]), [[0, false], [1, true], [1, true]])
  const grow = applyVisaRows<VisaSlot>(next, [visa(3, 1)], () => ({}))
  assert.deepEqual(grow.map(s => [s.group, !!s.visaProductId]), [[0, false], [1, true], [1, true], [1, true]], 'slot baru masuk rombongan B, bukan mengambil slot A')
  const moved = applyVisaRows<VisaSlot>(grow, [visa(1, 0)], () => ({}))
  assert.deepEqual(moved.map(s => [s.group, !!s.visaProductId]), [[0, true], [1, false], [1, false], [1, false]])
  const fromSlots = visaRowsFromSlots<VisaSlot>([{ group: 0, visaProductId: 'vp' }, { group: 1, visaProductId: 'vp' }])
  assert.deepEqual(fromSlots.rows.map(r => [r.group, r.f.people]), [[0, '1'], [1, '1']], 'satu baris Visa per rombongan')
})

await t('mulai / hapus rombongan: semua ke rombongan pertama; hapus = produk ke "semua", indeks sesudahnya bergeser; draf membuang slot (dan baris Visa) rombongan itu; tinggal satu → tanpa rombongan', () => {
  const s0 = startGroups<VisaSlot>([{}, { visaProductId: 'vp', row: 'v' }], [visa(1), flightRow()], [{}])
  assert.deepEqual(s0.slots.map(s => s.group), [0, 0, 1]); assert.deepEqual(s0.rows.map(r => r.group), [0, undefined])
  const three = { groups: G(3), slots: [{ group: 0 }, { group: 1, visaProductId: 'vp', row: 'v1' }, { group: 2 }] as VisaSlot[], rows: [flightRow(2), visa(1, 1)] }
  three.rows[1]!.key = 'v1'
  const drop = removeGroup(three.groups, three.slots, three.rows, 1, true)
  assert.equal(drop.groups.length, 2); assert.deepEqual(drop.slots.map(s => s.group), [0, 1]); assert.deepEqual(drop.rows.map(r => [r.module, r.group]), [['flight', 1]], 'Visa rombongan terhapus ikut slotnya; tiket C → indeks 1')
  const keep = removeGroup(three.groups, three.slots, three.rows, 1, false)
  assert.deepEqual(keep.slots.map(s => s.group), [0, 0, 1], 'revisi: jamaah pindah ke rombongan pertama'); assert.deepEqual(keep.rows.map(r => r.group), [1, 0])
  const one = removeGroup(G(2), [{ group: 0 }, { group: 1 }], [flightRow(1)], 0, false)
  assert.deepEqual(one, { groups: [], slots: [{ group: undefined }, { group: undefined }], rows: [{ ...flightRow(1), group: undefined }] })
})

await t('ukuran rombongan (draf): naik = slot kosong di rombongan itu; turun hanya membuang slot TANPA visa; minimum = slot bervisa', () => {
  const slots: VisaSlot[] = [{ group: 0 }, { group: 1, visaProductId: 'vp', row: 'v' }, { group: 1 }]
  assert.deepEqual(resizeGroup<VisaSlot>(slots, 1, 4, () => ({})).map(s => s.group), [0, 1, 1, 1, 1])
  assert.deepEqual(resizeGroup<VisaSlot>(slots, 1, 0, () => ({})), [{ group: 0 }, { group: 1, visaProductId: 'vp', row: 'v' }])
})

await t('pindah jamaah (revisi): visanya ikut — baris Visa disusun ulang per rombongan, baris lain utuh; jamaah tanpa visa: baris tak berubah', () => {
  const v = visaRowsFromSlots<VisaSlot>([{ group: 0, visaProductId: 'vp' }, { group: 0, visaProductId: 'vp' }, { group: 1 }])
  const rows = [...v.rows, flightRow(0)]
  const x = moveSlot(v.slots, rows, 1, 1)
  assert.deepEqual(x.rows.map(r => [r.module, r.group, r.f.people]), [['visa', 0, '1'], ['visa', 1, '1'], ['flight', 0, '1']])
  assert.deepEqual(x.slots.map(s => s.group), [0, 1, 1])
  const y = moveSlot(v.slots, rows, 2, 0)
  assert.deepEqual(y.rows.map(r => r.key), rows.map(r => r.key))
})

if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
