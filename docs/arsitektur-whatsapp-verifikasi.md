# Arsitektur — Verifikasi WhatsApp lewat pesan masuk + email sebagai jaring pengaman

> Status: **SELESAI & TERVERIFIKASI secara lokal (2026-10-22)** — jaring pengaman email (§2) dan verifikasi nomor (§3–§9, as-built). **Belum diuji terhadap GOWA
> asli**: butuh pemilik mengonfigurasi webhook di GOWA (§6). Semua diuji dengan webhook palsu bertanda tangan HMAC sungguhan.

## 1. Fakta GOWA (aldinokemal/go-whatsapp-web-multidevice — dibaca dari dokumentasi resmi 2026-10-22)

| Hal | Fakta |
|---|---|
| Webhook | `--webhook` / env `WHATSAPP_WEBHOOK` (URL, boleh beberapa dipisah koma). Filter: `WHATSAPP_WEBHOOK_EVENTS` (kosong = semua; kita pakai `message`) |
| Payload pesan teks | `{ "event": "message", "device_id": "…", "payload": { "id", "chat_id", "from", "sender_display_name", "timestamp" (RFC3339), "is_from_me", "body" } }` |
| Pengirim | `payload.from` = JID penuh, mis. `628123456789@s.whatsapp.net` (kadang ada `from_lid`). Grup: `chat_id` berakhiran `@g.us` |
| Tanda tangan | Header `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 atas **body mentah**, kunci `WHATSAPP_WEBHOOK_SECRET` (bawaan `secret` — WAJIB diganti) |
| Pengiriman ulang | timeout 10 dtk; hingga 5 kali retry (1, 2, 4, 8, 16 dtk); penerima harus 2xx cepat dan **menangani duplikat** |
| Status koneksi | `GET /app/status` (perangkat bawaan), `GET /devices/:id/status`; `GET /health` hanya kesehatan server. **Tidak ada event putus-koneksi/logout** |

Yang belum terkonfirmasi (perlu dicoba pada instalasi Sumopod Anda): bentuk persis `/app/status`, apakah `from` selalu JID nomor (bukan LID) untuk kontak baru.

## 2. Jaminan: email selalu jaring pengaman (SUDAH DIEKSEKUSI 2026-10-22)

Permintaan pemilik: bila GOWA tidak aktif atau tidak ada nomor aktif, **semua notifikasi lewat email — pengguna tidak boleh kehilangan pemberitahuan hanya karena WhatsApp tidak ada.**
- `notify()` menjalankan WhatsApp dan email **paralel** (sebelumnya berurutan: gateway macet = timeout 10 dtk × 3 percobaan + jeda ≈ 34 dtk menunda email).
- Email dikirim untuk **semua** jenis kejadian tanpa syarat WhatsApp. WhatsApp hanya untuk 5 kejadian (booking, pengingat, pembayaran) dan hanya bila ada nomor + persetujuan (+ terverifikasi — sudah dieksekusi, §9).
- Bila **tidak ada** kanal yang sampai (WhatsApp mati **dan** email dimatikan admin/belum dikonfigurasi): peringatan keras tercatat (tanpa PII) — `[notify] TIDAK ADA kanal yang terkirim …`.
- Uji (`scripts/test-notify.ts`): untuk **setiap** jenis kejadian email terkirim saat gateway belum dikonfigurasi, akun tanpa nomor, tanpa persetujuan; plus gateway 500, gateway mati total, gateway lambat (email tiba sebelum WhatsApp selesai), dan kasus "tidak ada kanal". Uji mutasi: kembali ke berurutan dan mematikan peringatan — keduanya tertangkap.
- Sisa celah yang disadari: bila admin mematikan saklar email **dan** WhatsApp tak tersedia, tak ada yang sampai (hanya diberi peringatan). Saklar email adalah saklar darurat sengaja.

## 3. Rancangan verifikasi

**Skema:** `User.whatsappVerifiedAt DateTime?` dan `User.verifiedWhatsapp String? @unique` (salinan nomor yang terbukti; kolom unik biasa — Prisma tidak mengekspresikan indeks unik parsial, jadi keunikan "hanya di antara nomor terverifikasi" dicapai dengan kolom terpisah yang hanya terisi saat terverifikasi). Mengubah `whatsapp` mengosongkan keduanya. Token kode: `AuthToken` jenis baru `whatsapp_verification` (hash, sekali pakai, 15 menit, terikat `userId` + nomor).

**Alur:**
1. Pengguna menekan "Verifikasi WhatsApp" (profil / banner dashboard) → `POST /api/v1/auth/whatsapp/verification` (butuh sesi, rate limit) menerbitkan kode 8 karakter (alfabet tanpa karakter mirip) dan mengembalikan tautan `https://wa.me/<nomor bisnis>?text=VERIF%20<KODE>` (nomor bisnis dari `NEXT_PUBLIC_BUSINESS_WA`).
2. Pengguna mengirim pesan itu dari nomor yang didaftarkan.
3. GOWA memanggil `POST /api/v1/webhooks/whatsapp`. Endpoint: **tolak bila `WHATSAPP_WEBHOOK_SECRET` belum diisi** (fail-closed); verifikasi HMAC (`timingSafeEqual`, body mentah); abaikan `is_from_me`, grup, dan pesan yang bukan format `VERIF <KODE>`; cocokkan kode → token valid + **digit dari `from` == `User.whatsapp`**; klaim atomik; set `whatsappVerifiedAt` + `verifiedWhatsapp` dalam transaksi (bentrok unik → "sudah terverifikasi di akun lain", tanpa menyebut akun mana); balas 200 untuk semua kasus yang sah diabaikan (hindari retry badai); idempoten.
4. Halaman memeriksa `GET /api/v1/auth/whatsapp/status` (polling ringan) sampai terverifikasi; balasan otomatis "Nomor Anda terverifikasi" dikirim ke pengirim (percakapan dimulai pengguna — aman).
5. `notify()`: WhatsApp hanya bila `whatsappVerifiedAt` dan `verifiedWhatsapp === whatsapp`; selain itu `skipped` ("belum terverifikasi") — **email tak terpengaruh**. Batas harian per nomor tetap sebagai lapis tambahan.

**Mengapa aman:** JID pengirim diautentikasi oleh WhatsApp, tidak bisa dipalsukan pengguna — membuktikan pengendalian nomor tanpa mengirim apa pun keluar. Penyerang tidak bisa memverifikasi nomor korban (tak bisa mengirim dari nomor itu). Kode mengikat pesan ke akun yang meminta. Webhook publik dilindungi HMAC.

**Admin (panel Integrasi):** status GOWA langsung (`GET {WA_GATEWAY_URL}/app/status` — terhubung/tidak), apakah secret webhook terisi, dan URL webhook yang harus dipasang di GOWA.

## 4. Dampak
`prisma/schema.prisma` + migrasi; `lib/auth/whatsappVerify.ts` (kode, klaim, normalisasi JID→digit); rute `auth/whatsapp/{verification,status}` dan `webhooks/whatsapp`; `lib/notifications/notify.ts` (syarat terverifikasi); `lib/auth/contact.ts` (ubah nomor → cabut verifikasi); UI profil + banner dashboard; panel Integrasi; `.env*.example` (`WHATSAPP_WEBHOOK_SECRET`); uji dengan webhook palsu bertanda tangan; CI smoke (webhook tanpa/dengan tanda tangan salah → ditolak).

## 5. Keamanan yang harus diuji
HMAC salah/tanpa header/body diubah → 401; secret kosong → webhook mati; `from` ≠ nomor akun → tidak terverifikasi; grup & `is_from_me` diabaikan; kode kedaluwarsa/terpakai/milik akun lain; duplikat webhook (retry) idempoten; nomor sudah terverifikasi akun lain → ditolak tanpa kebocoran; ubah nomor mencabut verifikasi; balapan dua akun memverifikasi nomor yang sama (tepat satu menang); tidak ada PII/nomor di log; rate limit endpoint kode dan webhook.

## 6. Yang harus dilakukan pemilik (di luar kode)
Di GOWA (Sumopod): `WHATSAPP_WEBHOOK=https://<APP_DOMAIN>/api/v1/webhooks/whatsapp`, `WHATSAPP_WEBHOOK_SECRET=<acak panjang>`, `WHATSAPP_WEBHOOK_EVENTS=message`; isi **secret yang sama** di `.env.production` aplikasi. Pastikan GOWA bisa menjangkau domain aplikasi lewat HTTPS dan nomor bisnis (`NEXT_PUBLIC_BUSINESS_WA`) adalah nomor yang terhubung ke GOWA.

## 7. Keterbatasan yang diterima
Keluarga yang berbagi satu nomor: hanya satu akun yang menerima WhatsApp, lainnya email saja. Tanpa event putus-koneksi, status GOWA di admin hanya sesuai saat dibuka. Verifikasi bergantung pada GOWA menerima pesan (bila gateway mati, pengguna tak bisa memverifikasi — tetapi email tetap bekerja, §2).

## 8. Fase eksekusi
1. **Jaring pengaman email** — SELESAI (§2).
2. Skema + migrasi + `whatsappVerify` + webhook + uji + `notify()` terverifikasi — SELESAI (§9).
3. UI (profil, banner dashboard, polling) + panel Integrasi (status GOWA) + env/dok produksi — SELESAI (§9).
4. Security review (SOP langkah 5) — SELESAI (§9).

## 9. As-built (2026-10-22)

**Berkas:** `lib/auth/whatsappVerify.ts` (kode 8 karakter tanpa I/L/O/0/1, parser `VERIF <KODE>`, JID→digit, HMAC, `requestWhatsappVerification`, `completeWhatsappVerification`), `lib/whatsapp/webhook.ts` (`processWebhook` — seluruh logika webhook, diuji tanpa Next; `webhookSecret()`), rute `webhooks/whatsapp` (tipis: secret → baca body BERBATAS → `processWebhook` → balasan), `auth/whatsapp/{verification,status}`, `WhatsappVerifyCard`, banner dashboard, panel Integrasi (status GOWA langsung via `GET /app/status`, secret kuat?, nomor bisnis?, URL webhook), `whatsapp.status()`.
Skema: `User.whatsappVerifiedAt`, `User.verifiedWhatsapp @unique`, `AuthTokenType.whatsapp_verification`; migrasi `20261022120000_whatsapp_verification` (nomor lama otomatis tak terverifikasi).
Perilaku: `notify()` mengirim WA hanya bila `whatsappVerifiedAt` dan `verifiedWhatsapp === whatsapp` (+ persetujuan + batas 10/hari); mengubah nomor WhatsApp mencabut verifikasi; menonaktifkan akun melepas nomor; pengirim ≠ nomor akun, grup, LID, `is_from_me`, `chat_id ≠ from`, pesan basi (>10 mnt)/masa depan (>5 mnt), event lain, bukan format `VERIF` → diabaikan (200); kode tak hangus pada ketidakcocokan; penulisan verifikasi bersyarat (`updateMany where whatsapp = pengirim`) menutup balapan dengan `updateContact`; balasan otomatis hanya untuk sukses (memuat email **tersamar** akun) dan `taken`.
Pengaman webhook (hasil audit): secret < 32 karakter / bawaan GOWA (`secret`) / placeholder = **webhook mati (503)**; tanda tangan salah dibatasi 30/10 mnt per IP (429); batas per pengirim 10/jam hanya untuk pesan berformat `VERIF`; batas IP longgar 3000/10 mnt untuk semua pesan; ukuran body dibatasi 64 KB **dalam byte dan sebelum terbaca penuh**.

**Bukti verifikasi:**
- `scripts/test-whatsapp.ts` (23 uji): fungsi murni (kode, parser, JID, HMAC), alur akun (sukses, nomor salah tanpa membakar kode, kedaluwarsa, nomor diganti, nonaktif, satu nomor satu akun terverifikasi, balapan dua akun, pencabutan saat ganti nomor), **seluruh cabang webhook** (secret lemah → 503, 413 dalam byte, tanda tangan salah + pembatasan IP, 11 kasus diabaikan, balasan hanya ok/taken, batas pengirim, chat biasa tak menghabiskan batas, IP null, balapan verifikasi×ganti nomor, penjaga di route admin/webhook). **Uji mutasi 20 pengaman** (10 di tahap awal + 10 setelah audit): semua tertangkap.
- `test-notify` (+kasus belum terverifikasi untuk SEMUA jenis kejadian; email tetap terkirim; `verifiedWhatsapp ≠ whatsapp` tak dianggap terverifikasi).
- Browser + HTTP (dev server + GOWA palsu + webhook ditandatangani openssl): banner → kartu profil → kode + tautan `wa.me/<nomor bisnis>?text=VERIF…` → pesan dari nomor lain/grup/diri sendiri/LID diabaikan → pesan dari nomor benar (sufiks perangkat `:7`) → profil otomatis "Terverifikasi" + balasan otomatis di GOWA; retry idempoten; akun kedua dengan nomor sama → tak terverifikasi + balasan "sudah dipakai akun lain"; ganti nomor mencabut verifikasi; minta kode saat sudah terverifikasi → 409; panel admin menampilkan "Aktif" + URL webhook; tanpa tanda tangan/salah/body diubah → 401.
- CI smoke image produksi: webhook tanpa/salah/diubah tanda tangan → 401, sah + pesan biasa/kode tak dikenal → 200 `handled=false`, `verification` tanpa sesi → 401.
- **Audit keamanan independen** (`security-auditor`): 0 Critical, 0 High, 1 Medium, 5 Low, 2 Info — **semua diperbaiki** kecuali dua yang dicatat terbuka (alat admin pelepas nomor + balasan `BATAL`; anonimisasi akun — SEC-43/44).
- **Belum diverifikasi:** GOWA asli — apakah `from` selalu JID nomor (bukan `@lid`; pesan LID diabaikan diam-diam dan kartu memberi petunjuk setelah 90 dtk), bentuk persis `/app/status` (parser menyerah ke "tidak diketahui"), JID negara tertentu yang beda dari E.164.

## 10. Pelepasan verifikasi (SEC-43, 2026-10-25)

Dua jalur melepas verifikasi nomor (`releaseWhatsappVerification` di `lib/auth/whatsappVerify.ts`): kolom `whatsappVerifiedAt`/`verifiedWhatsapp` dikosongkan dan kode verifikasi yang menunggu dihanguskan; **nomor kontak (`whatsapp`) tetap tersimpan** — akun hanya berhenti menerima WhatsApp sampai nomor dibuktikan lagi (email tidak terpengaruh). Penulisan bersyarat pada nomor yang dibaca, jadi tidak balapan dengan verifikasi/pergantian nomor.

- **Pemegang nomor: balas `BATAL`** (juga `BATAL VERIF`/`BATAL VERIFIKASI`) ke nomor bisnis. Berlaku hanya untuk pesan dari pengirim yang JID-nya terautentikasi WhatsApp, obrolan pribadi (chat = pengirim). Melepas verifikasi nomor itu dari akun mana pun yang memegangnya — inti kasus nomor daur ulang: pemilik lama masih "terverifikasi", pemilik baru terkena `taken`. Balasan (ke pengirim sendiri, email akun tersamar) hanya bila ada yang dilepas; selain itu diam, sehingga tidak bisa dipakai menebak nomor mana yang terverifikasi. Dibatasi 5/jam per pengirim (`webhookCancelSender`). Pesan `taken` kini menyebut `BATAL`.
- **Superadmin: `DELETE /api/v1/admin/system/users/[id]/whatsapp`** + tombol "Lepas WhatsApp" (muncul bila akun terverifikasi) di Manajemen Pengguna. Tanpa body; log audit hanya id pelaku/target.

Uji: `scripts/test-whatsapp.ts` (+6 uji: parser, pelepasan lewat nomor/id, kasus nomor daur ulang end-to-end, cabang webhook BATAL, batas pengirim, penjaga route) — tiga pengaman dimutasi dan tertangkap; HTTP nyata (tanda tangan salah 401, BATAL sah melepas, manager/tanpa login 403, id tak ada 404, ulang → released=false).
