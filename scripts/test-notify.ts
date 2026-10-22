// Uji lib/notifications/notify.ts terhadap DATABASE SUNGGUHAN + gateway WhatsApp & Resend PALSU (docs/arsitektur-notifikasi.md §3–4).
// Fokus: log notifikasi harus JUJUR (sent | failed | skipped) — dulu selalu "sent", termasuk saat gateway belum dikonfigurasi.
//
// PENGAMAN: menulis user/booking/log sementara, jadi menolak berjalan kecuali nama database memuat "test", "_ci" atau "tmp".
// Dulu uji skrip pernah terhubung ke DB dev karena Bun memuat .env.local otomatis — jangan terulang.
import assert from 'node:assert/strict'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notifications/notify'
import type { NotificationEvent } from '@/lib/notifications/events'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'
import { waMessage } from '@/lib/notifications/events'

const url = process.env.DATABASE_URL ?? ''
const dbName = url.split('/').pop()?.split('?')[0] ?? ''
if (!/(test|_ci|tmp)/i.test(dbName)) {
  console.error(`DITOLAK: database "${dbName}" bukan database uji (harus memuat test / _ci / tmp). Set DATABASE_URL ke database sekali pakai.`)
  process.exit(2)
}

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`)
  }
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'

// ───────────── server palsu ─────────────
type Req = FakeRequest
let waSeen: Req[] = []
let mailSeen: Req[] = []
let waStatus = 200
let waDelayMs = 0 // simulasi gateway lambat
let mailScript: number[] = []
const wa = await startFakeServer(async (req) => { waSeen.push(req); if (waDelayMs) await new Promise((r) => setTimeout(r, waDelayMs)); return { status: waStatus } })
const mail = await startFakeServer((req) => {
  mailSeen.push(req)
  const status = mailScript.shift() ?? 200
  return { status, body: status === 200 ? { id: `msg_${mailSeen.length}` } : { message: 'gagal' } }
})

function configure(opts: { wa?: boolean; email?: boolean } = {}) {
  const { wa: useWa = true, email: useEmail = true } = opts
  if (useWa) env.WA_GATEWAY_URL = `http://127.0.0.1:${wa.port}`; else delete env.WA_GATEWAY_URL
  if (useEmail) { env.RESEND_API_KEY = 're_test_key'; env.RESEND_FROM = 'Saudinesia <noreply@saudinesia.test>'; env.RESEND_API_URL = `http://127.0.0.1:${mail.port}` }
  else { delete env.RESEND_API_KEY; delete env.RESEND_FROM }
  env.APP_URL = 'https://saudinesia.test'
  waSeen = []; mailSeen = []; waStatus = 200; waDelayMs = 0; mailScript = []
}

// ───────────── data uji ─────────────
const tag = `nt${Date.now()}`
// `phone` di opsi = nomor WhatsApp akun (notifikasi WA memakai User.whatsapp — docs/arsitektur-auth.md §3.5). Telepon SENGAJA berbeda dari
// WhatsApp: bila notify() keliru memakai `phone`, uji penerima langsung gagal. Akun diberi ConsentLog WhatsApp kecuali `noConsent`.
const mk = (suffix: string, extra: Partial<{ email: string; phone: string | null; fullName: string; noConsent: boolean }> = {}) => {
  const number = extra.phone === undefined ? `62811${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}` : extra.phone
  return prisma.user.create({
    data: {
      email: extra.email ?? `${tag}-${suffix}@example.test`, passwordHash: 'x', fullName: extra.fullName ?? `Uji ${suffix}`,
      phone: number ? `62999${number.slice(5)}` : null, whatsapp: number, role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(),
      ...(extra.noConsent ? {} : { consentLogs: { create: { type: 'whatsapp_notifications', version: 'uji' } } }),
    },
  })
}
const ids: { users: string[]; bookings: string[] } = { users: [], bookings: [] }
async function user(...a: Parameters<typeof mk>) { const u = await mk(...a); ids.users.push(u.id); return u }
async function booking(userId: string) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${ids.bookings.length}`, userId, departureDate: new Date('2026-12-01'), returnDate: new Date('2026-12-12'), season: 'regular', totalAmount: 1000000 } })
  ids.bookings.push(b.id); return b
}
const logs = (userId: string, type?: string) => prisma.notificationLog.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ sentAt: 'asc' }, { channel: 'asc' }] })
const confirmed: NotificationEvent = { type: 'payment_confirmed', code: 'SND-9' }
const originalSetting = await prisma.siteSetting.findFirst()

try {
  console.log('== jujur: sent | failed | skipped ==')

  await t('kedua kanal sukses → dua baris "sent", email membawa externalId dan penerima benar', async () => {
    configure(); const u = await user('a'); const b = await booking(u.id)
    const out = await notify({ userId: u.id, bookingId: b.id, event: confirmed })
    assert.deepEqual(out.map((o) => `${o.channel}:${o.status}`).sort(), ['email:sent', 'whatsapp:sent'])
    const rows = await logs(u.id)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.status === 'sent' && r.error === null))
    const email = rows.find((r) => r.channel === 'email')!, whats = rows.find((r) => r.channel === 'whatsapp')!
    assert.equal(email.recipient, u.email); assert.match(email.externalId ?? '', /^msg_/); assert.match(email.messagePreview ?? '', /SND-9/)
    assert.equal(whats.recipient, u.whatsapp); assert.notEqual(u.phone, u.whatsapp); assert.equal(whats.externalId, null)
    assert.equal(waSeen.length, 1); assert.equal(mailSeen.length, 1)
    assert.equal(mailSeen[0]!.path, '/emails')
  })

  await t('REGRESI: gateway WhatsApp BELUM dikonfigurasi → "skipped", BUKAN "sent" (dulu selalu sent)', async () => {
    configure({ wa: false }); const u = await user('b')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'skipped')
    const r = (await logs(u.id)).find((x) => x.channel === 'whatsapp')!
    assert.equal(r.status, 'skipped'); assert.match(r.error ?? '', /WA_GATEWAY_URL/)
    assert.equal(waSeen.length, 0)
  })

  await t('REGRESI: gateway WhatsApp error 500 → "failed" dengan alasan (bukan "sent"); email tetap terkirim', async () => {
    configure(); waStatus = 500; const u = await user('c')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'failed')
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent')
    const r = (await logs(u.id)).find((x) => x.channel === 'whatsapp')!
    assert.equal(r.status, 'failed'); assert.match(r.error ?? '', /HTTP 500/)
    assert.equal(waSeen.length, 3, '1 percobaan + 2 retry')
  })

  await t('RESEND belum dikonfigurasi → email "skipped" dengan alasan, tidak ada request; WA tetap jalan', async () => {
    configure({ email: false }); const u = await user('d')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'skipped')
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'sent')
    assert.match((await logs(u.id)).find((x) => x.channel === 'email')!.error ?? '', /RESEND_API_KEY/)
    assert.equal(mailSeen.length, 0)
  })

  await t('Resend error 422 → email "failed" (alasan tercatat), WA tetap sent', async () => {
    configure(); mailScript = [422]; const u = await user('e')
    const out = await notify({ userId: u.id, event: confirmed })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'failed')
    const r = (await logs(u.id)).find((x) => x.channel === 'email')!
    assert.match(r.error ?? '', /HTTP 422/); assert.equal(r.externalId, null)
  })

  console.log('== lingkup WhatsApp ==')

await t('WhatsApp HANYA untuk konfirmasi booking, pengingat pembayaran, pembayaran dikonfirmasi/ditolak; selebihnya email saja', async () => {
  const wa: NotificationEvent[] = [
    { type: 'booking_submitted', code: 'SND-1', deadline: 'besok' },
    { type: 'payment_reminder_12h', code: 'SND-1', deadline: 'besok' },
    { type: 'payment_reminder_22h', code: 'SND-1', deadline: 'besok' },
    { type: 'payment_confirmed', code: 'SND-1' },
    { type: 'payment_rejected', code: 'SND-1' },
  ]
  const emailOnly: NotificationEvent[] = [
    { type: 'auto_cancelled', code: 'SND-1' },
    { type: 'visa_status_change', code: 'SND-1', status: 'approved' },
    { type: 'welcome', name: 'Budi' },
    { type: 'test' },
  ]
  for (const e of wa) assert.ok(waMessage(e), `${e.type} harus punya pesan WA`)
  for (const e of emailOnly) assert.equal(waMessage(e), null, `${e.type} tidak boleh lewat WhatsApp`)
})

await t('kejadian email-saja: nomor WhatsApp ada pun TIDAK ada request ke gateway WA dan tidak ada baris log WA', async () => {
  configure(); const u = await user('wa-scope'); const b = await booking(u.id)
  const out = await notify({ userId: u.id, bookingId: b.id, event: { type: 'visa_status_change', code: 'SND-9', status: 'disetujui' } })
  assert.deepEqual(out.map((o) => o.channel), ['email'])
  assert.equal(waSeen.length, 0)
  assert.equal((await logs(u.id, 'visa_status_change')).filter((l) => l.channel === 'whatsapp').length, 0)
})

await t('gateway menerima nomor WhatsApp sebagai digit saja (bukan telepon, tanpa +/spasi)', async () => {
  configure(); const u = await user('wa-digits'); const b = await booking(u.id)
  await notify({ userId: u.id, bookingId: b.id, event: confirmed })
  assert.equal(waSeen.length, 1)
  assert.equal(waSeen[0]!.body.phone, u.whatsapp)
  assert.match(String(waSeen[0]!.body.phone), /^\d+$/)
  assert.notEqual(waSeen[0]!.body.phone, u.phone)
})

await t('tanpa ConsentLog WhatsApp → WA "skipped" (alasan tercatat), TIDAK ada request ke gateway; email tetap jalan', async () => {
  configure(); const u = await user('wa-noconsent', { noConsent: true }); const b = await booking(u.id)
  const out = await notify({ userId: u.id, bookingId: b.id, event: confirmed })
  assert.deepEqual(out.map((o) => `${o.channel}=${o.status}`).sort(), ['email=sent', 'whatsapp=skipped'])
  assert.equal(waSeen.length, 0)
  const row = (await logs(u.id)).find((l) => l.channel === 'whatsapp')!
  assert.match(row.error ?? '', /persetujuan/i)
})

await t('batas harian per NOMOR TUJUAN: setelah 10 WA ke satu nomor, berikutnya "skipped" (nomor tak terverifikasi tak boleh jadi corong spam); email tetap', async () => {
  configure(); const target = `62811${Date.now().toString().slice(-8)}`
  const a = await user('wa-cap-a', { phone: target }); const b2 = await user('wa-cap-b', { phone: target }) // dua akun menunjuk nomor yang sama
  const bk = await booking(a.id); const bk2 = await booking(b2.id)
  for (let i = 0; i < 10; i++) await notify({ userId: i % 2 ? b2.id : a.id, bookingId: i % 2 ? bk2.id : bk.id, event: confirmed })
  assert.equal(waSeen.length, 10)
  const out = await notify({ userId: a.id, bookingId: bk.id, event: confirmed })
  assert.deepEqual(out.map((o) => `${o.channel}=${o.status}`).sort(), ['email=sent', 'whatsapp=skipped'])
  assert.equal(waSeen.length, 10, 'tidak ada request ke-11')
  const row = (await logs(a.id)).filter((l) => l.channel === 'whatsapp').pop()!
  assert.match(row.error ?? '', /Batas/)
})

await t('contact_changed: email saja (tanpa WhatsApp), isi memberi tahu perubahan', async () => {
  configure(); const u = await user('wa-changed')
  const out = await notify({ userId: u.id, event: { type: 'contact_changed' } })
  assert.deepEqual(out.map((o) => o.channel), ['email'])
  assert.equal(waSeen.length, 0)
  assert.match(String(mailSeen[0]!.body.subject), /diubah/)
})

console.log('== email sebagai jaring pengaman ==')

// Jaminan produk (2026-10-22): bila WhatsApp tidak bisa dipakai (gateway mati/belum dikonfigurasi/diblokir, nomor tak ada, belum terverifikasi),
// SEMUA pemberitahuan tetap sampai lewat email. Diuji untuk SETIAP jenis kejadian, bukan sampel.
const ALL_EVENTS: NotificationEvent[] = [
  { type: 'booking_submitted', code: 'SND-1', deadline: 'besok' },
  { type: 'payment_reminder_12h', code: 'SND-1', deadline: 'besok' },
  { type: 'payment_reminder_22h', code: 'SND-1', deadline: 'besok' },
  { type: 'payment_confirmed', code: 'SND-1' },
  { type: 'payment_rejected', code: 'SND-1' },
  { type: 'auto_cancelled', code: 'SND-1' },
  { type: 'visa_status_change', code: 'SND-1', status: 'approved' },
  { type: 'contact_changed' },
  { type: 'welcome', name: 'Budi' },
  { type: 'test' },
]

await t('gateway WhatsApp BELUM dikonfigurasi: email terkirim untuk SEMUA jenis kejadian', async () => {
  for (const event of ALL_EVENTS) {
    configure({ wa: false }); const u = await user(`fb-nocfg-${event.type}`)
    const out = await notify({ userId: u.id, event })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent', event.type)
    assert.equal(mailSeen.length, 1, event.type)
    assert.notEqual(out.find((o) => o.channel === 'whatsapp')?.status, 'sent', event.type)
  }
})

await t('akun TANPA nomor WhatsApp: email terkirim untuk SEMUA jenis kejadian (tanpa baris WA)', async () => {
  for (const event of ALL_EVENTS) {
    configure(); const u = await user(`fb-nonum-${event.type}`, { phone: null })
    const out = await notify({ userId: u.id, event })
    assert.deepEqual(out.map((o) => `${o.channel}=${o.status}`), ['email=sent'], event.type)
    assert.equal(waSeen.length, 0, event.type)
  }
})

await t('nomor ada tetapi BELUM ada persetujuan WhatsApp: email terkirim untuk SEMUA jenis kejadian, gateway tak dipanggil', async () => {
  for (const event of ALL_EVENTS) {
    configure(); const u = await user(`fb-nocons-${event.type}`, { noConsent: true })
    const out = await notify({ userId: u.id, event })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent', event.type)
    assert.equal(waSeen.length, 0, event.type)
  }
})

await t('gateway WhatsApp error 500: email tetap terkirim', async () => {
  configure(); waStatus = 500; const u = await user('fb-500'); const b = await booking(u.id)
  const out = await notify({ userId: u.id, bookingId: b.id, event: confirmed })
  assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'failed')
  assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent')
})

await t('gateway WhatsApp MATI total (koneksi ditolak): email tetap terkirim', async () => {
  configure(); env.WA_GATEWAY_URL = 'http://127.0.0.1:1'; const u = await user('fb-down'); const b = await booking(u.id)
  const out = await notify({ userId: u.id, bookingId: b.id, event: confirmed })
  assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'failed')
  assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent')
})

await t('gateway LAMBAT: email TIDAK menunggu WhatsApp (kanal paralel) — email tiba jauh sebelum WhatsApp selesai', async () => {
  configure(); waDelayMs = 2500; const u = await user('fb-slow'); const b = await booking(u.id)
  const t0 = Date.now()
  const out = await notify({ userId: u.id, bookingId: b.id, event: confirmed })
  const total = Date.now() - t0
  assert.equal(out.find((o) => o.channel === 'email')?.status, 'sent')
  assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'sent')
  assert.ok(total >= 2400, `WhatsApp lambat harus ikut ditunggu notify (ukur ${total}ms)`)
  assert.ok(mailSeen[0]!.at - t0 < 1500, `email harus dikirim paralel, bukan setelah WhatsApp (tiba ${mailSeen[0]!.at - t0}ms setelah mulai)`)
})

await t('TIDAK ADA kanal yang sampai (WhatsApp mati DAN email dimatikan admin): peringatan keras tercatat, tanpa PII, tidak melempar', async () => {
  configure({ wa: false }); const u = await user('fb-none')
  const row = (await prisma.siteSetting.findFirst()) ?? (await prisma.siteSetting.create({ data: {} })) // baris yang SAMA dengan yang dibaca notify()
  await prisma.siteSetting.update({ where: { id: row.id }, data: { emailNotificationsEnabled: false } })
  const logged: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logged.push(a.join(' ')) }
  let out
  try { out = await notify({ userId: u.id, event: confirmed }) } finally { console.error = orig }
  await prisma.siteSetting.update({ where: { id: row.id }, data: { emailNotificationsEnabled: originalSetting?.emailNotificationsEnabled ?? true } })
  assert.ok(out.every((o) => o.status === 'skipped'))
  const warn = logged.find((l) => l.includes('TIDAK ADA kanal'))
  assert.ok(warn, 'peringatan harus ada')
  assert.ok(!warn!.includes(u.email) && !warn!.includes(u.whatsapp ?? 'x'), 'tanpa PII')
})

console.log('== penerima & kanal ==')

  await t('akun tanpa nomor → hanya email; kejadian tanpa pesan WA (welcome) → hanya email', async () => {
    configure(); const u = await user('f', { phone: null })
    assert.deepEqual((await notify({ userId: u.id, event: confirmed })).map((o) => o.channel), ['email'])
    configure()
    const v = await user('f2')
    assert.deepEqual((await notify({ userId: v.id, event: { type: 'welcome', name: 'Uji' } })).map((o) => o.channel), ['email'])
    assert.equal(waSeen.length, 0)
  })

  await t('email placeholder (*.invalid) tidak pernah dikirimi; hanya WA', async () => {
    configure(); const u = await user('g', { email: `${tag}-g@akun.invalid` })
    assert.deepEqual((await notify({ userId: u.id, event: confirmed })).map((o) => o.channel), ['whatsapp'])
    assert.equal(mailSeen.length, 0)
  })

  await t('saklar admin emailNotificationsEnabled=false → email "skipped", WA tidak terpengaruh', async () => {
    configure(); const u = await user('h')
    const row = (await prisma.siteSetting.findFirst()) ?? (await prisma.siteSetting.create({ data: {} })) // baris yang SAMA dengan yang dibaca notify()
    await prisma.siteSetting.update({ where: { id: row.id }, data: { emailNotificationsEnabled: false } })
    const out = await notify({ userId: u.id, event: confirmed })
    await prisma.siteSetting.update({ where: { id: row.id }, data: { emailNotificationsEnabled: originalSetting?.emailNotificationsEnabled ?? true } })
    assert.equal(out.find((o) => o.channel === 'email')?.status, 'skipped')
    assert.match((await logs(u.id)).find((x) => x.channel === 'email')!.error ?? '', /dinonaktifkan/)
    assert.equal(out.find((o) => o.channel === 'whatsapp')?.status, 'sent')
    assert.equal(mailSeen.length, 0)
  })

  console.log('== dedupe ==')

  await t('dedupe: kanal yang sudah "sent" dilewati ("duplicate"), tidak ada baris/request baru', async () => {
    configure(); const u = await user('i'); const b = await booking(u.id)
    const ev: NotificationEvent = { type: 'payment_reminder_12h', code: 'SND-1', deadline: 'besok' }
    await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true })
    const again = await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true })
    assert.deepEqual(again.map((o) => o.status), ['duplicate', 'duplicate'])
    assert.equal((await logs(u.id)).length, 2)
    assert.equal(waSeen.length, 1); assert.equal(mailSeen.length, 1)
  })

  await t('dedupe TIDAK menghitung "failed"/"skipped": percobaan ulang berhasil (dulu pengingat gagal tak pernah dicoba lagi)', async () => {
    configure({ email: false }); const u = await user('j'); const b = await booking(u.id)
    const ev: NotificationEvent = { type: 'payment_reminder_22h', code: 'SND-2', deadline: 'nanti' }
    await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true }) // email skipped
    configure()                                                              // kredensial sekarang diisi
    const retry = await notify({ userId: u.id, bookingId: b.id, event: ev, dedupe: true })
    assert.equal(retry.find((o) => o.channel === 'email')?.status, 'sent')
    assert.equal(retry.find((o) => o.channel === 'whatsapp')?.status, 'duplicate', 'WA sudah sent → tidak dobel')
    assert.equal(mailSeen.length, 1)
  })

  await t('tanpa dedupe, kejadian berulang SAH dikirim lagi (mis. bukti ditolak dua kali)', async () => {
    configure(); const u = await user('k')
    await notify({ userId: u.id, event: { type: 'payment_rejected', code: 'SND-3' } })
    await notify({ userId: u.id, event: { type: 'payment_rejected', code: 'SND-3' } })
    assert.equal(mailSeen.length, 2); assert.equal(waSeen.length, 2)
    const keys = mailSeen.map((m) => m.headers.get('idempotency-key'))
    assert.ok(keys[0] && keys[1] && keys[0] !== keys[1], 'kunci idempotensi berbeda per pengiriman')
  })

  console.log('== ketahanan & keamanan ==')

  await t('notify() tidak pernah melempar: user tidak ada → []', async () => {
    configure()
    assert.deepEqual(await notify({ userId: '00000000-0000-0000-0000-000000000000', event: confirmed }), [])
  })

  await t('nama berisi HTML: email yang dikirim ke Resend ter-escape', async () => {
    configure(); const u = await user('l', { fullName: '<img src=x onerror=alert(1)>' })
    await notify({ userId: u.id, event: confirmed })
    const html = mailSeen[0]!.body.html as string
    assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'))
  })

  await t('log email menyimpan subjek, BUKAN isi email', async () => {
    configure(); const u = await user('m')
    await notify({ userId: u.id, event: confirmed })
    const r = (await logs(u.id)).find((x) => x.channel === 'email')!
    assert.equal(r.messagePreview, mailSeen[0]!.body.subject)
    assert.ok(!(r.messagePreview ?? '').includes('<'))
  })
} finally {
  // Bersihkan SEMUA data uji (log → booking → user) dan kembalikan saklar.
  await prisma.notificationLog.deleteMany({ where: { userId: { in: ids.users } } })
  await prisma.booking.deleteMany({ where: { id: { in: ids.bookings } } })
await prisma.consentLog.deleteMany({ where: { userId: { in: ids.users } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
  if (originalSetting) await prisma.siteSetting.update({ where: { id: originalSetting.id }, data: { emailNotificationsEnabled: originalSetting.emailNotificationsEnabled } })
  await wa.stop(); await mail.stop()
  await prisma.$disconnect()
}

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
