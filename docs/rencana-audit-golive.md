# Rencana Audit Go-Live — PII di Log + OWASP Top 10

> Status: **DISETUJUI (2026-11-19)** — pemilik: PII log + G-1 + G-2 sebelum go-live; Low (G-3/G-4/G-5) dicatat di Register dan menyusul; isi log = nama + kode + pesan disamarkan. Menutup dua butir M14 `docs/progress.md`: "No PII in application logs" dan "Penetration-test checklist (OWASP Top 10)".

## 1. PII di log aplikasi

### 1.1 Recheck (2026-11-19, pindai `app/`, `lib/`, `middleware.ts`, `instrumentation*.ts`)

- 246 pemanggilan `console.*`; **121 mencetak objek galat mentah** (`console.error('[tag]', e)`), sebagian besar di `catch` Route Handler. Objek galat Prisma `PrismaClientValidationError` memuat SELURUH argumen query (email, nomor, nama, nilai `fieldValues` jamaah) — jalur bocor PII yang nyata bila masukan tak terduga sampai ke Prisma. Galat `fetch` juga bisa memuat URL beserta query.
- ±15 pemanggilan mencetak `e.message` (mis. `bookings/[id]/invoice`, `test-email`, `cron`, `instrumentation-node`) — risiko sama untuk pesan Prisma.
- `lib/email/resend.ts:98` mencetak `lastError` = cuplikan respons Resend (bisa menggemakan alamat tujuan); `lib/whatsapp/client.ts:68` mencetak pesan galat jaringan.
- **Klien Prisma sendiri** (`lib/db/index.ts`, produksi `log: ['error']`) mencetak `prisma:error` beserta SELURUH argumen query ke stderr — terlepas dari `catch` kita. Dibuktikan 2026-11-19 pada DB uji: `PrismaClientValidationError` memuat email dan nomor HP masukan, juga dengan `errorFormat: 'minimal'` dan pada event `error`.
- Yang sudah benar: `notify()` (`safeErr`: nama + kode), `authFailureResponse` (hanya `e.name` — aman tetapi terlalu miskin untuk diagnosis), log audit admin (`actor=… target=…` tanpa email/nama), log cron (kode booking, bukan nama), tautan invoice disamarkan (`redactInvoiceLinks`), tautan auth hanya di `NODE_ENV === 'development'`.

Sudah tercatat sebagai **SEC-228** (Low, hanya route alamat). Dinaikkan ke **Medium** dan diperluas: seluruh aplikasi + klien Prisma (pre-existing; butuh galat tak terduga + akses log server untuk terjadi, tetapi melanggar aturan CLAUDE.md § Security "Never log pilgrim PII").

### 1.2 Rencana

1. **Satu pintu `lib/log/`** (server saja):
   - `redactPii(text)` — samarkan email, deret angka ≥ 8 digit (HP/NIK/rekening), tautan invoice, token panjang (heksa/base64url ≥ 32).
   - `errorSummary(e)` — `nama` + `code` Prisma/IpaymuError bila ada + pesan yang sudah disamarkan (pesan `PrismaClientValidationError` DIBUANG seluruhnya, hanya "validasi Prisma gagal" + nama model bila ada) + 3 baris `at …` teratas stack (lokasi kode, tanpa data).
   - `logError(tag, e, konteks?)` — `console.error('[tag]', ringkasan)`; `konteks` hanya id/kode (tipe dibatasi `Record<string, string | number | boolean>`).
2. **Klien Prisma**: `log: [{ emit: 'event', level: 'error' }]` (+ `warn`) di produksi dan `$on('error')` → `logError('prisma', …)` — Prisma tak lagi mencetak argumen query sendiri; mode development tetap seperti sekarang.
3. **Ganti semua pemanggilan** yang mencetak objek galat mentah / `e.message` dengan `logError` (mekanis). `authFailureResponse` ikut memakai `errorSummary` → diagnosis 500 jadi lebih baik tanpa PII. `lastError` email/WhatsApp lewat `redactPii`.
4. **Penjaga `scripts/test-log-pii.ts`** (penemu sumber, tanpa daftar hafalan): menolak `console.*` di `app/`/`lib/` yang argumennya identifier galat mentah, `.message`, `JSON.stringify(body|data|input…)`, atau interpolasi nama kolom PII (`email`, `phone`, `whatsapp`, `fullName`, `nik`, `passport`, `fieldValues`, `recipient`, `address`); uji unit `redactPii`/`errorSummary` (email, +62…, NIK 16 digit, galat validasi Prisma sungguhan dari klien yang dibuat gagal).
5. Aturan tertulis: CLAUDE.md § Security — "galat dicatat HANYA lewat `logError`/`errorSummary`".

## 2. OWASP Top 10 (2021)

Diaudit subagent `security-auditor` (read-only, 2026-11-19): 230 route diperiksa (185 memanggil guard langsung, 45 sisanya handler bersama bergard, publik sengaja, atau webhook). **0 Critical, 0 High baru.**

| Kat. | Status | Ringkas |
|---|---|---|
| A01 Akses | Lulus | Route jamaah dicakup sesi/pemilik (404 seragam), admin cek peran di awal, halaman admin `requireAdminPage`. |
| A02 Kriptografi | Lulus | JWT HS256 dipin, rahasia divalidasi, cookie httpOnly/Secure/Lax, PII AES-GCM + HMAC, tautan invoice HMAC. |
| A03 Injeksi | Sebagian | Raw SQL ber-parameter/literal, tanpa `dangerouslySetInnerHTML`, CSV anti-injeksi, redirect daftar putih. Sisa SEC-220. |
| A04 Desain | Lulus | Harga server, kuota/pembayaran/refund dinilai di dalam kunci, iPaymu hanya lewat `/transaction`. |
| A05 Konfigurasi | Sebagian | Header Caddy, non-root, tanpa port internal. Sisa SEC-06 (CSP penuh) + G-1/G-3. |
| A06 Komponen | Sebagian | SEC-05/SEC-266 (alat build). |
| A07 Autentikasi | Sebagian | Batas laju atomik, sesi bisa dicabut, anti-enumerasi. SEC-51 (MFA staf, diterima) + G-4. |
| A08 Integritas | Sebagian | HMAC GOWA, callback iPaymu hanya pemicu, unggahan dari isi berkas, workflow hak minimum. G-5. |
| A09 Log & pemantauan | **Gagal untuk go-live** | PII di log (§1) + G-2; belum ada alert (RETROFIT-GAPS #3). |
| A10 SSRF | Lulus | Semua `fetch` keluar ke base URL env/konstanta. |

### 2.1 Temuan baru (diverifikasi ulang terhadap kode)

- **G-1 Medium** — web terhubung ke Postgres sebagai SUPERUSER (`docker-compose.prod.yml` `POSTGRES_USER` = `DATABASE_URL` web). Trigger append-only (buku kas, snapshot harga, jejak) bisa dimatikan dan `COPY … TO PROGRAM` mungkin bila proses web dibobol. Usul: peran `migrator` (pemilik skema, hanya kontainer `migrate`) + peran `app` NOSUPERUSER bukan pemilik (DML saja); uji CI bahwa `DISABLE TRIGGER` ditolak.
- **G-2 Medium** — tak ada jejak untuk buat/ubah peran/nonaktifkan staf, login staf, dan unduhan ZIP dokumen jamaah. Usul: jejak append-only (aktor, target, aksi, IP) di transaksi yang sama + log ZIP.
- **G-3 Low** — web memakai kredensial ROOT MinIO. Usul: user MinIO aplikasi berpolicy satu bucket; `ensureBucketExists` pindah ke deploy.
- **G-4 Low** — logout hanya menghapus cookie (JWT 7 hari tetap sah). Usul: naikkan `sessionVersion` saat logout staf / "keluar dari semua perangkat".
- **G-5 Low** — kurs pihak ketiga tanpa batas wajar (≤ 0/anomali langsung jadi HPP). Usul: tolak ≤ 0 atau lonjakan > X%, simpan kurs lama + peringatan.

Perlu dicek manual (VPS/produksi): branch protection, SSH key-only + firewall, backup DB terjadwal + uji restore, `/_next/image` di artefak produksi, `Cache-Control` ZIP dokumen, uptime/alert `/api/v1/health`.

## 3. Urutan eksekusi

- **G1 — SELESAI 2026-11-19** — PII di log: `lib/log` + klien Prisma + penggantian pemanggil + penjaga + aturan CLAUDE.md (menutup SEC-228).
- **G2** — peran database terpisah (G-1): `migrator` pemilik skema, `app` DML saja; compose + `.env.production.example` + `docs/deployment.md` + uji bahwa peran app tak bisa mematikan trigger.
- **G3** — jejak staf + ZIP (G-2): tabel jejak append-only, ditulis di transaksi yang sama oleh `lib/auth/adminUsers.ts`, login staf, dan unduhan ZIP.
- G-1 = SEC-303, G-2 = SEC-304; G-3/G-4/G-5 = SEC-305..307 di Register Temuan Security, menyusul sesudah go-live.

## 4. Hasil G1 (2026-11-19)

- `lib/log/index.ts` — `redactPii` (email, angka ≥ 8 digit, token ≥ 32; UUID dan tanggal ISO dipertahankan), `errorSummary` (nama + kode + pesan tersamar + 3 lokasi; validasi Prisma → "validasi Prisma gagal (prisma.x.y)"; galat Prisma lain → baris alasan terakhir), `logError`/`logWarn` (konteks hanya primitif), `prismaEventSummary`.
- `lib/db/index.ts` — galat/peringatan Prisma = event, dicatat tersamar; development tetap mencetak query (SQL tanpa nilai).
- 193 pemanggilan `console.error/warn(tag, e…)` di 121 berkas → `logError`/`logWarn` (codemod), ±20 sisanya manual (template literal, `authFailureResponse`, `lib/pilgrims/http.ts`, `listHandlers`, harga, cron, `lastError` email/WhatsApp). `notify()` memakai `errorSummary` (pengganti `safeErr`). Log sapuan akun terhapus menulis kolom eksplisit, bukan `JSON.stringify`.
- Penjaga `scripts/test-log-pii.ts`: pemindai AST setiap `console.*` server (objek galat mentah, `.message`/`.stack`, `JSON.stringify`, nama kolom data pribadi, argumen tak dikenal → merah; pengecualian hanya `// log-pii-ok: <alasan>` sebaris — kini satu: tautan auth dev-only), uji mutan, dan galat validasi Prisma SUNGGUHAN (pesan aslinya memuat email/HP; ringkasan dan event klien tidak). `scripts/test-routes.ts` menerima `logError` sebagai jalur log di `catch`.
