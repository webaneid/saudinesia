// Template WhatsApp yang bisa diedit (GOWA self-host F3, docs/rencana-gowa-self-host.md §4.2–4.3):
// render murni (baris kosong dibuang, satu lintasan), daftar putih variabel, teks bawaan = teks lama (ekuivalensi), migrasi = daftar kunci,
// simpan (versi → 409, sama-dengan-bawaan = null, jejak tanpa isi), saklar mati → notify mencatat "dilewati" tanpa memanggil gateway.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { WA_SAMPLE, WA_TEMPLATE_DEFS, WA_TEMPLATE_KEYS, renderTemplate, templateProblem, templateVars } from '@/lib/whatsapp/templateDefs'
import { listWaTemplates, renderWa, saveWaTemplate } from '@/lib/whatsapp/templates'
import { waContent, waMessage } from '@/lib/notifications/events'
import { notify } from '@/lib/notifications/notify'
import { formatRupiah } from '@/lib/utils'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}

await t('render: variabel diisi satu lintasan; baris yang semua variabelnya kosong dibuang; baris kosong beruntun diringkas', () => {
  assert.equal(renderTemplate('A {{kodeBooking}}\nTagihan: *{{tagihan}}*\n\n\n\nZ', { kodeBooking: 'SND-1' }), 'A SND-1\n\nZ')
  assert.equal(renderTemplate('Kode {{kodeBooking}}', { kodeBooking: '{{total}}' }), 'Kode {{total}}', 'nilai tidak diproses ulang')
  assert.equal(renderTemplate('{{kodeBooking}} {{total}}', { kodeBooking: 'X' }), 'X', 'baris dengan sebagian variabel terisi tetap ada')
  assert.equal(renderTemplate('Teks tetap\n{{tak_dikenal}}', {}), 'Teks tetap', 'variabel asing = kosong')
})

await t('validasi: kosong, > 1000, variabel asing, variabel wajib hilang ditolak; semua teks bawaan sah', () => {
  assert.match(templateProblem('payment_rejected', '   ') ?? '', /kosong/)
  assert.match(templateProblem('payment_rejected', `{{kodeBooking}}${'x'.repeat(1000)}`) ?? '', /maksimal/)
  assert.match(templateProblem('payment_rejected', '{{kodeBooking}} {{nomorInvoice}}') ?? '', /tidak dikenal/)
  assert.match(templateProblem('payment_reminder_partial', '{{kodeBooking}} lunasi') ?? '', /wajib.*sisaTagihan/)
  for (const k of WA_TEMPLATE_KEYS) {
    assert.equal(templateProblem(k, WA_TEMPLATE_DEFS[k].defaultBody), null, k)
    for (const v of templateVars(WA_TEMPLATE_DEFS[k].defaultBody)) assert.ok((WA_TEMPLATE_DEFS[k].vars as readonly string[]).includes(v), `${k}: ${v}`)
  }
})

await t('tanpa PII: variabel hanya kode/jumlah/tanggal/tautan (tak ada nama, email, telepon, NIK, paspor)', () => {
  for (const k of WA_TEMPLATE_KEYS) for (const v of WA_TEMPLATE_DEFS[k].vars) assert.doesNotMatch(v, /nama|name|email|phone|telepon|nomorHp|nik|paspor|passport|alamat/i, `${k}: ${v}`)
})

await t('migrasi: CHECK dan baris semai = WA_TEMPLATE_KEYS persis', () => {
  const dir = readdirSync('prisma/migrations').find(d => d.endsWith('_whatsapp_templates'))
  assert.ok(dir)
  const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8')
  const check = /CHECK \("key" IN \(([^)]*)\)\)/.exec(sql)?.[1] ?? ''
  assert.deepEqual([...check.matchAll(/'([a-z_]+)'/g)].map(m => m[1]), [...WA_TEMPLATE_KEYS])
  const seed = sql.slice(sql.indexOf('INSERT INTO'))
  assert.deepEqual([...seed.matchAll(/\('([a-z_]+)'\)/g)].map(m => m[1]), [...WA_TEMPLATE_KEYS])
})

await prisma.whatsappTemplate.updateMany({ data: { body: null, enabled: true } })

await t('ekuivalensi: teks bawaan + nilai kejadian = teks yang dikirim sebelum F3', async () => {
  const rp = formatRupiah(2_500_000)
  const cases: [Parameters<typeof waMessage>[0], string][] = [
    [{ type: 'payment_reminder_d1', code: 'SND-1', deadline: 'besok 10.00', balance: 2_500_000 },
      `Reminder: Pembayaran booking *SND-1* belum kami terima.\nTagihan: *${rp}*\nBatas waktu: *besok 10.00*\n\nSegera lakukan pembayaran agar tempat Anda tetap aman.`],
    [{ type: 'payment_reminder_d0', code: 'SND-1', deadline: 'hari ini' },
      'Reminder: Pembayaran booking *SND-1* belum kami terima.\nBatas waktu: *hari ini*\n\nSegera lakukan pembayaran agar tempat Anda tetap aman.'],
    [{ type: 'payment_reminder_d1', code: 'SND-1', deadline: 'besok', balance: 2_500_000, partial: true },
      `Reminder: Booking *SND-1* masih memiliki sisa tagihan *${rp}*.\nBatas waktu: *besok*\n\nBukti pelunasan dapat dikirim dari halaman booking.`],
    [{ type: 'payment_confirmed', code: 'SND-1' },
      'Pembayaran booking *SND-1* telah dikonfirmasi. Terima kasih!\n\nDokumen perjalanan akan kami kirimkan segera setelah visa diproses.'],
    [{ type: 'payment_confirmed', code: 'SND-1', balance: 2_500_000 },
      `Pembayaran booking *SND-1* telah kami terima. Terima kasih!\n\nSisa tagihan: *${rp}*. Bukti pelunasan dapat dikirim dari halaman booking.`],
    [{ type: 'payment_rejected', code: 'SND-1' },
      'Bukti pembayaran untuk booking *SND-1* tidak dapat diverifikasi.\nMohon upload ulang bukti transfer yang jelas.'],
    [{ type: 'departure_reminder_1d', code: 'SND-1', date: '5 Desember 2026' },
      'Persiapkan diri Anda! Keberangkatan booking *SND-1* besok, *5 Desember 2026*.\n\nSemoga perjalanan ibadah Anda lancar dan mabrur.'],
    [{ type: 'departure_reminder_7d', code: 'SND-1', date: '5 Desember 2026' },
      'Persiapkan diri Anda! Keberangkatan booking *SND-1* 7 hari lagi, *5 Desember 2026*.\n\nSemoga perjalanan ibadah Anda lancar dan mabrur.'],
    [{ type: 'invoice_issued', code: 'SND-1', number: 'INV-1', total: 'Rp 1', dueDate: '1 Jan', path: null },
      'Invoice *INV-1* untuk booking *SND-1* sudah terbit.\nTotal tagihan: *Rp 1*\nJatuh tempo: *1 Jan*'],
  ]
  for (const [e, want] of cases) assert.equal(await waMessage(e), want, e.type)
})

await t('simpan: versi basi → stale; teks tak sah → invalid; teks = bawaan → disimpan null; kustom dipakai renderWa; jejak tanpa isi teks', async () => {
  const [row] = (await listWaTemplates()).filter(r => r.key === 'payment_rejected')
  assert.ok(row)
  assert.equal((await saveWaTemplate('payment_rejected', { body: 'Bukti *{{kodeBooking}}* ditolak.', enabled: true, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }, 'staf-uji')).kind, 'stale')
  const bad = await saveWaTemplate('payment_rejected', { body: 'Bukti {{total}} ditolak', enabled: true, expectedUpdatedAt: row.updatedAt }, 'staf-uji')
  assert.equal(bad.kind, 'invalid')
  const ok = await saveWaTemplate('payment_rejected', { body: 'Bukti *{{kodeBooking}}* ditolak.\r\nSilakan unggah ulang.', enabled: true, expectedUpdatedAt: row.updatedAt }, 'staf-uji')
  assert.equal(ok.kind, 'done')
  if (ok.kind !== 'done') return
  assert.equal(ok.template.body, 'Bukti *{{kodeBooking}}* ditolak.\nSilakan unggah ulang.')
  assert.equal(await waMessage({ type: 'payment_rejected', code: 'SND-9' }), 'Bukti *SND-9* ditolak.\nSilakan unggah ulang.')
  const audit = await prisma.settingsAudit.findFirst({ where: { entity: 'whatsapp_template', entityId: 'payment_rejected' }, orderBy: { at: 'desc' } })
  assert.deepEqual(audit?.summary, { body: 'berubah' })
  const same = await saveWaTemplate('payment_rejected', { body: WA_TEMPLATE_DEFS.payment_rejected.defaultBody, enabled: true, expectedUpdatedAt: ok.template.updatedAt }, 'staf-uji')
  assert.equal(same.kind === 'done' && same.template.body, null)
})

await t('saklar: mati → renderWa disabled, waMessage null, notify mencatat WhatsApp "dilewati" tanpa ke gateway; email tidak terpengaruh', async () => {
  const [row] = (await listWaTemplates()).filter(r => r.key === 'payment_confirmed_full')
  const off = await saveWaTemplate('payment_confirmed_full', { body: null, enabled: false, expectedUpdatedAt: row!.updatedAt }, 'staf-uji')
  assert.equal(off.kind, 'done')
  assert.deepEqual(await renderWa('payment_confirmed_full', { kodeBooking: 'X' }), { kind: 'disabled' })
  assert.equal(await waMessage({ type: 'payment_confirmed', code: 'X' }), null)
  assert.equal((await waContent({ type: 'payment_confirmed', code: 'X', balance: 5 }))?.kind, 'message', 'varian sebagian tetap aktif')
  const env = process.env as Record<string, string | undefined>
  env.WA_GATEWAY_URL = 'http://127.0.0.1:1' // tak boleh dipanggil
  const u = await prisma.user.create({ data: { email: `wa-tpl-${Date.now()}@example.test`, fullName: 'Uji', role: 'pilgrim', passwordHash: 'x', whatsapp: '6281200000777', whatsappVerifiedAt: new Date(), verifiedWhatsapp: '6281200000777' }, select: { id: true } })
  const out = await notify({ userId: u.id, event: { type: 'payment_confirmed', code: 'X' } })
  const wa = out.find(o => o.channel === 'whatsapp')
  assert.equal(wa?.status, 'skipped')
  const log = await prisma.notificationLog.findFirst({ where: { userId: u.id, channel: 'whatsapp' } })
  assert.match(log?.error ?? '', /dinonaktifkan/)
  assert.ok(out.some(o => o.channel === 'email'), 'kanal email tetap diproses')
  const now = (await listWaTemplates()).find(r => r.key === 'payment_confirmed_full')!
  await saveWaTemplate('payment_confirmed_full', { body: null, enabled: true, expectedUpdatedAt: now.updatedAt }, 'staf-uji')
  await prisma.notificationLog.deleteMany({ where: { userId: u.id } })
  await prisma.user.delete({ where: { id: u.id } })
})

await t('DB bermasalah: render jatuh ke teks bawaan (tak pernah melempar)', async () => {
  // Teks kustom yang tak lagi sah (mis. definisi berubah) diabaikan → bawaan.
  await prisma.whatsappTemplate.update({ where: { key: 'payment_rejected' }, data: { body: '{{nomorInvoice}} tanpa kode' } })
  assert.equal(await waMessage({ type: 'payment_rejected', code: 'SND-2' }), renderTemplate(WA_TEMPLATE_DEFS.payment_rejected.defaultBody, { kodeBooking: 'SND-2' }))
  await prisma.whatsappTemplate.update({ where: { key: 'payment_rejected' }, data: { body: null } })
})

await t('route + UI: superadmin, kunci divalidasi, .strict(); pratinjau editor memakai render yang sama', () => {
  const src = readFileSync('app/api/v1/admin/system/whatsapp/templates/[key]/route.ts', 'utf8')
  assert.match(src, /requireSuperAdmin\(\)/); assert.match(src, /isWaTemplateKey\(key\)/); assert.match(src, /saveWaTemplate\(/)
  assert.match(readFileSync('lib/validators/whatsapp.ts', 'utf8'), /waTemplateSaveSchema = z\.object\([\s\S]*?\)\.strict\(\)/)
  const ui = readFileSync('app/[locale]/admin/(protected)/system/whatsapp/WhatsappTemplates.tsx', 'utf8')
  assert.match(ui, /renderTemplate\(/); assert.match(ui, /templateProblem\(/); assert.doesNotMatch(ui, /dangerouslySetInnerHTML/)
  // Penulis tunggal tabel.
  for (const f of ['lib/notifications/events.ts', 'lib/notifications/notify.ts', 'app/api/v1/admin/system/whatsapp/templates/[key]/route.ts'])
    assert.doesNotMatch(readFileSync(f, 'utf8'), /whatsappTemplate\./, f)
})

void WA_SAMPLE
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
