# ADR-0005: Identitas jamaah global berkunci NIK + kartu per akun, NIK & paspor terenkripsi

**Status:** Accepted
**Tanggal:** 2026-11-02

## Context
Pemilik ingin (1) setiap akun punya daftar jamaah tersimpan, (2) satu gudang jamaah global tanpa duplikat dengan NIK sebagai penjaga ("hari ini lewat jamaah B, besok lewat rombongan C, datanya satu"), dan (3) pengguna hanya melihat jamaah yang ia input sendiri. Poin 2 dan 3 bertentangan bila diterapkan pada satu baris data yang sama. NIK dan nomor paspor adalah data pribadi kuat; ruang NIK kecil dan berpola (wilayah + tanggal lahir + urut), sehingga hash polos dapat dibalik bila database bocor. Rencana lengkap dan keputusan pemilik K1–K12, C1–C3: `docs/arsitektur-jamaah.md`.

## Decision
- **Dua lapis**: `PilgrimIdentity` (satu baris per orang, unik `HMAC(NIK)`, hanya staf) dan `SavedPilgrim` (kartu milik satu akun, berisi persis yang diketik akun itu). Kartu dengan NIK yang cocok ditautkan diam-diam ke identitas yang sama. `BookingPilgrim.fieldValues` tetap snapshot beku per booking.
- **NIK wajib** untuk setiap jamaah (kecuali bayi < 2 tahun); WNA dikenali lewat negara + nomor paspor. Respons simpan kartu identik apakah NIK baru, sudah ada, atau konflik — tidak ada orakel keberadaan data.
- **NIK dan nomor paspor**: indeks HMAC-SHA256 berkunci (pemisahan domain per tujuan) + nilai asli AES-256-GCM (IV acak, AAD per tujuan, ciphertext berversi kunci untuk rotasi). **NIK tanpa digit polos sama sekali** (digit 1–12 dapat diturunkan dari kode kecamatan alamat dan tanggal lahir, sehingga 4 digit terakhir polos melengkapi NIK tanpa kunci — SEC-165): tampilan selalu tersamar penuh; paspor boleh menyimpan 4 karakter terakhir. Membuka nilai mencocokkan indeks baris yang sama. Satu modul `lib/pii/` — satu-satunya pemakai cipher dan pembaca kunci (dijaga `scripts/test-pii.ts`).
- **Kunci terpisah dari `JWT_SECRET`**: `PII_INDEX_KEY`, `PII_ENCRYPTION_KEY` (+ `PII_ENCRYPTION_KEY_VERSION`, `PII_ENCRYPTION_KEYS_RETIRED` untuk rotasi), 64 hex, divalidasi fail-closed saat dipakai, diperingatkan saat boot.

## Alternatif yang Dipertimbangkan
- **Satu baris jamaah dipakai bersama semua akun** — membocorkan data A ke B begitu B memilih orang yang sama.
- **Minta NIK hanya bila nama + alamat sama** (usulan awal) — permintaan NIK itu sendiri memastikan orang tersebut terdaftar (enumerasi); ditolak demi privasi, pemilik menyetujui NIK selalu wajib.
- **SHA-256 polos untuk NIK** — dapat dibalik dengan menebak semua NIK yang mungkin.
- **Kunci diturunkan dari `JWT_SECRET`** (pola tautan invoice) — merotasi kunci sesi akan merusak indeks NIK dan membuat NIK tersimpan tak terbaca.
- **BIGSERIAL** — ID berurutan mengundang tebakan URL; skema seluruhnya UUID.

## Konsekuensi
- Pengguna tidak pernah melihat data akun lain; Saudinesia tetap melihat satu orang dengan satu riwayat.
- Data kanonik disalin ke identitas (duplikasi kolom yang disengaja); diperbarui dari pengajuan jamaah yang lolos verifikasi admin.
- **Kunci PII hilang = NIK/paspor tersimpan tak terbaca** → kunci wajib dicadangkan; mengganti `PII_INDEX_KEY` berarti menghitung ulang semua indeks dari nilai terdekripsi.
- Pencarian NIK hanya pencocokan tepat (lewat indeks), bukan pencarian sebagian.
