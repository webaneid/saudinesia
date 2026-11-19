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
- **G2 — SELESAI 2026-11-19** — peran database terpisah (G-1): `migrator` pemilik skema, `app` DML saja; compose + `.env.production.example` + `docs/deployment.md` + uji bahwa peran app tak bisa mematikan trigger.
- **G3 — SELESAI 2026-11-19 (§6 rencana, §7 hasil)** — jejak staf + ZIP (G-2): tabel jejak append-only, ditulis di transaksi yang sama oleh `lib/auth/adminUsers.ts`, login staf, dan unduhan ZIP.
- G-1 = SEC-303, G-2 = SEC-304; G-3/G-4/G-5 = SEC-305..307 di Register Temuan Security, menyusul sesudah go-live.

## 4. Hasil G1 (2026-11-19)

- `lib/log/index.ts` — `redactPii` (email, angka ≥ 8 digit, token ≥ 32; UUID dan tanggal ISO dipertahankan), `errorSummary` (nama + kode + pesan tersamar + 3 lokasi; validasi Prisma → "validasi Prisma gagal (prisma.x.y)"; galat Prisma lain → baris alasan terakhir), `logError`/`logWarn` (konteks hanya primitif), `prismaEventSummary`.
- `lib/db/index.ts` — galat/peringatan Prisma = event, dicatat tersamar; development tetap mencetak query (SQL tanpa nilai).
- 193 pemanggilan `console.error/warn(tag, e…)` di 121 berkas → `logError`/`logWarn` (codemod), ±20 sisanya manual (template literal, `authFailureResponse`, `lib/pilgrims/http.ts`, `listHandlers`, harga, cron, `lastError` email/WhatsApp). `notify()` memakai `errorSummary` (pengganti `safeErr`). Log sapuan akun terhapus menulis kolom eksplisit, bukan `JSON.stringify`.
- Penjaga `scripts/test-log-pii.ts`: pemindai AST setiap `console.*` server (objek galat mentah, `.message`/`.stack`, `JSON.stringify`, nama kolom data pribadi, argumen tak dikenal → merah; pengecualian hanya `// log-pii-ok: <alasan>` sebaris — kini satu: tautan auth dev-only), uji mutan, dan galat validasi Prisma SUNGGUHAN (pesan aslinya memuat email/HP; ringkasan dan event klien tidak). `scripts/test-routes.ts` menerima `logError` sebagai jalur log di `catch`.

## 5. Hasil G2 (2026-11-19, menutup SEC-303)

- Dua peran: `saudinesia` (POSTGRES_USER, pemilik skema/superuser bootstrap) dipakai HANYA kontainer `migrate` lewat `MIGRATE_DATABASE_URL`; `saudinesia_app` dipakai web lewat `DATABASE_URL` — LOGIN, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS, bukan pemilik apa pun, hanya SELECT/INSERT/UPDATE/DELETE + sekuens (tanpa TRUNCATE/TRIGGER, `_prisma_migrations` tertutup, `CREATE` di skema `public` dicabut).
- Peran dibuat/diperbarui oleh image `migrate` SESUDAH setiap `prisma migrate deploy` (`prisma/apply-app-role.ts` → SQL `prisma/appRole.ts` lewat `prisma db execute --stdin`; idempoten, sandi `APP_DB_PASSWORD` alfanumerik ≥ 32 tak muncul di argumen proses). Tabel baru ikut terbuka lewat `ALTER DEFAULT PRIVILEGES` dan GRANT ulang tiap deploy.
- Web tak lagi memegang kredensial pemilik: `POSTGRES_PASSWORD`, `MIGRATE_DATABASE_URL`, `APP_DB_PASSWORD` dikosongkan di `environment` web. `scripts/buat-env-production.sh` membuat dua sandi berbeda.
- Kebutuhan runtime dicek: aplikasi tak menjalankan DDL; `LOCK TABLE booking_code_lock IN EXCLUSIVE MODE` cukup dengan hak UPDATE; advisory lock dan `SET LOCAL` tak butuh hak khusus.
- Penjaga `scripts/test-db-roles.ts` (DB sekali pakai + koneksi superuser; peran uji acak, dihapus di akhir): SQL menolak sandi/nama tak sah; penerapan idempoten lewat jalur produksi; peran bukan superuser/pemilik; setiap tabel DML saja; mematikan trigger di SETIAP tabel bertrigger, `DROP`/`ALTER`/`TRUNCATE`/`CREATE TABLE`/`COPY … TO PROGRAM`/`session_replication_role`/`ALTER ROLE … SUPERUSER` ditolak; `LOCK TABLE` kode booking + advisory jalan; default privileges untuk tabel baru. Juga mengunci isi compose/Dockerfile/`.env.production.example`.
- CI (`docker` smoke): web memakai `saudinesia_app` dan punya koneksi aktif sebagai peran itu, peran bukan superuser/pemilik, kredensial pemilik tak terbaca di web, `ALTER TABLE cash_entries DISABLE TRIGGER ALL` sebagai `saudinesia_app` ditolak — di atas seluruh smoke yang sudah ada (checkout, invoice PDF, login) yang kini berjalan dengan peran DML saja.
- Uji nyata lokal: server dev dengan peran DML saja pada DB audit — checkout visa (kode booking + nomor invoice + snapshot), atur total booking (snapshot penyesuaian + pajak ulang), batal oleh staf, halaman admin utama: semua berhasil, tanpa galat izin; seluruh koneksi aplikasi tercatat sebagai peran DML.

## 6. Rencana G3 — jejak staf (SEC-304)

Keputusan pemilik (2026-11-19): login yang dicatat = **staf saja** (admin/manager/superadmin; jamaah tidak); **IP utuh** disimpan; **halaman Sistem → Jejak Staf** dibuat sekarang.

Recheck: jejak append-only yang ada hanya `settings_audit` (setelan) dan jejak buka NIK/paspor (gudang identitas). Buat/ubah staf (`POST admin/system/users`, `updateUserByAdmin`), buka kunci login (`reset-limits`), lepas WhatsApp (`whatsapp` DELETE) hanya `console.info` (hilang saat log diputar) atau tidak tercatat sama sekali; login staf dan unduhan ZIP dokumen jamaah (`admin/bookings/[id]/documents/zip`) tak tercatat.

1. Tabel `staff_audit_events` (append-only lewat trigger, `at` timestamptz): `actorId` (staf pelaku; login = akun itu sendiri; null = skrip), `targetUserId`, `bookingId`, `action` (CHECK: `staff_create`, `staff_update`, `staff_reset_limits`, `staff_whatsapp_release`, `login_success`, `login_failed`, `documents_zip`), `ip`, `summary` JSON TANPA data pribadi (peran/status lama → baru, nama cukup "berubah", alasan gagal login sebagai kode, jumlah berkas ZIP).
2. Satu penulis `lib/audit/staff.ts` (`recordStaffEvent(tx, …)`); pembaca `listStaffEvents` untuk halaman. Ditulis DI TRANSAKSI yang sama dengan perubahan akun; login berhasil dan ZIP fail-closed (jejak gagal ditulis = tidak masuk / tidak terunduh); login gagal best-effort (galat dicatat, respons tetap 401).
3. Login gagal dicatat hanya bila email milik akun staf (sandi salah, nonaktif, belum verifikasi) — email tak dikenal tidak dicatat (tak ada pemilik, menghindari menyimpan masukan bebas).
4. Halaman superadmin `system/staff-audit`: `DataTable` + `Pagination` + `FilterBar` (aksi, staf), waktu `formatInstant`. Akun bayangan Platform Provider tak terlihat oleh superadmin klien (`visibleStaffWhere`): kejadian yang pelaku ATAU targetnya akun provider disembunyikan.
5. Hapus akun: staf tidak dihapus lewat jalur UU PDP (dinonaktifkan); kolom `actorId`/`targetUserId` didaftarkan di pemindai `scripts/test-deletion.ts` sebagai dipertahankan (jejak keamanan, kepentingan sah).
6. Penjaga `scripts/test-staff-audit.ts`: setiap jalur menulis tepat satu baris; tanpa perubahan = tanpa baris; UPDATE/DELETE ditolak trigger; ringkasan tanpa email/nama; login jamaah tidak tercatat; penyaring provider; pemindai sumber — tak ada penulis `staffAuditEvent` lain.

## 7. Hasil G3 (2026-11-19, menutup SEC-304)

- Tabel `staff_audit_events` (migrasi `20261209090000_staff_audit_events`): tanpa FK, `at` timestamptz, CHECK daftar aksi + `summary` berupa objek, trigger menolak SEMUA UPDATE/DELETE (TRUNCATE ditutup oleh peran DML G2). Penulis tunggal `lib/audit/staff.ts` (`recordStaffEvent`), ringkasan bertipe sempit (skalar atau pasangan lama → baru).
- Jalur berjejak: buat staf (satu transaksi dengan akun), `updateUserByAdmin` (di transaksi berkunci yang sama; hanya bila peran/status/nama benar-benar berubah, nama cukup "berubah"), buka kunci login, lepas WhatsApp (menggantikan `console.info`), login staf (gagal = best-effort dengan kode alasan `password`/`inactive`/`unverified`; berhasil = fail-closed sebelum sesi terbit), unduhan ZIP dokumen jamaah (fail-closed sebelum berkas diserahkan; jumlah berkas dan jamaah, tanpa nama). Login jamaah dan email tak dikenal tidak dicatat.
- IP = `auditIp` (nilai pertama `X-Forwarded-For` utuh — BUKAN `clientIp` rate limit yang meringkas IPv6 ke /64; ditemukan saat uji browser).
- Halaman superadmin Sistem → Jejak Staf (`system/staff-audit`): `DataTable` + `Pagination` + `FilterBar` (aksi, staf — daftar putih staf yang terlihat). Kejadian yang pelaku ATAU sasarannya akun bayangan Platform Provider disembunyikan dari superadmin klien.
- Sambil lalu: respons ZIP kini `Cache-Control: no-store` (butir cek manual §2.1).
- Hapus akun: `StaffAuditEvent.actorId`/`targetUserId` didaftarkan di `scripts/test-deletion.ts` sebagai dipertahankan (staf dinonaktifkan, bukan dihapus lewat jalur UU PDP).
- Penjaga `scripts/test-staff-audit.ts` (DB sungguhan): satu baris per perubahan, tanpa perubahan/ditolak = tanpa baris, ringkasan tanpa nama/email, IP utuh, login staf berhasil/gagal/nonaktif, jamaah & email tak dikenal tak tercatat, UPDATE/DELETE/aksi liar ditolak DB, penyaring provider, pemindai sumber (penulis tunggal; route wajib berjejak; jejak sebelum `createSession` dan sebelum respons ZIP).
- Uji browser (DB audit): login gagal + berhasil, buka kunci, ubah peran dua arah, unduh ZIP — semua tampil di halaman dengan filter aksi bekerja.

