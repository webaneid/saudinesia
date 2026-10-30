// Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6, Fase 2) terhadap DATABASE SUNGGUHAN: baris bawaan hasil migrasi, CHECK di DB, validasi Zod, simpan/alamat/zona waktu,
// nomor invoice berurut tanpa lompat (paralel + rollback), adapter CRUD daftar. Penjaga sumber untuk route/halaman. Selalu memulihkan keadaan bawaan.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { formatInvoiceNumber, numberPatternError } from '@/lib/invoice/numberPattern'
import { allocateInvoiceNumber } from '@/lib/invoice/numbering'
import { getInvoiceSettings, loadAppTimezone, SettingsError, updateInvoiceSettings } from '@/lib/invoice/settings'
import { bankAccountAdapter, qrisAccountAdapter, taxRuleAdapter } from '@/lib/invoice/lists'
import { createListHandlers } from '@/lib/invoice/listHandlers'
import { createMediaHandlers } from '@/lib/media/handlers'
import { bankAccountSchema, bankAccountUpdateSchema, invoiceSettingsSchema, qrisAccountSchema, qrisAccountUpdateSchema, taxRuleSchema, taxRuleUpdateSchema } from '@/lib/validators/invoiceSettings'
import { getAppTimezone, setAppTimezone } from '@/lib/time'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 10).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const exec = (sql: string) => prisma.$executeRawUnsafe(sql)
const rejects = async (sql: string, why: string) => { await assert.rejects(() => exec(sql), `${why} harus ditolak DB`) }

const DEFAULTS = { numberPrefix: 'INV', numberPattern: '{PREFIX}-{YYYY}-{SEQ}', numberPadding: 4, numberResetYearly: true, appTimezone: 'Asia/Jakarta', defaultDueDays: 4, expireDaysBeforeReference: 7, minimumFirstPaymentPercent: 0, uniqueCodeEnabled: true, uniqueCodeMin: 100, uniqueCodeMax: 999, methodBankTransfer: true, methodQris: false, methodIpaymu: false, methodXendit: false, gatewaySandbox: true, ipaymuFeePercent: 0, ipaymuFeeFlatIdr: 0, xenditFeePercent: 0, xenditFeeFlatIdr: 0 }
const valid = () => ({ ...DEFAULTS, companyName: 'PT Saudinesia', companyTaxId: '', companyPhone: '', companyEmail: '', companyWebsite: '', termsDoc: null, footerNoteDoc: null })
async function resetDefaults() {
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { ...DEFAULTS, companyName: null, companyTaxId: null, companyPhone: null, companyEmail: null, companyWebsite: null, termsDoc: null, footerNoteDoc: null, updatedById: null, companyAddressId: null } })
  setAppTimezone('Asia/Jakarta')
}
const createdAddresses: string[] = []

console.log('== baris bawaan & batas di DB ==')
await t('migrasi menyemai SATU baris global dengan nilai bawaan dan satu aturan PPN 0% (tanpa pajak)', async () => {
  const s = await getInvoiceSettings()
  assert.equal(s.id, 'global')
  for (const [k, v] of Object.entries(DEFAULTS)) assert.equal((s as Record<string, unknown>)[k], v, k)
  assert.equal(await prisma.invoiceSettings.count(), 1)
  const ppn = await prisma.taxRule.findMany({ where: { name: 'PPN' } })
  assert.ok(ppn.length >= 1 && Number(ppn[0]!.ratePercent) === 0 && ppn[0]!.mode === 'added')
})
await t('CHECK di DB menolak nilai tak wajar walau ditulis lewat SQL mentah (baris kedua, padding, tenggat, persen, kode unik, biaya, awalan, pola tanpa {SEQ})', async () => {
  await rejects(`INSERT INTO invoice_settings (id, "updatedAt") VALUES ('lain', now())`, 'id selain global')
  for (const [col, bad] of [['numberPadding', 0], ['numberPadding', 11], ['defaultDueDays', 400], ['defaultDueDays', -1], ['expireDaysBeforeReference', 366], ['minimumFirstPaymentPercent', 100.5], ['ipaymuFeePercent', 101], ['xenditFeeFlatIdr', 10_000_001]] as const)
    await rejects(`UPDATE invoice_settings SET "${col}" = ${bad} WHERE id = 'global'`, `${col}=${bad}`)
  await rejects(`UPDATE invoice_settings SET "uniqueCodeMin" = 500, "uniqueCodeMax" = 500 WHERE id = 'global'`, 'kode unik min>=max')
  await rejects(`UPDATE invoice_settings SET "uniqueCodeMax" = 10000 WHERE id = 'global'`, 'kode unik > 9999')
  await rejects(`UPDATE invoice_settings SET "numberPrefix" = 'IN V' WHERE id = 'global'`, 'awalan berspasi')
  await rejects(`UPDATE invoice_settings SET "numberPattern" = '{PREFIX}-{YYYY}' WHERE id = 'global'`, 'pola tanpa {SEQ}')
  await rejects(`INSERT INTO tax_rules (id, name, "ratePercent", "updatedAt") VALUES ('x1', 'PPN', 101, now())`, 'tarif > 100')
  await rejects(`INSERT INTO tax_rules (id, name, "ratePercent", "basisPercent", "updatedAt") VALUES ('x2', 'PPN', 11, 0, now())`, 'dasar 0')
  await rejects(`INSERT INTO tax_rules (id, name, "ratePercent", "updatedAt") VALUES ('x3', '  ', 11, now())`, 'nama kosong')
  await rejects(`INSERT INTO bank_accounts (id, "bankName", "accountNumber", "accountHolder", "updatedAt") VALUES ('b1', ' ', '1', 'A', now())`, 'bank kosong')
  await rejects(`INSERT INTO qris_accounts (id, name, "updatedAt") VALUES ('q1', '', now())`, 'nama QRIS kosong')
  await rejects(`INSERT INTO invoice_sequences (key, "lastNumber", "updatedAt") VALUES ('neg', -1, now())`, 'urut negatif')
})

console.log('== pola nomor & validasi ==')
await t('numberPatternError (tabel nilai): token dikenal, {SEQ} tepat satu, tahun wajib bila diulang tahunan, karakter liar/token asing ditolak', () => {
  const table: Array<[string, boolean, string | null]> = [
    ['{PREFIX}-{YYYY}-{SEQ}', true, null], ['{PREFIX}/{YY}{MM}/{SEQ}', true, null], ['INV-{SEQ}', false, null], ['{SEQ}', false, null],
    ['{PREFIX}-{SEQ}', true, 'Nomor diulang tiap tahun — pola harus memuat {YYYY} atau {YY}'],
    ['{PREFIX}-{YYYY}', true, 'Pola nomor harus memuat {SEQ} tepat satu kali'],
    ['{SEQ}-{SEQ}-{YYYY}', true, 'Pola nomor harus memuat {SEQ} tepat satu kali'],
    ['{PREFIX}-{YYYY}-{SEQ}-{FOO}', true, 'Pola nomor memuat token yang tidak dikenal (yang tersedia: {PREFIX} {YYYY} {YY} {MM} {SEQ})'],
    ['INV {YYYY} {SEQ}', true, 'Pola nomor hanya boleh huruf, angka, titik, garis bawah, garis miring, dan tanda hubung'],
    ['', true, 'Pola nomor 1–60 karakter'], ['x'.repeat(61), true, 'Pola nomor 1–60 karakter'],
  ]
  for (const [pat, yearly, want] of table) assert.equal(numberPatternError(pat, yearly), want, `${pat} (yearly=${yearly})`)
})
await t('formatInvoiceNumber (tabel nilai dihitung tangan): padding, tahun 2/4 digit, bulan, melebihi lebar tak dipotong', () => {
  const p = { prefix: 'INV', year: 2026, month: 7, seq: 7, padding: 4 }
  assert.equal(formatInvoiceNumber('{PREFIX}-{YYYY}-{SEQ}', p), 'INV-2026-0007')
  assert.equal(formatInvoiceNumber('{PREFIX}/{YY}{MM}/{SEQ}', p), 'INV/2607/0007')
  assert.equal(formatInvoiceNumber('{SEQ}', { ...p, seq: 12345 }), '12345')
  assert.equal(formatInvoiceNumber('SND-{YYYY}-{SEQ}', { ...p, padding: 6, prefix: '' }), 'SND-2026-000007')
  assert.equal(formatInvoiceNumber('{PREFIX}-{YYYY}-{SEQ}', { ...p, year: 2027, seq: 1 }), 'INV-2027-0001')
})
await t('invoiceSettingsSchema: bawaan lolos; zona/email/situs/pola/kode unik/rentang salah ditolak; kolom liar ditolak (.strict); alamat opsional', () => {
  assert.ok(invoiceSettingsSchema.safeParse(valid()).success)
  const bad = (patch: Record<string, unknown>) => invoiceSettingsSchema.safeParse({ ...valid(), ...patch }).success
  assert.equal(bad({ appTimezone: 'Asia/Nowhere' }), false); assert.equal(bad({ appTimezone: 'WIB' }), false)
  assert.equal(bad({ companyEmail: 'bukan-email' }), false); assert.equal(bad({ companyEmail: 'a@b.co' }), true)
  assert.equal(bad({ companyWebsite: 'ftp://x.y' }), false); assert.equal(bad({ companyWebsite: 'https://saudinesia.com' }), true)
  assert.equal(bad({ numberPattern: '{PREFIX}-{YYYY}' }), false); assert.equal(bad({ numberResetYearly: true, numberPattern: '{SEQ}' }), false); assert.equal(bad({ numberResetYearly: false, numberPattern: '{SEQ}' }), true)
  assert.equal(bad({ uniqueCodeMin: 500, uniqueCodeMax: 500 }), false); assert.equal(bad({ uniqueCodeMax: 10000 }), false)
  for (const [k, v] of [['numberPadding', 0], ['defaultDueDays', 366], ['expireDaysBeforeReference', -1], ['minimumFirstPaymentPercent', 101], ['ipaymuFeePercent', -1], ['xenditFeeFlatIdr', 10_000_001], ['defaultDueDays', 1.5]] as const) assert.equal(bad({ [k]: v }), false, `${k}=${v}`)
  for (const extra of [{ id: 'lain' }, { updatedById: 'x' }, { liar: 1 }, { companyAddressId: 'x' }]) assert.equal(bad(extra), false, JSON.stringify(extra))
  assert.equal(bad({ address: { type: 'international', fullAddress: '1 Orchard Rd', countryCode: 'SG' } }), true)
  assert.equal(bad({ address: { type: 'domestic', fullAddress: 'Jl. X' } }), false, 'alamat domestik tanpa provinsi')
  assert.equal(bad({ termsDoc: '{bukan json' }), false, 'teks kaya tak sah ditolak')
  assert.equal(bad({ termsDoc: '{"type":"doc","content":[{"type":"script"}]}' }), false, 'node di luar daftar putih ditolak')
  assert.equal(bad({ termsDoc: 'Teks polos lama' }), true, 'teks polos diterima (data lama)')
})
await t('skema bank/QRIS/pajak: batas dan bentuk (tarif 3 desimal, dasar 0 ditolak, payload QRIS harus 000201…, nomor rekening karakter liar ditolak, .strict)', () => {
  assert.ok(bankAccountSchema.safeParse({ bankName: 'BSI', accountNumber: '7000 123 456', accountHolder: 'PT S' }).success)
  for (const b of [{ bankName: '', accountNumber: '1', accountHolder: 'A' }, { bankName: 'B', accountNumber: '12;DROP', accountHolder: 'A' }, { bankName: 'B', accountNumber: '1', accountHolder: 'A', extra: 1 }]) assert.equal(bankAccountSchema.safeParse(b).success, false, JSON.stringify(b))
  assert.ok(qrisAccountSchema.safeParse({ name: 'QRIS', emvPayload: '00020101021226' }).success)
  assert.equal(qrisAccountSchema.safeParse({ name: 'QRIS', emvPayload: 'http://evil' }).success, false)
  assert.ok(taxRuleSchema.safeParse({ name: 'PPN', ratePercent: 11, basisPercent: 100, mode: 'added' }).success)
  assert.ok(taxRuleSchema.safeParse({ name: 'PPN', ratePercent: 12, basisPercent: 91.667, mode: 'included' }).success)
  for (const x of [{ ratePercent: 101 }, { ratePercent: 11.1234 }, { basisPercent: 0 }, { basisPercent: 100.1 }, { mode: 'lain' }, { name: '' }]) assert.equal(taxRuleSchema.safeParse({ name: 'PPN', ratePercent: 11, basisPercent: 100, mode: 'added', ...x }).success, false, JSON.stringify(x))
})

console.log('== simpan, alamat, zona waktu ==')
await t('updateInvoiceSettings menyimpan nilai, mencatat staf, memperbarui zona aplikasi; alamat dibuat → diubah (baris yang sama) → dihapus (tanpa yatim)', async () => {
  const staff = await prisma.user.findFirstOrThrow({ where: { role: { in: ['superadmin', 'admin', 'manager'] } }, select: { id: true } }).catch(async () => prisma.user.create({ data: { email: `inv-${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } }))
  const base = invoiceSettingsSchema.parse({ ...valid(), numberPrefix: 'SND', appTimezone: 'Asia/Riyadh', defaultDueDays: 10, companyName: 'PT Saudinesia', companyEmail: 'a@b.co', address: { type: 'international', fullAddress: '1 Orchard Rd', countryCode: 'SG', city: 'Singapore' } })
  const s1 = await updateInvoiceSettings(base, staff.id)
  assert.deepEqual([s1.numberPrefix, s1.defaultDueDays, s1.appTimezone, s1.companyName, s1.updatedById], ['SND', 10, 'Asia/Riyadh', 'PT Saudinesia', staff.id])
  assert.equal(getAppTimezone(), 'Asia/Riyadh', 'zona proses ikut setelan')
  assert.ok(s1.companyAddress); createdAddresses.push(s1.companyAddress!.id)
  const s2 = await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), address: { type: 'international', fullAddress: '2 Marina Blvd', countryCode: 'SG', city: 'Singapore' } }), staff.id)
  assert.equal(s2.companyAddress!.id, s1.companyAddress!.id, 'alamat diubah di tempat')
  assert.equal(s2.companyAddress!.fullAddress, '2 Marina Blvd'); assert.equal(getAppTimezone(), 'Asia/Jakarta')
  const s3 = await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), address: null }), staff.id)
  assert.equal(s3.companyAddress, null)
  assert.equal(await prisma.address.count({ where: { id: s1.companyAddress!.id } }), 0, 'alamat lama dihapus, bukan yatim')
  const s4 = await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), companyName: 'Tanpa Alamat Berubah' }), staff.id)
  assert.equal(s4.companyAddress, null); assert.equal(s4.companyName, 'Tanpa Alamat Berubah')
})
await t('alamat tak sah (hierarki wilayah salah) → SettingsError 400, pengaturan TIDAK berubah dan tak ada alamat yatim', async () => {
  await resetDefaults()
  const before = await prisma.address.count()
  const input = invoiceSettingsSchema.parse({ ...valid(), companyName: 'Tak Boleh Tersimpan', address: { type: 'domestic', fullAddress: 'Jl. X', provinceId: 'tak-ada', regencyId: 'tak-ada-juga' } })
  await assert.rejects(() => updateInvoiceSettings(input, 'staf'), (e: unknown) => e instanceof SettingsError && e.status === 400)
  assert.equal((await getInvoiceSettings()).companyName, null)
  assert.equal(await prisma.address.count(), before)
})
await t('loadAppTimezone (boot): memuat zona dari DB; nilai tak dikenal di DB diabaikan (zona tak berubah, tak melempar)', async () => {
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { appTimezone: 'Asia/Makassar' } })
  setAppTimezone('Asia/Jakarta')
  assert.equal(await loadAppTimezone(), 'Asia/Makassar'); assert.equal(getAppTimezone(), 'Asia/Makassar')
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { appTimezone: 'Planet/Mars' } })
  assert.equal(await loadAppTimezone(), null); assert.equal(getAppTimezone(), 'Asia/Makassar', 'tak berubah')
  await resetDefaults()
})

await t('SEC-110: loadAppTimezone MENCOBA ULANG saat database gagal (boot sebelum DB siap): gagal dua kali lalu berhasil → zona dimuat; gagal terus → null tanpa melempar; nilai tak dikenal tak diulang', async () => {
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { appTimezone: 'Asia/Makassar' } }); setAppTimezone('Asia/Jakarta')
  const model = prisma.invoiceSettings as unknown as { findUnique: (...a: unknown[]) => Promise<unknown> }
  const real = model.findUnique.bind(model); let calls = 0
  const orig = console.error; console.error = () => {}
  try {
    model.findUnique = async (...a: unknown[]) => { if (++calls <= 2) throw new Error('belum siap'); return real(...a) }
    assert.equal(await loadAppTimezone({ attempts: 5, delayMs: 5 }), 'Asia/Makassar'); assert.equal(calls, 3); assert.equal(getAppTimezone(), 'Asia/Makassar')
    setAppTimezone('Asia/Jakarta'); calls = 0
    model.findUnique = async () => { calls++; throw new Error('mati') }
    assert.equal(await loadAppTimezone({ attempts: 3, delayMs: 5 }), null); assert.equal(calls, 3); assert.equal(getAppTimezone(), 'Asia/Jakarta')
    calls = 0; model.findUnique = async () => { calls++; return { appTimezone: 'Planet/Mars' } }
    assert.equal(await loadAppTimezone({ attempts: 3, delayMs: 5 }), null); assert.equal(calls, 1, 'nilai tak dikenal tak diulang')
  } finally { model.findUnique = real; console.error = orig; await resetDefaults() }
})

console.log('== penomoran ==')
const wipeSeq = () => prisma.invoiceSequence.deleteMany()
await t('allocateInvoiceNumber: urut 1,2,3 berformat sesuai pola; 20 alokasi PARALEL (transaksi terpisah) menghasilkan nomor unik dan berurutan tanpa lompat', async () => {
  await wipeSeq(); await resetDefaults()
  const at = new Date('2026-07-15T03:00:00Z')
  const one = await prisma.$transaction(tx => allocateInvoiceNumber(tx, at))
  assert.deepEqual([one.number, one.seq, one.key], ['INV-2026-0001', 1, '2026'])
  const many = await Promise.all(Array.from({ length: 20 }, () => prisma.$transaction(tx => allocateInvoiceNumber(tx, at))))
  assert.deepEqual(many.map(m => m.seq).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2))
  assert.equal(new Set(many.map(m => m.number)).size, 20)
  assert.equal((await prisma.invoiceSequence.findUniqueOrThrow({ where: { key: '2026' } })).lastNumber, 21)
})
await t('rollback TIDAK meninggalkan lompatan: transaksi yang dibatalkan mengembalikan nomor; nomor berikutnya melanjutkan tanpa celah', async () => {
  await wipeSeq()
  const at = new Date('2026-07-15T03:00:00Z')
  await prisma.$transaction(tx => allocateInvoiceNumber(tx, at))
  await assert.rejects(() => prisma.$transaction(async tx => { await allocateInvoiceNumber(tx, at); throw new Error('gagal terbit') }), /gagal terbit/)
  const next = await prisma.$transaction(tx => allocateInvoiceNumber(tx, at))
  assert.equal(next.seq, 2, 'nomor 2 dipakai ulang setelah rollback — tak ada lubang')
})
await t('tahun diulang menurut ZONA APLIKASI: 31 Des 17:00 UTC = 1 Jan WIB → nomor 2027-0001; di Riyadh masih 2026; tanpa pengulangan memakai kunci "all"', async () => {
  await wipeSeq(); await resetDefaults()
  const nye = new Date('2026-12-31T17:00:00Z')
  assert.equal((await prisma.$transaction(tx => allocateInvoiceNumber(tx, new Date('2026-12-31T16:59:59Z')))).number, 'INV-2026-0001')
  assert.equal((await prisma.$transaction(tx => allocateInvoiceNumber(tx, nye))).number, 'INV-2027-0001', 'tahun baru mulai tepat 00:00 WIB, urut kembali ke 1')
  setAppTimezone('Asia/Riyadh')
  try { assert.equal((await prisma.$transaction(tx => allocateInvoiceNumber(tx, nye))).number, 'INV-2026-0002', 'Riyadh masih 31 Des 20.00') } finally { setAppTimezone('Asia/Jakarta') }
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { numberResetYearly: false, numberPattern: '{PREFIX}-{SEQ}', numberPadding: 3 } })
  const a = await prisma.$transaction(tx => allocateInvoiceNumber(tx, nye)); const b = await prisma.$transaction(tx => allocateInvoiceNumber(tx, new Date('2027-06-01T00:00:00Z')))
  assert.deepEqual([a.number, a.key, b.number], ['INV-001', 'all', 'INV-002'])
  await wipeSeq(); await resetDefaults()
})

console.log('== daftar (CRUD lewat handler, jejak audit) ==')
const STAFF = 'staf-uji-1'
const mkHandlers = () => ({
  bank: createListHandlers({ tag: 't/bank', label: 'Rekening bank', entity: 'bank_account', schema: bankAccountSchema, updateSchema: bankAccountUpdateSchema, adapter: bankAccountAdapter, requireStaff: async () => ({ userId: STAFF }) }),
  qris: createListHandlers({ tag: 't/qris', label: 'Akun QRIS', entity: 'qris_account', schema: qrisAccountSchema, updateSchema: qrisAccountUpdateSchema, adapter: qrisAccountAdapter, requireStaff: async () => ({ userId: STAFF }) }),
  tax: createListHandlers({ tag: 't/tax', label: 'Aturan pajak', entity: 'tax_rule', schema: taxRuleSchema, updateSchema: taxRuleUpdateSchema, adapter: taxRuleAdapter, requireStaff: async () => ({ userId: STAFF }) }),
})
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (r: Response) => (await r.json()) as { success: boolean; data?: Record<string, unknown> & { id?: string }; error?: string }
const audits = (entityId: string) => prisma.settingsAudit.findMany({ where: { entityId }, orderBy: { at: 'asc' } })

await t('rekening bank: buat (201) → ubah penuh → nonaktifkan (aksi ikon) → duplikat bank+nomor 409 → hapus 200 → hapus lagi 404; tiap perubahan menulis jejak dengan nomor rekening DISAMARKAN', async () => {
  const h = mkHandlers().bank
  const created = await json(await h.POST(req({ bankName: 'Bank Uji', accountNumber: '70001234567', accountHolder: 'PT Uji', sortOrder: 2 })))
  assert.equal(created.success, true); const id = created.data!.id!
  const second = await json(await h.POST(req({ bankName: 'Bank Uji', accountNumber: '222', accountHolder: 'PT Uji', sortOrder: 1 })))
  const list = await json(await h.GET())
  assert.deepEqual((list.data as unknown as Array<{ id: string }>).filter(x => [id, second.data!.id].includes(x.id)).map(x => x.id), [second.data!.id, id], 'urut sortOrder')
  const upd = await h.PUT(req({ bankName: 'Bank Uji', accountNumber: '70001234567', accountHolder: 'PT Baru', branch: null, isActive: true, sortOrder: 2 }), ctx(id))
  assert.equal(upd.status, 200)
  assert.equal((await json(await h.PUT(req({ isActive: false }), ctx(id)))).data!.isActive, false)
  assert.equal((await h.POST(req({ bankName: 'Bank Uji', accountNumber: '70001234567', accountHolder: 'X' }))).status, 409)
  assert.equal((await h.DELETE(req(null), ctx(id))).status, 200)
  assert.equal((await h.DELETE(req(null), ctx(id))).status, 404)
  const log = await audits(id)
  assert.deepEqual(log.map(l => [l.action, l.staffId]), [['create', STAFF], ['update', STAFF], ['toggle', STAFF], ['delete', STAFF]])
  const dump = JSON.stringify(log.map(l => l.summary))
  assert.ok(!dump.includes('70001234567') && dump.includes('••••4567'), 'nomor rekening tak pernah utuh di jejak')
  assert.deepEqual((log[2]!.summary as { isActive: unknown[] }).isActive, [true, false])
  assert.ok((log[1]!.summary as { before: { accountHolder: string }; after: { accountHolder: string } }).before.accountHolder === 'PT Uji' && (log[1]!.summary as { after: { accountHolder: string } }).after.accountHolder === 'PT Baru')
  await h.DELETE(req(null), ctx(second.data!.id!))
})
await t('SEC-112: PUT penuh MEWAJIBKAN isActive dan sortOrder (menghilangkannya tak menghidupkan kembali baris nonaktif); POST memakai bawaan; kolom liar 400; aksi ikon hanya {isActive: boolean}', async () => {
  const h = mkHandlers().bank
  const c = await json(await h.POST(req({ bankName: 'Bank Uji2', accountNumber: '999', accountHolder: 'PT', isActive: false })))
  const id = c.data!.id!
  assert.equal(c.data!.sortOrder, 0, 'bawaan saat buat')
  assert.equal((await h.PUT(req({ bankName: 'Bank Uji2', accountNumber: '999', accountHolder: 'PT' }), ctx(id))).status, 400, 'tanpa isActive/sortOrder ditolak')
  assert.equal((await prisma.bankAccount.findUniqueOrThrow({ where: { id } })).isActive, false, 'tetap nonaktif')
  assert.equal((await h.PUT(req({ bankName: 'B', accountNumber: '1', accountHolder: 'A', isActive: true, sortOrder: 0, liar: 1 }), ctx(id))).status, 400)
  assert.equal((await h.PUT(req({ isActive: 'ya' }), ctx(id))).status, 400)
  assert.equal((await h.PUT(req({ isActive: true, bankName: 'X' }), ctx(id))).status, 400, 'bukan bentuk {isActive} saja → wajib skema penuh')
  await h.DELETE(req(null), ctx(id))
})
await t('QRIS dan pajak lewat handler: buat/ubah/aktif/hapus + jejak (payload QRIS hanya panjangnya); tarif desimal utuh; tarif 101 ditolak', async () => {
  const { qris, tax } = mkHandlers()
  const q = await json(await qris.POST(req({ name: 'QRIS Uji', emvPayload: '00020101021226ABCDEF' }))); const qid = q.data!.id!
  assert.equal((await qris.PUT(req({ name: 'QRIS Uji', emvPayload: null, isActive: false, sortOrder: 0 }), ctx(qid))).status, 200)
  assert.equal((await qris.POST(req({ name: 'Salah', emvPayload: 'http://evil' }))).status, 400)
  await qris.DELETE(req(null), ctx(qid))
  const qlog = JSON.stringify((await audits(qid)).map(l => l.summary))
  assert.ok(!qlog.includes('ABCDEF') && qlog.includes('(20 karakter)'), 'payload QRIS tak tersimpan di jejak')
  const t1 = await json(await tax.POST(req({ name: 'PPN Uji', ratePercent: 11, basisPercent: 91.667, mode: 'included' })))
  assert.deepEqual([t1.data!.ratePercent, t1.data!.basisPercent], [11, 91.667]); assert.equal((await tax.POST(req({ name: 'X', ratePercent: 101, basisPercent: 100, mode: 'added' }))).status, 400)
  await tax.DELETE(req(null), ctx(t1.data!.id!))
})
await t('jejak append-only di DB: UPDATE dan DELETE pada settings_audit ditolak trigger (hanya penambahan)', async () => {
  const row = await prisma.settingsAudit.findFirstOrThrow()
  await assert.rejects(() => exec(`UPDATE settings_audit SET action = 'x' WHERE id = '${row.id}'`), /append-only/)
  await assert.rejects(() => exec(`DELETE FROM settings_audit WHERE id = '${row.id}'`), /append-only/)
})
await t('autentikasi list handler: bukan superadmin → 403 untuk semua verb tanpa perubahan/jejak; galat infrastruktur (bukan auth) → 500 + log (tak disamarkan jadi 403); bawaan = requireSuperAdmin (sumber)', async () => {
  const before = await prisma.settingsAudit.count(); const rows = await prisma.bankAccount.count()
  const denied = (msg: string) => createListHandlers({ tag: 't/anon', label: 'Rekening bank', entity: 'bank_account', schema: bankAccountSchema, updateSchema: bankAccountUpdateSchema, adapter: bankAccountAdapter, requireStaff: async () => { throw new Error(msg) } })
  for (const msg of ['Unauthorized', 'Forbidden']) {
    const h = denied(msg)
    assert.equal((await h.POST(req({ bankName: 'B', accountNumber: '1', accountHolder: 'A' }))).status, 403, `${msg} POST`)
    assert.equal((await h.GET()).status, 403); assert.equal((await h.PUT(req({ isActive: false }), ctx('x'))).status, 403); assert.equal((await h.DELETE(req(null), ctx('x'))).status, 403)
  }
  const orig = console.error; console.error = () => {}
  try { assert.equal((await denied('database mati').GET()).status, 500) } finally { console.error = orig }
  assert.equal(await prisma.settingsAudit.count(), before); assert.equal(await prisma.bankAccount.count(), rows)
})

console.log('== SEC-108/112/114/115/117 pengaturan ==')
await t('SEC-108: "urut diulang tiap tahun" TIDAK dapat dibalik setelah ada nomor terbit (nomor kembar); setelah penghitung kosong boleh; mengubah pola/awalan tetap boleh', async () => {
  await resetDefaults(); await wipeSeq()
  await prisma.$transaction(tx => allocateInvoiceNumber(tx, new Date('2026-07-15T03:00:00Z')))
  const flip = invoiceSettingsSchema.parse({ ...valid(), numberResetYearly: false })
  await assert.rejects(() => updateInvoiceSettings(flip, STAFF), (e: unknown) => e instanceof SettingsError && e.status === 409 && /kembar/.test(e.message))
  assert.equal((await getInvoiceSettings()).numberResetYearly, true, 'tidak berubah')
  const ok1 = await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), numberPrefix: 'SND', numberPattern: '{PREFIX}/{YY}/{SEQ}' }), STAFF)
  assert.equal(ok1.numberPrefix, 'SND')
  await wipeSeq()
  assert.equal((await updateInvoiceSettings(flip, STAFF)).numberResetYearly, false)
  await wipeSeq(); await resetDefaults()
})
await t('SEC-117: token konkurensi — expectedUpdatedAt basi → 409; yang segar lolos; dua penyimpan SERENTAK dengan alamat baru menghasilkan SATU alamat (tak ada yatim)', async () => {
  await resetDefaults()
  const s0 = await getInvoiceSettings()
  await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), companyName: 'A', expectedUpdatedAt: s0.updatedAt }), STAFF)
  await assert.rejects(() => updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), companyName: 'B', expectedUpdatedAt: s0.updatedAt }), STAFF), (e: unknown) => e instanceof SettingsError && e.status === 409)
  assert.equal((await getInvoiceSettings()).companyName, 'A', 'tak menimpa perubahan orang lain')
  const before = await prisma.address.count()
  const withAddr = (n: number) => invoiceSettingsSchema.parse({ ...valid(), address: { type: 'international', fullAddress: `${n} Orchard Rd`, countryCode: 'SG', city: 'Singapore' } })
  await Promise.all([1, 2, 3, 4, 5].map(n => updateInvoiceSettings(withAddr(n), STAFF)))
  assert.equal(await prisma.address.count(), before + 1, 'tepat satu alamat baru')
  const cur = await getInvoiceSettings(); createdAddresses.push(cur.companyAddress!.id)
  await resetDefaults()
})
await t('SEC-109 jejak pengaturan: hanya kolom yang BERUBAH tercatat ([lama, baru]); teks kaya "berubah" tanpa isi; alamat dibuat/diubah/dihapus; tanpa perubahan = tanpa jejak', async () => {
  await resetDefaults(); const start = await prisma.settingsAudit.count({ where: { entity: 'invoice_settings' } })
  await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), companyName: null }), STAFF)
  assert.equal(await prisma.settingsAudit.count({ where: { entity: 'invoice_settings' } }), start, 'tak ada perubahan → tak ada jejak')
  await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), companyName: null, defaultDueDays: 9, appTimezone: 'Asia/Makassar', termsDoc: 'Syarat rahasia panjang' }), STAFF)
  const last = (await prisma.settingsAudit.findMany({ where: { entity: 'invoice_settings' }, orderBy: { at: 'desc' }, take: 1 }))[0]!
  assert.deepEqual(last.summary, { defaultDueDays: [4, 9], appTimezone: ['Asia/Jakarta', 'Asia/Makassar'], termsDoc: 'berubah' })
  assert.equal(last.staffId, STAFF)
  await resetDefaults()
})
await t('SEC-114: zona yang DISIMPAN harus kanonik (daftar runtime) — "+07:00", "GMT+7", huruf kecil, "WIB" ditolak; nama kanonik lolos; pengecekan pg_timezone_names ada di jalur simpan', () => {
  for (const bad of ['+07:00', 'GMT+7', 'UTC+7', 'asia/jakarta', 'WIB', '07:00', 'Asia/Nowhere']) assert.equal(invoiceSettingsSchema.safeParse({ ...valid(), appTimezone: bad }).success, false, bad)
  for (const good of ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Riyadh', 'America/Los_Angeles', 'UTC']) assert.equal(invoiceSettingsSchema.safeParse({ ...valid(), appTimezone: good }).success, true, good)
  assert.match(read('lib/invoice/settings.ts'), /pg_timezone_names WHERE name = \$\{fields\.appTimezone\}/)
})
await t('SEC-114: zona yang dikenal ICU tetapi TIDAK ada di pg_timezone_names ditolak 400 saat simpan (database tak dapat memakainya di SQL laporan) — disimulasikan karena daftar ICU dan Postgres saat ini sama', async () => {
  await resetDefaults()
  const real = prisma.$transaction.bind(prisma) as (fn: (tx: unknown) => Promise<unknown>, o?: unknown) => Promise<unknown>
  const patched = ((fn: (tx: unknown) => Promise<unknown>, o?: unknown) => real(tx => {
    const t2 = tx as { $queryRaw: (...a: unknown[]) => Promise<unknown> }
    const proxy = new Proxy(t2, { get: (target, prop) => prop === '$queryRaw' ? (strings: TemplateStringsArray, ...v: unknown[]) => (strings.join('?').includes('pg_timezone_names') ? Promise.resolve([{ n: 0 }]) : (target.$queryRaw as (...a: unknown[]) => Promise<unknown>)(strings, ...v)) : (target as never)[prop as never] })
    return fn(proxy)
  }, o))
  ;(prisma as unknown as { $transaction: unknown }).$transaction = patched
  try {
    await assert.rejects(() => updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), appTimezone: 'Asia/Makassar' }), STAFF), (e: unknown) => e instanceof SettingsError && e.status === 400 && /database/.test(e.message))
    assert.equal((await getInvoiceSettings()).appTimezone, 'Asia/Jakarta', 'tak berubah')
  } finally { (prisma as unknown as { $transaction: unknown }).$transaction = real }
  assert.equal((await updateInvoiceSettings(invoiceSettingsSchema.parse({ ...valid(), appTimezone: 'Asia/Makassar' }), STAFF)).appTimezone, 'Asia/Makassar', 'tanpa simulasi: lolos')
  await resetDefaults()
})
await t('SEC-116: situs dinormalkan lewat URL (href sah) dan menolak kutip/kurung sudut/spasi/skema lain; karakter kontrol/baris baru ditolak di nama/teks pendek', () => {
  const site = (v: string) => invoiceSettingsSchema.safeParse({ ...valid(), companyWebsite: v })
  const ok2 = site('https://saudinesia.com'); assert.ok(ok2.success && ok2.data.companyWebsite === 'https://saudinesia.com/')
  for (const bad of ['https://x.y/"onmouseover=1', "https://x.y/'a", 'https://x.y/<script>', 'https://x.y/ a', 'javascript:alert(1)', 'ftp://x.y', 'saudinesia.com']) assert.equal(site(bad).success, false, bad)
  for (const f of ['companyName', 'companyTaxId', 'companyPhone', 'numberPrefix']) assert.equal(invoiceSettingsSchema.safeParse({ ...valid(), [f]: 'Ab\ncd' }).success, false, `${f} berbaris baru`)
  assert.equal(bankAccountSchema.safeParse({ bankName: 'B\u0007', accountNumber: '1', accountHolder: 'A' }).success, false)
})
await t('SEC-115: CHECK tambahan di DB (charset pola nomor, situs, payload QRIS, bentuk zona) menolak nilai liar lewat SQL mentah', async () => {
  await rejects(`UPDATE invoice_settings SET "numberPattern" = '{PREFIX}-<b>{SEQ}' WHERE id = 'global'`, 'pola dengan <')
  await rejects(`UPDATE invoice_settings SET "numberPattern" = '{PREFIX} {SEQ}' WHERE id = 'global'`, 'pola berspasi')
  await rejects(`UPDATE invoice_settings SET "numberPattern" = E'{SEQ}\\n' WHERE id = 'global'`, 'pola berbaris baru')
  await rejects(`UPDATE invoice_settings SET "companyWebsite" = 'javascript:alert(1)' WHERE id = 'global'`, 'situs bukan http(s)')
  await rejects(`UPDATE invoice_settings SET "companyWebsite" = 'https://x.y/"z' WHERE id = 'global'`, 'situs berkutip')
  await rejects(`UPDATE invoice_settings SET "appTimezone" = '+07:00' WHERE id = 'global'`, 'zona bentuk offset')
  await rejects(`INSERT INTO qris_accounts (id, name, "emvPayload", "updatedAt") VALUES ('q9', 'Q', 'http://evil', now())`, 'payload QRIS liar')
})
await t('SEC-111: logo invoice (media invoice_settings) hanya superadmin — manager 403 di GET/POST/PATCH/DELETE; superadmin lolos; tipe lain (hotel) tak terpengaruh', async () => {
  const stub = { url: async () => 'u', put: async () => undefined, delete: async () => undefined, deleteMany: async () => undefined } as never
  const mk = (role: string) => createMediaHandlers({ requireWrite: async () => ({ role }), storage: stub })
  const c = (id: string, type = 'invoice_settings') => ({ params: Promise.resolve({ productType: type, productId: id }) })
  const ci = (id: string, imageId: string, type = 'invoice_settings') => ({ params: Promise.resolve({ productType: type, productId: id, imageId }) })
  const uuid = '11111111-1111-4111-8111-111111111111'
  for (const role of ['manager', 'admin', 'pilgrim']) {
    const h = mk(role)
    assert.equal((await h.listGET(new Request('http://x'), c('global'))).status, 403, `${role} GET`)
    assert.equal((await h.listPOST(new Request('http://x', { method: 'POST', body: new FormData() }), c('global'))).status, 403, `${role} POST`)
    assert.equal((await h.itemPATCH(new Request('http://x', { method: 'PATCH', body: '{}' }), ci('global', uuid))).status, 403, `${role} PATCH`)
    assert.equal((await h.itemDELETE(new Request('http://x', { method: 'DELETE' }), ci('global', uuid))).status, 403, `${role} DELETE`)
  }
  assert.equal((await mk('superadmin').listGET(new Request('http://x'), c('global'))).status, 200)
  assert.equal((await mk('manager').listGET(new Request('http://x'), c(uuid, 'hotel'))).status, 404, 'hotel: lolos pemeriksaan peran, hotel uji tak ada → 404 (bukan 403)')
  assert.equal((await mk('superadmin').listGET(new Request('http://x'), c('lain'))).status, 404, 'id selain global ditolak')
})

console.log('== penjaga sumber ==')
await t('route: auth superadmin di baris pertama (authFailureResponse), skema .strict, tanpa body mentah ke Prisma, tanpa catch 403 polos; list handler: PUT {isActive} saja = ganti status, selain itu skema penuh', () => {
  const dirs = ['invoice-settings', 'bank-accounts', 'bank-accounts/[id]', 'qris-accounts', 'qris-accounts/[id]', 'tax-rules', 'tax-rules/[id]']
  for (const d of dirs) {
    const src = read(`app/api/v1/admin/system/${d}/route.ts`)
    assert.match(src, /export (async function|const) (GET|POST|PUT|DELETE)/, d)
    assert.doesNotMatch(src, /prisma\./, `${d}: route tipis, tanpa Prisma langsung`)
  }
  const handlers = read('lib/invoice/listHandlers.ts')
  assert.equal((handlers.match(/const a = await staff\('/g) ?? []).length, 4, 'tiap verb memanggil staff() (requireSuperAdmin) lebih dulu')
  assert.match(handlers, /opts\.requireStaff \?\? requireSuperAdmin/, 'bawaan = requireSuperAdmin')
  assert.equal((handlers.match(/writeAudit\(tx,/g) ?? []).length, 4, 'tiap perubahan menulis jejak di transaksi yang sama')
  assert.doesNotMatch(handlers, /catch\s*\{\s*return NextResponse\.json\(err\('Forbidden'\)/)
  assert.match(handlers, /keys\.length === 1 && keys\[0\] === 'isActive'/)
  const settingsRoute = read('app/api/v1/admin/system/invoice-settings/route.ts')
  assert.equal((settingsRoute.match(/requireSuperAdmin\(\)/g) ?? []).length, 2)
  assert.match(settingsRoute, /invoiceSettingsSchema\.safeParse/)
  assert.doesNotMatch(settingsRoute, /data: *(body|b)\b/)
  assert.match(read('lib/validators/invoiceSettings.ts'), /\.strict\(\)\.superRefine/)
})
await t('halaman: server guard requireAdminPage + hanya superadmin; menu Sistem + breadcrumb; logo lewat MediaField registry; provider zona di layout; boot memuat zona', () => {
  const page = read('app/[locale]/admin/(protected)/system/invoice-settings/page.tsx')
  assert.match(page, /requireAdminPage\(locale\)/); assert.match(page, /SUPERADMIN_ROLES\.includes\(session\.role\)/)
  assert.match(read('lib/admin/navigation.ts'), /\/admin\/system\/invoice-settings/)
  assert.match(read('lib/admin/navigation.ts'), /'invoice-settings': 'Pengaturan Invoice'/)
  assert.match(read('lib/media/owners.ts'), /invoice_settings:[^\n]*idLiteral: 'global', superadminOnly: true/)
  assert.equal((read('lib/media/owners.ts').match(/idLiteral: 'global'/g) ?? []).length, 1, 'hanya satu pemilik berid literal')
  assert.match(read('lib/media/handlers.ts'), /lit \? p\.productId !== lit : !uuid\.safeParse\(p\.productId\)\.success/, 'pemilik lain tetap wajib UUID')
  assert.match(read('app/[locale]/layout.tsx'), /<AppTimezoneProvider tz=\{getAppTimezone\(\)\} \/>/)
  assert.match(read('instrumentation-node.ts'), /loadAppTimezone/)
  assert.match(read('app/[locale]/admin/(protected)/system/invoice-settings/InvoiceSettingsEditor.tsx'), /<MediaField productType="invoice_settings"/)
})

// ── pembersihan: kembalikan keadaan bawaan ───────────────────────────────────────────────────────────────────────────
await wipeSeq(); await resetDefaults()
await prisma.address.deleteMany({ where: { id: { in: createdAddresses } } })
await prisma.taxRule.deleteMany({ where: { name: { in: ['PPN Uji'] } } })
await exec(`TRUNCATE settings_audit`) // pembersihan uji (TRUNCATE tak melewati trigger baris append-only)
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
