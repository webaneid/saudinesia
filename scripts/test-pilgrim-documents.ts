// Uji dokumen jamaah Fase 4 (docs/arsitektur-jamaah.md §7) terhadap DATABASE SUNGGUHAN + penyimpanan memori (tanpa MinIO).
// Inti: berkas dinilai dari ISI (exe berganti nama .jpg, teks, PDF berskrip DITOLAK), foto dienkode ulang ke WebP tanpa EXIF/GPS dengan sisi
// terpanjang 2000 px, cakupan kartu (akun lain → 404 yang sama), ganti = berkas lama hilang, staf atas nama pelanggan, arsip, batas, katalog
// jenis (bawaan terkunci, hapus-aman), pola kode referensi aman dari ReDoS, dan penjaga penulis tunggal.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { __resetForTests } from '@/lib/auth/rateLimit'
import { createSavedPilgrim, deleteSavedPilgrim, type Actor } from '@/lib/pilgrims/service'
import { DocumentFileRejected, DOCUMENT_MAX_SIDE, prepareDocumentFile } from '@/lib/documents/file'
import { createDocumentService, checkUploadFields, listCardDocuments, MAX_DOCUMENTS_PER_CARD, uploadableTypes, type DocumentTypeOption } from '@/lib/documents/service'
import type { DocumentStorage } from '@/lib/documents/storage'
import { createDocumentType, deleteDocumentType, updateDocumentType } from '@/lib/documents/types'
import { documentTypeCreateSchema, referencePatternProblem } from '@/lib/validators/documents'
import { documentRows, uploadFields, canUpload, EMPTY_DRAFT } from '@/components/shared/documents/documentRows'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const env = process.env as Record<string, string | undefined>
env.PII_INDEX_KEY = randomBytes(32).toString('hex')
env.PII_ENCRYPTION_KEY = randomBytes(32).toString('hex')
env.PII_ENCRYPTION_KEY_VERSION = '1'
delete env.PII_ENCRYPTION_KEYS_RETIRED
delete env.REDIS_URL
__resetForTests()
await prisma.piiKeyCheck.deleteMany()

// ── berkas uji ──────────────────────────────────────────────────────────────────────────────────────────────────────
const gpsJpeg = await sharp({ create: { width: 3000, height: 2100, channels: 3, background: { r: 200, g: 180, b: 160 } } })
  .composite([{ input: Buffer.from('<svg width="3000" height="300"><text x="20" y="200" font-size="160" font-family="monospace">P&lt;IDNSANTOSO&lt;&lt;BUDI&lt;&lt;&lt;&lt;&lt;&lt;</text></svg>'), top: 1700, left: 0 }])
  .jpeg().withExif({ IFD0: { Make: 'UjiKamera', Model: 'RahasiaModel' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '6/1 12/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '106/1 49/1 0/1' } })
  .toBuffer()
const png = await sharp({ create: { width: 800, height: 500, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')
const pdfJs = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')
const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), randomBytes(2048)])

await t('BERKAS PALSU DITOLAK: exe berganti nama .jpg, teks, PDF berskrip, PDF terpotong, kosong, > 5 MB', async () => {
  const rejected = async (b: Buffer, re: RegExp) => assert.rejects(() => prepareDocumentFile(b), (e: Error) => e instanceof DocumentFileRejected && re.test(e.message))
  await rejected(exe, /JPG, PNG, WebP\) atau PDF/)
  await rejected(Buffer.from('halo ini bukan gambar'), /atau PDF/)
  await rejected(pdfJs, /skrip/)
  // SEC-183: nama PDF ber-escape #xx tetap dikenali; aksi lain (Launch/SubmitForm) ditolak
  await rejected(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'), /skrip/)
  await rejected(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /AA << /O << /S /L#61unch /F (calc.exe) >> >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'), /skrip/)
  await rejected(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /SubmitForm >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'), /skrip/)
  assert.equal((await prepareDocumentFile(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction [3 0 R /Fit] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'))).mimeType, 'application/pdf', 'OpenAction tampilan awal (PDF pindaian) tetap diterima')
  await rejected(pdf.subarray(0, pdf.length - 7), /atau PDF/) // tanpa %%EOF
  await rejected(Buffer.alloc(0), /kosong/)
  await rejected(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]), /5 MB/)
  // JPEG rusak (header benar, isi sampah) → bukan gambar valid
  await rejected(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(4096)]), /bukan gambar/)
})

await t('FOTO → WebP: EXIF/GPS/merek kamera hilang, sisi terpanjang 2000 px, rasio tetap; PNG ikut WebP; PDF apa adanya + sha256', async () => {
  const before = await sharp(gpsJpeg).metadata()
  assert.ok(before.exif && before.exif.toString('latin1').includes('UjiKamera'), 'fixture harus benar-benar ber-EXIF')
  const out = await prepareDocumentFile(gpsJpeg)
  assert.equal(out.mimeType, 'image/webp'); assert.equal(out.ext, 'webp')
  const meta = await sharp(out.body).metadata()
  assert.equal(meta.format, 'webp')
  assert.equal(meta.exif, undefined, 'EXIF harus dibuang'); assert.equal(meta.xmp, undefined); assert.equal(meta.icc, undefined)
  assert.ok(!out.body.toString('latin1').includes('UjiKamera') && !out.body.toString('latin1').includes('RahasiaModel'))
  assert.equal(Math.max(meta.width!, meta.height!), DOCUMENT_MAX_SIDE)
  assert.equal(meta.width, 2000); assert.equal(meta.height, 1400)
  assert.equal(out.sha256, createHash('sha256').update(out.body).digest('hex'))
  const p = await prepareDocumentFile(png)
  assert.equal(p.mimeType, 'image/webp'); assert.equal((await sharp(p.body).metadata()).width, 800, 'gambar kecil tidak diperbesar')
  const d = await prepareDocumentFile(pdf)
  assert.equal(d.mimeType, 'application/pdf'); assert.ok(d.body.equals(pdf), 'PDF tidak diubah (C3)')
})

await t('MRZ tetap terbaca: baris teks 160 px pada foto 3000 px masih ≥ 100 px tinggi setelah diperkecil (ambang aman OCR)', async () => {
  const out = await prepareDocumentFile(gpsJpeg)
  const meta = await sharp(out.body).metadata()
  const scale = meta.width! / 3000
  assert.ok(160 * scale >= 100, `tinggi huruf MRZ setelah konversi ${(160 * scale).toFixed(0)} px`)
})

await t('POLA KODE REFERENSI aman dari ReDoS: hanya kelas/literal/{n,m} berjangkar', () => {
  for (const ok of ['^[A-Z0-9]{6}$', '^[A-Z]{2}[0-9]{4,8}$', '^AB-[0-9]{3}$']) assert.equal(referencePatternProblem(ok), null, ok)
  for (const bad of ['^(a+)+$', '^.*$', '[A-Z]{6}', '^[A-Z]+$', '^\\d{6}$', '^(AB|CD)$', `^${'[A-Z]'.repeat(30)}$`]) assert.notEqual(referencePatternProblem(bad), null, bad)
  assert.equal(documentTypeCreateSchema.safeParse({ key: 'x_y', label: 'Uji', icon: 'FileText', reusable: true, referenceLabel: 'Kode', referencePattern: '^(a+)+$' }).success, false)
  // SEC-182: pengulang variabel berdampingan atas kelas tumpang tindih = backtracking polinomial; {n,} tak berbatas; > 40
  for (const bad of [`^${'[A]{0,9}'.repeat(10)}[B]$`, '^[A]{0,9}[A]{0,9}$', '^[A-Z]{6,}$', '^[A-Z]{0,99}$', '^[A-Z]{5,2}$', '^[A-Z]{6}{2}$', '^[^A]{6}$', '^[A-Z]{6}$$']) assert.notEqual(referencePatternProblem(bad), null, bad)
  assert.equal(referencePatternProblem('^[A-Z]{2}[0-9]{6}[A-Z]{0,2}$'), null, 'satu pengulang variabel tetap boleh')
  assert.equal(documentTypeCreateSchema.safeParse({ key: 'x_y', label: 'Uji', icon: 'BukanIkon', reusable: true }).success, false, 'ikon di luar daftar putih ditolak')
  assert.equal(documentTypeCreateSchema.safeParse({ key: 'x_y', label: 'Uji', icon: 'FileText', reusable: true, isSystem: true }).success, false, 'kolom liar ditolak (strict)')
})

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tag = `dc${Date.now()}`
let n = 0
const users: string[] = []
async function makeUser(role: 'pilgrim' | 'admin' = 'pilgrim'): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role }, select: { id: true, role: true } })
  users.push(u.id)
  return { userId: u.id, role: u.role }
}
async function makeCard(owner: Actor): Promise<string> {
  const r = await createSavedPilgrim(owner, owner.userId, savedPilgrimInputSchema.parse({ fullName: `Jamaah ${++n}`, birthDate: '2025-06-01', nationality: 'ID' })) // bayi: tanpa NIK
  if (!r.ok) throw new Error(r.error)
  return r.card.id
}

const mem = new Map<string, Buffer>()
const storage: DocumentStorage = {
  put: async (k, b) => { mem.set(k, b) },
  remove: async (k) => { mem.delete(k) },
  removePrefix: async (p) => { let c = 0; for (const k of [...mem.keys()]) if (k.startsWith(p)) { mem.delete(k); c++ } return c },
  url: async (k) => `https://minio.test/${k}?X-Amz-Signature=uji`,
}
const svc = createDocumentService(storage)
const types = Object.fromEntries((await prisma.documentType.findMany()).map(x => [x.key, x]))
for (const k of ['passport', 'ktp', 'kk', 'vaccine', 'flight_ticket', 'hotel_reservation', 'transport_reservation', 'other']) assert.ok(types[k]?.isSystem, `bawaan ${k} ada (migrasi)`)
const T = (k: string) => types[k]!.id

const a = await makeUser()
const b = await makeUser()
const staff = await makeUser('admin')
const cardA = await makeCard(a)

await t('UNGGAH pemilik: baris + objek di bawah saved-pilgrims/{pemilik}/{kartu}/; nama berkas asli tak dipakai; DTO tanpa objectKey/sha256/uploadedById', async () => {
  const r = await svc.upload(a, a.userId, cardA, { documentTypeId: T('ktp') }, gpsJpeg)
  assert.ok(r.ok, JSON.stringify(r))
  const row = await prisma.pilgrimDocument.findUniqueOrThrow({ where: { id: r.document.id } })
  assert.match(row.objectKey, new RegExp(`^saved-pilgrims/${a.userId}/${cardA}/ktp/\\d+-[0-9a-f]{8}\\.webp$`))
  assert.ok(mem.has(row.objectKey)); assert.equal(row.mimeType, 'image/webp'); assert.equal(row.status, 'pending'); assert.equal(row.uploadedById, a.userId)
  assert.equal(row.sha256, createHash('sha256').update(mem.get(row.objectKey)!).digest('hex'))
  for (const k of ['objectKey', 'sha256', 'uploadedById', 'savedPilgrimId']) assert.ok(!(k in r.document), `DTO tak boleh memuat ${k}`)
  assert.equal(r.document.byStaff, false)
})

await t('CAKUPAN: akun lain unggah/lihat/hapus/daftar kartu A → 404 yang sama dengan kartu tak ada; tak ada objek tertinggal', async () => {
  const before = mem.size
  const ghost = '00000000-0000-4000-8000-000000000000'
  const viaB = await svc.upload(b, b.userId, cardA, { documentTypeId: T('kk') }, png)
  const viaBOwner = await svc.upload(b, a.userId, cardA, { documentTypeId: T('kk') }, png)
  const missing = await svc.upload(a, a.userId, ghost, { documentTypeId: T('kk') }, png)
  assert.deepEqual(viaB, missing); assert.deepEqual(viaBOwner, missing); assert.equal(missing.ok ? 0 : missing.status, 404)
  assert.equal(mem.size, before, 'unggahan yang ditolak tak meninggalkan objek')
  const doc = await prisma.pilgrimDocument.findFirstOrThrow({ where: { savedPilgrimId: cardA } })
  assert.deepEqual(await svc.previewUrl(b, b.userId, cardA, doc.id), { ok: false, status: 404, error: 'Dokumen tidak ditemukan', code: 'documentNotFound' })
  assert.equal((await svc.previewUrl(b, a.userId, cardA, doc.id)).ok, false)
  assert.equal((await svc.remove(b, b.userId, cardA, doc.id)).ok, false)
  assert.equal(await listCardDocuments(b, b.userId, cardA), null)
  assert.equal(await listCardDocuments(b, a.userId, cardA), null)
  assert.equal(await prisma.pilgrimDocument.count({ where: { id: doc.id } }), 1)
  const own = await svc.previewUrl(a, a.userId, cardA, doc.id)
  assert.ok(own.ok && own.url.includes('X-Amz-Signature'), 'pemilik mendapat URL presigned')
})

await t('GANTI (jenis tunggal): unggahan baru menghapus baris DAN objek lama; jenis boleh-banyak menambah', async () => {
  const first = await prisma.pilgrimDocument.findFirstOrThrow({ where: { savedPilgrimId: cardA, documentTypeId: T('ktp') } })
  const r = await svc.upload(a, a.userId, cardA, { documentTypeId: T('ktp') }, pdf)
  assert.ok(r.ok)
  assert.equal(await prisma.pilgrimDocument.count({ where: { savedPilgrimId: cardA, documentTypeId: T('ktp') } }), 1)
  assert.equal(await prisma.pilgrimDocument.count({ where: { id: first.id } }), 0)
  assert.equal(mem.has(first.objectKey), false, 'berkas lama dihapus (K12)')
  assert.ok((await svc.upload(a, a.userId, cardA, { documentTypeId: T('other'), label: 'Surat Mahram' }, png)).ok)
  assert.ok((await svc.upload(a, a.userId, cardA, { documentTypeId: T('other'), label: 'Akta Lahir' }, png)).ok)
  assert.equal(await prisma.pilgrimDocument.count({ where: { savedPilgrimId: cardA, documentTypeId: T('other') } }), 2)
})

await t('ATURAN JENIS: per-perjalanan & nonaktif ditolak; label bebas hanya "other"; paspor wajib habis-berlaku; tanggal; kode referensi', async () => {
  const no = (r: { ok: boolean; status?: number; field?: string }, field: string) => { assert.equal(r.ok, false); assert.equal(r.status, 400); assert.equal(r.field, field) }
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('flight_ticket'), referenceCode: 'ABC123' }, pdf) as never, 'documentTypeId')
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('ktp'), label: 'KTP Saya' }, pdf) as never, 'label')
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('other') }, pdf) as never, 'label')
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('passport') }, pdf) as never, 'expiresAt')
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('ktp'), expiresAt: '2030-01-01' }, pdf) as never, 'expiresAt')
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('passport'), issuedAt: '2031-01-01', expiresAt: '2030-01-01' }, pdf) as never, 'issuedAt')
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('passport'), issuedAt: '2025-01-01', expiresAt: '2024-01-01' }, pdf) as never, 'expiresAt')
  const pass = await svc.upload(a, a.userId, cardA, { documentTypeId: T('passport'), issuedAt: '2024-01-10', expiresAt: '2034-01-09' }, gpsJpeg)
  assert.ok(pass.ok); assert.equal(pass.document.expiresAt, '2034-01-09'); assert.equal(pass.document.issuedAt, '2024-01-10')
  // kode referensi (aturan murni — jenis tiket diunggah per booking di Fase 7)
  const ticket = types.flight_ticket! as unknown as DocumentTypeOption
  assert.equal('ok' in checkUploadFields(ticket, { documentTypeId: ticket.id }), true)
  assert.equal('ok' in checkUploadFields(ticket, { documentTypeId: ticket.id, referenceCode: 'abc-12' }), true)
  assert.deepEqual(checkUploadFields(ticket, { documentTypeId: ticket.id, referenceCode: ' abc 123 ' }), { label: ticket.label, referenceCode: 'ABC123', issuedAt: null, expiresAt: null })
  await prisma.documentType.update({ where: { id: T('vaccine') }, data: { isActive: false } })
  no(await svc.upload(a, a.userId, cardA, { documentTypeId: T('vaccine') }, pdf) as never, 'documentTypeId')
  assert.ok(!(await uploadableTypes()).some(x => x.key === 'vaccine' || x.key === 'flight_ticket'))
  await prisma.documentType.update({ where: { id: T('vaccine') }, data: { isActive: true } })
})

await t('STAF atas nama pelanggan: boleh unggah (D4), byStaff = true, uploadedById = staf; akun pemilik nonaktif → 422 + berkas dibuang', async () => {
  const cardB = await makeCard(b)
  const r = await svc.upload(staff, b.userId, cardB, { documentTypeId: T('kk') }, png)
  assert.ok(r.ok); assert.equal(r.document.byStaff, true)
  assert.equal((await prisma.pilgrimDocument.findUniqueOrThrow({ where: { id: r.document.id } })).uploadedById, staff.userId)
  await prisma.user.update({ where: { id: b.userId }, data: { isActive: false } })
  const before = mem.size
  const off = await svc.upload(staff, b.userId, cardB, { documentTypeId: T('ktp') }, png)
  assert.equal(off.ok ? 0 : off.status, 422)
  assert.equal(mem.size, before, 'berkas yang sudah terunggah dibuang saat transaksi menolak')
  await prisma.user.update({ where: { id: b.userId }, data: { isActive: true } })
})

await t('ARSIP: kartu diarsipkan → unggah/hapus 409; batas per kartu → 409 + berkas baru dibuang', async () => {
  const c = await makeCard(a)
  await prisma.savedPilgrim.update({ where: { id: c }, data: { archivedAt: new Date() } })
  const r = await svc.upload(a, a.userId, c, { documentTypeId: T('ktp') }, png)
  assert.equal(r.ok ? 0 : r.status, 409)
  await prisma.savedPilgrim.update({ where: { id: c }, data: { archivedAt: null } })
  for (let i = 0; i < MAX_DOCUMENTS_PER_CARD; i++) {
    await prisma.pilgrimDocument.create({ data: { savedPilgrimId: c, documentTypeId: T('other'), label: `isi ${i}`, objectKey: `saved-pilgrims/${a.userId}/${c}/other/${i}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, sha256: 'a'.repeat(64), uploadedById: a.userId } })
  }
  const before = mem.size
  const over = await svc.upload(a, a.userId, c, { documentTypeId: T('other'), label: 'Kelebihan' }, png)
  assert.equal(over.ok ? 0 : over.status, 409); assert.equal(mem.size, before)
  await prisma.pilgrimDocument.deleteMany({ where: { savedPilgrimId: c } })
})

await t('HAPUS dokumen: baris + objek hilang; dokumen kartu lain lewat kartu ini → 404', async () => {
  const doc = await prisma.pilgrimDocument.findFirstOrThrow({ where: { savedPilgrimId: cardA, documentTypeId: T('other') } })
  const cardC = await makeCard(a)
  assert.equal((await svc.remove(a, a.userId, cardC, doc.id)).ok, false, 'id dokumen dari kartu lain')
  assert.deepEqual(await svc.remove(a, a.userId, cardA, doc.id), { ok: true })
  assert.equal(await prisma.pilgrimDocument.count({ where: { id: doc.id } }), 0); assert.equal(mem.has(doc.objectKey), false)
})

await t('HAPUS KARTU: kartu tanpa booking dihapus sungguhan beserta baris dokumennya (FK Restrict tak menghalangi)', async () => {
  const c = await makeCard(a)
  assert.ok((await svc.upload(a, a.userId, c, { documentTypeId: T('ktp') }, png)).ok)
  const r = await deleteSavedPilgrim(a, a.userId, c)
  assert.deepEqual(r, { ok: true, result: 'deleted' })
  assert.equal(await prisma.pilgrimDocument.count({ where: { savedPilgrimId: c } }), 0)
})

await t('KATALOG JENIS: buat, kunci ganda 409, bawaan terkunci sifatnya, hapus-aman (bawaan/terpakai → nonaktif, kosong → hapus)', async () => {
  const key = `uji_${Date.now() % 100000}`
  const made = await createDocumentType(documentTypeCreateSchema.parse({ key, label: 'Surat Uji', icon: 'ScrollText', reusable: true }))
  assert.ok(made.ok)
  const dup = await createDocumentType(documentTypeCreateSchema.parse({ key, label: 'Lagi', icon: 'FileText', reusable: true }))
  assert.equal(dup.ok ? 0 : dup.status, 409)
  const locked = await updateDocumentType(T('passport'), { allowMultiple: true })
  assert.equal(locked.ok ? '' : locked.field, 'allowMultiple')
  assert.ok((await updateDocumentType(T('passport'), { label: 'Foto Paspor' })).ok, 'label bawaan boleh diubah')
  const sys = await deleteDocumentType(T('kk'))
  assert.equal(sys.deleted, false); assert.equal((await prisma.documentType.findUniqueOrThrow({ where: { id: T('kk') } })).isActive, false)
  await prisma.documentType.update({ where: { id: T('kk') }, data: { isActive: true } })
  const custom = made.ok ? made.value.id : ''
  const c = await makeCard(a)
  assert.ok((await svc.upload(a, a.userId, c, { documentTypeId: custom }, png)).ok)
  assert.equal((await deleteDocumentType(custom)).deleted, false, 'terpakai → nonaktif')
  await prisma.pilgrimDocument.deleteMany({ where: { documentTypeId: custom } })
  assert.deepEqual(await deleteDocumentType(custom), { deleted: true })
  await assert.rejects(() => deleteDocumentType(custom), (e: { code?: string }) => e.code === 'P2025')
})

await t('BALAPAN hapus jenis saat unggah (SEC-185): jenis dihapus di antara pembacaan dan INSERT → 400 "tidak tersedia" (bukan 500), berkas dibuang', async () => {
  const made = await createDocumentType(documentTypeCreateSchema.parse({ key: `uji_r${Date.now() % 100000}`, label: 'Surat Balapan', icon: 'ScrollText', reusable: true }))
  assert.ok(made.ok)
  const id = made.ok ? made.value.id : ''
  const before = mem.size
  const racing = createDocumentService({ ...storage, put: async (k, body, mime) => { await storage.put(k, body, mime); assert.deepEqual(await deleteDocumentType(id), { deleted: true }) } })
  const r = await racing.upload(a, a.userId, await makeCard(a), { documentTypeId: id }, png)
  assert.equal(r.ok ? 0 : r.status, 400)
  assert.equal(r.ok ? '' : r.field, 'documentTypeId')
  assert.equal(mem.size, before, 'berkas yang sempat terunggah dibuang')
})

await t('UI murni: baris repeater (jenis tunggal satu baris, boleh-banyak per berkas) + kolom unggah hanya yang relevan', async () => {
  const tys = await uploadableTypes()
  const docs = (await listCardDocuments(a, a.userId, cardA))!
  const rows = documentRows(tys, docs)
  assert.equal(rows.filter(r => r.kind === 'single' && r.type.key === 'ktp').length, 1)
  assert.equal(rows.filter(r => r.kind === 'extra').length, docs.filter(d => d.typeKey === 'other').length)
  // Berkas yang jenisnya tak ada di daftar (tak diminta / dinonaktifkan) tampil di akhir bertanda `unlisted` (tak bisa diganti).
  const ktpDoc = docs.find(d => d.typeKey === 'ktp')
  if (ktpDoc) {
    const without = documentRows(tys.filter(x => x.key !== 'ktp'), docs)
    const last = without.find(r => r.document?.id === ktpDoc.id)
    assert.ok(last && last.kind === 'extra' && last.unlisted, 'berkas jenis tak terdaftar ditandai unlisted')
  }
  assert.ok(rows.every(r => !(r.kind === 'extra' && r.unlisted)), 'jenis terdaftar tak pernah unlisted')
  const ktp = tys.find(x => x.key === 'ktp')!
  assert.deepEqual(uploadFields(ktp, { label: 'x', referenceCode: 'y', issuedAt: '2020-01-01', expiresAt: '2030-01-01' }), { documentTypeId: ktp.id })
  const pass = tys.find(x => x.key === 'passport')!
  assert.equal(canUpload(pass, EMPTY_DRAFT, new File([new Uint8Array(1)], 'a.jpg')), false, 'paspor tanpa habis-berlaku')
  assert.equal(canUpload(pass, { ...EMPTY_DRAFT, expiresAt: '2030-01-01' }, null), false, 'tanpa berkas')
})

await t('PENJAGA PENULIS TUNGGAL: pilgrimDocument hanya ditulis di lib/documents/, documentType hanya di lib/documents/types.ts + migrasi', () => {
  const root = new URL('..', import.meta.url).pathname
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components']) walk(join(root, d))
  const bad: string[] = []
  for (const f of files) {
    const rel = relative(root, f)
    const src = readFileSync(f, 'utf8')
    if (/\.pilgrimDocument\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(src) && !rel.startsWith('lib/documents/')) bad.push(`${rel}: menulis pilgrim_documents`)
    if (/\.documentType\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(src) && rel !== 'lib/documents/types.ts') bad.push(`${rel}: menulis document_types`)
    if (/['"]use client['"]/.test(src) && /from ['"]@\/lib\/documents\/(service|file|storage|types|purge|http)['"]/.test(src.replace(/import type [^;]+;?/g, ''))) bad.push(`${rel}: komponen klien mengimpor modul server dokumen`)
  }
  assert.deepEqual(bad, [])
})

// Bersihkan (DB uji): dokumen → kartu → identitas → pengguna.
await prisma.pilgrimDocument.deleteMany({ where: { savedPilgrim: { ownerId: { in: users } } } })
await prisma.documentType.deleteMany({ where: { key: { startsWith: 'uji_' } } })
await prisma.savedPilgrim.deleteMany({ where: { ownerId: { in: users } } })
await prisma.pilgrimIdentity.deleteMany({ where: { cards: { none: {} }, bookingPilgrims: { none: {} } } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()

if (failed > 0) { console.log(`\n${failed} uji GAGAL`); process.exit(1) }
console.log('\nSemua uji dokumen jamaah (Fase 4) lulus')
