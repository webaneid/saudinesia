// Smoke CI: invoice PDF harus benar-benar jadi di server PRODUKSI (`bun server.js` di dalam image), bukan hanya build/dev.
// Dibuat setelah upgrade dependency (SEC-05) lulus `next build` dan dev tetapi invoice gagal 500 di produksi
// ("Cannot find module '#standard-fonts/Helvetica'") — hanya uji pada artefak produksi yang menangkapnya.
//
// Dijalankan DI DALAM image web (lihat .github/workflows/ci.yml); lokal: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD bisa diganti.
// MENULIS user + booking sementara ke database — hanya untuk database CI/uji (dijaga CI_SMOKE=1).
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'ci-admin@example.test'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Ci-Admin!2345'

const fail = (m: string): never => { console.log('GAGAL:', m); process.exit(1) }

// PENGAMAN: skrip ini menulis ke database. Hanya jalan bila CI_SMOKE=1 — diset oleh workflow di jaringan compose CI yang terisolasi.
// Jangan set ini di mesin dev yang DATABASE_URL-nya mengarah ke database asli.
if (process.env.CI_SMOKE !== '1') fail('hanya untuk CI: set CI_SMOKE=1 (menulis user & booking sementara ke database)')

const prisma = new PrismaClient()
try {
  const user = await prisma.user.create({ data: { email: `inv-ci-${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Pemesan CI', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  const booking = await prisma.booking.create({
    data: {
      bookingCode: `CI-INV-${Date.now()}`, userId: user.id, status: 'active',
      departureDate: new Date('2026-12-10'), returnDate: new Date('2026-12-20'), season: 'regular', totalAmount: '5000000',
      pilgrims: { create: [{ isLeader: true, fieldValues: { fullName: 'Pemesan CI' } }] },
    },
  })

  // Invoice dibangun dari snapshot harga (docs/arsitektur-harga-terpadu.md §17): satu baris yang jumlahnya = total booking.
  await prisma.priceSnapshot.create({
    data: { bookingId: booking.id, itemType: 'hotel', itemId: 'ci-item', itemLabel: 'Hotel CI', itemDetail: '3 malam', itemQty: 1, description: 'Hotel CI', qty: 1, unit: 'item', unitSellIdr: '5000000', totalSellIdr: '5000000', mode: 'auto' },
  })

  const login = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) })
  if (login.status !== 200) fail(`login admin ${login.status}`)
  const cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
  if (!cookie.startsWith('snd-session=')) fail('cookie sesi tidak diterima')

  const res = await fetch(`${BASE}/api/v1/bookings/${booking.id}/invoice`, { headers: { Cookie: cookie } })
  const body = Buffer.from(await res.arrayBuffer())
  console.log('invoice', res.status, res.headers.get('content-type'), `${body.length} bytes`)
  if (res.status !== 200) fail(`invoice HTTP ${res.status}`)
  if (!(res.headers.get('content-type') ?? '').includes('application/pdf')) fail('content-type bukan application/pdf')
  if (body.subarray(0, 5).toString() !== '%PDF-') fail('isi bukan PDF')
  if (body.length < 1000) fail(`PDF terlalu kecil (${body.length} byte)`)
  console.log('OK: invoice PDF jadi di server produksi')
} finally {
  await prisma.$disconnect()
}
