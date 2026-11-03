// Pemetaan baris Visa ↔ slot jamaah di editor booking admin (docs/rencana-visa-produk.md §2.2): visa dijual sebagai BARIS produk, tetapi tetap disimpan
// per jamaah. Murni (tanpa DB). Yang dikunci: kelompok per (produk, lama tinggal); jumlah naik mengisi jamaah tanpa visa dulu; jumlah turun/hapus
// melepas dari belakang; visa terkunci (revisi R3) dan visa paket tak pernah tersentuh; subtotal baris = Σ angka server anggotanya.
import assert from 'node:assert/strict'
import type { ItemRow } from '../app/[locale]/admin/(protected)/bookings/drafts/[id]/ItemRows'
import { applyVisaRows, lockedMembers, stripRow, syncVisaCounts, visaRowTotal, visaRowsFromSlots, type VisaSlot } from '../app/[locale]/admin/(protected)/bookings/drafts/[id]/visaRows'

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

const make = (): VisaSlot => ({})
const setRow = (rows: ItemRow[], key: string, patch: { pick?: string; people?: string; days?: string }) => rows.map(r => (r.key !== key ? r : {
  ...r, f: { ...r.f, ...(patch.pick !== undefined && { pick: patch.pick }), ...(patch.people !== undefined && { people: patch.people }), extra: patch.days !== undefined ? { ...r.f.extra, days: patch.days } : r.f.extra },
}))
const visa = (pick: string, people: number, days = ''): ItemRow => ({ key: `n-${pick}-${people}-${days}`, module: 'visa', f: { pick, start: '', end: '', people: String(people), rooms: '1', extra: days ? { days } : {} } })
const sent = (slots: VisaSlot[]) => slots.map(s => { const { visaProductId, selectedDurationDays } = stripRow(s); return `${visaProductId ?? '-'}${selectedDurationDays ? `/${selectedDurationDays}` : ''}` })

await t('muat: dikelompokkan per (produk, lama tinggal) urut kemunculan; jamaah tanpa visa & visa paket bukan baris', () => {
  const { rows, slots } = visaRowsFromSlots<VisaSlot>([
    { visaProductId: 'A', selectedDurationDays: 30 }, {}, { visaProductId: 'B' }, { visaProductId: 'A', selectedDurationDays: 30 },
    { visaProductId: 'A', selectedDurationDays: 90 }, { visaProductId: 'P', visaFromPackage: true },
  ])
  assert.deepEqual(rows.map(r => [r.f.pick, r.f.extra.days ?? '', r.f.people]), [['A', '30', '2'], ['B', '', '1'], ['A', '90', '1']])
  assert.equal(slots[0]!.row, slots[3]!.row)
  assert.equal(slots[1]!.row, undefined)
  assert.equal(slots[5]!.row, undefined, 'visa paket tak menjadi baris')
  assert.ok(rows.every(r => r.module === 'visa'))
})

await t('jumlah naik: isi jamaah TANPA visa dulu (urut), sisanya slot baru; visa paket/terkunci bukan tempat kosong', () => {
  const base: VisaSlot[] = [{}, { visaProductId: 'P', visaFromPackage: true }, { locked: true }, {}]
  const next = applyVisaRows(base, [visa('A', 4, '30')], make)
  assert.deepEqual(sent(next), ['A/30', 'P', '-', 'A/30', 'A/30', 'A/30'])
  assert.equal(next[2]!.row, undefined, 'jamaah terkunci tanpa visa tak diberi visa')
})

await t('ganti produk / lama tinggal → semua anggota ikut; draf terkirim tanpa kunci baris', () => {
  const { rows, slots } = visaRowsFromSlots<VisaSlot>([{ visaProductId: 'A' }, { visaProductId: 'A' }, {}])
  const key = rows[0]!.key
  const next = applyVisaRows(slots, setRow(rows, key, { pick: 'B', days: '45' }), make)
  assert.deepEqual(sent(next), ['B/45', 'B/45', '-'])
  assert.ok(next.map(stripRow).every(s => !('row' in s)))
})

await t('jumlah turun & hapus baris: lepas anggota dari BELAKANG; jamaah tetap ada (tanpa visa)', () => {
  const { rows, slots } = visaRowsFromSlots<VisaSlot>([{ visaProductId: 'A' }, { visaProductId: 'A' }, { visaProductId: 'A' }])
  const key = rows[0]!.key
  const down = applyVisaRows(slots, setRow(rows, key, { people: '1' }), make)
  assert.deepEqual(sent(down), ['A', '-', '-'])
  const gone = applyVisaRows(slots, [], make)
  assert.deepEqual(sent(gone), ['-', '-', '-'])
  assert.equal(gone.length, 3)
})

await t('dua baris berbeda berbagi slot kosong tanpa saling menimpa', () => {
  const next = applyVisaRows([{}, {}, {}], [visa('A', 2), visa('B', 2)], make)
  assert.deepEqual(sent(next), ['A', 'A', 'B', 'B'])
  assert.equal(new Set(next.map(s => s.row)).size, 2)
})

await t('REVISI: anggota terkunci tak pernah diubah/dilepas; jumlah tak bisa di bawah anggota terkunci; baris terkunci tak terhapus', () => {
  const { rows, slots } = visaRowsFromSlots<VisaSlot>([{ visaProductId: 'A', locked: true }, { visaProductId: 'A' }, { visaProductId: 'A' }])
  const key = rows[0]!.key
  assert.equal(lockedMembers(slots, key), 1)
  const changed = applyVisaRows(slots, setRow(rows, key, { pick: 'B', people: '0' }), make)
  assert.deepEqual(sent(changed), ['A', '-', '-'], 'terkunci tetap A, sisanya dilepas; jumlah dipaksa ≥ 1')
  const deleted = applyVisaRows(slots, [], make)
  assert.deepEqual(sent(deleted), ['A', '-', '-'], 'hapus baris tak menyentuh visa terkunci')
})

await t('jumlah orang baris selalu = anggota sebenarnya (sesudah jamaah dihapus di luar baris)', () => {
  const { rows, slots } = visaRowsFromSlots<VisaSlot>([{ visaProductId: 'A' }, { visaProductId: 'A' }, {}])
  const synced = syncVisaCounts(rows, slots.slice(1))
  assert.equal(synced[0]!.f.people, '1')
  assert.equal(syncVisaCounts(rows, slots)[0], rows[0], 'tanpa perubahan → objek sama (tak memicu render)')
})

await t('subtotal baris = Σ angka server anggotanya (urut slot); tanpa pratinjau → undefined', () => {
  const { rows, slots } = visaRowsFromSlots<VisaSlot>([{ visaProductId: 'A' }, {}, { visaProductId: 'B' }, { visaProductId: 'A' }])
  assert.equal(visaRowTotal(slots, rows[0]!.key, [100, 0, 250, 100]), 200)
  assert.equal(visaRowTotal(slots, rows[1]!.key, [100, 0, 250, 100]), 250)
  assert.equal(visaRowTotal(slots, rows[0]!.key, undefined), undefined)
})

if (failed) {
  console.log(`${failed} GAGAL`)
  process.exit(1)
}
