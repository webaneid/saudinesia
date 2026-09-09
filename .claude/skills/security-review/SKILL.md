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
   upload handler, `middleware.ts`, Prisma schema). Kalau tidak jelas, tanya
   user file mana yang mau di-review.

2. Baca `docs/architecture/architecture-security.md` untuk checklist lengkap
   (jangan hafal dari memori, checklist project bisa sudah diupdate).
   Project ini **bukan** multi-tenant (satu operator, lihat `CLAUDE.md`
   intro) — jangan cari checklist tenant isolation yang tidak relevan.

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

   **Kalau ada secret/config baru:**
   - [ ] Diambil dari `process.env`, bukan hardcoded
   - [ ] Ada di `.env.example` (tanpa nilai asli) kalau memang perlu didokumentasikan

4. Laporkan hasil dalam format:
   ```
   ## Security Review — [nama file/fitur]

   ✅ Lolos: [poin yang sudah benar]
   ⚠️  Perlu diperbaiki: [poin bermasalah + baris kode + saran fix]
   ❓ Perlu dicek manual: [hal yang tidak bisa dipastikan dari kode saja]
   ```

5. Kalau ketemu masalah kategori "⚠️ Perlu diperbaiki", JANGAN anggap task selesai
   — perbaiki dulu atau tanya user mau prioritaskan fix sekarang atau dicatat
   sebagai technical debt di `docs/decisions.md`.

6. Kalau reviewnya kompleks/menyentuh banyak file sekaligus (misal audit
   seluruh `app/api/v1/admin/`), pertimbangkan delegasikan ke subagent
   `security-auditor` (lihat `.claude/agents/security-auditor.md`) supaya
   tidak menghabiskan context window sesi utama.
