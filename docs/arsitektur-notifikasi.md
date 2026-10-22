# Arsitektur — Notifikasi (Email Resend + WhatsApp, satu pintu)

> Status: **FASE 1–4 SELESAI & TERVERIFIKASI (2026-10-21), diperbarui 2026-10-22** — lihat §10–§12. Dokumen ini adalah source of truth as-built untuk
> notifikasi email+WhatsApp. **§12 memuat perubahan sesudahnya** (lingkup WhatsApp diperkecil, WhatsApp hanya ke nomor terverifikasi, kanal paralel, email jaring
> pengaman) yang menggantikan bagian terkait di §3–§4 dan §9. Auth: `docs/arsitektur-auth.md`. Pola acuan: smart-ai (`architecture-notifications.md`, repo terpisah). Tujuan operasional: **saat produksi
> cukup mengisi kredensial (env) lalu menekan "Kirim email uji" di admin** — tanpa mengubah kode.

## 1. Keadaan AWAL sebelum implementasi (riwayat; recheck 2026-10-21 terhadap kode saat itu)

| Fakta | Bukti |
|---|---|
| **Email belum ada sama sekali.** Paket `resend` terpasang tapi tidak ada satu pun pemakainya | `package.json:44`; grep `resend` di `app/ lib/` hanya mengenai kata "resend OTP" di form |
| Hanya WhatsApp yang jalan, di 4 titik panggil | `admin/payments/[id]/confirm`, `admin/visa/[pilgrimId]/status`, `lib/cron/autocancelJob.ts` (auto-cancel & pengingat) |
| **Log notifikasi berbohong**: `whatsapp.sendMessage` menelan semua kegagalan (hanya `console.error`), lalu `sendWhatsApp` selalu menulis `status: 'sent'` — termasuk saat `WA_GATEWAY_URL` kosong. Dedupe pengingat cron memakai log itu, jadi pengingat yang gagal tidak pernah dicoba lagi | `lib/whatsapp/client.ts:23-62`, `lib/notifications/send.ts:27-38`, `lib/cron/autocancelJob.ts:77` |
| 3 tipe notifikasi punya template WA tapi **tidak ada pemicunya**: `booking_submitted`, `departure_reminder_*`, `refund_approved` | `lib/notifications/templates/whatsapp.ts`; tidak ada pemanggil |
| Pengingat cron melewati user tanpa nomor telepon — user tanpa nomor (mis. kelak daftar lewat Google) tak dapat apa pun | `lib/cron/autocancelJob.ts:73` |
| Konfigurasi hanya env (`RESEND_API_KEY`, `RESEND_FROM`); tidak ada tempat untuk melihat "apakah integrasi sudah terpasang" | `.env.example:30-31` |

## 2. Yang diambil dari smart-ai, dan yang tidak

| Diambil | Alasan |
|---|---|
| Resend lewat **HTTP API** (`fetch`), bukan SDK | Sedikit dependency, mudah diuji dengan server palsu; SDK `resend` yang tak terpakai dihapus |
| Status **`dilewati`** bila kredensial kosong — **tidak pernah "terkirim" palsu** | Memperbaiki kelemahan §1 |
| Admin bisa **melihat status integrasi** dan **kirim uji** | Inti "tinggal setting API" |
| Kunci rahasia hanya di env, tidak di database | Tidak ada kunci enkripsi/secret manager di Saudinesia; rahasia di DB = permukaan baru |
| Email = kanal pelengkap WA dengan fallback satu sama lain | Pengguna tanpa nomor tetap terjangkau |

| Tidak diambil (sengaja) | Alasan |
|---|---|
| Antrean pg-boss + outbox | Saudinesia tidak punya antrean; satu replika + node-cron. Pengiriman **best-effort tanpa memblokir** (sudah menjadi aturan `CLAUDE.md` § WhatsApp) + log jujur + 2 retry. Outbox = fase terpisah bila volume membutuhkan |
| React Email | Dependency besar; cukup satu layout HTML + fungsi per kejadian dengan escape ketat |
| Template/kanal yang bisa diubah admin di database | Belum dibutuhkan; satu saklar `emailNotificationsEnabled` cukup |

## 3. Arsitektur

```
 pemicu (route / cron)
        │  notify({ userId, bookingId?, event })          ← SATU pintu, tidak pernah melempar error
        ▼
 lib/notifications/notify.ts ──► muat user (email, whatsapp) ► tentukan kanal (PARALEL, §12)
        │                                  │
        │ WhatsApp (nomor TERVERIFIKASI)   │ Email (jika ada email & saklar aktif)
        ▼                                  ▼
 lib/whatsapp/client.ts            lib/email/resend.ts  ──► Resend HTTP API
 (kini MENGEMBALIKAN hasil)        (retry, idempotency key)
        └──────────────┬───────────────────┘
                       ▼
          NotificationLog (satu baris per kanal: sent | failed | skipped, externalId, error)
```

- `lib/notifications/events.ts` — union terketik semua kejadian + `waMessage(event)` + `emailContent(event)`; menambah kejadian
  baru = satu entri, kompiler memaksa kedua kanal diisi.
- `lib/email/templates.ts` — satu layout (tabel, CSS inline, hijau brand) + konten per kejadian; **semua nilai dinamis di-escape**.
- `lib/email/resend.ts` — `sendEmail()` → `{status:'sent'|'skipped'|'failed'}`; **tidak pernah melempar**.
- Penerima: email akun; email placeholder/tak valid tidak dikirimi. WhatsApp hanya ke `User.whatsapp` yang **terverifikasi** dan sudah menyetujui (§12).

## 4. Matriks kejadian

| Kejadian | Pemicu | WA | Email | Dedupe |
|---|---|---|---|---|
| `booking_submitted` | `POST /api/v1/bookings` sukses (**baru** — sebelumnya tak pernah dikirim) | ya (nomor terverifikasi) | ya (ringkasan + batas bayar + tautan) | per booking |
| `payment_reminder_12h` / `_22h` | cron :30 | ya | ya | per booking+kanal, hanya yang `sent` |
| `payment_confirmed` / `payment_rejected` | admin konfirmasi/tolak | ya | ya | tidak (bisa berulang) |
| `auto_cancelled` | cron tiap jam | **tidak** (email saja, §12) | ya | per booking |
| `visa_status_change` | admin ubah status visa | **tidak** (email saja, §12) | ya | tidak |
| `contact_changed` | pemilik mengubah telepon/WhatsApp yang sudah ada | tidak | ya (peringatan keamanan) | tidak |
| `departure_reminder_7d` / `_1d` | **belum ada pemicu** — di luar scope fase ini (dicatat) | — | — | — |
| `refund_approved` | **belum ada pemicu** — di luar scope | — | — | — |
| `welcome` | pendaftaran selesai (password/Google) | tidak | ya | per user |
| `test` | admin "Kirim email uji" | tidak | ya | tidak |
| ~~OTP~~ | **Tidak ada lagi** — OTP WhatsApp dihapus dari auth (ADR-0001); verifikasi akun/reset lewat tautan email, verifikasi nomor lewat pesan masuk (ADR-0002) | — | — | — |

**Dedupe per kanal**: pengingat tidak dikirim ulang bila kanal itu sudah `sent`; `failed`/`skipped` dicoba lagi di siklus berikutnya
(jendela pengingat 2 jam memberi ≥ 1 kesempatan ulang) — memperbaiki kelemahan §1.

## 5. Skema (migrasi baru)

- `NotificationLog.externalId String?` — id pesan dari Resend (jejak audit pengiriman).
- `SiteSetting.emailNotificationsEnabled Boolean @default(true)` — saklar global admin.
- `status` tetap string bebas: `sent | failed | skipped`.

## 6. Admin & "tinggal setting API"

Halaman **Pengaturan → Integrasi & Notifikasi** (superadmin):
- Status (hanya boolean + alamat pengirim; **tidak pernah mengembalikan rahasia, bahkan sebagian**): Resend terkonfigurasi?
  `RESEND_FROM`, WhatsApp gateway terkonfigurasi?, Google terkonfigurasi? + **redirect URI persis** yang harus didaftarkan di Google Cloud Console.
- Saklar "Kirim notifikasi email".
- Tombol **Kirim email uji** (`POST /api/v1/admin/system/integrations/test-email`): superadmin, divalidasi, dibatasi 5/jam, hasilnya
  `sent | skipped(alasan) | failed(pesan)` ditampilkan apa adanya.

API: `GET /api/v1/admin/system/integrations`, `POST /api/v1/admin/system/integrations/test-email`.

## 7. Konfigurasi & daftar periksa produksi

| Env | Fungsi |
|---|---|
| `RESEND_API_KEY` | kunci API Resend (rahasia) |
| `RESEND_FROM` | pengirim, mis. `Saudinesia <noreply@domain.com>` — **domain harus terverifikasi di Resend** |
| `RESEND_REPLY_TO` | opsional |
| `APP_URL` | origin publik untuk tautan di email (runtime; `scripts/buat-env-production.sh` mengisinya) |
| `WHATSAPP_WEBHOOK_SECRET` | secret webhook GOWA (verifikasi nomor) — ≥32 karakter acak; lemah/kosong = webhook mati (§12, `docs/arsitektur-whatsapp-verifikasi.md`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | login Google (opsional; `docs/arsitektur-auth.md` §3.4) — tidak memengaruhi notifikasi |

Urutan saat produksi: (1) daftar domain di Resend → pasang DNS **SPF, DKIM, dan DMARC** → tunggu "Verified"; (2) buat API key (izin
*sending*); (3) isi `RESEND_API_KEY`/`RESEND_FROM` di `.env.production` server, `docker compose up -d web`; (4) admin → **Kirim email uji**;
(5) cek `Log Notifikasi`. Tanpa langkah 3, sistem berjalan normal dan mencatat `skipped` — tidak ada yang rusak.

## 8. Keamanan

- Escape HTML untuk semua nilai dinamis (nama jamaah, kode booking, status) — mencegah injeksi HTML/phishing lewat nama.
- Subjek tanpa CR/LF; alamat tujuan divalidasi; tautan hanya `APP_URL` + path internal dengan id di-`encodeURIComponent`.
- Kunci API hanya dari env, tidak pernah dicatat/dikembalikan; kegagalan mencatat status HTTP + pesan singkat saja.
- `RESEND_API_URL` (untuk uji dengan server palsu) hanya dihormati bila `NODE_ENV` development/test (fail-closed).
- Endpoint uji: superadmin + rate limit + tujuan tervalidasi (bukan relay email terbuka).
- Log menyimpan penerima dan subjek, **bukan isi email**.
- `Idempotency-Key` per (kejadian, booking, penerima) agar retry/overlap tidak mengirim ganda.

## 9. Keterbatasan yang diterima (dicatat)

- Tanpa antrean: bila proses mati tepat saat mengirim, pesan itu hilang (log berstatus `failed`/tidak ada). Outbox = fase berikutnya.
- Tanpa webhook Resend: status `sent` = diterima Resend, **bukan** dijamin masuk inbox (bounce/komplain tak terlacak).
- Email **adalah** jalur kritis auth (verifikasi pendaftaran, reset password, email auth lewat `lib/auth/authEmail.ts` — bukan `notify()`); domain pengirim terverifikasi = syarat go-live. Tidak ada OTP.
- Pengiriman at-least-once untuk jalur WA (timeout setelah gateway terlanjur mengirim → retry bisa dobel).

## 10. Fase eksekusi

1. **Fondasi** — SELESAI: `sendEmail` + `events/templates` + `notify` + perbaikan klien WA (hasil jujur) + migrasi + uji (server Resend & WA palsu).
2. **Pemicu** — SELESAI: 4 titik panggil lama → `notify`, pemicu baru `booking_submitted`, dedupe cron diperbaiki, `lib/notifications/send.ts` dihapus.
3. **Admin** — SELESAI: panel integrasi, saklar email, email uji, status log `skipped`/`failed` + keterangan.
4. **Dokumen produksi + security review** — SELESAI (SOP langkah 5), lalu PR.

## 11. Bukti verifikasi (as-built, 2026-10-21)

- `bun run typecheck` bersih; `bun run build` 0 error. `bun run test` = rate limiter + `test-email.ts` (19 uji: klien Resend, retry,
  redaksi kunci API, template + escaping HTML) + `test-notify.ts` (14 uji terhadap DB sekali pakai + gateway WA/Resend PALSU: log jujur
  sent/failed/skipped, regresi "dulu selalu sent", dedupe hanya menghitung `sent`, saklar admin, email placeholder `.invalid`).
  CI menjalankannya di job `validate` (DB `saudinesia_ci`; `test-notify` menolak DB yang namanya tidak memuat test/_ci/tmp).
  Server palsu memakai `node:http` (`scripts/lib/fakeServer.ts`), bukan `Bun.serve`, supaya `tsc` project tetap bersih.
- Browser (dev server di DB sekali pakai + Resend palsu): bagian **Integrasi & Notifikasi** menampilkan status tiap layanan; tombol
  "Kirim uji" → "Diterima Resend", permintaan tiba di server palsu dengan `Authorization: Bearer <kunci>`, pengirim & subjek benar.
  Via API: `to` tidak valid → 400; batas 5/jam → 429 + `Retry-After`; saklar email tersimpan (nilai bukan boolean → 400);
  respons `GET /integrations` tidak memuat kunci API.
- Security review: tidak ada Critical/High baru. Satu perbaikan saat review (log galat `notify` kini tanpa pesan Prisma yang bisa memuat
  email/nomor). Temuan Low baru: SEC-16 (lihat `docs/lessons-learned.md`).
- **Belum diverifikasi:** pengiriman ke Resend NYATA (butuh kredensial + domain terverifikasi — dikerjakan saat produksi lewat tombol
  "Kirim email uji"), dan jalur pemicu booking/pembayaran end-to-end lewat browser (dicakup uji `notify` + typecheck, bukan alur UI).

## 12. Perubahan setelah Fase 4 notifikasi (2026-10-22) — menggantikan §3/§4/§9 yang bertentangan

- **Lingkup WhatsApp diperkecil** (ADR-0001): `waMessage` hanya untuk `booking_submitted`, `payment_reminder_12h/22h`, `payment_confirmed`, `payment_rejected`. Status visa, auto-cancel, welcome,
  `contact_changed`, test = **email saja**. Template WA yang tak terpakai dipertahankan di `templates/whatsapp.ts` (diberi catatan).
- **WhatsApp hanya ke nomor TERVERIFIKASI** (ADR-0002): `whatsappVerifiedAt` dan `verifiedWhatsapp === whatsapp`, ditambah `ConsentLog` WhatsApp dan batas 10 pesan/nomor/24 jam. Selain itu kanal WA berstatus `skipped` dengan alasan.
- **Kanal berjalan PARALEL** (`Promise.allSettled`): email tidak menunggu WhatsApp (gateway macet ≈34 dtk sebelumnya menunda email) dan satu kanal tak pernah menggugurkan yang lain.
- **Email jaring pengaman yang dijamin:** semua kejadian selalu dikirim lewat email apa pun kondisi WhatsApp (belum dikonfigurasi, mati, diblokir, tanpa nomor, tanpa persetujuan, belum terverifikasi) — diuji
  untuk SETIAP jenis kejadian. Bila tidak ada kanal yang sampai (WhatsApp mati dan email dimatikan admin) tercatat peringatan keras tanpa PII.
- Penerima WA memakai `User.whatsapp` (bukan `phone`). Klien WA mengirim E.164 apa adanya.
- Bukti: `scripts/test-notify.ts` (29 uji) + `scripts/test-whatsapp.ts`; lihat `docs/arsitektur-whatsapp-verifikasi.md` §2 dan §9.

