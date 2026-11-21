# Rencana — GOWA self-host + halaman Sistem → WhatsApp (koneksi & template)

Status: **RENCANA DISETUJUI (2026-11-21)** — keputusan §6 diambil pemilik. **F1 SELESAI 2026-11-21** (§7); F2 berikutnya. Acuan pola: jalajogja (`docs/arsitektur-gowa-deployment.md`,
`docs/arsitektur-whatsapp.md` §5/§7/§8/§16.8). Kebijakan WhatsApp yang TIDAK berubah: ADR-0001 (WhatsApp hanya kanal notifikasi, email jaring
pengaman wajib), ADR-0002 (hanya nomor terverifikasi yang menerima pesan; verifikasi lewat pesan MASUK `VERIF <kode>` + webhook HMAC).

## 1. Latar

Pemilik: GOWA di Sumopod = biaya bulanan tambahan untuk klien. GOWA (open source, `aldinokemal2104/go-whatsapp-web-multidevice`) cukup
dijalankan sebagai kontainer di VPS kita sendiri, dikelola dari halaman admin seperti jalajogja: hubungkan (scan QR), lihat status, putuskan,
dan **edit teks template** notifikasi.

## 2. Recheck kode vs dokumen (Fase Eksekusi SOP langkah 1)

| Hal | Kode aktual | Catatan |
|---|---|---|
| Klien GOWA | `lib/whatsapp/client.ts`: `POST {url}/app/send/message/text`, header `Authorization: Bearer <WA_GATEWAY_TOKEN>`; status `GET /app/status` | **Gap:** GOWA v9 (openapi resmi) memakai `POST /send/message` `{phone, message}` dan **Basic auth** (`--basic-auth user:pass`). Jalur & auth sekarang tidak cocok dengan GOWA asli — belum pernah teruji karena gateway belum pernah diisi di produksi. |
| Template | `lib/notifications/templates/whatsapp.ts` (fungsi JS, Indonesia saja) dipilih `waMessage()` `lib/notifications/events.ts` | Aktif dikirim: `invoice_issued`, `payment_reminder_d1/d0`, `payment_confirmed`, `payment_rejected`, `departure_reminder_7d/1d` + 3 balasan verifikasi (`whatsappVerified/Taken/Released`). `bookingSubmitted`, `autoCancelled`, `visaStatusChange`, `refundApproved` = mati (dipertahankan). CLAUDE.md menyebut "keyed by locale" — kenyataannya satu bahasa. |
| Varian bersyarat | `paymentReminder` (belum bayar vs sisa cicilan), `paymentConfirmed` (lunas vs sebagian), `invoiceIssued` (baris tautan hanya bila URL https) | Template `{{var}}` ala jalajogja tak punya kondisional → dipecah jadi kunci terpisah (§4.3). |
| Panel status | `lib/notifications/integrations.ts` → Sistem → Pengaturan (Integrasi): configured/hasToken/webhook/gateway reachable+connected | Teks masih menyebut Sumopod. Akan dipindah ke halaman WhatsApp. |
| Webhook masuk | `app/api/v1/webhooks/whatsapp` + `lib/whatsapp/webhook.ts` (HMAC `X-Hub-Signature-256`) | Cocok dengan GOWA v9. Host internal `web:3000` tergolong host `app` → `/api/v1/webhooks` tidak diblokir (`lib/admin/domain.ts`). |
| Log | `notification_logs.messagePreview` menyimpan cuplikan pesan | Variabel template TIDAK boleh berisi PII baru (nama jamaah dll.) — tetap seperti sekarang: kode booking, nominal, tanggal. |
| Compose/env | `docker-compose.prod.yml` tanpa layanan WhatsApp; `.env.production.example` `WA_GATEWAY_URL/TOKEN`, `WHATSAPP_WEBHOOK_SECRET` (dibuat `buat-env-production.sh`) | Disesuaikan F1. |

## 3. Infrastruktur (F1)

- Layanan `gowa` di `docker-compose.prod.yml`: image **dipin versi + digest** (kandidat v9.9.0, 2026-11-06; v9.10.0 terlalu baru < 2 minggu),
  hanya jaringan `internal`, **tanpa `ports:`** (tidak pernah publik — beda dari jalajogja yang membuka subdomain QR), volume `gowa_data:/app/storages`
  (sesi WhatsApp), `mem_limit`, `restart: unless-stopped`, healthcheck `/health`.
- Konfigurasi GOWA: basic auth `GOWA_BASIC_AUTH_USER/PASSWORD` (acak, dibuat generator env), webhook `http://web:3000/api/v1/webhooks/whatsapp`,
  `WHATSAPP_WEBHOOK_SECRET` (nilai sama dengan web), event `message` saja, auto-reply/auto-mark-read mati.
- Web: `WA_GATEWAY_URL=http://gowa:3000` + kredensial Basic yang sama. `WA_GATEWAY_TOKEN` dihapus (mesin di atas data — belum pernah dipakai).
- `scripts/buat-env-production.sh` mengisi kredensial GOWA; helper sekali jalan untuk server yang `.env.production`-nya sudah ada
  (menambah baris tanpa menimpa apa pun).
- Klien `lib/whatsapp/client.ts` (tetap satu-satunya pemanggil GOWA): Basic auth, `POST /send/message`, `status()` dari `/app/status`, plus
  `loginQr()`, `loginWithCode(phone)` (opsional, §6 K3), `logout()`, `reconnect()`. Tidak pernah melempar; tak mencatat nomor/isi (SEC-09).

## 4. Halaman Sistem → WhatsApp (F2 koneksi, F3 template)

Menu baru `/admin/system/whatsapp` (superadmin; manager hanya lihat? → §6 K5). Panel Integrasi di Pengaturan hanya ringkasan + tautan.

### 4.1 Koneksi (alur jalajogja §7.1, tanpa langkah "buat device" — satu perangkat)
- Kartu status: gateway terjangkau, terhubung/terputus, nomor yang tertaut (dari `jid`), webhook secret OK, **peringatan bila nomor tertaut ≠
  `NEXT_PUBLIC_BUSINESS_WA`** (verifikasi `VERIF` dikirim jamaah ke nomor bisnis — kalau beda, verifikasi tak pernah sampai).
- "Hubungkan" → modal QR: `GET /api/v1/admin/whatsapp/qr` — server memanggil GOWA `/app/login`, **mengunduh PNG dari `qr_link` di jaringan
  internal** (host & path divalidasi = host GOWA, bukan URL bebas → tak ada SSRF), mengembalikan data URI base64, `Cache-Control: no-store`.
  Hitung mundur + muat ulang QR; polling `GET /api/v1/admin/whatsapp/status` tiap 3 dtk hanya selama modal terbuka; terhubung → modal tutup.
- "Putuskan" (ConfirmDialog, bukan `window.confirm`) → `/app/logout`. "Sambung ulang" → `/app/reconnect`.
- "Kirim uji" HANYA ke nomor WhatsApp **terverifikasi milik staf yang menekan** (ADR-0002 — tak ada kotak nomor bebas).
- Setiap hubungkan/putuskan/uji dicatat jejak append-only (`settings_audit`, area `whatsapp`, tanpa nomor).

### 4.2 Template (pola jalajogja §16.8)
- Default tetap di kode (`WA_TEMPLATE_DEFAULTS`, string `{{variabel}}`); override di tabel baru `whatsapp_templates` (kunci unik, isi, aktif,
  `updatedAt`, `updatedById`), ditulis HANYA `lib/whatsapp/templates.ts` (versi `expectedUpdatedAt` → 409, jejak `settings_audit`).
  Reset ke bawaan = hapus override. Render = ganti string murni (regex `{{(\w+)}}`), tak pernah eval.
- **Daftar putih variabel per template**: disimpan ditolak (400) bila memuat variabel yang tak dikenal untuk template itu; variabel wajib
  (mis. `{{kodeBooking}}`) harus ada; panjang ≤ 1.000 karakter. Tidak ada variabel PII.
- **Baris yang semua variabelnya kosong dibuang saat render** — menutup regresi jalajogja (baris "Pantau: " kosong).
- UI per template: label + keterangan kapan dikirim, editor teks, chip variabel (klik = sisipkan), pratinjau dengan contoh nilai, petunjuk format
  WhatsApp (`*tebal*`, `_miring_`), badge "Kustom", "Kembalikan bawaan", saklar aktif (§6 K2).

### 4.3 Kunci template (varian dipecah)
`invoice_issued` · `payment_reminder_unpaid` · `payment_reminder_partial` · `payment_confirmed_full` · `payment_confirmed_partial` ·
`payment_rejected` · `departure_reminder` (H-7 & H-1, `{{hariLagi}}` = "besok"/"7 hari lagi") · balasan verifikasi (§6 K1).

## 5. Fase

| Fase | Isi | Bukti |
|---|---|---|
| F1 | Layanan `gowa` di compose, env/generator/helper, klien GOWA v9 (Basic, `/send/message`, login/logout/status), uji klien dengan server GOWA tiruan | `bun run build`, tes klien, docker smoke CI |
| F2 | Halaman Sistem → WhatsApp: status, QR proxy, polling, putuskan/sambung ulang, kirim uji, jejak; panel Integrasi diringkas | Uji route (401/403/tanpa gateway), browser lokal dengan GOWA asli di Docker: scan QR sungguhan, kirim uji |
| F3 | Template editable + saklar per notifikasi: migrasi `whatsapp_templates`, layanan, validasi variabel, UI editor+pratinjau, `waMessage` membaca override | Uji render (baris kosong, variabel asing ditolak, default = teks lama persis), tes kesetaraan pesan lama |
| Deploy | Generator/helper env di server → deploy → buka Sistem → WhatsApp → scan QR nomor bisnis → kirim uji → verifikasi nomor jamaah sungguhan | Dipandu langkah demi langkah dengan pemilik |

Satu PR per fase. Security review tiap fase (QR proxy, auth Basic, kontainer baru tanpa port, template = masukan admin).

## 6. Keputusan pemilik (2026-11-21)

- **K1** Yang bisa diedit hanya 7 notifikasi; 3 balasan verifikasi nomor (teks keamanan) tetap di kode.
- **K2** Ada saklar aktif/nonaktif per notifikasi WhatsApp (email tetap selalu terkirim).
- **K3** Selain QR, ada "masuk dengan kode pasangan" (default rencana — murah, tanpa kamera).
- **K4** Sesi WhatsApp (`gowa_data`) TIDAK ikut backup — bila server hilang, scan QR ulang.
- **K5** Halaman Sistem → WhatsApp hanya superadmin.
- **K6** Nomor yang di-scan = `NEXT_PUBLIC_BUSINESS_WA` (nomor tujuan `VERIF` jamaah); halaman memperingatkan bila berbeda.

## 7. Catatan as-built

**F1 (2026-11-21):** dicek terhadap kode sumber GOWA v9.9.0 (Docker tak ada di Mac): GOWA membuat SATU perangkat bawaan saat start
(`EnsureDefault`) → klien tanpa `X-Device-Id`; `/app/logout` mempertahankan slot. `qr_link` memuat host permintaan → klien hanya memakai JALUR
(`/statics/qrcode/<nama>.png`, regex) di atas `WA_GATEWAY_URL`, gambar dicek magic PNG + ≤ 256 KB. Kirim 401/400 tidak dicoba ulang. Kontainer:
image dipin digest multi-arsitektur, read-only (`/app/statics` + `/tmp` tmpfs, `/app/storages` volume), `cap_add` hanya untuk entrypoint
(root → chown → su-exec ke uid 20001), tanpa `env_file`, dasbor GOWA/MCP mati, chat storage & unduh media mati. `scripts/lengkapi-env-production.sh`
dipanggil `deploy-server.sh` sebelum `pull` (compose menolak jalan tanpa `WA_GATEWAY_USER/PASSWORD`). CI job docker menjalankan GOWA asli:
sehat, tanpa port, read-only, proses uid 20001, rahasia web tak terbaca, 401 tanpa kredensial, QR PNG terambil dari web. GOWA tiruan
`scripts/dev-eval.ts` mengikuti API v9 (perangkat mulai terputus + tombol "Simulasikan scan QR"). Uji: `test-whatsapp-client`, `test-lengkapi-env`,
penjaga compose di `test-routes` (SEC-10). Security: 0 C/H/M; 1 Low diterima (SEC-311).
