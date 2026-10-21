---
name: security-review
description: Audit kode yang baru ditulis/diedit terhadap checklist keamanan project (docs/architecture/architecture-security.md). Gunakan setelah selesai bikin endpoint baru, fitur auth, upload file, atau query database — sebelum dianggap "selesai"/commit. Bisa juga dipanggil manual lewat "/security-review" atau saat user minta "cek keamanan kode ini".
---

# Skill: Security Review

> Diadopsi dari template `master-typescript` (2026-09-10), disesuaikan ke
> stack project ini: Next.js App Router Route Handler + Prisma (bukan Elysia
> + Drizzle), auth JWT + WhatsApp OTP via GOWA, storage MinIO.

Tujuan: mengecek kode yang baru ditulis terhadap checklist konkret, BUKAN
memberi opini umum "sudah cukup aman". Setiap poin harus dijawab dengan
merujuk baris kode spesifik, bukan asumsi.

## Langkah

1. Identifikasi file yang baru diubah di sesi ini (Route Handler, auth,
   upload handler, `middleware.ts`, Prisma schema, **dan** Dockerfile/compose/
   Caddyfile/workflow/skrip/`.env*.example`/`package.json`). Pakai
   `git diff --name-only <base>..HEAD` bila review mencakup satu fase/PR. Kalau
   tidak jelas, tanya user file mana yang mau di-review.

2. Baca `docs/architecture/architecture-security.md` untuk checklist lengkap
   (jangan hafal dari memori, checklist project bisa sudah diupdate).
   Project ini **bukan** multi-tenant (satu operator, lihat `CLAUDE.md`
   intro) — jangan cari checklist tenant isolation yang tidak relevan.
   Baca juga **Register Temuan Security** di `docs/lessons-learned.md` — jangan
   melaporkan ulang temuan yang sudah tercatat Terbuka (rujuk ID-nya), dan
   periksa apakah pola yang sama muncul di kode baru.

3. Untuk TIAP file yang direview, cek poin yang relevan:

   **Kalau file adalah Route Handler (`app/api/v1/**/route.ts`):**
   - [ ] Semua field body/query/params divalidasi pakai Zod schema dari
         `lib/validators/` sebelum dipakai — bukan langsung `await request.json()`
         tanpa `.parse()`/`.safeParse()`
   - [ ] Endpoint yang butuh login memanggil `lib/auth/session.ts` di AWAL
         handler — `middleware.ts` saja tidak cukup (`CLAUDE.md` § API Conventions)
   - [ ] Kalau endpoint akses resource spesifik (by id), ada cek ownership/role
         — bukan cuma cek "user sudah login", tapi "user/role ini boleh akses resource ini"
   - [ ] Response shape konsisten `{ success, data?, error?, meta? }` — tidak
         mengembalikan Prisma error mentah, stack trace, atau nama model internal
   - [ ] Rate limiting ada untuk endpoint sensitif (login, register,
         forgot-password, OTP — pola Redis counter sudah ada di `lib/auth/otp.ts`)

   **Kalau file menyentuh database (Prisma):**
   - [ ] Tidak ada `$queryRaw`/`$executeRaw` dengan string concatenation/template
         literal manual dari input user
   - [ ] Kalau terpaksa raw SQL, pakai parameter binding Prisma (`prisma.$queryRaw\`... WHERE id = ${id}\``)
         — ada juga komentar yang jelaskan kenapa Prisma ORM tidak cukup
         (aturan `CLAUDE.md` § Prisma)
   - [ ] Tidak ada query yang balikin semua kolom termasuk field sensitif ke
         response (mis. `passwordHash`/token internal ikut ke-serialize)

   **Kalau file terkait auth (`lib/auth/`, login/register):**
   - [ ] Session JWT `httpOnly; Secure; SameSite=Strict` (`CLAUDE.md` § Security)
   - [ ] Tidak pernah log OTP, password, atau isi token — meski di error log
   - [ ] Permission check role (`ADMIN_ROLES`/`SUPERADMIN_ROLES`) dicek di
         `lib/auth/session.ts` atau di Route Handler, bukan `if` ad-hoc yang
         gampang kelewat di endpoint baru
   - [ ] OTP rate limit (3x/10 menit per nomor) tetap dipakai kalau ada flow
         OTP baru — jangan bikin jalur OTP baru yang skip counter Redis ini

   **Kalau file terkait upload (MinIO, `lib/storage/minio.ts`):**
   - [ ] Validasi MIME type + ukuran file **server-side** (whitelist
         `image/jpeg`, `image/png`, `application/pdf`, maks 5 MB —
         `CLAUDE.md` § MinIO), bukan cuma trust `Content-Type` dari client
   - [ ] Object key digenerate server-side dengan format
         `{entity}/{entity_id}/{doc_type}/{unix_ms}-{sanitized_filename}` —
         bukan nama file asli mentah dari client (path traversal risk)
   - [ ] Semua panggilan SDK MinIO lewat `lib/storage/minio.ts`, tidak ada
         raw SDK usage di tempat lain
   - [ ] Presigned URL, bukan bucket public — TTL sesuai konvensi (15 menit
         preview, 60 menit ZIP)

   **Kalau file terkait pembayaran (`Payment`/`Refund` model, admin confirm):**
   - [ ] Konfirmasi pembayaran manual (`buktiTransferPath`/`confirmedById`)
         cuma bisa dilakukan role admin/manager/superadmin — cek di handler,
         bukan cuma di UI
   - [ ] `totalAmount`/`amount` selalu dihitung ulang/divalidasi server-side,
         tidak pernah dipercaya mentah dari body request client

   **Kalau file menulis ke database dari body request (create/update):**
   - [ ] Tidak ada `data: body` / `data: b` / `...body` ke Prisma — body diparse
         dulu dengan Zod schema `.strict()` dari `lib/validators/` (mass
         assignment: field seperti `passwordHash`, `role`, `bookedQuota`,
         `pendingQuota` tidak boleh bisa diubah dari body)
   - [ ] Field yang dikelola mesin lain (kuota booking, status pembayaran,
         harga hasil `computeSellPrice`) tidak ada di schema update
   - [ ] Error dibedakan: `Unauthorized`/`Forbidden` → 401/403, input tidak
         valid → 400, tidak ditemukan (`P2025`) → 404, sisanya 500 + log. BUKAN
         `catch { return 403 }` untuk semua error

   **Kalau file adalah endpoint sensitif (login, register, forgot/reset password, OTP, kirim WhatsApp):**
   - [ ] Ada rate limit per identitas (nomor/email) DAN per IP, dan ada batas
         percobaan salah untuk kode yang bisa ditebak (OTP 6 digit)
   - [ ] **Fungsi proteksinya punya pemanggil.** `grep -rn "<namaFungsi>"` —
         fungsi rate limit yang tidak dipanggil siapa pun sama dengan tidak ada
         (SEC-04). Jangan puas dengan "ada fungsinya / ada di dokumen"
   - [ ] Perilaku jatuh ke aman bila Redis/penyimpan counter mati (fail-closed
         untuk endpoint yang memicu biaya/pengambilalihan akun), atau
         keputusan fail-open dicatat sadar

   **Kalau ada perilaku khusus development (OTP di response/log, bypass limit, endpoint `/dev/*`, `NODE_ENV`):**
   - [ ] Kondisi aktifnya `NODE_ENV === 'development'` persis. `!== 'production'`
         = fail-open → lingkungan dengan NODE_ENV salah/kosong membocorkan OTP
         (SEC-02). Uji dengan `NODE_ENV` = `test`, `staging`, kosong → harus mati

   **Kalau file infra (Dockerfile, docker-compose*.yml, Caddyfile, `.github/workflows/*`, `scripts/*`, `.env*.example`, `next.config.ts`, `instrumentation*.ts`):**
   - [ ] Image berjalan non-root; tidak ada rahasia di layer/`ARG`/`ENV` (`ARG`
         terlihat di `docker history`; `NEXT_PUBLIC_*` memang publik); `.dockerignore`
         mengecualikan `.env*`, `.git`, `docs`, `.claude`
   - [ ] Compose: tidak ada `ports:` selain reverse proxy (Postgres/Redis/MinIO
         hanya jaringan internal); batas resource; tidak ada `privileged`/mount `docker.sock`
   - [ ] Caddy/header: HSTS, `nosniff`, anti-clickjacking (`frame-ancestors`),
         host file hanya GET/HEAD; `X-Forwarded-For` ditimpa
   - [ ] Workflow: `permissions:` minimum (`contents: read`), tidak memakai
         `pull_request_target` dengan checkout kode PR, rahasia tidak di-`echo`,
         action dipin versi; langkah deploy tidak menerima input tak tepercaya
         di `run:` (injeksi `${{ github.event... }}`)
   - [ ] Skrip: tidak mengambil rahasia dari argumen (riwayat shell/`ps`), tidak
         menimpa data yang ada, tidak mencetak rahasia; uji pada database
         sekali pakai, bukan DB dev
   - [ ] Berkas yang berisi rahasia asli (`.env.production`, `.env.deploy`) ada
         di `.gitignore`; hanya `*.example` yang boleh ter-commit
   - [ ] File yang dikompilasi untuk Edge (`instrumentation.ts`, `middleware.ts`)
         tidak menarik modul Node — dibuktikan oleh `bun run build`, bukan typecheck

   **Kalau `package.json` / `bun.lock` berubah:**
   - [ ] `bun audit --audit-level=critical` bersih; catat jumlah high/moderate
         dan apakah ada yang **baru** karena dependency yang ditambah
   - [ ] Dependency baru benar-benar perlu (bukan satu pemanggilan yang bisa
         dilakukan runtime bawaan) dan berasal dari maintainer/nama yang benar

   **Kalau ada secret/config baru:**
   - [ ] Diambil dari `process.env`, bukan hardcoded
   - [ ] Ada di `.env.example` (tanpa nilai asli) kalau memang perlu didokumentasikan

4. Laporkan hasil dalam format (severity sama dengan `.claude/agents/security-auditor.md`):
   ```
   ## Security Review — [nama file/fitur]

   ✅ Lolos: [poin yang sudah benar]
   ⚠️  Perlu diperbaiki:
      - [CRITICAL/HIGH/MEDIUM/LOW] [judul] — file:baris — masalah — saran fix — [baru di fase ini | pre-existing]
   ❓ Perlu dicek manual: [hal yang tidak bisa dipastikan dari kode saja]
   ```
   Jangan melebih-lebihkan severity; akurasi klasifikasi lebih penting daripada daftar panjang.

5. Tindak lanjut (aturan lengkap: `CLAUDE.md` § Fase Eksekusi SOP langkah 5):
   - **Critical/High pada kode yang diubah/ditambah fase ini → WAJIB diperbaiki
     sebelum task/fase dianggap selesai.** Buktikan perbaikannya dengan uji
     nyata (curl/skrip, termasuk kasus yang harus ditolak), bukan hanya typecheck.
   - **Medium/Low → catat** di Register Temuan Security
     (`docs/lessons-learned.md`: ID berikutnya, severity, status, lokasi) — boleh
     ditunda, tidak boleh hilang.
   - **Pre-existing** (kode lama yang ditemukan sambil lalu): catat severity
     apa adanya dan beri tahu user. Critical/High pre-existing dijadwalkan
     sebagai fase hardening, wajib Selesai sebelum go-live.

6. Kalau reviewnya kompleks/menyentuh banyak file sekaligus (lebih dari ±10
   file, lintas modul, atau menyentuh auth/pembayaran/upload/infra),
   delegasikan ke subagent `security-auditor` (lihat
   `.claude/agents/security-auditor.md`) supaya tidak menghabiskan context
   window sesi utama.
