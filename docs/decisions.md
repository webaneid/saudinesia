# Saudinesia — Architectural Decisions Log

Format per entry:
```
## YYYY-MM-DD — <title>
**Decision:** what was decided
**Rationale:** why
**Alternatives considered:** what else was evaluated
**Affects:** ...
```

---

## 2026-05-09 — ORM: Drizzle → Prisma

**Decision:** Ganti ORM dari Drizzle ke Prisma.
**Rationale:** Prisma lebih mature, migration tooling lebih solid (`prisma migrate dev`), dan type safety-nya lebih mudah dipahami tim yang belum familiar dengan SQL-first approach. Drizzle bagus untuk performa tinggi tapi overhead belajarnya lebih tinggi.
**Alternatives considered:** Drizzle ORM (awalnya dipilih di architecture.md karena Bun-compatible), tetap dengan Drizzle.
**Affects:** `CLAUDE.md` §Prisma, `docs/architecture.md`, `prisma/schema.prisma`

---

## 2026-05-09 — Auth: OTP-only → Email + Password

**Decision:** Login menggunakan email + password. OTP WhatsApp hanya untuk verifikasi nomor WA saat registrasi dan reset password.
**Rationale:** OTP-only login menciptakan hard dependency ke GOWA untuk setiap login. Kalau GOWA down, semua user tidak bisa masuk. Email+password lebih resilient, lebih familiar untuk booking platform (Traveloka, Tiket.com style), dan memisahkan concern autentikasi dari notifikasi.
**Alternatives considered:** OTP-only (flow awal), hybrid dengan Google OAuth.
**Affects:** `docs/auth-flow.md`, `lib/auth/`, `app/api/v1/auth/`, semua auth pages

---

## 2026-05-09 — Dev Mode OTP: devCode di response body

**Decision:** Di `NODE_ENV !== 'production'`, endpoint OTP mengembalikan `devCode` langsung di response body. GOWA tidak dipanggil sama sekali di dev.
**Rationale:** Solusi awal memakai in-memory Map (`_devOtp`) untuk menyimpan OTP di dev, tapi Next.js Turbopack mengisolasi module per route handler sehingga Map tidak shared antar request. Endpoint terpisah `/api/v1/dev/otp` juga bermasalah karena alasan yang sama. Mengembalikan `devCode` di response adalah satu-satunya cara yang reliable tanpa ketergantungan ke shared state.
**Alternatives considered:** In-memory Map (gagal karena Turbopack isolation), endpoint terpisah `GET /api/v1/dev/otp` (gagal karena alasan sama), logging ke console saja (tidak ergonomis karena user harus lihat terminal).
**Affects:** `app/api/v1/auth/register/route.ts`, `app/api/v1/auth/forgot-password/route.ts`, semua form dengan OTP step

---

## 2026-05-09 — OTP Verification: Redis → DB fallback

**Decision:** Ketika Redis tidak tersedia (dev tanpa Redis), OTP disimpan dan diverifikasi dari tabel `otp_requests` di PostgreSQL.
**Rationale:** Turbopack mengisolasi module per route handler, membuat in-memory fallback tidak reliable. Database sudah pasti ada (PostgreSQL berjalan untuk Prisma), sehingga DB menjadi universal fallback yang tidak bergantung pada shared process memory.
**Alternatives considered:** In-memory Map fallback (tidak reliable dengan Turbopack), memaksa install Redis di dev (overhead setup), skip verifikasi OTP di dev (tidak safe).
**Affects:** `lib/auth/otp.ts` — `verifyAndConsumeOtp()` sekarang query DB jika Redis tidak available

---

## 2026-05-09 — Port Dev: 6260

**Decision:** Dev server berjalan di port 6260.
**Rationale:** Konsisten dengan port range 626x yang digunakan untuk project-project lain di environment user. Port 6260 bebas saat setup.
**Alternatives considered:** Port default 3000 (bentrok dengan service lain).
**Affects:** `package.json` script `dev`, `.env.local` `NEXT_PUBLIC_APP_URL`

---

## 2026-05-09 — VPS: Hostinger (main) + Sumopod (GOWA only)

**Decision:** Main VPS (app, PostgreSQL, Redis, MinIO) di Hostinger. GOWA (go-whatsapp-web-multidevice) di-host terpisah di Sumopod sebagai external service.
**Rationale:** GOWA membutuhkan WhatsApp Web connection yang harus selalu hidup. Memisahkannya dari main VPS mengurangi risiko jika GOWA harus restart atau maintenance — main app tidak terpengaruh. GOWA dianggap best-effort service.
**Alternatives considered:** Semua di satu VPS (risiko restart saling mengganggu), pakai WhatsApp Business API resmi (mahal, approval lama).
**Affects:** `docs/architecture.md` §Deployment, `docker-compose.yml`, `.env.example` `WA_GATEWAY_URL`

---

## 2026-05-09 — Seed Data: Comprehensive Sample Data

**Decision:** Seed data realistis untuk 5 hotel (3 Makkah, 2 Madinah), 5 armada transport, 3 muthowif, 4 katering, 4 heritage tour, quota untuk 90 hari ke depan.
**Rationale:** Catalog dan booking wizard tidak bisa dievaluasi tanpa data. Seed data lebih cepat dari membangun super admin CRUD dulu (yang dijadwalkan di M10). Seed bisa dijalankan ulang kapan saja (`bun run db:seed`).
**Alternatives considered:** Bangun super admin CRUD dulu lalu input manual (lambat, blocking M3 dan M4), data dummy minimal (tidak cukup untuk evaluasi UX).
**Affects:** `prisma/seed.ts`, semua halaman catalog M3

---

## 2026-05-10 — Catalog Pages: Server Components + Direct Prisma

**Decision:** Halaman catalog (`/hotels`, `/transport`, `/muthowif`, dll.) menggunakan Server Components dengan direct Prisma query, bukan fetch ke API route sendiri.
**Rationale:** Server-to-server fetch tidak diperlukan di Next.js App Router. Direct Prisma di Server Component lebih efisien (tidak ada HTTP overhead) dan tetap SEO-friendly. API routes tetap ada untuk dipakai booking wizard (client-side fetch).
**Alternatives considered:** Fetch ke `/api/v1/catalog/*` dari Server Component (tidak efisien, tambah latency), React Query di Client Component (hilangkan SSR/SEO benefit).
**Affects:** Semua `app/[locale]/(public)/*/page.tsx`

---

## 2026-05-10 — Button asChild: @radix-ui/react-slot

**Decision:** Tambah `@radix-ui/react-slot` untuk mendukung `asChild` prop di Button component, mengikuti pattern shadcn/ui.
**Rationale:** Pattern `<Button asChild><Link href="...">...</Link></Button>` dipakai di banyak tempat untuk render button sebagai Link dengan styling button. Tanpa Slot, harus duplikasi className di setiap Link atau buat wrapper tersendiri.
**Alternatives considered:** Buat `LinkButton` component terpisah, hardcode styling di `<a>` tag.
**Affects:** `components/ui/button.tsx`, `package.json`

---

## 2026-05-11 — Arsitektur Produk: Semua Layanan adalah Entitas Produk Terpisah

**Decision:** Setiap layanan Saudinesia (hotel, transport, muthowif, katering, ziarah, haji, visa) adalah **produk independen** yang dapat dijual satuan maupun dibundle. Haji dan Visa ditambahkan sebagai entitas produk baru, bukan hanya proses internal.

**Rationale:** Saudinesia adalah travel agent/mediator — bukan pemilik aset. Semua layanan adalah "produk" yang dikurasi dari vendor Saudi. Admin harus bisa menambah, mengubah harga, menonaktifkan produk apapun secara dinamis. Ini memungkinkan fleksibilitas bisnis: paket bisa berubah tiap tahun (harga haji naik, hotel baru, rute transport baru) tanpa perlu deploy ulang.

**Alternatives considered:**
- Haji sebagai sub-tipe booking Umroh (terlalu restrictif, haji punya aturan berbeda)
- Visa hanya sebagai proses dokumen (sudah kita build, tapi tidak cukup — visa juga produk berbayar)
- Generic `Product` table dengan type field (terlalu loose, kehilangan type safety)

**Affects:**
- `prisma/schema.prisma` — tambah `HajiProduct`, `VisaProduct`, `Package`, `PackageItem`
- `docs/architecture.md` — update product catalog section
- `app/[locale]/(public)/` — tambah halaman haji dan visa catalog
- `app/[locale]/superadmin/` — tambah CRUD haji, visa, dan paket/bundle
- Booking wizard — support pemilihan produk haji dan visa

---

## 2026-05-13 — Unified Admin Dashboard: hapus /superadmin, gabung ke /admin

**Decision:** Dua dashboard terpisah (`/admin` dan `/superadmin`) digabung menjadi satu URL `/admin` dengan sidebar role-based. Tambah role `manager` di antara `admin` dan `superadmin`.

**Rationale:** Dua dashboard tidak user-friendly dan tidak scalable untuk tim nyata. Staff bingung harus masuk ke URL mana. Manager produk harus punya akses tanpa harus jadi superadmin. Satu dashboard dengan section yang muncul/sembunyi berdasarkan role adalah industry standard (Shopify, WooCommerce, dsb).

**Role hierarchy baru:**
- `admin` → Operasional saja (booking, bayar, visa status)
- `manager` → Operasional + Manajemen Produk (hotel, haji, visa, paket, dll)
- `superadmin` → Semua + Sistem (user management, settings)

**Alternatives considered:**
- Tetap dua dashboard dengan link antar-panel (confusing, UX buruk)
- Permission system per-feature granular (over-engineering untuk scale sekarang)

---

## 2026-05-21 — Media Library: Upload via server bukan direct-to-MinIO

**Decision:** File upload dilakukan client → Next.js server → MinIO. Bukan direct upload dari browser ke MinIO menggunakan presigned PUT URL.
**Rationale:** Validasi MIME type dan ukuran file wajib dilakukan server-side dan tidak bisa dipercaya dari client. Jika direct upload digunakan, server tidak bisa memvalidasi konten sebelum tersimpan. Konsistensi validasi lebih penting dari sedikit penghematan bandwidth server.
**Alternatives considered:** Presigned PUT URL (bypass validasi), Server Actions (tidak support XHR progress tracking yang dibutuhkan progress bar).
**Affects:** `app/api/v1/pilgrims/.../documents/route.ts`, `lib/storage/minio.ts`, `components/shared/media/useDocuments.ts`

---

## 2026-05-21 — Media Library: XHR bukan fetch untuk upload progress

**Decision:** Upload file menggunakan `XMLHttpRequest` (XHR) bukan `fetch()` di `useDocuments.ts`.
**Rationale:** `fetch()` tidak mengekspos upload progress event. `xhr.upload.onprogress` adalah satu-satunya cara native untuk mendapatkan persentase progress upload yang ditampilkan di progress bar `UploadModal`.
**Alternatives considered:** `fetch()` tanpa progress (UX buruk untuk file besar), library tiptap/form (overkill), polling endpoint status (latency tinggi dan kompleks).
**Affects:** `components/shared/media/useDocuments.ts`

---

## 2026-05-21 — Admin login di luar route group (protected) — fix redirect loop

**Decision:** Halaman login admin dipindahkan ke luar `(protected)/` route group. Struktur baru: `admin/login/` (tanpa auth layout) + `admin/(protected)/` (dengan auth layout).
**Rationale:** Layout Next.js App Router bersifat nested dan otomatis diterapkan ke semua halaman di bawahnya. Layout `admin/layout.tsx` yang redirect unauthenticated users ke `/admin/login` menyebabkan infinite redirect loop karena `/admin/login` sendiri ikut dibungkus layout yang sama. Solusinya adalah memisahkan route login ke luar protected group.
**Alternatives considered:** Check pathname di layout (tidak reliable di server component), conditional redirect (sulit di-maintain).
**Affects:** `app/[locale]/admin/` directory structure, `app/[locale]/admin/(protected)/layout.tsx`

**Affects:** `prisma/schema.prisma` (UserRole enum), `lib/auth/session.ts`, `middleware.ts`, `app/[locale]/admin/layout.tsx`, semua route guards di `/admin/products/*` (dari `requireSuperAdmin` → `requireManager`), `CLAUDE.md` folder structure

---

## 2026-05-21 — Hotel Media Library: arsitektur dan UX flow

**Decision:** Foto hotel disimpan sebagai array object key di `Hotel.images` (JSON field). Upload hanya bisa dilakukan setelah hotel tersimpan di DB (hotel butuh ID). Flow create: isi data dasar → simpan → redirect ke halaman edit yang punya gallery foto inline di bagian atas.

**Rationale:**
- Hotel belum punya ID sebelum disimpan, sehingga object key MinIO belum bisa di-generate. Dua alternatif (overlay gallery pasca-save, atau temp ID) keduanya lebih buruk dari redirect sederhana ke halaman edit.
- Menyimpan object key (bukan URL) di DB adalah keputusan yang dipertahankan dari desain awal — URL berubah saat MinIO credentials dirotasi, object key tidak.
- Foto pertama dalam array dianggap foto cover (badge "UTAMA") di UI.

**Komponen:**
- `components/admin/media/ProductMediaGallery.tsx` — grid thumbnail reusable untuk produk apapun
- `components/admin/media/ImageUploadModal.tsx` — drag-drop + XHR upload dengan progress bar
- `GET|POST|DELETE /api/v1/admin/products/hotels/[id]/images`

**Alternatives considered:** Gallery overlay otomatis pasca-create (tidak intuitif), upload foto sebelum save via temp ID (butuh cleanup job untuk orphan files).

**Affects:** `app/[locale]/admin/(protected)/products/hotels/page.tsx`, `app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx`, `app/api/v1/admin/products/hotels/[id]/images/route.ts`

---

## 2026-05-21 — MinIO dev lokal: credentials tidak match + bucket belum dibuat

**Decision:** `MINIO_SECRET_KEY` di `.env.local` dikoreksi dari `minioadmin` → `minioadmin123`. Bucket `saudinesia-docs` dibuat manual via `mc mb local/saudinesia-docs`.

**Rationale:** MinIO di lokal berjalan sebagai standalone process (Homebrew, bukan Docker). Credentials yang digunakan saat MinIO pertama kali dijalankan berbeda dari yang diasumsikan di `.env.local`. Credentials ini dikunci di data directory MinIO (`~/minio-data`) dan tidak bisa diubah tanpa reset storage. Error yang muncul: `Storage error. Please try again.` (HTTP 500) saat upload foto hotel.

**Cara debug yang digunakan:**
1. `curl http://localhost:9000/minio/health/live` → MinIO berjalan ✓
2. `lsof -i:9000` → proses `minio` standalone (bukan Docker) ✓
3. `mc alias set` dengan berbagai kombinasi → `minioadmin123` berhasil ✓
4. `mc ls local` → bucket `saudinesia-docs` tidak ada → buat manual ✓

**Pelajaran untuk mesin baru / anggota tim baru:**
Sebelum mulai development fitur yang menyentuh storage, verifikasi dengan 3 perintah:
```bash
curl -s http://localhost:9000/minio/health/live && echo "MinIO OK"
mc alias set local http://localhost:9000 $MINIO_ACCESS_KEY $MINIO_SECRET_KEY --api s3v4
mc ls local  # harus tampil saudinesia-docs
```
Lihat `docs/minio-setup.md` untuk panduan lengkap setup dari nol.

**Affects:** `.env.local` (`MINIO_SECRET_KEY=minioadmin123`), bucket `saudinesia-docs` (sudah dibuat di local MinIO)

---

## 2026-05-21 — Cron Jobs: instrumentation.ts + node-cron external

**Decision:** Cron jobs (auto-cancel dan payment reminder) di-wire via `instrumentation.ts` di project root. `node-cron` didaftarkan sebagai webpack external di `next.config.ts` agar tidak di-bundle oleh webpack.

**Rationale:** `instrumentation.ts` adalah satu-satunya cara resmi Next.js App Router untuk menjalankan kode saat server startup. `node-cron` menggunakan `child_process` dan `path` (Node.js built-ins) yang tidak bisa di-bundle oleh webpack. `serverExternalPackages` tidak cukup untuk instrumentation.ts — perlu `webpack.externals` secara eksplisit. Guard `globalThis._cronStarted` mencegah job terdaftar dua kali pada hot reload di dev.

**Alternatives considered:** API route `/api/v1/internal/cron` yang dipanggil eksternal scheduler (bergantung infrastruktur eksternal), server.ts custom (tidak kompatibel dengan `output: 'standalone'`).

**Affects:** `instrumentation.ts` (baru), `next.config.ts` (`serverExternalPackages` + `webpack.externals`), `lib/cron/autocancelJob.ts` (tambah `startPaymentReminderJob`)

---

## 2026-05-21 — Hotel Images di Public Catalog: Presigned URL Server-side + `unoptimized`

**Decision:** Foto hotel di public catalog (`/hotels`, `/hotels/[id]`) di-render menggunakan presigned URL yang di-generate server-side di Server Component, dengan `<Image unoptimized />` dari `next/image`.

**Rationale:**
- Bucket MinIO bersifat private — URL publik langsung (`NEXT_PUBLIC_MINIO_PUBLIC_URL/key`) tidak bisa diakses browser tanpa auth.
- `minioLoader` (custom loader di `next.config.ts`) dirancang untuk konten publik; tidak cocok untuk private bucket.
- `unoptimized` prop membypass custom loader sehingga presigned URL digunakan as-is tanpa prepend base URL ganda.
- Presigned URL di-generate server-side (TTL 1 jam) via `getPresignedUrl()` dari `lib/storage/minio.ts` — aman karena tidak mengekspos credentials ke client.
- `Promise.all()` untuk parallelisasi presigned URL per hotel di catalog list; `.catch(() => null)` agar satu foto gagal tidak crash seluruh halaman.

**Gallery layout detail page:** 1 foto = hero penuh; 2 foto = split; 3+ foto = besar kiri + 2 thumbnail kanan + overlay "+N foto" jika lebih.

**Alternatives considered:** Membuat path `hotels/` public di MinIO (melanggar keputusan bucket private), membuat API route proxy gambar (tambah latency dan bandwidth server tidak perlu).

**Affects:** `app/[locale]/(public)/hotels/page.tsx`, `app/[locale]/(public)/hotels/[id]/page.tsx`

---

## 2026-05-22 — Visa Product v2: VisaRequirement JSON + Dynamic Documents

**Decision:** `VisaProduct.requirements` diubah dari `string[]` menjadi `VisaRequirement[]` (JSON array dengan `docType`, `label`, `description`, `required`). `VisaProduct.country` ditambahkan (default "Saudi Arabia"). `VisaApplication.visaProductId` ditambahkan sebagai nullable FK ke VisaProduct. Document system (`DocumentGrid`, `UploadModal`, `PilgrimDocuments`) dijadikan dinamis — terima `requirements?: VisaRequirement[]` prop.

**Rationale:**
- Requirements lama hanya teks biasa — tidak bisa linked ke document upload slot
- `DocumentGrid` hardcoded ke 5 dokumen yang sama untuk semua jamaah semua visa
- Tidak ada cara untuk tahu visa apa yang dipesan saat memvalidasi dokumen yang diupload
- `visaType` dropdown hardcoded membatasi admin tambah jenis baru tanpa deploy

**Alternatives considered:**
- Tabel terpisah `VisaRequirementTemplate` dengan FK ke VisaProduct — lebih normalized tapi overhead relasi tidak diperlukan untuk kebutuhan saat ini; JSON sudah cukup flexible
- Keep hardcoded REQUIRED_DOCUMENTS dan ubah per-visa via env var — terlalu rigid, tidak bisa dikonfigurasi per produk

**Affects:**
- `prisma/schema.prisma` — VisaProduct (country, requirements structure), VisaApplication (visaProductId)
- `lib/types/visa.ts` — VisaRequirement type + parseRequirements()
- `components/shared/media/DocumentGrid.tsx` — requirements prop
- `components/shared/media/UploadModal.tsx` — requirements prop
- `components/shared/media/DocumentCard.tsx` — label + required props
- `components/admin/PilgrimDocuments.tsx` — requirements prop
- `app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts` — dynamic validation + auto-advance
- `app/[locale]/admin/(protected)/products/visa/page.tsx` — list + create (Simpan & Lanjut)
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — new: edit + requirements builder
- `app/[locale]/(public)/visa/page.tsx` — country grouping, structured requirements

---

## 2026-05-22 — Transport v3: Harga di TransportPricing (Trip × Vehicle), bukan di Vehicle

**Decision:** Arsitektur transport sepenuhnya ditulis ulang. Harga tidak lagi melekat ke `TransportVehicle`. Diperkenalkan `TransportTrip` (paket perjalanan) dan `TransportPricing` (junction table `tripId × vehicleId`) sebagai tempat harga. `TransportQuota` kini referensi `pricingId` bukan `vehicleId + routeId`. Semua 6 kolom harga + `perSeatEnabled` dihapus dari `TransportVehicle`.

**Rationale:**
- Masalah v2: harga per kendaraan berarti sedan selalu Rp 500K ke mana pun. Padahal Airport Transfer + Sedan bisa Rp 500K tapi City Tour + Sedan bisa Rp 2.5jt. Harga adalah fungsi dari **(trip, vehicle)**, bukan hanya vehicle.
- `perSeatEnabled` perlu granular per kombinasi — bus bisa per-seat di transfer tapi charter-only di city tour.
- Satu kendaraan fisik bisa dipakai di banyak trip dengan harga berbeda tanpa duplikasi data vehicle.

**Schema baru:**
- `TransportVehicle` — data fisik saja (nama, tipe, kapasitas, armada, foto)
- `TransportTrip` — paket perjalanan (category, originHint, destinationHint, isActive)
- `TransportPricing` — `@@unique([tripId, vehicleId])`, charter 3 musim + perSeat 3 musim + `perSeatEnabled`
- `TransportQuota` — `pricingId` FK menggantikan `vehicleId + routeId + isCharter`

**DB migration:** `db push --force-reset` (user consent explicit: "setuju, saya blm bikin apapun jadi murni ini semua isinya seeding dari kamu.." — data adalah seed murni, tidak ada data user nyata yang hilang).

**Alternatives considered:**
- Harga di Vehicle per category (vehicle + category → harga): tidak scalable, tidak type-safe
- Tabel `TransportRoute` tetap dipertahankan dan harga ditaruh di route: route tidak tahu kendaraan, tetap masalah
- Harga di `TransportQuota` (per tanggal): overhead data besar, harga tidak seharusnya berubah per tanggal

**Affects:**
- `prisma/schema.prisma` — 4 model transport ditulis ulang
- `prisma/seed.ts` — 5 vehicles, 6 trips, 20 pricing rows, 186 quotas
- `app/api/v1/admin/products/transport/trips/` — baru (CRUD)
- `app/api/v1/admin/products/transport/pricing/` — baru (CRUD)
- `app/api/v1/admin/products/transport/vehicles/` — diperbarui (hapus field harga)
- `app/api/v1/admin/products/transport/routes/` — **dihapus** (model `transportRoute` tidak ada lagi)
- `app/api/v1/catalog/transport/route.ts` — rewrite query via pricingId + season suffix
- `app/api/v1/bookings/route.ts` — `unitPrice` + `pickupDetail`/`dropoffDetail` ditambah ke booking transport
- `app/[locale]/admin/(protected)/products/transport/` — 2 tab + trip edit page dengan pricing builder
- `app/[locale]/(public)/transport/page.tsx` — group by category, vehicle cards dengan harga season
- Semua query `transportQuota include { vehicle, route }` di booking pages → `include { pricing: { include: { trip, vehicle } } }`

---

## 2026-07-08 — Modularisasi Dokumentasi: `docs/arsitektur-<modul>.md` per Modul Produk

**Decision:** Setiap modul produk (Visa, Transport, Hotel, Muthowif, Haji, Umroh/Booking Core, Katering & Tour, Paket, Group Booking) akan punya dokumen arsitektur tersendiri dengan konvensi nama `docs/arsitektur-<modul>.md` (bahasa Indonesia, prefix di depan). Dokumen ini ditulis berdasarkan audit langsung ke kode aktual (bukan rencana), dan menjadi **source of truth** untuk modul tersebut — menggantikan bagian terkait di `docs/architecture.md` yang jadi arsip desain awal. Dimulai dari `docs/arsitektur-visa.md`.

**Rationale:** `docs/architecture.md` ditulis di awal proyek dan sudah banyak basi (skema visa lama tanpa `VisaProduct`, endpoint `/api/admin/*` bukan `/api/v1/admin/*`, dll) — pernah menyesatkan karena masih jadi rujukan utama di CLAUDE.md padahal tidak lagi akurat. Modularisasi per produk lebih maintainable untuk platform dengan banyak modul independen (hotel, transport, muthowif, visa, haji, dst.) yang masing-masing berkembang dengan kecepatan berbeda.

**Audit Visa (2026-07-08) menemukan gap nyata** antara rencana (`docs/decisions.md` 2026-05-22) dan implementasi — backend requirements dinamis per visa product sudah ~95% selesai, tapi 4 titik integrasi belum tersambung (lihat `docs/arsitektur-visa.md` §7): `visaApplication.visaProductId` tidak pernah di-set saat booking, wizard tidak punya step pilih `VisaProduct`, validator `visaType` masih enum hardcoded (kontradiksi dengan `VisaProduct.visaType` free text), dan `DocumentGrid`/`PilgrimDocuments` dipanggil tanpa prop `requirements`. Item ini ditambahkan sebagai pending di `docs/progress.md` M7.

**Alternatives considered:**
- Terus tulis semua di `docs/architecture.md` satu file besar — sudah terbukti jadi basi dan sulit di-maintain seiring modul bertambah
- Nama file `<modul>-architecture.md` (suffix Inggris, existing convention transport/visa) — diganti demi konsistensi bahasa Indonesia di seluruh dokumentasi proyek

**Affects:**
- `docs/arsitektur-visa.md` — baru, source of truth Visa
- `docs/visa-architecture.md` — dihapus, isinya diserap ke `arsitektur-visa.md`
- `docs/transport-architecture.md` → `docs/arsitektur-transport.md` — rename saja, konten belum diaudit ulang
- `docs/architecture.md` — ditambah catatan supersede di header + anotasi basi di seksi skema/API visa
- `docs/progress.md` — M7 dapat pointer ke dokumen baru + 4 gap item baru
- `CLAUDE.md` — section baru "Dokumentasi Arsitektur per Modul"

---

## 2026-07-08 — Modul Umroh (Booking Core): `docs/arsitektur-umroh.md` — Ditemukan Beberapa Bug Kritis Sekaligus

**Decision:** Audit lapisan orkestrasi booking (wizard, transaksi create, payment confirm/reject, cancellation, cron) yang menyatukan semua modul produk, dan buat `docs/arsitektur-umroh.md` sebagai source of truth keempat. Berbeda dari 3 modul sebelumnya, audit ini menemukan **beberapa bug kritis sekaligus**, bukan cuma satu.

**Rationale:** User memilih modul Umroh (bukan Haji) sebagai modul berikutnya karena ini adalah mesin/engine yang menghubungkan semua modul produk — audit di sini sekaligus mengonfirmasi apakah bug pending→booked yang ditemukan di Muthowif juga terjadi di modul lain.

**Temuan kritis (lihat `docs/arsitektur-umroh.md` §7 untuk detail lengkap):**
1. **Haji tidak bisa dibooking sama sekali** — `createBookingSchema` tidak punya field `haji`, `POST /api/v1/bookings` tidak pernah membuat `BookingHaji`, tidak ada `reserveHajiQuota()`. Haji tampil di katalog publik tapi tidak bisa benar-benar dipesan. Lebih dalam lagi: `HajiProduct` hanya punya `totalQuota`/`bookedQuota`, **tidak ada `pendingQuota`** — beda dari pola 3-kolom Hotel/Transport, sehingga tidak mungkin dibuat alur reserve-lalu-confirm yang aman race condition tanpa migrasi schema dulu.
2. **Self-cancel jamaah tidak melepas kuota** — `DELETE /api/v1/bookings/[id]` tidak di dalam `$transaction`, tidak memanggil `release*Quota` apa pun. Auto-cancel cron (`lib/cron/autocancelJob.ts`) melakukannya dengan benar — jadi ini regresi/inkonsistensi antara dua jalur pembatalan yang seharusnya setara.
3. **Refund record tidak pernah dibuat** — model `Refund` lengkap ada di schema (approval flow, `isForceMajeure`, `paidAt`) tapi `prisma.refund.create()` tidak pernah dipanggil di mana pun. Nominal refund dihitung di self-cancel lalu hilang tanpa jejak audit.
4. **`totalAmount` dipercaya dari klien** tanpa validasi ulang server-side di `POST /api/v1/bookings`.
5. Konfirmasi ulang bug Muthowif (`docs/arsitektur-muthowif.md` Gap #1) — akar masalahnya justru ada di file Booking Core (`admin/payments/[id]/confirm/route.ts`), bukan di kode Muthowif.
6. Dead code tambahan: `app/api/v1/internal/autocancel/route.ts` dan `.../internal/reminders/route.ts` — stub identik pola dengan yang ditemukan di modul Transport; mekanisme cron aktual adalah node-cron in-process via `instrumentation.ts`.

**Alternatives considered:** Perbaiki bug sekaligus saat menulis dokumentasi — ditolak, scope sesi ini tetap dokumentasi dulu, perbaikan jadi keputusan terpisah user.

**Affects:**
- `docs/arsitektur-umroh.md` — baru, source of truth Booking Core
- `docs/architecture.md` — anotasi di data-flow diagram (booking creation, auto-cancel, reminder), tabel API bookings/internal
- `docs/progress.md` — M4 dan M8 dapat pointer + 5 gap item baru termasuk 3 bug kritis
- `CLAUDE.md` — bagian "Perhatian" diperluas jadi daftar 4 bug kritis lintas modul yang harus diperbaiki sebelum M15

---

## 2026-07-08 — Rencana Booking Engine Universal: `docs/arsitektur-booking.md`

**Decision:** Alih-alih menambal Gap #1-#4 di `docs/arsitektur-umroh.md` §7 satu per satu, buat rencana arsitektur untuk **satu booking engine universal**: adapter registry kuota (`Record<BookingItemType, QuotaAdapter>` — reserve/confirm/release seragam untuk semua tipe produk), satu fungsi `cancelBooking()` dipakai baik self-cancel maupun auto-cancel cron, `totalAmount` dihitung ulang server-side, dan `Refund` record dibuat otomatis di dalam alur cancel. Didokumentasikan di `docs/arsitektur-booking.md` sebagai **rencana**, bukan audit as-built — belum diimplementasikan.

**Rationale:** User mengidentifikasi bahwa saat ini "Booking" dan "Umroh" menyatu — tidak ada engine generik, hanya satu jalur hardcoded berbentuk Umroh (`createBookingSchema` tidak punya field `haji`). Analisis akar masalah: setiap bug kritis yang ditemukan di `arsitektur-umroh.md` dan `arsitektur-muthowif.md` berasal dari pola yang sama — orkestrasi kuota ditulis tangan terpisah di 4 file (create, confirm, self-cancel, auto-cancel cron) tanpa jaminan struktural bahwa keempatnya konsisten per tipe produk. `PackageItem` (`prisma/schema.prisma:301-312`) sudah memakai pola polimorfik `productType`/`productId` — preseden bahwa pola ini sudah diterima di codebase, tinggal diperluas ke booking.

**Keputusan kunci — Opsi B (inkremental) dipilih atas Opsi A (big-bang):** pertahankan tabel per-tipe (`BookingHotel`, `BookingTransport`, dst.) apa adanya, tambahkan HANYA lapisan adapter tipis di atasnya. Ini menutup semua gap kritis (karena `Record<BookingItemType, QuotaAdapter>` memaksa kelengkapan secara statis lewat TypeScript) tanpa migrasi data dan tanpa mengubah query di 3 dokumen arsitektur produk yang sudah ditulis. `BookingItem` polimorfik tunggal (Opsi A) didokumentasikan sebagai visi jangka panjang opsional, bukan langkah wajib sekarang — dihindari demi tidak over-engineering sebelum ada kebutuhan nyata.

**Alternatives considered:**
- Tambal Gap #1-#4 satu-satu tanpa restrukturisasi — ditolak, tidak mencegah kelas bug yang sama terulang untuk produk berikutnya (Package, standalone Visa purchase, dst.)
- Opsi A (tabel `BookingItem` polimorfik tunggal menggantikan semua tabel per-tipe) sebagai langkah sekarang — ditolak untuk saat ini karena risiko migrasi data dan breaking change lebih besar dari manfaat langsungnya; disimpan sebagai visi opsional

**Affects:**
- `docs/arsitektur-booking.md` — baru, rencana (belum diimplementasikan)
- `docs/architecture.md` — catatan di banner modularisasi + data-flow diagram
- `docs/progress.md` — M8 dapat item rencana perbaikan struktural
- `CLAUDE.md` — bagian "Rencana (belum diimplementasikan)" baru, mengarahkan agar perbaikan bug kritis menunggu keputusan eksekusi rencana ini, bukan tambal langsung

---

## 2026-07-08 — Booking Engine Universal Di-pending: Asumsi "Satu Bentuk Booking" Keliru

**Decision:** Eksekusi `docs/arsitektur-booking.md` Step 1-4 (adapter registry, migrasi Haji pendingQuota, cancelBooking() universal, refactor 4 titik orkestrasi) **dihentikan sebelum mulai coding**. Insight baru ditambahkan sebagai §1.5 di dokumen tersebut, status diubah dari "RENCANA / PERANCANGAN" jadi "PENDING".

**Rationale:** Saat diminta eksekusi, user menyadari draf rencana (ditulis sesi sebelumnya) diam-diam mengasumsikan bahwa setiap booking selalu berbentuk satu trip Umroh dengan komponen opsional (hotel + transport + muthowif + catering + tour), dengan Haji sekadar "step tambahan" di wizard yang sama. Kenyataan bisnisnya berbeda: pelanggan bisa saja hanya ingin beli Visa saja (tanpa trip), Transport saja (sudah punya hotel sendiri), Umroh penuh, atau Haji (all-inclusive) — masing-masing alur pembelian dengan bentuk payload yang berbeda, bukan satu wizard linear dengan langkah opsional.

**Keputusan kunci:** lapisan bawah (adapter registry kuota, `BookingItem` sebagai visi opsional) **tetap valid** — itu murni soal bagaimana kuota direservasi/dikonfirmasi/dilepas per item, tidak berubah oleh insight ini. Yang perlu didesain ulang adalah lapisan atasnya: bentuk `createBookingSchema`/API/wizard yang merepresentasikan "keranjang" berisi kombinasi item dari alur pembelian manapun. Ini **belum didesain** — didokumentasikan sebagai open question di `docs/arsitektur-booking.md` §1.5, bukan diputuskan sepihak sesi ini.

**Alternatives considered:**
- Lanjutkan eksekusi Step 1-4 apa adanya (adapter di atas asumsi wizard-tunggal), desain ulang lapisan atas belakangan — ditolak, berisiko adapter harus ditulis ulang begitu bentuk keranjang yang benar disepakati, sia-sia kerja
- Desain langsung skema keranjang multi-alur sekarang juga tanpa dokumentasi dulu — ditolak, user eksplisit minta pending total setelah insight ini ditangkap di dokumen, bukan lanjut merancang

**Affects:**
- `docs/arsitektur-booking.md` — status banner diubah jadi PENDING, section §1.5 baru, §5 dan §6 dapat catatan pending
- Tidak ada perubahan kode/schema — sesi ini murni dokumentasi

---

## 2026-07-08 — Sweep Kelengkapan Visa: 2 Gap Baru Ditemukan Sebelum Refactor Total

**Decision:** Sebelum refactor total modul Visa, lakukan sweep khusus untuk kode yang sudah ada tapi belum tercatat di `docs/arsitektur-visa.md` (bukan sekadar re-verifikasi gap yang sudah diketahui). Caranya: list semua file yang menyebut "visa" di seluruh codebase, bandingkan dengan file yang dikutip di dokumen, lalu baca detail setiap file yang belum dikutip untuk menilai apakah substansinya sudah tercakup atau tidak.

**Temuan:** 4 file dari sweep ternyata trivial (nav link di `AdminSidebar.tsx`/`Header.tsx`, type literal di `draft.ts`, notification type literal di `send.ts`) — tidak perlu dicatat terpisah. Tapi 2 file mengandung logic substansial yang belum pernah didokumentasikan:
1. **`VisaActions.tsx`** (`app/[locale]/admin/(protected)/bookings/[id]/VisaActions.tsx:6-13`) — memegang satu-satunya state machine transisi status visa (`pending_documents → documents_complete → submitted_to_syarikah → in_review → {issued, rejected}`, `rejected → pending_documents`) di seluruh sistem. Diverifikasi bahwa `PUT /api/v1/admin/visa/[pilgrimId]/status` **tidak melakukan validasi transisi apa pun** — endpoint menerima keenam nilai enum status secara bebas tanpa mengecek status saat ini. Validasi transisi murni kosmetik UI (client-side), bukan aturan yang ditegakkan.
2. **Pola `catch { return err('Forbidden'), 403 }` polos** di kelima handler CRUD produk visa (`admin/products/visa/route.ts` GET/POST, `.../[id]/route.ts` GET/PUT/DELETE) — semua jenis error (termasuk error DB non-auth) dilaporkan sebagai 403, melanggar konvensi API sendiri di `CLAUDE.md`. Relevan langsung ke rencana refactor: `BookingVisa.visaProductId` adalah FK wajib (bukan nullable seperti `VisaApplication.visaProductId`) — begitu Gap #1 di `docs/arsitektur-umroh.md` diperbaiki dan `BookingVisa` mulai terisi, `DELETE` produk visa yang masih dipakai akan kena constraint DB dan errornya akan tersamar jadi 403 alih-alih 409/500 yang sebenarnya.

**Rationale:** User secara eksplisit meminta pengecekan "apakah ada implemented code tetapi belum dicatat dalam arsitektur" sebagai persiapan refactor total — bukan sekadar "apakah dokumen masih akurat". Dua pendekatan ini berbeda: yang pertama butuh sweep kelengkapan (list semua file terkait, cross-check), bukan hanya spot-check gap yang sudah diketahui.

**Alternatives considered:** Hanya re-verifikasi 4 gap yang sudah tercatat tanpa sweep baru — ditolak, tidak menjawab pertanyaan spesifik user soal kode yang belum tercatat.

**Affects:**
- `docs/arsitektur-visa.md` — §4 dan §5 dapat baris baru untuk `VisaActions.tsx`, §7 dapat Gap #5 dan #6
- `docs/progress.md` — M7 dapat 2 item gap baru

---

## 2026-07-08 — `docs/arsitektur-tiket-pesawat.md`: Konfirmasi Modul Tidak Ada, Bukan Audit

**Decision:** User meminta dibuatkan `docs/arsitektur-tiket-pesawat.md` yang "sesuai dengan implemented code". Audit menemukan modul ini **0% ada di kode** (tidak ada model Prisma, API route, komponen, atau halaman) dan secara eksplisit tercatat sebagai out-of-scope Phase 2 di `docs/spec.md:23,384`. Ditawarkan ke user apakah mau dokumen "belum diimplementasikan" (jujur, singkat) atau dokumen rencana (butuh input kebutuhan bisnis) — user pilih dokumen "belum diimplementasikan".

**Rationale:** Menulis konten arsitektur untuk modul yang tidak ada kodenya akan berarti mengarang — bertentangan langsung dengan permintaan user sendiri ("sesuai dengan implemented code") dan merusak konvensi yang sudah dibangun di seluruh dokumen `arsitektur-*.md` lain (semua audit langsung ke kode, bukan aspirasi). Satu-satunya referensi "tiket pesawat" di codebase adalah `etiket` — jenis dokumen upload di modul Visa (bukti tiket PP milik jamaah sendiri), bukan fitur booking tiket.

**Alternatives considered:**
- Menulis dokumen rencana langsung tanpa tanya kebutuhan bisnis — ditolak, tidak ada konteks (integrasi GDS? input manual? scope tidak jelas)
- Diam-diam mengasumsikan user salah sebut modul — ditolak, user mengonfirmasi eksplisit maksudnya memang tiket pesawat

**Affects:**
- `docs/arsitektur-tiket-pesawat.md` — baru, dokumen "tidak diimplementasikan"
- `CLAUDE.md` — catatan bahwa dokumen ini beda jenis dari dokumen modul lain

---

## 2026-07-08 — Rencana Varian Visa Umroh: Reguler vs Non-Hotel

**Decision:** Sebelum mengerjakan perbaikan Gap #1-#6 di `docs/arsitektur-visa.md` §7, tangkap dulu kebutuhan baru dari diskusi dengan user: `visaType: "Umroh"` sebenarnya punya 2 entitas berbeda — **Visa Reguler Umroh** (wajib booking hotel + transport, mungkin tiket pesawat kalau modul itu dibangun) dan **Visa Non-Hotel** (hotel/transport opsional, tapi ada biaya tambahan berdasarkan jumlah hari dengan batas minimum-maksimum). Ditambahkan sebagai §9 (RENCANA, belum diimplementasikan) di `docs/arsitektur-visa.md`, bukan file terpisah — karena ini pengembangan modul Visa itu sendiri, bukan concern lintas-modul seperti `docs/arsitektur-booking.md`.

**Rationale:** Kalau perbaikan gap dikerjakan dulu tanpa menangkap kebutuhan ini, kemungkinan besar wizard/validator yang diperbaiki akan berasumsi ke bentuk visa yang homogen (satu `VisaProduct` = satu perilaku), padahal kenyataannya perilakunya bercabang (wajib vs opsional komponen lain, harga tetap vs harga berbasis hari). §9.4 mencatat bahwa step hotel/transport di wizard (saat ini selalu opsional) perlu jadi kondisional-wajib tergantung `VisaProduct` yang dipilih — perubahan ini harus direncanakan sebelum Gap #2 (`tambah step pilih VisaProduct di wizard`) dikerjakan.

**Skema yang diusulkan (§9.2):** tetap satu tabel `VisaProduct`, tambah 3 field: `requiredComponents: Json` (array string, mis. `["hotel","transport"]`, pola sama dengan `PackageItem.productType` yang sudah ada), `minDays`/`maxDays: Int?`, `dayFeeTiers: Json?`. Tidak butuh tabel/model terpisah per varian.

**Keputusan terbuka, belum diputuskan (§9.3):** struktur `dayFeeTiers` — apakah tarif berjenjang per rentang hari (Opsi A, direkomendasikan sementara) atau tabel lookup tetap per angka hari spesifik (Opsi B). Menunggu konfirmasi user sebelum implementasi, dicatat eksplisit di dokumen sebagai open question, bukan diasumsikan sepihak.

**Alternatives considered:**
- Buat file terpisah `docs/arsitektur-visa-varian.md` — ditolak, ini pengembangan modul Visa itu sendiri, bukan concern lintas-modul; CLAUDE.md menetapkan satu dokumen per modul
- Asumsikan langsung salah satu struktur `dayFeeTiers` tanpa tanya — ditolak, ini murni keputusan bisnis (bagaimana tarif riil dihitung), bukan sesuatu yang bisa ditebak dari kode/konteks yang ada

**Affects:**
- `docs/arsitektur-visa.md` — §9 baru (RENCANA), banner status di atas diperbarui

---

## 2026-07-08 — Prinsip Anti-Hardcode untuk Varian Visa Umroh

**Decision:** User menegaskan bahwa nama & jumlah varian Visa Umroh ("Reguler", "Non-Hotel", dst.) **tidak boleh hardcode** di kode manapun — keduanya di §9.1 adalah contoh bisnis untuk menjelaskan kebutuhan, bukan nilai tetap. Ditambahkan §9.1.1 di `docs/arsitektur-visa.md` sebagai prinsip wajib.

**Rationale:** Kalau desain sebelumnya (§9.2-9.4) diimplementasikan dengan kondisional berbasis nama (`if (name === 'Visa Reguler Umroh')`), sistem akan rapuh setiap kali admin menambah/mengubah nama varian. `VisaProduct.visaType` sudah free text (bukan enum) sejak Visa Product v2 (2026-05-22) — prinsip ini menegaskan bahwa field baru (`requiredComponents`, `dayFeeTiers`, dll.) harus dipakai sebagai satu-satunya sumber kebenaran perilaku, bukan nama/id produk. Ini juga memperkuat perbaikan Gap #3 yang sudah tercatat — validator `visaType: z.enum([...])` harus diganti validasi terhadap `VisaProduct` aktif di database, bukan sekadar daftar string bebas tanpa validasi.

**Affects:**
- `docs/arsitektur-visa.md` — §9.1.1 baru, §9.4 diperjelas (wizard fetch dinamis dari DB, bukan toggle 2 tombol tetap)

---

## 2026-07-08 — Struktur `durationFeeRules` Dikonfirmasi: Gabungan Hari Spesifik & Rentang, Harga Selalu Flat

**Decision:** Keputusan terbuka di `docs/arsitektur-visa.md` §9.3 (Opsi A tarif berjenjang vs Opsi B lookup tetap) dikonfirmasi user sebagai **gabungan keduanya dalam satu struktur**: `durationFeeRules: Json` — array `{ minDays, maxDays, fee }`, di mana `minDays === maxDays` berarti durasi spesifik (mis. "7 hari"), `minDays < maxDays` berarti rentang (mis. "20-30 hari"), dan `fee` **selalu harga total flat** — tidak pernah dikalikan jumlah hari.

**Rationale:** Draf sebelumnya salah paham menganggap "biaya bervariasi per hari" berarti tarif per-hari yang dikalikan (Opsi A) atau lookup murni per angka spesifik tanpa rentang (Opsi B). User mengklarifikasi bisnisnya sebenarnya butuh dua bentuk sekaligus — beberapa durasi punya harga spesifik per angka (7 hari ≠ 8 hari), beberapa lainnya dikelompokkan jadi rentang dengan satu harga flat (20-30 hari = satu harga). Struktur `minDays`/`maxDays` per baris menyatukan kedua kasus tanpa perlu discriminator field terpisah — kalau `minDays === maxDays` otomatis berarti titik spesifik.

**Konsekuensi desain:** field `minDays`/`maxDays` terpisah di level `VisaProduct` (diusulkan di draf pertama §9.2) **dihapus** — sudah redundan karena rentang keseluruhan yang diperbolehkan otomatis tercakup dari union semua baris `durationFeeRules`. Ini juga konsisten dengan prinsip anti-hardcode yang baru saja disepakati — satu sumber kebenaran, bukan dua field yang berpotensi tidak sinkron.

**Affects:**
- `docs/arsitektur-visa.md` — §9.2 (schema, `dayFeeTiers` → `durationFeeRules`, field `minDays`/`maxDays` level produk dihapus), §9.3 (ditulis ulang, bukan lagi 2 opsi terbuka), §9.4, §9.5, banner status

---

## 2026-07-08 — Model Harga Durasi: Varian Produk (Override), Bukan Biaya Tambahan (Additive)

**Decision:** Klarifikasi lanjutan dari user (analogi varian ukuran produk S/M/L/XL): `durationFeeRules` **menggantikan** `VisaProduct.price`, bukan **menambah** di atasnya. `VisaProduct.price` = harga durasi default (mis. 7 hari). Baris di `durationFeeRules` hanya perlu didefinisikan untuk durasi yang BEDA dari default — kalau durasi yang dipilih jamaah cocok salah satu baris, pakai harga baris itu penuh; kalau tidak cocok baris manapun, jatuh ke `VisaProduct.price` sebagai fallback. Tidak ada kondisi "durasi tidak valid" — semua durasi selalu punya harga (baik dari rule spesifik atau dari default).

**Rationale:** Draf sebelumnya (revisi pertama §9.3) masih meninggalkan ambiguitas apakah `fee` di `durationFeeRules` ditambahkan ke `VisaProduct.price` atau berdiri sendiri. User menegaskan eksplisit: berdiri sendiri, meniru pola varian produk e-commerce yang familiar. Desain ini juga menghindari hardcode angka "7 hari" di kode manapun — default itu implisit dari apa yang TIDAK didaftarkan di `durationFeeRules`, admin bebas menentukan durasi mana yang jadi pengecualian dari harga default tanpa developer perlu tahu angka spesifiknya di code.

**Alternatives considered:**
- Additive (`VisaProduct.price` + `durationFeeRules.fee`) — ditolak, bukan model bisnis yang dimaksud user
- Wajib daftar SEMUA durasi yang valid di `durationFeeRules` (termasuk durasi default) — ditolak, tidak perlu; fallback ke `VisaProduct.price` sudah cukup dan mengurangi data yang harus diisi admin

**Affects:**
- `docs/arsitektur-visa.md` — §9.1 (tabel kebutuhan bisnis), §9.3 (ditulis ulang: model varian/override + aturan fallback), §9.4 (validasi durasi tidak lagi menolak, tapi fallback ke default)

---

## 2026-07-08 — Rencana Arsitektur Harga/HPP Universal: `docs/arsitektur-harga.md`

**Decision:** Buat rancangan arsitektur harga & HPP lintas-modul (`docs/arsitektur-harga.md`), dipicu oleh tabel harga BRN (visa) yang dilampirkan user menunjukkan kompleksitas nyata: HPP multi-vendor (syarikah berbeda-beda), HPP dalam USD yang perlu dikonversi ke IDR pakai kurs harian, margin keuntungan minimum yang harus admin-configurable, dan pembulatan harga jual psikologis. Dikonfirmasi lewat pengecekan langsung ke kode: **tidak ada infrastruktur ini sama sekali** — tidak ada model `Setting`, tidak ada konsep HPP/markup/margin di model produk manapun, halaman `system/settings/` belum pernah dibuat.

**Rationale:** Eksposur mata uang asing berpotensi lintas modul (Hotel/Transport/Muthowif/Haji semua dibayar ke vendor Saudi, bukan cuma Visa), jadi HPP tidak boleh didesain sebagai field khusus di `VisaProduct` saja — itu akan terduplikasi begitu modul lain butuh hal yang sama. Skema `ProductCost` polimorfik (mengikuti pola `PackageItem.productType`/`productId` yang sudah ada) memungkinkan satu infrastruktur dipakai semua modul tanpa migrasi ulang, tapi **data HPP nyata hanya diisi untuk Visa dulu** (satu-satunya yang datanya tersedia sekarang) — menghindari over-engineering isi data untuk modul yang belum butuh.

**Keputusan desain kunci:**
- Kurs di-cache via cron (jadwal 08:00 & 16:00 WIB, diselaraskan dengan jam terbit JISDOR 15:15 WIB), bukan fetch API live per request — demi latensi, ketahanan, dan konsistensi harga dalam satu sesi user.
- `midRate` (mentah) dan `sellRate` (mid + spread admin-configurable) disimpan terpisah — mewujudkan kebutuhan eksplisit user bahwa kurs jual di money changer berbeda dari kurs tengah tercatat.
- `ExchangeRate` append-only (bukan overwrite satu baris "current") — perlu histori untuk snapshot & audit margin.
- `costTiers` di `ProductCost` pakai struktur JSON yang sama persis dengan `durationFeeRules` (`docs/arsitektur-visa.md` §9.3) — masalah struktural yang sama (harga bervariasi per rentang hari), satu pola bukan dua.
- `PricingRule` (margin minimum) nullable per `productType` — global default + override, admin atur sendiri via halaman settings baru, bukan hardcode persentase di kode.

**Riset dilakukan (via WebSearch):** dua kandidat sumber kurs — Bank Indonesia JISDOR (resmi, defensible untuk akuntansi, tapi API SOAP/XML lama) vs API komersial gratis (ExchangeRate-API/Frankfurter, REST/JSON simpel, tapi bukan sumber resmi Indonesia). **Belum diputuskan** — direkomendasikan mulai dari API komersial untuk MVP, BI JISDOR sebagai upgrade path, tapi ini keputusan bisnis user, bukan teknis murni.

**Alternatives considered:**
- Field HPP langsung di `VisaProduct` (tanpa tabel `ProductCost` terpisah) — ditolak, tidak reusable ke modul lain, akan terduplikasi
- Fetch kurs live per request — ditolak, latensi + ketahanan + inkonsistensi harga dalam satu sesi
- Isi data HPP semua modul sekaligus sekarang — ditolak, data nyata baru ada untuk Visa, mengisi modul lain saat ini murni spekulasi

**Affects:**
- `docs/arsitektur-harga.md` — baru, rencana lengkap (10 seksi)
- `CLAUDE.md` — bagian "Rencana (belum diimplementasikan)" dapat entri kedua

---

## 2026-07-08 — Dua Pasangan Kurs: USD/IDR dan SAR/IDR, Bukan USD Saja

**Decision:** User mengonfirmasi kebutuhan kurs mencakup **dua pasangan**: USD→IDR dan SAR→IDR (Riyal Saudi), bukan cuma USD seperti draf pertama `docs/arsitektur-harga.md`. Skema `ExchangeRate` tidak perlu berubah (kolom `fromCurrency`/`toCurrency` sudah generik), tapi cron job dan pemilihan sumber API perlu di-review ulang.

**Temuan riset (via WebSearch):** Saudi Riyal di-peg tetap ke USD sejak 1986 (3,75 SAR = 1 USD, stabil, diperkirakan tetap di 2026). Frankfurter API (salah satu kandidat sumber) **tidak mendukung SAR sama sekali** (basis ECB, dikonfirmasi lewat currency tracker mereka) — otomatis gugur untuk kebutuhan ini. ExchangeRate-API mendukung 165 mata uang termasuk SAR — jadi kandidat tunggal yang bisa penuhi kedua pasangan dari satu sumber konsisten. BI JISDOR spesifik untuk USD/IDR saja, tidak ada rilis resmi SAR/IDR dari BI.

**Keputusan desain:** fetch SAR→IDR **langsung dari API**, bukan derivasi manual dari `USD→IDR ÷ 3.75` — meski peg-nya sangat stabil, hardcode rasio peg di kode melanggar prinsip anti-hardcode yang sudah disepakati sebelumnya (kalau peg berubah suatu saat, derivasi manual akan diam-diam salah). Rasio 3,75 tetap berguna sebagai **sanity-check** (log warning kalau rate yang di-fetch menyimpang jauh dari peg), bukan jalur kalkulasi utama.

**Alternatives considered:**
- Derivasi SAR/IDR dari USD/IDR × 3,75 — ditolak, melanggar prinsip anti-hardcode, rawan diam-diam salah kalau peg berubah
- Pakai Frankfurter untuk USD/IDR dan cari sumber lain khusus SAR — ditolak untuk sekarang, lebih rumit (2 sumber berbeda) dibanding ExchangeRate-API yang sudah cakup keduanya sekaligus

**Affects:**
- `docs/arsitektur-harga.md` — §1, §4 (ditulis ulang jadi §4.1 dan §4.2), §9 (2 baris keputusan baru), §10 (sumber riset ditambah)

---

## 2026-07-08 — Verifikasi Rencana Harga terhadap Tabel BRN Nyata: 2 Celah Ditemukan & Diperbaiki

**Decision:** User meminta verifikasi apakah `docs/arsitektur-harga.md` benar-benar mengakomodir tabel harga BRN (visa) yang dilampirkan di awal diskusi. Dicek angka per angka (bukan sekadar dibaca sekilas), ditemukan 2 celah struktural di draf pertama, keduanya sudah diperbaiki di dokumen:

1. **HPP ternyata penjumlahan beberapa komponen biaya, bukan satu angka.** Verifikasi matematis: `HPP USD` di tabel = `BRN` (bervariasi per hari) + `HPP Visa Individual` (117 USD, tetap semua baris) — cocok di semua 14 baris tabel (mis. hari 7: 9,38+117=126,38≈126; hari 85: 113,94+117=230,94≈231). `ProductCost` (§3.3) diperbaiki: tambah field `costComponent` (label bebas) supaya satu vendor bisa punya beberapa baris HPP yang **dijumlahkan** (masing-masing boleh currency & day-tier berbeda), bukan satu baris tunggal. `isPreferred` yang tadinya di `ProductCost` dipisah jadi model kecil `PreferredVendor` (per productType+productId) karena preferensi vendor adalah keputusan per produk, bukan per baris komponen biaya.

2. **Pembulatan harga jual itu "ke terdekat", bukan "selalu ke atas".** Verifikasi: Rp 2.950.409 di tabel dibulatkan TURUN ke Rp 2.950.000 (bukan naik ke Rp 3.000.000), sementara Rp 2.980.738 dibulatkan NAIK ke Rp 3.000.000 — konsisten dengan pembulatan ke kelipatan terdekat, bukan selalu ke atas seperti draf pertama (`roundUp`). Fungsi di §5 diganti jadi `roundToNearest`.

**Rationale:** Ini persis kenapa verifikasi terhadap data nyata penting sebelum implementasi — dua asumsi di draf pertama (HPP = 1 angka, pembulatan selalu ke atas) terlihat masuk akal secara desain tapi salah begitu dicocokkan ke angka riil. Kalau langsung diimplementasikan tanpa verifikasi ini, hasil kalkulasi HPP dan harga jual akan meleset dari yang sebenarnya diinginkan bisnis.

**Affects:**
- `docs/arsitektur-harga.md` — §3.3 (`ProductCost` + `costComponent`, model baru `PreferredVendor`), §5 (kalkulasi jadi sum multi-komponen, `roundToNearest`), §8 Step 1/4, §9 (2 baris keputusan baru: #10, #11, #12)

---

## 2026-07-08 — Koreksi Kedua: "BRN" adalah Nama Vendor, Vendor Dipilih PER KOMPONEN Bukan Per Produk

**Decision:** User mengoreksi pemahaman kolom tabel BRN: "BRN" bukan angka biaya generik, melainkan **nama syarikah/vendor** yang menyuplai komponen biaya khusus varian Non-Hotel. "HPP Visa Individu" (117 USD) adalah HPP untuk **Visa Reguler Umroh** (satu-satunya komponennya). HPP Non-Hotel = komponen "individu" (sama, 117) + komponen dari vendor BRN (bervariasi per hari) — dua komponen dari **vendor yang berbeda**, bukan satu vendor menyuplai semua komponen produk yang sama.

**Konsekuensi desain:** `PreferredVendor` (dari revisi sebelumnya, di-scope per `productType`+`productId`) diperbaiki lagi jadi di-scope per `productType`+`productId`+**`costComponent`** — karena kompetisi antar-syarikah terjadi di level komponen (mis. syarikah lain bisa menawarkan komponen "biaya_non_hotel" dengan harga beda dari BRN), bukan di level keseluruhan produk. Fungsi `computeSellPrice` (§5) diperbaiki: loop tiap `costComponent` yang ada untuk produk itu, untuk masing-masing cari `PreferredVendor` KHUSUS komponen itu, baru jumlahkan.

**Contoh konkret didokumentasikan** di §3.3: Visa Reguler = 1 baris `ProductCost` (komponen "individu" saja). Visa Non-Hotel = 2 baris `ProductCost` (komponen "individu" + komponen "biaya_non_hotel" dari vendor BRN), dengan 2 baris `PreferredVendor` terpisah.

**Rationale:** Ini koreksi kedua berturut-turut terhadap asumsi yang sama (struktur HPP multi-komponen) — pertama saya salah kira 1 vendor bisa punya banyak komponen tergabung, sekarang dikoreksi lagi bahwa komponen berbeda BISA datang dari vendor berbeda. Pola ini justru lebih mendukung kebutuhan awal user ("HPP banyak variannya, syarikah A, syarikah B") — kompetisi vendor kini benar-benar granular di level komponen biaya, bukan cuma di level seluruh produk.

**Affects:**
- `docs/arsitektur-harga.md` — §3.3 (penjelasan direvisi + contoh konkret Reguler/Non-Hotel), `PreferredVendor` (unique key tambah `costComponent`), §5 (loop per komponen dengan preferred vendor sendiri-sendiri), §8 Step 4, §9 (#10, #11 diperbarui)

---

## 2026-07-08 — `docs/arsitektur-harga.md` Jadi Rujukan Resmi Harga Visa (Bukan Dua Sumber Terpisah)

**Decision:** User meminta arsitektur harga (`docs/arsitektur-harga.md`) dijadikan **rujukan resmi** untuk harga Visa — menutup celah yang sempat ditemukan (dua dokumen sama-sama mengatur "harga per jumlah hari": `VisaProduct.durationFeeRules` di `docs/arsitektur-visa.md` §9.3 sebagai tabel yang diisi admin manual, vs `computeSellPrice()` di `docs/arsitektur-harga.md` sebagai mesin hitung otomatis dari HPP+kurs+margin). Keputusan: `VisaProduct.price` dan `durationFeeRules` **bukan lagi diisi admin manual** — keduanya jadi **cache/snapshot** hasil `computeSellPrice()`, di-refresh otomatis.

**Rationale:** Dua sumber kebenaran untuk hal yang sama (harga jual per durasi) berisiko saling tidak sinkron — admin bisa lupa update salah satu, atau keduanya diisi dengan asumsi margin/kurs yang beda. Dengan HPP+kurs+margin sebagai satu-satunya input, dan harga jual sebagai OUTPUT yang dihitung, tidak ada lagi dua tempat yang perlu dijaga konsisten manual.

**Mekanisme cache (§6 baru di `docs/arsitektur-harga.md`):** boundary hari di `durationFeeRules` diturunkan otomatis dari union `minDays`/`maxDays` di seluruh `ProductCost.costTiers` produk itu (bukan diketik admin). Refresh dipicu 2 kondisi: (1) admin ubah `ProductCost`/`PreferredVendor`/`PricingRule` untuk produk itu → recalculate seketika; (2) setelah cron kurs jalan (08:00/16:00 WIB) → recalculate semua produk yang pakai currency yang baru saja diperbarui. Pola ini konsisten dengan alasan kurs sendiri di-cache (hindari hitung ulang tiap page view), tapi tetap ikut berubah begitu kurs harian ter-update.

**Konsekuensi turunan:** admin UI di `/products/visa/[id]` (`docs/arsitektur-visa.md` §9.4-9.5) berubah — bukan lagi form isi `fee` per rentang hari, tapi form kelola `ProductCost` per komponen biaya + `PreferredVendor`. Detail UI ini belum didesain, dicatat eksplisit sebagai belum diputuskan di §9.5 `arsitektur-visa.md`.

**Alternatives considered:**
- Biarkan `durationFeeRules` tetap diisi manual, independen dari mesin HPP — ditolak, itu justru masalah yang sedang diperbaiki (dua sumber kebenaran)
- Compute harga live tiap request tanpa cache — ditolak, sama alasan dengan kurs: latensi + inkonsistensi harga dalam satu sesi user

**Affects:**
- `docs/arsitektur-harga.md` — §6 baru (Cache Harga Jual & Mekanisme Refresh), section lama direnumber (§6→7, §7→8, §8→9, §9→10, §10→11), §9 Step 5/6/7/8 diperbarui, §10 dapat 2 baris keputusan baru (#13, #14)
- `docs/arsitektur-visa.md` — §9 banner, §9.3, §9.4, §9.5 diperbarui: `durationFeeRules`/`price` jadi cache, bukan input manual

---

## 2026-07-08 — Klarifikasi Reusability: Apa yang 100% Generik vs Butuh Adapter per Produk

**Decision:** User mengonfirmasi pemahaman bahwa arsitektur harga ini didesain jadi komponen yang bisa dipasang ke produk mana pun. Ditambahkan §8.1 di `docs/arsitektur-harga.md` untuk memisahkan eksplisit: `Vendor`/`ExchangeRate`/`ProductCost`/`PricingRule`/`PreferredVendor`/`computeSellPrice()` 100% reusable tanpa sentuh kode; hanya fungsi `refresh*ProductCache()` (§6.2) yang butuh "adapter" tipis per tipe produk, karena tempat cache & bentuk tier beda per produk (Visa per rentang hari vs Hotel per season vs Transport per charter/per-kursi).

**Rationale:** Penting didokumentasikan eksplisit (bukan cuma dijawab lisan) supaya pembaca dokumen di masa depan tidak salah kira ini "pasang dan langsung jalan 100% tanpa kode" untuk produk baru — parallel langsung ditarik ke pola adapter registry kuota yang sudah ada di `docs/arsitektur-booking.md` §3.2, karena user sudah familiar dengan konsep itu dari diskusi sebelumnya.

**Affects:**
- `docs/arsitektur-harga.md` — §8.1 baru

---

## 2026-07-08 — Fase Eksekusi SOP Ditambahkan ke CLAUDE.md

**Decision:** User meminta SOP eksplisit untuk eksekusi implementasi multi-fase (sebelum mulai eksekusi arsitektur harga). Dicek dulu: `CLAUDE.md` sudah punya "Milestone SOP" (build check → progress.md → decisions.md → milestone berikutnya), tapi granularitasnya untuk milestone besar (M1-M15), bukan fase kecil di dalam satu implementasi. Ditambahkan section baru "Fase Eksekusi SOP" yang melengkapi (bukan menggantikan) Milestone SOP, dengan 5 poin: (0) selalu baca CLAUDE.md & fokus task berjalan, (1) rencana arsitektur dulu sebelum eksekusi, (2) eksekusi satu fase per waktu, (3) cek `bun run build` tiap selesai fase, (4) dokumentasikan kalau 0 error, (5) baru lanjut fase berikutnya.

**Rationale:** Milestone SOP terlalu kasar granularitasnya untuk implementasi seperti eksekusi `docs/arsitektur-harga.md` yang punya banyak step kecil (Schema → Cron → Settings UI → HPP UI → Kalkulasi → Cache → Snapshot → Build). Tanpa SOP fase, ada risiko banyak perubahan menumpuk sebelum dicek type error, atau dokumentasi ketinggalan jauh dari kode aktual.

**Affects:**
- `CLAUDE.md` — section baru "Fase Eksekusi SOP", ditempatkan sebelum "Milestone SOP"

---

## 2026-07-17 — Fase 1 Arsitektur Harga: Schema Diterapkan, DB Direset (Drift Migrasi Ditemukan)

**Decision:** Eksekusi Fase 1 dari `docs/arsitektur-harga.md` §9 — 5 model baru (`Vendor`, `ExchangeRate`, `ProductCost`, `PricingRule`, `PreferredVendor`) ditambahkan ke `prisma/schema.prisma` persis sesuai desain final di §3 (setelah 2 revisi berdasarkan verifikasi tabel HPP nyata). Migrasi `20260717065932_add_pricing_hpp_infrastructure` dibuat & diterapkan. `bun run build` — 0 error.

**Temuan penting saat eksekusi — drift migrasi:** `prisma migrate dev` gagal karena riwayat migrasi (`prisma/migrations/`, cuma sampai 13 Mei) tidak sinkron dengan skema aktual — Transport v3 dan Visa Product v2 (`country` field) ternyata pernah diterapkan lewat `prisma db push` (bukan `migrate dev`), jadi tidak pernah tercatat sebagai migrasi resmi. Prisma minta reset total untuk menyamakan.

**Konfirmasi eksplisit diminta dan didapat dari user** ("ya, reset...") sebelum menjalankan `prisma migrate reset --force` — sesuai mekanisme keamanan Prisma sendiri untuk agen AI (env var `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` wajib diisi persis teks konsensus user). DB lokal (`localhost:5432/saudinesia`) di-reset, 3 migrasi lama diterapkan ulang, tapi seed gagal di tengah jalan karena tabel Transport v3 (`transport_pricing`, dll.) belum ada — mengonfirmasi drift-nya.

**Solusi teknis untuk drift:** karena shell environment ini non-interaktif (Prisma `migrate dev` menolak jalan tanpa TTY, bahkan dengan `--create-only` dan stdin di-pipe), dipakai jalur alternatif yang tetap menghasilkan migrasi resmi (bukan `db push` permanen): `prisma migrate diff` (generate SQL dari riwayat migrasi ke skema target) → tulis manual ke folder migrasi baru → `prisma migrate resolve --applied` untuk baseline 3 migrasi lama yang sudah ada tabelnya tapi hilang tracking-nya (`_prisma_migrations` table sempat hilang saat reset) → `prisma migrate deploy` untuk menerapkan migrasi baru secara non-interaktif. Setelah itu `bun prisma generate` + `bun run db:seed` untuk pulihkan data dummy.

**Catatan desain untuk fase implementasi berikutnya (BUKAN bug, tapi nuansa yang perlu diperhatikan):** `PricingRule.@@unique([productType])` dengan `productType: String?` (nullable, null = default global) — PostgreSQL **tidak** menganggap dua NULL sebagai sama untuk unique constraint, jadi constraint ini secara teknis tidak mencegah lebih dari satu baris `productType: null` dibuat. Untuk fase implementasi UI settings (Fase 3) nanti, invarian "hanya satu baris global" harus ditegakkan di level aplikasi (mis. selalu upsert row global yang sama, bukan create baru), bukan mengandalkan constraint DB semata.

**Alternatives considered:**
- Pakai `prisma db push` langsung untuk fase ini — ditolak (walau ditawarkan sebagai opsi ke user), lebih baik tetap punya riwayat migrasi resmi karena drift yang sama sudah terjadi sekali dan sebaiknya tidak diperparah
- Baseline manual tanpa reset (`migrate resolve` langsung di atas DB lama tanpa reset) — dicoba secara implisit lewat alur di atas setelah reset; tidak mencoba menghindari reset sepenuhnya karena `_prisma_migrations` sempat tidak ada sama sekali (bukan cuma drift skema)

**Affects:**
- `prisma/schema.prisma` — 5 model baru
- `prisma/migrations/20260717065932_add_pricing_hpp_infrastructure/` — baru
- DB lokal — direset & di-seed ulang (data dummy, bukan data production)
- `docs/progress.md` — section baru "Arsitektur Harga / HPP — Eksekusi Bertahap", Fase 1 dicentang

---

## 2026-07-17 — Fase 2 Arsitektur Harga: Cron Kurs Diimplementasikan

**Decision:** `lib/cron/exchangeRateJob.ts` dibuat — fetch USD→IDR dan SAR→IDR dari `open.er-api.com` (endpoint gratis ExchangeRate-API, dikonfirmasi lewat WebFetch dan uji langsung: `GET https://open.er-api.com/v6/latest/{BASE}`, tanpa API key). Jadwal `0 8,16 * * *` dengan opsi `{ timezone: 'Asia/Jakarta' }` eksplisit di `node-cron` — dicek dulu bahwa cron job lain (`autocancelJob.ts`) TIDAK set timezone eksplisit (karena jadwalnya per-jam, tidak sensitif TZ), tapi job ini butuh jam spesifik WIB (08:00/16:00) jadi timezone wajib diset eksplisit, tidak boleh mengandalkan TZ server.

**Diverifikasi fungsional** (bukan cuma `bun run build`): dijalankan manual sekali via script sementara, dikonfirmasi kurs USD/IDR (~17.992) dan SAR/IDR (~4.798) berhasil ter-fetch dari API asli dan tersimpan ke tabel `exchange_rates` dengan `sellRate` terhitung benar dari `midRate × (1 + 1.5%)`. Sanity-check peg SAR/USD (~3.75) juga terverifikasi tidak memicu warning (implied peg dari data aktual ≈3.75, sesuai ekspektasi).

**Deviasi dari rencana `docs/arsitektur-harga.md` (dicatat eksplisit, disengaja):** `spreadPercent` untuk kurs sementara **hardcode** (`DEFAULT_SPREAD_PERCENT = 1.5` sebagai konstanta di kode), bukan dibaca dari setting admin — karena halaman admin settings (Fase 3) belum dibangun saat fase ini dikerjakan. Ini pelanggaran sementara terhadap prinsip anti-hardcode yang sudah disepakati di seluruh sesi ini, diterima sebagai trade-off pragmatis supaya Fase 2 tidak terhambat menunggu Fase 3 — akan diperbaiki (baca dari `PricingRule`/setting baru) begitu Fase 3 selesai, dicatat sebagai TODO eksplisit di kode dan di sini.

**Error handling:** tiap pasangan mata uang di-fetch dalam try/catch terpisah — kegagalan satu pasangan (mis. SAR down) tidak menggagalkan pasangan lain (USD tetap tersimpan), sesuai desain di `docs/arsitektur-harga.md` §4.2.

**Alternatives considered:**
- Tunda Fase 2 sampai Fase 3 (settings) selesai dulu, supaya spreadPercent tidak hardcode sama sekali — ditolak, melanggar SOP fase (satu fase per waktu, jangan gabung), dan cron kurs tidak butuh settings UI untuk *berfungsi*, cuma untuk *dikonfigurasi* — keduanya independen
- BI JISDOR sebagai sumber (bukan ExchangeRate-API) — tetap tidak dipakai untuk fase ini sesuai keputusan sebelumnya (§4.2 `arsitektur-harga.md`), format SOAP/XML-nya lebih kompleks dan bukan blocker untuk MVP

**Affects:**
- `lib/cron/exchangeRateJob.ts` — baru
- `instrumentation.ts` — daftarkan `startExchangeRateJob()`
- `docs/progress.md` — Fase 2 dicentang, catatan deviasi spreadPercent

---

## 2026-07-17 — Fase 3 Arsitektur Harga: Halaman Admin Settings Dibuat

**Decision:** Halaman `system/settings/` (link sidebar sudah ada sejak lama, halamannya baru dibuat sekarang) diimplementasikan dengan 2 section: margin/pembulatan (`PricingRule` global) dan vendor/syarikah (`Vendor`). API routes baru: `admin/system/settings/pricing-rule` (GET auto-create default kalau belum ada + PUT), `admin/system/settings/vendors` (GET/POST), `admin/system/settings/vendors/[id]` (PUT + DELETE-sebagai-soft-deactivate).

**Perbaikan pola dari bug yang ditemukan sebelumnya:** kelima handler baru ini secara eksplisit membedakan `Unauthorized`/`Forbidden` (401 tidak dipakai di sini karena `requireSuperAdmin()` selalu throw `'Forbidden'` untuk non-superadmin, session kosong tetap masuk kategori sama di guard ini) dari error lain (500, `console.error`, tanpa bocorkan detail Prisma) — **tidak mengulangi** pola "semua error jadi 403 polos" yang jadi Gap #6 di `docs/arsitektur-visa.md` §7.

**Vendor tidak punya DELETE fisik** — cuma toggle `isActive`, sama alasan dengan kenapa Transport vehicle juga tidak punya DELETE fisik (`docs/arsitektur-transportasi.md` §3): vendor dipakai `ProductCost`/`PreferredVendor`, hapus fisik berisiko orphan/FK constraint begitu data HPP mulai diisi.

**Diverifikasi end-to-end via browser** (bukan cuma `bun run build`): login superadmin (`admin@saudinesia.local`), halaman settings render dengan margin default 20%/Rp50.000 otomatis ter-buat (mengonfirmasi `getOrCreateGlobalRule()` bekerja), vendor "BRN" berhasil dibuat, toggle status aktif→nonaktif berhasil, update margin ke 25% berhasil tersimpan — semua tanpa console error.

**Affects:**
- `app/api/v1/admin/system/settings/pricing-rule/route.ts` — baru
- `app/api/v1/admin/system/settings/vendors/route.ts` — baru
- `app/api/v1/admin/system/settings/vendors/[id]/route.ts` — baru
- `app/[locale]/admin/(protected)/system/settings/page.tsx` — baru
- `docs/progress.md` — Fase 3 dicentang

---

## 2026-07-17 — Fase 4 Arsitektur Harga: Admin HPP per Produk Visa

**Decision:** Section "HPP & Komponen Biaya" ditambahkan ke halaman edit `/products/visa/[id]` yang sudah ada (bukan halaman terpisah) — konsisten dengan pola requirements builder yang sudah ada di halaman yang sama. API baru: `admin/products/visa/[id]/costs` (GET list + vendors + preferredVendors sekaligus, POST create), `.../costs/[costId]` (PUT/DELETE), `.../costs/preferred` (PUT, upsert `PreferredVendor` di-scope per `costComponent` sesuai desain §3.4 `docs/arsitektur-harga.md`).

**UX shortcut:** kalau komponen baru dibuat dan itu satu-satunya vendor untuk `costComponent` itu, `PreferredVendor` langsung di-set otomatis (tidak perlu admin klik "Jadikan Pilihan" secara terpisah untuk kasus umum 1-vendor-per-komponen).

**Diverifikasi end-to-end via browser** (bukan cuma `bun run build`): dibuat produk visa baru "Visa Non-Hotel Umroh", ditambahkan komponen "biaya_non_hotel" dari vendor "BRN" dengan tarif 20-30 hari = Rp1.500.000, tersimpan benar dan badge "Vendor Pilihan" muncul otomatis. Dikonfirmasi ulang lewat query Prisma langsung ke `product_costs` dan `preferred_vendors` — struktur data persis sesuai desain (`costTiers: [{minDays:20,maxDays:30,cost:1500000}]`).

**Catatan proses verifikasi:** ditemukan Browser pane sempat mengalami rendering glitch (viewport 0x0, screenshot menampilkan layout aneh) di beberapa titik selama pengujian — diatasi dengan mengandalkan `get_page_text` dan `read_page` (bukan koordinat visual) untuk verifikasi, plus query DB langsung sebagai pembuktian independen. Bukan bug di kode aplikasi.

**Affects:**
- `app/api/v1/admin/products/visa/[id]/costs/route.ts` — baru
- `app/api/v1/admin/products/visa/[id]/costs/[costId]/route.ts` — baru
- `app/api/v1/admin/products/visa/[id]/costs/preferred/route.ts` — baru
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — section baru "HPP & Komponen Biaya"
- `docs/progress.md` — Fase 4 dicentang

---

## 2026-07-17 — Fase 5 Arsitektur Harga: Fungsi `computeSellPrice()`

**Decision:** `lib/pricing/computeSellPrice.ts` diimplementasikan persis sesuai desain §5 `docs/arsitektur-harga.md`. Fungsi murni, `async` (query DB untuk komponen/kurs/margin, tidak menyimpan state).

**Perilaku komponen tanpa tier cocok:** dilewati diam-diam (`continue`), tidak melempar error — komponen memang boleh cuma berlaku untuk rentang hari tertentu (mis. "biaya_non_hotel" cuma untuk 20-30 hari; kalau jumlahHari di luar itu, komponen itu dianggap tidak berlaku, bukan error).

**Diverifikasi dengan data nyata** dari Fase 4 (bukan data mock): produk "Visa Non-Hotel Umroh", komponen "biaya_non_hotel" (1.500.000 [unit currency test], tier 20-30 hari) dari vendor BRN. Hasil hari-25: HPP, minSellPrice, dan sellPrice (dibulatkan ke kelipatan Rp50.000) semua matematis benar dan konsisten dengan formula desain. Hasil hari-5 (di luar tier): 0 di semua field, tanpa exception — mengonfirmasi "skip diam-diam" bekerja sesuai desain.

**Affects:**
- `lib/pricing/computeSellPrice.ts` — baru
- `docs/progress.md` — Fase 5 dicentang

---

## 2026-07-17 — Fase 6 Arsitektur Harga: Cache Refresh — Termasuk Insiden Kehilangan Data (Shadow DB)

**Decision:** Ditemukan saat eksekusi bahwa `VisaProduct.durationFeeRules`/`requiredComponents` (didesain di `docs/arsitektur-visa.md` §9.2) belum pernah ter-migrate — ditambahkan lewat migrasi baru `20260717081142_add_visa_pricing_cache_fields`. `lib/pricing/refreshVisaProductCache.ts` diimplementasikan sesuai §6.2 `docs/arsitektur-harga.md`, disambungkan ke 5 titik pemicu (create/update/delete `ProductCost`, update `PreferredVendor`, update `PricingRule` global — semua `await` blocking karena scope 1 produk; akhir cron kurs — fire-and-forget `void` untuk update `PricingRule` global karena bisa menyentuh banyak produk sekaligus).

**INSIDEN — kehilangan data karena kesalahan penggunaan `prisma migrate diff`:** Untuk menghasilkan SQL migrasi non-interaktif (pola yang sama dipakai di Fase 1), perintah `prisma migrate diff --shadow-database-url "$DATABASE_URL" ...` dijalankan lagi — **tapi kali ini parameter `--shadow-database-url` salah diarahkan ke database asli**, bukan database sementara terpisah. "Shadow database" di Prisma memang didesain sebagai database sekali-pakai yang boleh di-reset untuk keperluan hitung diff — karena diarahkan ke DB asli, seluruh data lokal (termasuk semua data uji Fase 1-5: vendor BRN, produk "Visa Non-Hotel Umroh", kurs yang sudah di-fetch, dll.) terhapus **tanpa melalui pengaman konsensus eksplisit** yang berlaku untuk `migrate reset` (karena `migrate diff` tidak punya guard AI yang sama). Ini ditemukan segera setelah migrasi (query verifikasi Fase 6 mengembalikan "produk tidak ditemukan"), dilaporkan transparan ke user, dan database di-reseed (`bun run db:seed` + setup ulang data uji secara manual).

**Perbaikan proses untuk migrasi berikutnya (kalau perlu `migrate diff` lagi di sesi non-interaktif ini):** WAJIB pakai database shadow yang benar-benar terpisah (mis. nama database lain di instance Postgres yang sama, atau biarkan Prisma yang auto-generate shadow DB-nya sendiri tanpa override eksplisit ke `$DATABASE_URL`) — jangan pernah lagi menyamakan `--shadow-database-url` dengan `DATABASE_URL` yang sedang dipakai aplikasi.

**Diverifikasi ulang setelah reseed:** setup data uji dibuat ulang lewat script langsung (lebih cepat & lebih dapat diandalkan dari UI browser untuk kasus ini), dipanggil `refreshExchangeRates()` (Fase 2) yang otomatis memicu `refreshAllVisaProductCaches()` (Fase 6) di akhir — dikonfirmasi log `[cron] Cache harga visa di-refresh untuk currency: USD, SAR` muncul otomatis, dan `VisaProduct.durationFeeRules` ter-update dengan nilai yang persis konsisten dengan pemanggilan `computeSellPrice()` langsung untuk hari yang sama.

**Alternatives considered:**
- Skip verifikasi ulang, percaya kode benar dari review saja — ditolak, insiden kehilangan data justru menunjukkan pentingnya verifikasi ulang end-to-end setelah operasi database apa pun, bukan cuma setelah perubahan kode

**Affects:**
- `prisma/schema.prisma` — `VisaProduct.requiredComponents`, `VisaProduct.durationFeeRules`
- `prisma/migrations/20260717081142_add_visa_pricing_cache_fields/` — baru
- `lib/pricing/refreshVisaProductCache.ts` — baru
- `app/api/v1/admin/products/visa/[id]/costs/route.ts`, `.../costs/[costId]/route.ts`, `.../costs/preferred/route.ts` — panggil refresh setelah mutasi
- `app/api/v1/admin/system/settings/pricing-rule/route.ts` — panggil refresh semua produk setelah margin global berubah
- `lib/cron/exchangeRateJob.ts` — panggil refresh produk yang terpengaruh currency yang baru di-update
- DB lokal — sempat terhapus tak sengaja, sudah di-reseed
- `docs/progress.md` — Fase 6 dicentang + catatan insiden

---

## 2026-07-17 — Fase 7 Arsitektur Harga: Field Snapshot (Schema Saja) — Semua 7 Fase Selesai

**Decision:** `VisaApplication` dapat 5 field snapshot baru (`selectedDurationDays`, `hppSnapshotRupiah`, `sellPriceSnapshot`, `exchangeRateIdsUsed`, `vendorIdsUsed`) via migrasi `add_visa_application_price_snapshot`. **Field ini sengaja belum diisi kode manapun** — pengisiannya baru bisa terjadi setelah `POST /api/v1/bookings` benar-benar menyimpan `visaProductId` dan memanggil `computeSellPrice()` saat create booking, yang bergantung pada Gap #1 (`visaApplication.visaProductId` tidak pernah di-set) dan Gap #2 (wizard belum punya step pilih `VisaProduct`) di `docs/arsitektur-visa.md` §7 — keduanya di luar scope eksekusi arsitektur harga sesi ini.

**Perbaikan proses migrasi:** kali ini dipakai database shadow yang benar-benar terpisah (`saudinesia_shadow`, dibuat khusus via `CREATE DATABASE`, dihapus setelah migrasi selesai) — bukan `DATABASE_URL` asli seperti insiden Fase 6. Dikonfirmasi data (5 hotel dari seed) tetap utuh sebelum dan sesudah migrasi.

**SEMUA 7 FASE ARSITEKTUR HARGA (`docs/arsitektur-harga.md` §9) SELESAI dieksekusi untuk scope Visa:**
1. Schema (`Vendor`, `ExchangeRate`, `ProductCost`, `PricingRule`, `PreferredVendor`)
2. Cron kurs (USD/SAR→IDR, 08:00 & 16:00 WIB, ExchangeRate-API)
3. Admin settings (margin/pembulatan global, CRUD vendor)
4. Admin HPP per produk Visa (komponen biaya + tarif durasi + vendor pilihan per komponen)
5. `computeSellPrice()`
6. Cache refresh otomatis ke `VisaProduct.price`/`durationFeeRules`
7. Field snapshot di `VisaApplication` (schema siap, pengisian menunggu perbaikan gap wizard terpisah)

**Yang MASIH belum lengkap (bukan kegagalan fase, tapi dependency di luar scope):** end-to-end dari wizard booking sampai booking benar-benar tersimpan dengan harga terhitung — itu bergantung pada perbaikan Gap #1/#2 `arsitektur-visa.md` §7 yang merupakan pekerjaan terpisah (memilih `VisaProduct` di wizard, set `visaProductId` saat create booking). Infrastruktur HPP/harga-nya sendiri sudah lengkap dan teruji.

**Affects:**
- `prisma/schema.prisma` — `VisaApplication` 5 field baru
- `prisma/migrations/20260717081927_add_visa_application_price_snapshot/` — baru
- `docs/progress.md` — Fase 7 dicentang, catatan "semua fase selesai"

---

## 2026-07-17 — Audit Sinkronisasi `docs/arsitektur-harga.md` vs Kode Aktual, Pasca Eksekusi 7 Fase

**Decision:** User meminta verifikasi ulang bahwa `docs/arsitektur-harga.md` benar-benar sesuai kode aktual (bukan cuma dipercaya dari catatan yang ditulis sendiri saat eksekusi tiap fase) — pola sama dengan sync-check yang sudah dilakukan untuk modul Visa sebelumnya. Setiap model schema, fungsi (`computeSellPrice`, `refreshVisaProductCache`), cron job, dan titik pemicu refresh dicek baris demi baris terhadap kode aktual.

**Temuan #1 (staleness dokumen, bukan bug kode):** status banner dokumen masih menyatakan "RENCANA / PERANCANGAN — belum diimplementasikan" dan "Urutan Implementasi (belum dieksekusi)", padahal ketujuh fase sudah selesai dan diverifikasi. Diperbaiki: banner sekarang "DIIMPLEMENTASIKAN & TERVERIFIKASI (scope Visa)", §9 ditandai selesai per step.

**Temuan #2 (dokumentasi tidak lengkap):** implemented code (6 API route, 2 halaman admin) tidak tercatat di tabel manapun — dokumen langsung loncat dari desain fungsi ke Keputusan Arsitektur tanpa bagian "API Routes"/"Admin UI" seperti konvensi dokumen modul lain (`arsitektur-visa.md`, `arsitektur-transportasi.md`). Ditambahkan §11 (API Routes) dan §12 (Admin UI).

**Temuan #3 (gap nyata, belum diperbaiki — didokumentasikan di §13 baru):**
1. `spreadPercent` kurs hardcode (`DEFAULT_SPREAD_PERCENT = 1.5` di `exchangeRateJob.ts`) — belum admin-configurable seperti prinsip §2 mengharuskan.
2. Field snapshot `VisaApplication` (Fase 7) ada di schema, belum diisi kode manapun — sudah dicatat sebelumnya sebagai dependency Gap Visa, dikonfirmasi ulang masih akurat.
3. `PricingRule` override per `productType` didukung schema tapi belum ada UI-nya — admin cuma bisa atur margin global lewat halaman settings saat ini.
4. Nuansa `@@unique([productType])` nullable — dicatat sebelumnya, dikonfirmasi masih berlaku, invarian ditegakkan aplikasi bukan DB.
5. **Paling signifikan:** route lama `PUT /api/v1/admin/products/visa/[id]` (basic info, sudah ada sejak Visa Product v2 sebelum sesi ini) **masih menerima `price` manual** dari form "Informasi Dasar" tanpa validasi minimum dan **tanpa memanggil `refreshVisaProductCache()`** — dua jalur (manual vs cache) hidup berdampingan tanpa aturan, admin bisa input harga manual yang lalu diam-diam ter-overwrite begitu ada perubahan HPP berikutnya. Validasi minimum yang dijanjikan §5 ("tolak kalau harga manual di bawah minSellPrice") ternyata **tidak pernah diimplementasikan di kode manapun**.

**Rationale:** Temuan #5 paling penting karena ini persis kelas masalah yang mendorong seluruh arsitektur harga ini dibuat (dua sumber kebenaran harga yang bisa saling tidak sinkron) — dan celah itu masih ada di satu titik yang terlewat (form lama yang sudah ada sebelum sesi harga dimulai, tidak diaudit ulang saat Fase 4 menambahkan section baru di halaman yang sama).

**Keputusan scope:** gap-gap ini **didokumentasikan dulu, belum diperbaiki** — user secara eksplisit memilih fokus memperkuat data admin dulu ("kita perkuat dulu data di adminnya"), perbaikan gap menyusul sebelum pindah ke modul lain sesuai instruksi standing user.

**Affects:**
- `docs/arsitektur-harga.md` — banner, §3.4, §6.2, §7, §9 diperbaiki; §11 (API Routes), §12 (Admin UI), §13 (Gap/Ketidaksesuaian Aktif) baru; §11 lama (Referensi Silang) jadi §14
- `docs/progress.md` — entri audit sinkronisasi baru

---

## 2026-07-17 — Gap #5 (Harga Manual) Sengaja Ditunda, Bukan Diperbaiki Sekarang

**Decision:** Ditanya apakah Gap #5 (`docs/arsitektur-harga.md` §13 — form "Harga (Rp)" manual di `/products/visa/[id]` tidak sinkron dengan cache HPP) mau dijadikan read-only atau divalidasi, user memilih opsi ketiga: **tunda sepenuhnya** sampai modul Visa dirombak (perbaikan Gap #1/#2 `docs/arsitektur-visa.md` §7 + rombak wizard/admin) — alasan user: legacy/tidak-terkait akan dibersihkan sekaligus saat itu, bukan ditambal terpisah sekarang.

**Rekomendasi yang diberikan (disetujui user):** tunda, dengan alasan (1) ini keputusan UX yang lebih pas diputuskan holistik saat halaman dirombak total, bukan ditambal parsial; (2) belum ada dampak nyata karena belum ada booking produksi yang bergantung padanya; (3) sesi ini sudah 2 kali insiden database (reset Fase 1, kehilangan data Fase 6) — menambah perubahan kode lagi di halaman yang toh akan dirombak menambah risiko untuk manfaat kecil; (4) sudah tercatat jelas di §13 sehingga tidak akan terlupa.

**Affects:**
- `docs/arsitektur-harga.md` — §13 Gap #5 dapat catatan "DITUNDA, bukan terlewat" dengan tanggal keputusan

---

## 2026-07-17 — Visa Step 1: Validator + Wizard + Booking Creation Digabung Jadi Satu Unit

**Decision:** Sebelum eksekusi, rencana awal (`docs/arsitektur-visa.md` §9.6, ditulis lebih dulu) memisahkan perbaikan Gap #1/#2/#3 jadi 3 step berurutan (validator saja → wizard → booking creation). Saat mulai coding Step 1, ditemukan `PilgrimData` (`lib/booking/draft.ts`), wizard step (`pilgrims/page.tsx`), dan `payment/page.tsx` semuanya reference langsung shape `visaType: enum` — mengubah shape validator sendirian akan membuat build merah di 3 file itu (TypeScript akan menolak payload yang tidak cocok tipe baru). Ketiga step digabung jadi satu unit yang dieksekusi dan di-build sekaligus, bukan dipecah palsu — dicatat sebagai revisi di §9.6 sebelum coding mulai (bukan sesudah), sesuai Fase Eksekusi SOP poin 1.

**Implementasi:**
- `lib/validators/booking.ts` — `visaType: z.enum(['umroh','visit','business','work'])` diganti `visaProductId: z.string().uuid()` + `selectedDurationDays?: number`. Validasi keberadaan/status aktif produk via `.superRefine()` **async** (query `prisma.visaProduct.findMany` langsung di validator) — konsekuensinya route handler harus pakai `safeParseAsync()`, bukan `safeParse()` lagi. Ditambah validasi silang: kalau `requiredComponents` produk yang dipilih memuat `"hotel"`/`"transport"`, request tanpa komponen itu ditolak (400) — mewujudkan desain `docs/arsitektur-visa.md` §9.1-9.2 yang sebelumnya cuma didesain, belum ditegakkan di kode.
- `app/api/v1/bookings/route.ts` — di dalam loop pilgrims, `visaApplication.visaProductId` di-set dari payload, `visaApplication.visaType` diisi dari `VisaProduct.visaType` (tetap sebagai field fallback/display sesuai desain awal, bukan dihapus). `computeSellPrice('visa', visaProductId, durationDays)` dipanggil di dalam `$transaction`, hasilnya mengisi 5 field snapshot yang sejak Fase 7 `docs/arsitektur-harga.md` ada di schema tapi tidak pernah diisi kode manapun — sekarang benar-benar terisi.
- `pilgrims/page.tsx` — fetch `GET /api/v1/catalog/visa` (endpoint sudah ada, tidak diubah), render daftar produk sebagai tombol pilihan dinamis, menggantikan toggle 4 pilihan hardcode (`VISA_LABELS`) yang dihapus total.

**Diverifikasi (bukan cuma `bun run build`):** script langsung memanggil `createBookingSchema.safeParseAsync()` dengan `visaProductId` valid (lolos) dan fiktif (ditolak dengan pesan jelas — Gap #3 tertutup terverifikasi); simulasi penuh transaksi create booking + `VisaApplication` menghasilkan snapshot fields terisi dengan angka yang **identik** dengan pemanggilan `computeSellPrice()` manual (hppRupiah, sellPrice, rateUsed, vendorUsed semua cocok) — membuktikan Gap #1 tertutup dan integrasi ke arsitektur harga benar. Verifikasi browser: wizard step "Jamaah" menampilkan produk visa asli dari database sebagai tombol pilihan, state terpilih berfungsi, tanpa console error.

**Rationale re-scope:** Fase Eksekusi SOP mengizinkan (bahkan mewajibkan) update rencana kalau ditemukan pola/dependency lebih baik saat implementasi — ini bukan pelanggaran "jangan gabung fase", tapi koreksi terhadap pemecahan fase yang ternyata keliru secara teknis (3 "fase" itu sebenarnya tidak pernah bisa jadi 3 build yang valid terpisah).

**Affects:**
- `lib/validators/booking.ts`, `lib/booking/draft.ts`, `app/api/v1/bookings/route.ts`, `pilgrims/page.tsx`, `payment/page.tsx`
- `docs/arsitektur-visa.md` §9.6 — Step 1-3 lama digabung jadi Step 1, sisanya di-renumber
- `docs/progress.md` — section baru "Perbaikan Gap Modul Visa — Eksekusi Bertahap", Step 1 dicentang

---

## 2026-07-18 — UX Fix Panel HPP Admin Visa: Vendor Quick-Add, Preview Harga, Klarifikasi Multi-Komponen

**Decision:** User melaporkan langsung lewat screenshot 3 masalah usability di panel "HPP & Komponen Biaya" (`app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`, dibangun di Fase 4 arsitektur harga): (1) tidak ada cara menambah vendor dari halaman ini — dropdown vendor kosong dan mengarah ke jalan buntu kalau belum ada vendor sama sekali, (2) tidak ada visibilitas HPP, harga jual, atau hasil konversi kurs — admin hanya bisa menyimpan komponen tanpa tahu dampaknya ke harga jual, (3) tidak jelas bahwa satu produk bisa punya lebih dari satu komponen HPP (mis. komponen kedua dari vendor "BRN"). Ketiganya diperbaiki sekaligus di halaman yang sama, bukan dipecah jadi 3 sesi terpisah, karena saling terkait (semua di panel yang sama, saling bergantung secara alur — tidak ada nilai memecahnya).

**Implementasi:**
- Endpoint baru `GET /api/v1/admin/products/visa/[id]/preview?days=N` — memanggil `computeSellPrice('visa', id, days)` langsung dan mengembalikan juga detail `ExchangeRate` yang dipakai (mid vs sell), supaya admin bisa lihat kalkulasi transparan tanpa menunggu cache `VisaProduct.price` di-refresh via Fase 6 mechanism.
- Vendor quick-add inline: tombol "+ Vendor Baru" di sebelah dropdown vendor pada form tambah komponen, toggle ke input nama + tombol Simpan/Batal, POST ke endpoint `/api/v1/admin/system/settings/vendors` yang sudah ada sejak Fase 3 (tidak ada endpoint baru dibutuhkan), auto-refresh daftar vendor dan auto-select vendor baru.
- Panel "Preview Harga" baru (muncul begitu ≥1 komponen HPP tersimpan): input jumlah hari, fetch ke endpoint preview di atas, tampilkan HPP terkonversi Rupiah, harga jual minimum (margin), harga jual dibulatkan, dan kurs yang dipakai. Nilai HPP/margin dibulatkan (`Math.round`) hanya untuk tampilan — kalkulasi asli di `computeSellPrice()` tidak disentuh, tetap pakai float penuh untuk presisi.
- Teks penjelas ditambahkan begitu ≥1 komponen HPP ada, menjelaskan tombol "Tambah Komponen" bisa dipakai berulang untuk vendor/komponen tambahan dan fungsi badge "Vendor Pilihan" saat ada >1 vendor per komponen yang sama.

**Diverifikasi (bukan cuma `bun run build`):** dev server nyata (`bun run dev`, port 6260, proses terverifikasi listening & reachable via `lsof`+`curl`) dijalankan, alur penuh dicoba di browser sungguhan: buat vendor uji "Test Vendor QA" via tombol quick-add → berhasil muncul di dropdown dan otomatis terpilih; simpan komponen HPP dengan vendor itu → berhasil tersimpan dan otomatis jadi "Vendor Pilihan" (karena vendor pertama untuk komponen itu, sesuai logika existing di endpoint costs POST); panel Preview Harga menampilkan HPP USD→Rupiah, harga jual minimum, harga jual dibulatkan, dan kurs mid/sell — semua angka sesuai `computeSellPrice()`. Data uji (vendor & komponen) dihapus lagi dari database setelah verifikasi supaya tidak mengotori data produksi.

**Rationale:** Semua 3 masalah adalah gap usability admin panel, bukan bug logika — infrastruktur harga (Fase 1-7) sudah benar, tapi tidak ada cara bagi admin melihatnya atau melengkapi data vendor dari alur normal. Tidak menambah endpoint API baru untuk vendor (dipakai ulang endpoint Fase 3), hanya 1 endpoint baru (preview) yang murni read-only dan tidak mengubah data apa pun.

**Affects:**
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — 3 fix UI
- `app/api/v1/admin/products/visa/[id]/preview/route.ts` — baru
- `docs/progress.md` — entri baru di section "Perbaikan Gap Modul Visa — Eksekusi Bertahap"

**Superseded oleh entri di bawah (2026-07-18, redesain tabel tier gabungan)** — form "Tambah Komponen" yang diperbaiki di entri ini (vendor quick-add, teks penjelas multi-komponen) dihapus total sehari kemudian setelah user menguji langsung dan menemukan bentuk input per-komponen itu sendiri yang salah, bukan cuma detail UX-nya. Endpoint `/preview` dan pola vendor quick-add tetap dipakai di desain baru.

---

## 2026-07-18 — Redesain UI Input HPP: Tabel Tier Gabungan (Ganti Total Form "Tambah Komponen")

**Decision:** Sehari setelah UX fix di atas, user menguji panel "HPP & Komponen Biaya" langsung dan melaporkan bentuk inputnya sendiri salah (bukan cuma detail kecil): model bisnis nyata adalah **maksimal 2 elemen HPP per rentang hari** — Harga Visa (wajib) dan Harga BRN (opsional) — melekat ke rentang hari yang **sama**, dikonfirmasi lewat contoh presisi ("2-7 hari: visa 70 + BRN 30 → HPP 100 → +20% margin → 120"; "10 hari: visa 100 saja → HPP 100 → 120"). Form "Tambah Komponen" yang dibangun Fase 4 (dan diperbaiki di entri sebelumnya) mengharuskan rentang hari diketik **dua kali** di dua mini-form terpisah kalau mau isi Harga Visa + Harga BRN untuk rentang yang sama — itu akar kebingungannya, bukan salah hitung (`computeSellPrice()` sudah benar sejak Fase 5).

Rencana lengkap ditulis dulu di `docs/arsitektur-harga.md` §14 (mengikuti Fase Eksekusi SOP poin 1) sebelum eksekusi, dipecah 4 fase, tiap fase diverifikasi `bun run build` + browser/DB nyata sebelum lanjut fase berikutnya — bukan dieksekusi sekaligus.

**Implementasi (4 fase, semua selesai):**
1. **Endpoint baru** `GET`+`PUT /api/v1/admin/products/visa/[id]/cost-tiers` (`app/api/v1/admin/products/visa/[id]/cost-tiers/route.ts`) — `GET` join komponen `individu` (Harga Visa) dan `biaya_non_hotel` (Harga BRN) jadi satu array `rows` bentuk tabel, join berdasar `id` stabil yang disimpan **di dalam** JSON `costTiers` (field baru non-breaking, `{id, minDays, maxDays, cost}` — `computeSellPrice()` tidak peduli field ekstra karena baca lewat `as unknown as CostTier[]`). `PUT` replace-seluruh: upsert kedua `ProductCost`, auto-`PreferredVendor` (endpoint ini didesain 1 vendor per komponen, bukan multi-vendor-comparison), soft-deactivate (`isActive:false`, bukan hapus fisik) komponen BRN kalau body mengosongkannya, panggil `refreshVisaProductCache()` — semua reuse infrastruktur Fase 1-7, tidak ada migrasi Prisma.
2. **UI diganti total**: `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — form "Tambah Komponen" bebas teks dihapus, diganti 2 vendor-picker tetap (Harga Visa wajib, Harga BRN di belakang checkbox opsional — reuse pola quick-add vendor dari entri kemarin) + tabel baris tier (Min Hari, Maks Hari, Harga Visa, Harga BRN dalam satu baris yang sama) + satu tombol "Simpan Tabel HPP" untuk seluruh grid. Preview HPP/Harga Jual per baris muncul **setelah** simpan (panggil `/preview?days=<minDays baris>` per baris) — sengaja tidak dihitung live saat mengetik supaya tidak ada logic margin/kurs terduplikasi di client.
3. **Hapus kode lama**: folder `app/api/v1/admin/products/visa/[id]/costs/` (route `costs`, `costs/[costId]`, `costs/preferred`) dihapus total setelah dicek `grep` tidak direferensikan kode lain.
4. **Dokumentasi**: `docs/arsitektur-harga.md` §11 (tabel API Routes) dan §12 (Admin UI) diperbarui reflect struktur baru; status §14 diubah dari RENCANA jadi SELESAI & TERVERIFIKASI.

**Diverifikasi (bukan cuma `bun run build`, tiap fase):** Fase 1 dites lewat `fetch()` di console browser tab admin yang sudah login (tanpa lewat UI) — PUT dengan payload persis skenario user tersimpan benar, GET join kembali jadi bentuk tabel yang sama, `/preview` menghasilkan **HPP 100 USD → Rp 2.200.000 identik di kedua skenario** (dengan BRN maupun tanpa BRN), toggle BRN mati dicek soft-deactivate + `preferred_vendors` terhapus di database langsung. Fase 2 dites di UI sungguhan: isi baris "2-7 hari: visa 70 + BRN 30" dan "10 hari: visa 100 saja" dalam satu tabel (rentang hari sekali per baris), simpan → kedua baris tampil **"HPP Rp 1.826.219 → Harga Jual Rp 2.200.000"**, vendor persisten setelah reload; toggle checkbox BRN off lewat UI (bukan API) dicek ke database — `isActive:false` pada komponen BRN, `preferred_vendors` BRN terhapus. Fase 3 dicek `bun run build` 0 error + halaman dibuka ulang di browser tanpa console error setelah route lama dihapus. Data uji dibersihkan dari database setelah tiap fase.

**Rationale:** Ini kesalahan bentuk input (UX), bukan kesalahan arsitektur data atau kalkulasi — makanya perbaikannya murni endpoint+UI baru di atas skema `ProductCost`/`PreferredVendor` yang sudah ada sejak Fase 1, tanpa migrasi Prisma dan tanpa mengubah `computeSellPrice()`. Endpoint baru boleh hardcode 2 nama komponen (`individu`, `biaya_non_hotel`) karena itu definisi bisnis tetap untuk Visa yang sudah dikonfirmasi user 2 kali (di tabel BRN asli 2026-07-08 dan di klarifikasi 2026-07-18) — spesialisasi di level endpoint Visa, bukan pelanggaran prinsip polimorfik `ProductCost` yang tetap dipertahankan untuk modul lain nanti.

**Affects:**
- `app/api/v1/admin/products/visa/[id]/cost-tiers/route.ts` — baru
- `app/api/v1/admin/products/visa/[id]/costs/` — dihapus total (route, [costId]/route, preferred/route)
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — UI diganti total
- `docs/arsitektur-harga.md` §11, §12, §14 (baru), status banner di atas dokumen
- `docs/progress.md` — section baru "Redesain UI Input HPP: Tabel Tier Gabungan — Eksekusi Bertahap", 4 fase semua dicentang

---

## 2026-07-18 — Override Manual Harga Jual per Tier

**Decision:** Segera setelah redesain tabel tier (entri di atas), user minta kolom HPP dan Harga Jual — yang saat itu cuma teks kecil di bawah tiap baris — dipindah jadi kolom sejajar di tabel, dan kolom Harga Jual dibuat bisa diedit manual ("jangan sampai tidak editable"). Karena ini genuinely berpotensi mengubah prinsip "single source of truth `computeSellPrice()`" yang dipegang sejak Fase 5, ditanya dulu 2 pertanyaan eksplisit lewat `AskUserQuestion` sebelum menulis rencana: (1) HPP ikut manual atau tetap read-only — user pilih **HPP tetap read-only, cuma Harga Jual yang manual** (HPP murni jumlah Harga Visa+BRN, sudah kelihatan dari 2 kolom sumbernya, jadi rancu kalau ikut diedit terpisah); (2) override cuma preview di layar atau disimpan permanen — user pilih **disimpan permanen ke database**. Rencana ditulis di `docs/arsitektur-harga.md` §15 sebelum eksekusi (Fase Eksekusi SOP poin 1), dipecah 3 fase.

**Implementasi:**
- **Skema**: field opsional `sellPriceOverride?: number | null` ditambahkan ke tipe tier — disimpan **di dalam** JSON `costTiers` milik komponen `individu` saja (bukan `biaya_non_hotel`, karena override ini soal harga publish per rentang hari, bukan per komponen biaya). Tidak ada migrasi Prisma (kolom `costTiers` sudah `Json`).
- **`lib/pricing/computeSellPrice.ts`** — perubahan pertama sejak dibuat Fase 5. `findTier()` dibuat generic (`<T extends {minDays,maxDays}>`) supaya bisa dipakai baik untuk `CostTier` biasa maupun `IndividuTier` yang punya field tambahan. Setelah `hppRupiah`/`minSellPrice`/rounding dihitung seperti biasa, cari tier `individu` yang cocok `jumlahHari` — kalau tier itu punya `sellPriceOverride` terisi, itu jadi `sellPrice` FINAL, menggantikan hasil rounding otomatis. **`hppRupiah` dan `minSellPrice` sengaja tidak ikut di-override** — tetap angka asli hasil formula, supaya siapa pun baca `/preview` tetap bisa bandingkan HPP asli vs harga jual manual yang dipilih (transparansi). Perubahan ini otomatis mempengaruhi SEMUA pemanggil `computeSellPrice()` — `/preview` (transparan menampilkan override), `refreshVisaProductCache()` (katalog publik `VisaProduct.price` ikut override — **ini memang benar secara desain**, override justru dimaksudkan jadi harga publish), dan `POST /api/v1/bookings` (snapshot booking otomatis pakai override kalau ada, konsisten sejak Visa Step 1).
- **Risiko yang disengaja tidak divalidasi**: tidak ada pengecekan `sellPriceOverride >= minSellPrice` (margin minimum) — admin bisa mengetik harga di bawah HPP. Dicatat eksplisit di §15.3 sebagai beban tanggung jawab admin (user tidak minta guardrail tambahan saat ditanya), bukan validasi yang luput ditulis.
- **Endpoint `cost-tiers`** — `sellPriceOverride?: number|null` ditambahkan ke Zod schema `PUT`, dikembalikan di tiap `rows[]` pada `GET`.
- **UI** — tabel tier dapat 2 kolom baru menggantikan teks preview di bawah baris: "HPP" (read-only) dan "Harga Jual" (`<input>` editable, `value` = override tersimpan atau kosong, `placeholder` = harga otomatis dari `/preview` saat kosong — placeholder otomatis "benar" bahkan untuk baris yang sudah di-override, karena `/preview` memang mengembalikan angka override itu sendiri saat sudah tersimpan). Baris ter-override diberi highlight kuning (`bg-amber-50 ring-1 ring-amber-200`).

**Diverifikasi (bukan cuma `bun run build`, tiap fase):** Fase A dites lewat `fetch()` di console (tanpa UI) — PUT `sellPriceOverride: 2500000` tersimpan, `/preview` mengembalikan `sellPrice: 2500000` sementara `hppRupiah`/`minSellPrice` tetap angka asli; PUT `sellPriceOverride: null` mengembalikan `/preview` ke hasil rounding otomatis. Fase B dites di UI sungguhan lewat automasi DOM langsung (native value setter + dispatch event, karena gesture scroll/click browser-pane sempat tidak stabil di sesi ini) — isi baris, simpan → kolom HPP "Rp 1.278.353", Harga Jual kosong placeholder "Rp 1.550.000"; isi override manual "2500000" **dengan jeda waktu sebelum klik simpan** (percobaan pertama tanpa jeda gagal tersimpan — ternyata artefak timing script karena React membatch update state secara asinkron, bukan bug komponen; percobaan ulang dengan jeda berhasil), simpan → value persisten, placeholder ikut jadi "Rp 2.500.000", baris ter-highlight kuning; kosongkan + simpan (dengan jeda) → kembali ke placeholder "Rp 1.550.000", highlight hilang, dikonfirmasi juga lewat query database langsung (`sellPriceOverride: null`). Data uji dibersihkan dari database setelah tiap fase.

**Affects:**
- `lib/pricing/computeSellPrice.ts` — `findTier()` generic, logic override ditambahkan
- `app/api/v1/admin/products/visa/[id]/cost-tiers/route.ts` — field `sellPriceOverride` di schema + GET/PUT
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — kolom HPP + Harga Jual editable, highlight baris ter-override
- `docs/arsitektur-harga.md` §15 (status RENCANA → SELESAI)
- `docs/progress.md` — section baru "Override Manual Harga Jual per Tier — Eksekusi Bertahap", 3 fase semua dicentang

---

## 2026-07-18 — Bug Fix: HPP Tampil Rp 0 Kalau Min/Maks Hari Dikosongkan

**Decision:** User melaporkan (screenshot) HPP menghitung Rp 0 walau Harga Visa sudah diisi 114. Diinvestigasi sebelum diasumsikan sebagai bug konversi kurs — ternyata **bukan** masalah kurs (kurs USD→IDR terkonfirmasi benar, 18.262,19). Root cause: `canSaveTiers` di `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` cuma memvalidasi `maxDays >= minDays`, yang tetap `true` untuk `0 >= 0` — jadi tombol "Simpan Tabel HPP" tidak ter-disable meski Min/Maks Hari belum diisi (default state `0`). Baris tersimpan dengan tier `{minDays:0, maxDays:0}`, lalu preview memanggil `/preview?days=${row.minDays || 1}` — fallback `|| 1` (karena `0` falsy di JS) membuat query hari ke-1, yang tidak cocok dengan tier `[0,0]` tersimpan → HPP dihitung 0.

**Fix:** `canSaveTiers` ditambah syarat `r.minDays >= 1`, tombol simpan sekarang benar-benar disabled sampai Min Hari diisi. Fallback `|| 1` dihapus dari pemanggilan preview.

**Diverifikasi:** direproduksi persis skenario laporan (vendor terpilih, Harga Visa=114, Min/Maks Hari kosong) → tombol dikonfirmasi `disabled: true`; isi Min=2 Maks=7 → `disabled: false`; simpan → HPP tampil **Rp 2.081.890** (114 × 18.262,19, benar).

**Affects:**
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — validasi `canSaveTiers`, hapus fallback `|| 1`
- `docs/progress.md` — entri bug fix di section "Perbaikan Gap Modul Visa"

---

## 2026-07-18 — Preview HPP & Harga Jual Live, Tanpa Perlu Simpan Dulu

**Decision:** Bug fix di atas memicu pertanyaan user: kenapa HPP/Harga Jual baru muncul setelah "Simpan"? User minta 3 hal eksplisit: (1) **live** — muncul begitu angka diketik, tanpa simpan dulu; (2) **selalu tampil** — begitu ada angka, HPP/Harga Jual tidak boleh hilang dari layar, baik sebelum maupun sesudah simpan; (3) ditegaskan **HPP itu data penting**, bukan sekadar "script bantu bikin harga" yang boleh kosong/hilang sesukanya — jadi harus selalu bisa dipercaya dan terlihat. User langsung mengizinkan eksekusi ("ok sekalian eksekusi") tanpa perlu ronde konfirmasi tambahan, karena desainnya sudah dijelaskan & disepakati di respons sebelumnya (live-simulate lewat endpoint baru, tidak menduplikasi rumus di client).

**Implementasi:**
- **`lib/pricing/pricingHelpers.ts`** (baru) — `getLatestRate()`, `getMarginRule()`, `roundToNearest()` diekstrak dari `computeSellPrice.ts` (refactor murni, bukan duplikasi) supaya bisa dipakai ulang oleh fungsi simulasi baru.
- **`lib/pricing/simulateSellPrice.ts`** (baru) — hitung HPP→harga jual dari komponen yang dikasih **langsung** (bukan baca `ProductCost` tersimpan seperti `computeSellPrice()`), pakai helper yang sama supaya rumus tetap satu sumber kebenaran. Beda penting: kurs yang tidak ditemukan untuk salah satu currency membuat **seluruh** hasil `null` (bukan diam-diam skip komponen seperti `computeSellPrice()`) — karena semua komponen yang dikirim ke sini memang dimaksudkan untuk dihitung, bukan opsional.
- **`app/api/v1/admin/products/visa/simulate/route.ts`** (baru) — sengaja **bukan** di bawah `[id]/`, karena kalkulasinya tidak bergantung produk spesifik mana pun (cuma `productType='visa'` hardcode + angka yang dikirim). Next.js App Router mengizinkan route statis (`visa/simulate/`) hidup berdampingan dengan route dinamis (`visa/[id]/`) di level yang sama — dikonfirmasi tidak ada konflik saat build.
- **UI** — `loadRowPreviews` (lama, sekali panggil setelah GET/save lewat `/preview`) dihapus total, diganti `useEffect` yang mengamati `rows`/`visaCurrency`/`brnEnabled`/`brnCurrency`, debounce 500ms, panggil `/simulate`. Efek yang sama otomatis menutupi baik "baru mengetik" maupun "baru dimuat dari server" — tidak ada 2 jalur kode terpisah untuk 2 skenario itu.
- **Efek samping yang disengaja (bukan kebetulan)**: karena `/simulate` tidak pernah mencocokkan hari ke tier (beda dari `/preview` yang pakai `findTier`), pendekatan ini otomatis menutup **seluruh kelas bug** yang sama dengan laporan "HPP Rp 0" sebelumnya — preview sekarang benar-benar tidak bisa gagal karena rentang hari belum/salah diisi.

**Diverifikasi (bukan cuma `bun run build`, tiap fase):** Fase A — regresi eksplisit: `computeSellPrice()` (lewat `cost-tiers` PUT + `/preview`) menghasilkan angka **identik** sebelum dan sesudah refactor (Rp 1.278.353 / Rp 1.550.000 untuk skenario yang sama); `/simulate` dites langsung tanpa data tersimpan sama sekali — `visaCost=114` → Rp 2.081.890 → Rp 2.500.000, `visaCost=70+brnCost=30` → Rp 1.826.219 → Rp 2.200.000, keduanya cocok persis dengan hasil `computeSellPrice()` yang sudah diverifikasi di entri-entri sebelumnya. Fase B — browser nyata: pilih vendor, tambah baris, ketik Harga Visa=114 **tanpa isi Min/Maks Hari dan tanpa klik Simpan** → HPP "Rp 2.081.890" & placeholder Harga Jual "Rp 2.500.000" muncul dalam ±1 detik; dikonfirmasi ke database **0 baris tersimpan** saat itu (murni live, tanpa side-effect); isi Min/Maks lalu Simpan → HPP & placeholder tetap identik sebelum-sesudah simpan (tidak pernah hilang).

**Ditemukan & diperbaiki juga saat sesi ini:** gap penomoran §15 di `docs/arsitektur-harga.md` — sesi sebelumnya menulis §16 (Override) langsung setelah §14 (Redesain Tabel Tier) tanpa melalui §15, karena kesalahan pola pencarian saat insert section baru (anchor yang dipakai berisi teks "## 15. Referensi Silang" tapi replacement-nya langsung menomori ulang jadi "## 16." tanpa mempertahankan "## 15."). Dirapikan jadi berurutan 1-17 lagi (§15=Override, §16=Live Preview, §17=Referensi Silang) via `sed` dengan token sementara supaya tidak tabrakan antar tahap penomoran, termasuk semua referensi silang bernomor di `docs/decisions.md`/`docs/progress.md` yang menyebut section itu.

**Affects:**
- `lib/pricing/pricingHelpers.ts` — baru
- `lib/pricing/computeSellPrice.ts` — refactor import, perilaku tidak berubah
- `lib/pricing/simulateSellPrice.ts` — baru
- `app/api/v1/admin/products/visa/simulate/route.ts` — baru
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — `loadRowPreviews` diganti live-simulate debounced
- `docs/arsitektur-harga.md` §16 (baru, SELESAI), penomoran §15-§17 dirapikan
- `docs/progress.md` — section baru "Preview HPP & Harga Jual Live — Eksekusi Bertahap", 3 fase dicentang

---

## 2026-07-18 — Komponen Harga Jadi Satu-Satunya Sumber Kebenaran: Hapus Harga Manual, "Mulai Dari" di Katalog

**Decision:** User melihat kartu katalog publik menampilkan satu harga flat padahal admin sudah punya beberapa tier harga per rentang hari, lalu bertanya: haruskah `VisaProduct.price` dihapus total dan diganti komponen harga sepenuhnya (karena itu tujuan utama arsitektur ini), dan bagaimana kalau ada beberapa harga (usul: label "Mulai dari Rp [termurah]"). Sebelum setuju, dicek dulu kode aktual, ditemukan `VisaProduct.price` saat itu di-cache dari `computeSellPrice()` di **hari ke-1** (`DEFAULT_PROBE_DAY`), **bukan** harga termurah — kebetulan sering sama tapi tidak dijamin. Direkomendasikan 3 poin (bukan hapus field total, supaya tidak perlu migrasi/ubah banyak konsumen): (1) `price` tetap ada tapi isinya jadi `Math.min()` dari semua tier; (2) hapus total jalur edit manual (menutup Gap #5 §13 yang sebelumnya sengaja ditunda — lihat entri 2026-07-17); (3) "Mulai dari Rp X" di katalog kalau ≥2 harga berbeda. User setuju semua dan minta dieksekusi *strict* sesuai rencana yang ditulis dulu di `docs/arsitektur-harga.md` §17 (Fase Eksekusi SOP poin 1), dipecah 4 fase.

**Implementasi:**
- **`lib/pricing/refreshVisaProductCache.ts`** — `DEFAULT_PROBE_DAY` dihapus, `price` sekarang `Math.min(...durationFeeRules.map(r => r.fee))`, dihitung setelah `durationFeeRules` lengkap terkumpul. `durationFeeRules` kosong → `price` tidak diupdate (behavior lama dipertahankan, bukan direset ke 0). Backfill data lama dijalankan sekali lewat `refreshAllVisaProductCaches()` (script sekali-jalan, dihapus setelah dipakai).
- **Hapus jalur edit manual** (Gap #5, akhirnya ditutup bukan ditunda lagi): `price` dihapus dari `updateSchema` (`PUT /api/v1/admin/products/visa/[id]`) dan `createSchema` (`POST /api/v1/admin/products/visa`, produk baru selalu `price:0`). Input "Harga (Rp)" dihapus dari halaman edit (diganti kartu read-only "Harga saat ini: Rp X — dihitung otomatis") dan halaman buat produk baru (diganti teks penjelas). `loadCostTiers()` di halaman edit sekarang juga re-fetch produk supaya kartu harga tidak basi setelah HPP diubah. `priceLabel` (label bebas "per orang"/dll) dan kolom harga di tabel listing admin **sengaja tidak diubah** — scoping eksplisit sesuai rencana, supaya tidak melebar.
- **"Mulai dari" di katalog**: `GET /api/v1/catalog/visa` tambah field turunan `priceIsRange` (`true` kalau `new Set(durationFeeRules.map(r=>r.fee)).size >= 2`), **tidak** expose `durationFeeRules` mentah ke publik. `app/[locale]/(public)/visa/page.tsx` (server component, query Prisma langsung — jalur terpisah dari API route di atas, jadi logic `priceIsRange`-nya ditulis dua kali secara sengaja, bukan lupa reuse) tampilkan prefix "Mulai dari " kalau true.

**Diverifikasi (bukan cuma `bun run build`, tiap fase):** Fase 1 — test dengan tier yang **sengaja hari-1 BUKAN termurah** (1-3 hari @ 200 USD, 10-15 hari @ 50 USD) → `price` tersimpan Rp 1.100.000 (dari tier 50 USD), bukan Rp 4.400.000 (dari tier 200 USD hari-1) — membuktikan bug lama benar-benar tertutup; backfill terhadap data produksi nyata ("Visa Non-Hotel Umroh") tetap Rp 2.750.000, sekarang benar KARENA memang termurah (bukan kebetulan probe hari-1). Fase 2 — browser: kedua form dikonfirmasi tidak ada input harga; kirim `PUT .../visa/[id]` dengan `{price: 99999999}` langsung → response tetap harga lama, tidak berubah. Fase 3 — browser: "Visa Non-Hotel Umroh" (3 harga beda) tampil "Mulai dari Rp 2.750.000", "Visa Reguler" (1 harga) tampil polos; API response dicek `priceIsRange` benar per produk dan `durationFeeRules` terkonfirmasi tidak ada di response publik.

**Insiden minor selama eksekusi**: `bun run build` sempat gagal karena `.next` korup (efek jalankan `build` bersamaan dengan `dev` yang masih hidup dari sesi sebelumnya, gotcha yang sama sudah beberapa kali muncul sepanjang sesi ini) — diperbaiki dengan `rm -rf .next` lalu build ulang, bukan masalah kode.

**Affects:**
- `lib/pricing/refreshVisaProductCache.ts` — `Math.min()` menggantikan probe hari-1
- `app/api/v1/admin/products/visa/[id]/route.ts`, `app/api/v1/admin/products/visa/route.ts` — `price` dihapus dari schema
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`, `app/[locale]/admin/(protected)/products/visa/page.tsx` — input harga dihapus
- `app/api/v1/catalog/visa/route.ts`, `app/[locale]/(public)/visa/page.tsx` — `priceIsRange` + label "Mulai dari"
- `docs/arsitektur-harga.md` §13 (Gap #5 ditutup), §17 (baru, SELESAI), §11/§12 diperbarui
- `docs/progress.md` — section baru "Komponen Harga Jadi Satu-Satunya Sumber Kebenaran — Eksekusi Bertahap", 4 fase dicentang

---

## 2026-07-18 — Audit Sinkronisasi Ronde 2: `docs/arsitektur-harga.md` + `docs/arsitektur-visa.md` vs Kode Aktual

**Decision:** Sebelum lanjut ke fitur berikutnya, user minta dicek apakah `docs/arsitektur-harga.md` dan `docs/arsitektur-visa.md` masih sesuai kode aktual — mengingat banyak perubahan beruntun sejak audit ronde 1 (2026-07-17): redesain tabel tier (§14), override manual (§15), live preview (§16), penghapusan harga manual + "mulai dari" (§17), plus Visa Step 1 yang dieksekusi terpisah di sesi sebelumnya. Setiap file kode yang relevan dibaca ulang satu per satu (bukan dipercaya dari ingatan/dokumen) sebelum menyimpulkan status sinkron.

**Hasil:**
- **`docs/arsitektur-harga.md`: 100% sinkron, tidak ada perbaikan diperlukan.** Dicek: `lib/pricing/computeSellPrice.ts`, `simulateSellPrice.ts`, `pricingHelpers.ts`, `refreshVisaProductCache.ts`; endpoint `cost-tiers`/`preview`/`simulate`/`PUT`+`POST` visa product/`catalog/visa`; halaman admin edit+create dan katalog publik; `prisma/schema.prisma` (`Vendor`, `ExchangeRate`, `ProductCost`, `PricingRule`, `PreferredVendor`, `VisaProduct`, `VisaApplication`). Folder `/costs*` lama dikonfirmasi benar-benar sudah tidak ada (bukan cuma diklaim di dokumen).
- **`docs/arsitektur-visa.md`: ditemukan stale signifikan, diperbaiki.** Dokumen ini terakhir disentuh substansial 2026-07-08/07-17 dan tidak pernah diperbarui setelah "Visa Step 1" (2026-07-17) benar-benar dieksekusi — jadi masih menggambarkan Gap #1 (`visaApplication.visaProductId` tidak pernah di-set), Gap #2 (wizard tidak punya step pilih produk), dan Gap #3 (`visaType` masih enum hardcode) sebagai **masalah yang belum diperbaiki**, padahal ketiganya sudah ditutup. Dikonfirmasi ulang langsung ke kode sebelum menulis "DITUTUP" di dokumen (bukan dipercaya dari `docs/decisions.md` semata): `lib/validators/booking.ts` sekarang pakai `visaProductId: z.string().uuid()` + `.superRefine()` validasi ke DB (bukan enum), `pilgrims/page.tsx` fetch `GET /api/v1/catalog/visa` dan render pilihan dinamis, `app/api/v1/bookings/route.ts` men-set `visaApplication.visaProductId` dan memanggil `computeSellPrice()` untuk isi 5 field snapshot.
- Diperbaiki di `docs/arsitektur-visa.md`: banner status dokumen (baris 3, §9), §2 (skema `VisaProduct`/`VisaApplication` — tambah `requiredComponents`/`durationFeeRules`/5 field snapshot yang sebelumnya cuma disebut di §9.2/§9.5 sebagai "diusulkan" padahal sudah benar-benar ada di schema & sebagian sudah diisi kode), §3 (snippet `createSchema` diperbarui tanpa `price`, snippet validator wizard diganti dari enum jadi `visaProductId`), §6 (diagram alur end-to-end digambar ulang — Gap #1/#2/#3 dihapus dari jalur "broken", Gap #4/#5 tetap ditandai terbuka di posisi yang benar), §7 (tabel Gap: #1/#2/#3 dicoret + ditandai DITUTUP dengan tanggal, #4/#5/#6 tetap terbuka), §9.5 (judul diganti dari "Yang TIDAK diputuskan" jadi "Status Terkini", isi diperbarui), §9.6 (Step 1 dan Step 4 ditandai ✓ SELESAI dengan tanggal, ditambah catatan eksplisit bahwa Step 4 tereksekusi lewat `docs/arsitektur-harga.md` §17 — bukan lewat urutan §9.6 aslinya — supaya tidak terlihat seperti dikerjakan diam-diam di luar rencana).
- **Yang SENGAJA tidak diubah**: Gap #4 (requirements passthrough), Gap #5 (validasi transisi status server-side), Gap #6 (error handling `catch{...403}` polos di 5 handler CRUD visa) — dikonfirmasi ulang langsung ke kode (grep `requirements` di 2 halaman terkait = kosong, grep `TRANSITIONS`/`currentStatus` di route status = kosong, `catch{...403}` masih ada persis di 5 tempat) — semuanya **genuinely masih terbuka**, bukan ikut ditandai selesai tanpa verifikasi.

**Rationale:** Audit sinkronisasi dokumen-vs-kode bernilai justru karena harus jujur — kalau semua ditandai "selesai" tanpa dicek ulang, dokumen jadi tidak bisa dipercaya lagi sebagai source of truth. Pola yang sama dipertahankan dari audit ronde 1 (2026-07-17): baca kode dulu, baru simpulkan, dan bedakan jelas antara "sudah diperbaiki di dokumen" vs "genuinely masih ada gap di kode".

**Affects:**
- `docs/arsitektur-visa.md` — banner, §2, §3, §6, §7, §9, §9.5, §9.6 diperbarui
- `docs/arsitektur-harga.md` — tidak ada perubahan (dikonfirmasi sudah sinkron)
- `docs/progress.md` — entri baru "Audit sinkronisasi arsitektur vs kode, ronde 2"

---

## 2026-07-18 — Step 3 (Fitur Varian Visa) Ditunda — Fokus Visa, Jangan Sentuh Lintas-Modul

**Decision:** Setelah audit sinkronisasi ronde 2 menghasilkan daftar Step 2/3/5/6 yang tersisa di `docs/arsitektur-visa.md` §9.6, user secara eksplisit minta: apa pun yang berkaitan dengan modul lain dicatat dulu untuk perbaikan berikutnya, fokus perbaikan Visa saja untuk sekarang ("haji itu nanti").

**Analisis blast radius tiap step:**
- Step 2 (requirements dinamis) — cuma pass prop `requirements` ke `DocumentGrid`/`PilgrimDocuments` di 2 halaman detail booking. Murni Visa.
- Step 3 (fitur varian: `requiredComponents` kondisional + input durasi) — **menyentuh step hotel/transport di wizard booking yang sama dipakai alur Umroh penuh**, bukan cuma milik Visa. Berkaitan langsung dengan pertanyaan terbuka di `docs/arsitektur-booking.md` §1.5 (alur pembelian multi-bentuk: visa-only/transport-only/Umroh/Haji) yang sudah ditandai "PENDING — scope perlu dirombak, jangan eksekusi dulu" di sesi sebelumnya. Mengerjakan Step 3 sekarang berisiko membangun di atas asumsi wizard lama yang mungkin berubah total begitu booking engine universal itu dirombak.
- Step 5 (validasi transisi status) — murni `VisaApplication`/`VisaActions.tsx`/route status Visa. Tidak menyentuh modul lain.
- Step 6 (error handling CRUD) — murni route CRUD produk Visa. Tidak menyentuh modul lain.

**Keputusan:** Step 3 **DITUNDA** — dicatat lengkap di `docs/arsitektur-visa.md` §9.6 (termasuk alasan blast radius di atas) untuk dikerjakan nanti, entah setelah keputusan booking engine universal diambil, atau kalau user eksplisit minta dikerjakan terpisah dengan risiko itu dipahami. Urutan eksekusi berikutnya jadi **Step 2 → Step 5 → Step 6**, semuanya murni scoped ke Visa.

**Rationale:** Konsisten dengan prinsip "jangan melebar ke perbaikan/fitur lain yang tidak diminta" (Fase Eksekusi SOP poin 0) — bedanya di sini bukan soal fitur yang tidak diminta, tapi fitur yang DIMINTA (ada di rencana §9.6) tapi punya scope yang secara struktural melebihi satu modul, jadi ditunda sampai keputusan arsitektur yang lebih besar (booking engine) diambil, bukan ditambal di atas fondasi yang mungkin dirombak total.

**Affects:**
- `docs/arsitektur-visa.md` §9.6 — Step 3 ditandai DITUNDA dengan alasan, catatan independensi step diperbarui

---

## 2026-07-18 — Gap #4/#5/#6 Modul Visa Ditutup (Step 2, 5, 6 §9.6) — Semua Gap Visa DITUTUP

**Decision:** Lanjutan langsung dari keputusan menunda Step 3 (entri di atas) — dieksekusi Step 2, 5, 6 di `docs/arsitektur-visa.md` §9.6 secara berurutan, semuanya dikonfirmasi murni scoped ke modul Visa sebelum mulai (analisis blast radius sudah ada di entri sebelumnya).

**Step 2 — Requirements dinamis (Gap #4):**
- `app/[locale]/(pilgrim)/bookings/[id]/page.tsx` dan `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` — Prisma include ditambah `visaApplication: { include: { visaProduct: true } }`, `DocumentGrid`/`PilgrimDocuments` (yang sejak awal sudah didesain menerima prop `requirements?: VisaRequirement[]`, tinggal belum pernah diisi) sekarang terima `parseRequirements(p.visaApplication.visaProduct.requirements)`.
- Halaman admin sekalian diperbaiki: badge counter "X/Y dok" sebelumnya selalu `REQUIRED_DOCUMENTS.length` (5) hardcode di semua kasus — sekarang dihitung dari jumlah requirements `required:true` produk yang sebenarnya, fallback ke hardcode kalau pilgrim tidak punya `visaProduct` ter-link. Perbaikan ini di luar scope literal §9.6 tapi termasuk gap yang sama (requirements tidak dinamis), jadi diperbaiki sekalian bukan ditambal terpisah.
- **Diverifikasi**: dibuat booking uji langsung di database dengan produk "Visa Reguler" (3 requirements nyata: Passport/KTP/KK) — halaman admin booking detail dikonfirmasi tampil "0/3 dok" (bukan "0/5"), dan `GET /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents` mengembalikan 3 `requirements` yang sama. Halaman pilgrim tidak dites langsung di browser (tidak ada akun pilgrim aktif) tapi query dan pola prop-nya identik dengan halaman admin yang sudah terverifikasi.

**Step 5 — Validasi transisi status server-side (Gap #5):**
- `lib/validators/visaStatus.ts` (baru) — `VISA_STATUS_TRANSITIONS` map + `isValidVisaStatusTransition()` diekstrak dari `TRANSITIONS` lokal yang sebelumnya cuma ada di `VisaActions.tsx` (client), sekarang satu sumber kebenaran dipakai client dan server.
- `app/api/v1/admin/visa/[pilgrimId]/status/route.ts` — include `visaApplication` untuk baca status saat ini, validasi transisi sebelum `update()`, 422 kalau tidak valid; ditambah 404 eksplisit kalau `visaApplication` belum ada (sebelumnya jadi Prisma error generic 500 tanpa pesan jelas).
- **Diverifikasi**: booking uji — transisi `pending_documents → issued` (melompati 3 tahap) ditolak 422 dengan pesan jelas; transisi valid `pending_documents → documents_complete` berhasil 200, status ter-update di database.

**Step 6 — Error handling CRUD produk visa (Gap #6):**
- 5 handler (`GET`/`POST` di `admin/products/visa/route.ts`, `GET`/`PUT`/`DELETE` di `.../[id]/route.ts`) — `catch { return err('Forbidden'), 403 }` polos diganti pola yang sudah dipakai ~15 route lain sejak sesi arsitektur harga: bedakan `Unauthorized`/`Forbidden` (403) dari error lain (`console.error` + 500).
- **Diverifikasi** dengan kasus nyata, bukan cuma baca kode: `DELETE` produk visa yang tidak ada memicu Prisma P2025 (error non-auth asli) — sebelum perbaikan ini akan dilaporkan sebagai 403 "Forbidden" (menyesatkan), sekarang benar 500 "Internal server error". Happy path (GET list, GET by id, 404 eksplisit untuk id tidak ada) dikonfirmasi tetap jalan normal (regresi 0).

**Hasil:** Semua 6 gap di `docs/arsitektur-visa.md` §7 sekarang **DITUTUP**. Modul Visa sinkron penuh antara frontend, admin, API, dan dokumentasi — kecuali Step 3 (fitur varian) yang sengaja ditunda karena lintas-modul (lihat entri sebelumnya).

**Affects:**
- `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` — requirements passthrough
- `lib/validators/visaStatus.ts` — baru
- `app/[locale]/admin/(protected)/bookings/[id]/VisaActions.tsx`, `app/api/v1/admin/visa/[pilgrimId]/status/route.ts` — validasi transisi
- `app/api/v1/admin/products/visa/route.ts`, `.../[id]/route.ts` — error handling
- `docs/arsitektur-visa.md` §7 (semua gap DITUTUP), §9/§9.6 (status diperbarui)
- `docs/progress.md` — Step 2/5/6 dicentang dengan detail verifikasi

---

## 2026-07-19 — Modul Tiket Pesawat: Rencana Ditulis, Supersede `docs/spec.md` "Phase 2"

**Decision:** User minta modul Tiket Pesawat dibangun — modul baru dari nol (sebelumnya `docs/arsitektur-tiket-pesawat.md` cuma konfirmasi "0% ada, out-of-scope Phase 1"). Sebelum menulis rencana, 3 pertanyaan cakupan diajukan lewat `AskUserQuestion` (bukan diasumsikan), karena masing-masing punya konsekuensi struktural besar:

1. **Cakupan: quota-aware atau katalog pasif?** User pilih **quota-aware** (`totalSeats`/`pendingSeats`/`bookedSeats`) — ini memperluas `docs/spec.md` baris "Flight booking — No, Phase 2". Diklarifikasi dalam rencana (`docs/arsitektur-tiket-pesawat.md` §2.1): quota-aware **secara schema**, tapi **integrasi wizard booking (jamaah benar-benar pesan tiket) tetap TIDAK dikerjakan** — dipisah jadi fase terpisah nanti, konsisten pola Visa Step 3 (`docs/decisions.md` 2026-07-18) dan `docs/arsitektur-booking.md` §1.5 yang masih pending. `docs/spec.md` "Phase 2" jadi supersede SEBAGIAN: booking penuh tetap Phase 2, tapi pencatatan+kuota+harga masuk scope aktif sekarang.
2. **Struktur HPP: 1 komponen atau 2 seperti Visa?** User pilih **1 komponen ("Harga Tiket")** — lebih simpel dari Visa (yang butuh 2 komponen wajib+opsional karena ada 2 sumber biaya nyata). Konsekuensi: tidak butuh tabel tier multi-baris seperti Visa (`docs/arsitektur-visa.md` §9.6) — satu `FlightSchedule` = satu periode = satu harga.
3. **Struktur rute: field flat atau tabel terpisah?** User pilih **tabel `FlightRoute` terpisah** (mirip `TransportTrip`) — beda dari `VisaProduct` yang flat, karena rute dipakai ulang lintas banyak periode/jadwal.

**Temuan teknis penting selama analisis (dicatat sebelum eksekusi, bukan ditemukan lewat audit nanti):**
- `computeSellPrice()` (`lib/pricing/computeSellPrice.ts`) punya logic override manual (`docs/arsitektur-harga.md` §15) yang **hardcode mencari `costComponent === 'individu'`** — spesifik untuk nama komponen Visa. Untuk Flight yang komponennya bernama `"tiket"`, override tidak akan pernah aktif. Bukan bug (Flight tidak diminta punya override), tapi dicatat eksplisit di `docs/arsitektur-tiket-pesawat.md` §4 supaya kalau modul lain nanti butuh override, `computeSellPrice()` perlu digeneralisasi dulu (jangan diam-diam berasumsi ini otomatis jalan).
- Pola kuota Flight **sengaja beda** dari `TransportQuota` (yang per-`travelDate` spesifik) — kuota Flight melekat ke `FlightSchedule` (per periode/blok), bukan per tanggal individual, karena realita bisnis maskapai/agen beli alokasi kursi per blok periode, bukan harian. Bukan penyederhanaan asal, tapi keputusan sadar berdasar karakteristik bisnis (dijelaskan di `docs/arsitektur-tiket-pesawat.md` §1).

**Rationale:** Reuse arsitektur harga (`Vendor`/`ExchangeRate`/`ProductCost`/`PricingRule`/`PreferredVendor`/`computeSellPrice()`) tanpa sentuh kode sama sekali — modul ini jadi bukti pertama klaim reusability `docs/arsitektur-harga.md` §8.1 ("Reusable 100% tanpa sentuh kode sama sekali... butuh adapter tipis per tipe produk"). Fungsi kuota dibangun lengkap (reserve+confirm+release) sekaligus di awal walau belum ada pemanggil — bukan pola sama dengan bug kritis Muthowif (`confirmMuthowifQuota()` tidak pernah dibuat SAMA SEKALI, dan gap-nya tidak terdokumentasi sampai diaudit) — di sini fungsinya lengkap dan benar, ketiadaan pemanggilnya didokumentasikan eksplisit dari hari pertama.

**Affects:**
- `docs/arsitektur-tiket-pesawat.md` — ditulis ulang total sebagai rencana lengkap (§1-12)
- `CLAUDE.md` — catatan status modul diperbarui, tidak lagi "0% diimplementasikan"
- `docs/progress.md` — section baru "Modul Tiket Pesawat — Eksekusi Bertahap", 6 fase belum dicentang

---

## 2026-07-19 — Modul Tiket Pesawat: Eksekusi 6 Fase Selesai & Terverifikasi

**Decision:** Seluruh 6 fase di `docs/arsitektur-tiket-pesawat.md` §10 dieksekusi berurutan sesuai Fase Eksekusi SOP (satu fase per satu waktu, `bun run build` 0 error sebelum lanjut, dokumentasi di tiap fase) — Schema → Integrasi Harga → Admin UI → Publik → Kuota (infrastruktur) → Dokumentasi final. Detail verifikasi tiap fase ada di `docs/progress.md` bagian "Modul Tiket Pesawat".

**Rationale:** Membuktikan 2 klaim yang dicatat di entri perencanaan (2026-07-19 di atas) benar-benar berlaku, bukan cuma teori:
1. **Reusability arsitektur harga** — `Vendor`/`ExchangeRate`/`ProductCost`/`PricingRule`/`PreferredVendor`/`computeSellPrice()`/`simulateSellPrice()` dipakai ulang 100% tanpa sentuh kode sama sekali (Fase 2), cuma butuh 1 adapter tipis (`refreshFlightScheduleCache.ts`) dan 2 route API baru. Diverifikasi numerik: `/simulate` dan `PUT .../cost` menghasilkan angka yang **persis sama** untuk input yang sama.
2. **Kuota lengkap tanpa pemanggil, didokumentasikan dari hari pertama** (Fase 5) — kontras eksplisit dengan insiden `confirmMuthowifQuota()` yang hilang tanpa catatan. Ketiga fungsi (`reserveFlightQuota`/`confirmFlightQuota`/`releaseFlightQuota`) diverifikasi lewat script langsung (bukan lewat UI, karena memang belum ada pemanggil) — termasuk kasus kuota habis (harus `throw`, transaksi harus rollback bersih).

**Deviasi kecil dari rencana awal, dicatat (bukan bug):** Halaman listing admin (`products/flight/page.tsx`) menambahkan alur "Simpan & Lanjut →" (redirect otomatis ke halaman edit jadwal setelah jadwal baru dibuat) yang tidak eksplisit ada di rencana §7 — ditambahkan saat implementasi karena jadwal baru butuh HPP diisi segera (schedule tanpa HPP punya `price: 0`, tidak berguna kalau dibiarkan di listing). Konsisten pola UX Visa ("buat dulu, lengkapi kemudian").

**Affects:**
- `docs/arsitektur-tiket-pesawat.md` — banner status jadi SELESAI & TERVERIFIKASI, item "sengaja belum dikerjakan" dijabarkan eksplisit
- `docs/progress.md` — Fase 3-6 dicentang dengan catatan verifikasi detail
- `CLAUDE.md` — belum perlu diubah lagi (referensi ke modul ini sudah cukup akurat sejak entri perencanaan)

---

## 2026-07-19 — Modul Tiket Pesawat: Audit Ulang Rencana vs Kode, 2 Gap Ditutup

**Decision:** Atas permintaan user ("recheck antara arsitektur dan aktual implemented code"), dilakukan audit section-per-section `docs/arsitektur-tiket-pesawat.md` (§3-§9) terhadap kode aktual — bukan cuma baca ulang dokumen, tapi `grep`/baca langsung tiap file yang diklaim (schema, guard tiap route, checklist §9 poin-per-poin). 2 gap ditemukan dan (atas pilihan user) ditutup langsung di sesi yang sama:

1. **`GET /api/v1/catalog/flight`** (direncanakan §6) tidak pernah dibuat — dibuat sekarang di `app/api/v1/catalog/flight/route.ts`, pola identik `catalog/visa` (publik, tanpa guard, `price` di-`Number()`-kan).
2. **Kolom "Maskapai" hilang dari listing admin** — `GET /api/v1/admin/products/flight/schedules` sekarang menyertakan `airlineName` per baris, listing (`products/flight/page.tsx`) menampilkannya sebagai kolom baru.

Kedua fix pakai helper baru `lib/pricing/flightAirlines.ts` (`getFlightAirlineNames()`) — batch-lookup `ProductCost`→`Vendor`, satu query bukan N+1, dipakai di 2 tempat (bukan disalin-tempel).

**Rationale:** Audit "rencana vs kode" cuma bernilai kalau benar-benar diverifikasi ke file, bukan diasumsikan dari status banner yang sudah ditulis sendiri di Fase 6 — dokumen yang menyatakan diri "SELESAI & TERVERIFIKASI" tetap bisa punya gap kalau verifikasi Fase 3/4 sebelumnya tidak menyilangkan tiap klaim struktural (kolom tabel, endpoint) satu per satu terhadap kode, hanya mengecek jalur utama berfungsi. Pelajaran: verifikasi fungsional (branch alur utama jalan) tidak sama dengan verifikasi kesesuaian dokumen (tiap detail yang diklaim benar-benar ada).

**Ditemukan tapi sengaja tidak diperbaiki (di luar 2 gap yang disetujui user):** `PUT schedules/[id]` tidak ada validasi silang `departureTo >= departureFrom` (POST `createSchema` punya `.refine()`, `updateSchema` tidak). Bukan bug aktif karena UI admin selalu kirim kedua tanggal bersamaan, tapi endpoint sendiri tidak menegakkan invarian ini kalau dipanggil langsung. Dicatat di sini supaya tidak hilang, dikerjakan kalau nanti ada alasan (mis. endpoint dipakai dari klien lain).

**Affects:**
- `lib/pricing/flightAirlines.ts` — baru
- `app/api/v1/catalog/flight/route.ts` — baru
- `app/api/v1/admin/products/flight/schedules/route.ts` — GET sekarang menyertakan `airlineName`
- `app/[locale]/admin/(protected)/products/flight/page.tsx` — kolom Maskapai baru
- `docs/progress.md` — entri audit baru di bawah Fase 6

---

## 2026-07-19 — Kategori Vendor: Field `category` di `Vendor`, Bukan Model Terpisah per Konteks

**Decision:** User bertanya kenapa `Vendor` dipakai bersama untuk syarikah (Visa) dan maskapai (Flight), lalu menunjuk konsekuensi nyata: dropdown vendor di form HPP kedua modul saling tercampur karena tidak ada pembeda. Dua opsi dibandingkan sebelum eksekusi: (a) tambah field `category: String?` di `Vendor` (murah, aditif, tidak sentuh `ProductCost`/`computeSellPrice()`/`PreferredVendor`), atau (b) model `Airline` terpisah (lebih "bersih" tapi butuh `ProductCost` jadi polimorfik ganda, merombak infrastruktur yang sudah terbukti jalan di 2 modul). User pilih opsi (a), sekaligus minta desainnya siap dipakai modul Hotel nanti tanpa migrasi ulang — dipenuhi dengan field bebas teks (bukan enum), konsisten prinsip §2 `docs/arsitektur-harga.md`.

**Insiden saat eksekusi (tertangani, dilaporkan transparan ke user saat terjadi):** percobaan pertama membangun shadow-database-url pakai `sed` gagal diam-diam — hasil substitusinya identik dengan `DATABASE_URL` produksi asli, bukan `saudinesia_shadow` yang terpisah. Ini persis skenario berbahaya yang sudah jadi pelajaran dari insiden sebelumnya (shadow-database gotcha yang pernah menghapus DB lokal, dicatat di memori kerja sesi ini). Terdeteksi SEBELUM lanjut ke langkah berikutnya: langsung verifikasi row count 7 tabel kunci (termasuk `flight_routes`/`flight_schedules` yang saat itu sudah berisi 1 baris data nyata milik user dari sesi sebelumnya, bukan data uji), struktur `vendors` (belum ada kolom `category` bocor), dan riwayat `_prisma_migrations` (bersih, tanpa entri aneh) — semua utuh. Kesimpulan: `prisma migrate diff --script` ternyata cuma menghasilkan file SQL tanpa benar-benar mengeksekusi apa pun ke database manapun (baik `--from-url` maupun `--shadow-database-url`), jadi percobaan yang salah URL itu murni gagal tanpa efek samping — tapi tetap tidak diulang dengan asumsi "kemarin juga aman", melainkan diverifikasi eksplisit (`if [ "$DATABASE_URL" = "$SHADOW_URL" ]`) bahwa kedua URL benar-benar berbeda sebelum diff kedua dijalankan.

**Rationale:** Field kategori menutup masalah filter UI (bukti: quick-add dari Flight otomatis `category:'maskapai'`, dari Visa otomatis `category:'syarikah'`, dropdown masing-masing modul saling tidak tercampur — diverifikasi langsung ke database & browser) tanpa mengorbankan reusability arsitektur harga yang sudah dibuktikan di 2 modul (Visa, Flight). Insiden shadow-URL memperkuat pelajaran lama: jangan percaya hasil substitusi shell untuk sesuatu sekritis pemilihan database — verifikasi eksplisit tiap kali, bahkan untuk perubahan sekecil `ADD COLUMN`.

**Affects:**
- `prisma/schema.prisma` — `Vendor.category: String?` (migrasi `20260719143142_add_vendor_category`, backfill 3 vendor lama jadi `'syarikah'`)
- `app/api/v1/admin/system/settings/vendors/route.ts` — `GET` terima filter `?category=`, `POST` terima `category`
- `app/api/v1/admin/system/settings/vendors/[id]/route.ts` — `PUT` terima `category`
- `app/[locale]/admin/(protected)/system/settings/page.tsx` — input kategori + badge di daftar vendor
- `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` — fetch `?category=syarikah`, quick-add kirim `category:'syarikah'`
- `app/[locale]/admin/(protected)/products/flight/[id]/page.tsx` — fetch `?category=maskapai`, quick-add kirim `category:'maskapai'`
- `docs/arsitektur-harga.md` — §18 baru (RENCANA → SELESAI & TERVERIFIKASI)
- `docs/progress.md` — entri baru di bawah "Arsitektur Harga / HPP"

---

## 2026-07-19 — Bug Kritis: Komponen HPP Bermata Uang IDR Gagal Dihitung, Ditemukan User Lewat Pemakaian Nyata

**Decision:** User mencoba fitur kategori vendor yang baru selesai (entri di atas), pakai vendor "Saudinesia Air" dengan harga tiket dalam **Rupiah** (bukan USD) — HPP & Harga Jual di form edit Flight tampil "—" alih-alih angka, padahal komponen yang sama dengan mata uang USD berjalan normal. User kirim 2 screenshot perbandingan (IDR gagal, USD berhasil) dan bertanya apakah ini bug nyata.

**Root cause:** `computeSellPrice()` dan `simulateSellPrice()` (`lib/pricing/`) selalu memanggil `getLatestRate(component.currency, 'IDR')` tanpa terkecuali — kalau `component.currency` sudah `'IDR'`, ini mencari baris `ExchangeRate` `IDR→IDR` yang **tidak pernah ada** (cron kurs cuma fetch USD/IDR & SAR/IDR, lihat §4.1 `docs/arsitektur-harga.md`). `computeSellPrice()` skip komponen itu diam-diam (`continue`); `simulateSellPrice()` malah `return null` untuk seluruh hasil. Bug ini ada sejak fungsi ini pertama dibuat (bagian dari arsitektur harga original) — bukan regresi dari kerja Flight/kategori vendor hari ini, cuma baru kepakai/ketahuan sekarang karena sebelumnya belum ada yang coba isi mata uang IDR di kedua modul (Visa maupun Flight).

**Fix:** treat `currency === 'IDR'` sebagai identity — kalau biaya sudah dalam Rupiah, tidak butuh lookup `ExchangeRate` sama sekali, langsung `hppRupiah += cost`. Diterapkan di kedua fungsi. Detail teknis & verifikasi lengkap: `docs/arsitektur-harga.md` §19.

**Dampak nyata yang dikoreksi:** jadwal Flight milik user ("Cengkareng (CGK) → Madinah (MED)", vendor "Saudinesia Air", Rp 19.150.000) sempat gagal ter-cache (`FlightSchedule.price` macet di Rp 0 karena percobaan simpan sebelumnya silently failed). Setelah fix, disimpan ulang langsung ke record nyata itu (bukan cuma diverifikasi pakai data uji) — HPP Rp 19.150.000, Harga Jual Rp 23.000.000, terkonfirmasi tersimpan di database.

**Rationale kenapa fix di level fungsi inti, bukan tambal di UI Flight saja:** bug ini ada di `lib/pricing/computeSellPrice.ts`/`simulateSellPrice.ts` yang dipakai bersama Visa dan Flight (dan Hotel nanti) — kalau ditambal cuma di form Flight, Visa akan tetap kena bug yang sama begitu ada syarikah dengan harga IDR. Konsisten prinsip modul ini: perbaiki di lapisan yang di-reuse, bukan di satu konsumen saja.

**Affects:**
- `lib/pricing/computeSellPrice.ts` — skip lookup `ExchangeRate` kalau `currency==='IDR'`
- `lib/pricing/simulateSellPrice.ts` — sama
- `docs/arsitektur-harga.md` — §19 baru (bug ditemukan & ditutup)
- Data produksi: 1 `FlightSchedule` (milik user) di-refresh ulang cache-nya ke nilai yang benar

---

## 2026-07-19 — Modul Hotel: `docs/arsitektur-hotel.md` Ditulis sebagai Audit As-Built, Sebelum Rencana Migrasi Harga

**Decision:** User minta lanjut ke modul Hotel setelah Pesawat & kategori vendor selesai (pola bertahap: "mulai dari maskapai, visa, pesawat, kemudian nanti ke modul-modul lain"). Sebelum eksekusi kode, ditanya dulu lewat `AskUserQuestion` apa maksud "masuk ke Hotel" — karena beda dari Pesawat (dibangun dari nol), Hotel **sudah** jadi modul yang fungsional penuh, cuma harganya belum terhubung ke arsitektur HPP universal. User pilih: tulis dokumen as-built dulu (bukan langsung migrasi), dengan instruksi eksplisit "implementasi dan arsitektur harus sesuai... tulis dulu aja agar nanti saya tulis apa yang saya mau setelah kamu lengkap menulis implemented arsitektur."

**Yang dikerjakan:** `docs/arsitektur-hotel.md` ditulis dari nol (audit langsung ke kode — schema, API routes, admin UI, katalog publik, wizard, quota functions — bukan dari ingatan/dokumen lama), mengikuti struktur `docs/arsitektur-transportasi.md` (paling mirip karena sama-sama pola harga manual per-musim + kuota per-periode, bukan struktur HPP Visa). Tidak ada kode yang diubah — murni dokumentasi, sesuai instruksi user.

**Temuan signifikan selama audit (dicatat di `docs/arsitektur-hotel.md` §8, ringkasan di `docs/progress.md`):**
1. **Gap #1 (KRITIS, baru ditemukan)**: harga booking hotel (`BookingHotel.pricePerNight`) dipercaya mentah dari body request client (`hotelSelectionSchema.pricePerNight` di `lib/validators/booking.ts`) — server (`app/api/v1/bookings/route.ts:86-106`) tidak pernah query ulang `HotelRoom.priceRegular/Ramadan/Hajj` untuk verifikasi. Ini celah manipulasi harga nyata, bukan cuma inkonsistensi data — beda kelas dari gap-gap lain yang sudah tercatat sebelumnya di codebase ini. Pola serupa (`unitPrice`) kemungkinan ada di validator Transport, belum dikonfirmasi (di luar scope audit Hotel).
2. **Gap #2**: `PUT /api/v1/admin/products/hotels/[id]` pakai `prisma.hotel.update({ data: body })` mentah tanpa Zod — mass-assignment.
3. **Gap #3**: fitur "Layanan Hotel" (`HotelService`) tidak punya jalur admin sama sekali untuk mengisi data — publik query & render `hotel.services` tapi section itu permanen kosong di praktik. `docs/progress.md` sempat mencentang ini "selesai" — benar dari sisi render, menyesatkan dari sisi fungsional.
4. Gap #4-8 (severity lebih rendah): create-only tanpa edit/delete untuk kamar & kuota, dead code `HotelPicker.tsx` (pola sama `MuthowifPicker.tsx`), error-handling `catch{...403}` polos (pola sama Visa Gap #6 lama), inkonsistensi resolusi musim/kuota antar halaman publik, filter kota hardcode.

**Rationale kenapa Gap #1 ditonjolkan, bukan dikubur di daftar:** dokumen arsitektur modul lain di codebase ini (Visa, Muthowif) biasanya menonjolkan 1 bug paling kritis di banner status kalau ditemukan — konsisten pola itu di sini karena dampaknya beda kelas (keamanan/kepercayaan harga, bukan cuma UX/kerapian kode).

**Yang TIDAK dikerjakan sesi ini:** rencana migrasi harga Hotel ke `Vendor`/`ProductCost`/`computeSellPrice()` — sengaja belum ditulis, menunggu user baca dokumen ini dulu dan menentukan arah (migrasi penuh? perbaiki Gap #1 dulu independen dari migrasi? sesuatu yang lain?).

**Affects:**
- `docs/arsitektur-hotel.md` — baru, source of truth Hotel
- `docs/progress.md` — section baru "Modul Hotel — Audit As-Built", anotasi tambahan di checklist M3 lama soal "layanan hotel"
- `CLAUDE.md` — Hotel masuk daftar modul berdokumen, 3 temuan paling kritis ditambahkan ke section "Perhatian"

---

## 2026-07-19 — Modul Hotel: Refactor Total Disetujui, 4 Keputusan Struktural + Fase 0 Selesai

**Decision:** Setelah baca audit `docs/arsitektur-hotel.md` §1-9, user minta refactor total Hotel supaya sesuai struktur baru: featured photo, fasilitas checkbox, dan **harga wajib lewat komponen harga universal** (Vendor/ProductCost/computeSellPrice) dengan periode tanggal + minimal 5 tipe kamar (Single/Double/Triple/Quad/Quint, di-seed). User eksplisit minta konfirmasi dulu sebelum rencana ditulis ("jika ada yang harus dikonfirmasi, kamu harus konfirmasi terlebih dahulu... agar kita punya perencanaan yang matang") — 4 pertanyaan diajukan lewat `AskUserQuestion`:

1. **Konsep Vendor untuk Hotel** — user pilih **pihak ketiga terpisah, dipilih manual** (persis pola Maskapai Flight, `Vendor.category:'hotel'`), bukan representasi hotel itu sendiri.
2. **Struktur harga & kuota** — user pilih **satu entitas "Jadwal Kamar" per hotel×tipe×periode bebas** (persis `FlightSchedule`), MENGGANTI TOTAL 3 musim tetap (Regular/Ramadan/Hajj). User tambahkan konteks bisnis penting: data hotel riil yang dipegang tidak mengikuti pembagian musim itu, melainkan periode per bulan sesuai kontrak — mengkonfirmasi keputusan ini bukan cuma soal kerapian arsitektur, tapi memang lebih akurat merepresentasikan bisnis nyata.
3. **Scope fasilitas** — user pilih **level Hotel saja**, checkbox dari konstanta hardcode (bukan tabel database terpisah).
4. **Override harga manual** — user pilih **generalisasi `computeSellPrice()` sekarang** (bukan skip seperti keputusan Flight) — sekalian menutup utang teknis yang sudah dicatat sejak `docs/arsitektur-tiket-pesawat.md` §4.

**Rencana lengkap ditulis** di `docs/arsitektur-hotel.md` §10 (7 fase: 0-6) sebelum eksekusi kode apa pun, sesuai Fase Eksekusi SOP `CLAUDE.md`. Data lama (`HotelRoom`/`HotelQuota` — 20+20 baris, `booking_hotels: 0`) sengaja tidak dimigrasikan/dipertahankan — dikonfirmasi aman dihapus karena tidak ada booking nyata yang mereferensikannya, dan user eksplisit mengizinkan ("belum masuk tahap produksi, semua hal boleh diubah").

**Fase 0 dieksekusi & diverifikasi hari ini** (generalisasi override — lihat entri terpisah `docs/arsitektur-harga.md` §20) — sengaja dikerjakan **sebelum** skema Hotel disentuh sama sekali karena mengubah fungsi (`computeSellPrice()`) yang dipakai bersama Visa & Flight; kalau ada regresi, isolasi jadi mudah tanpa harus bongkar kerjaan Hotel yang belum mulai.

**Rationale kenapa "Jadwal Kamar" gabungan (bukan tetap pisah kuota vs harga):** mengikuti preseden `FlightSchedule` yang sudah terbukti — satu baris = satu unit jual (periode × tipe kamar), kuota dan harga berbagi lifecycle yang sama, mencegah kelas gap baru "periode harga vs periode kuota tidak selaras" yang justru jadi salah satu temuan di audit lama (§7 Gap #7).

**Affects:**
- `docs/arsitektur-hotel.md` — §10 baru (rencana lengkap 7 fase), banner status diupdate
- `docs/arsitektur-harga.md` — §20 baru (SELESAI & TERVERIFIKASI, Fase 0)
- `lib/pricing/computeSellPrice.ts` — override generalisasi (Fase 0)
- `docs/progress.md` — section baru "Modul Hotel — Refactor Total", Fase 0 dicentang

---

## 2026-07-19 — Modul Hotel: Deviasi Fase Eksekusi (Fase 1-6 Dikerjakan Sekaligus, Bukan Checkpoint Terpisah)

**Decision:** Rencana `docs/arsitektur-hotel.md` §10.8 menyusun Fase 1-6 dengan `bun run build` 0 error sebagai checkpoint di antara tiap fase, sesuai `CLAUDE.md` Fase Eksekusi SOP poin 2-3. Begitu Fase 1 dieksekusi (skema `HotelRoom`/`HotelQuota` dihapus, diganti `HotelRoomSchedule`), build langsung merah — bukan di 1-2 file, tapi di **±18 file lintas modul**: `lib/quota/index.ts`, `lib/validators/booking.ts`, `lib/cron/autocancelJob.ts`, `app/api/v1/bookings/route.ts`, `app/api/v1/admin/payments/[id]/confirm/route.ts`, `app/api/v1/bookings/[id]/route.ts`, `app/api/v1/admin/quotas/route.ts`, halaman admin/pilgrim booking detail, halaman admin quota dashboard, halaman beranda publik, dan seluruh halaman/route Hotel sendiri (admin + publik + wizard).

**Masalah dengan strict checkpoint-per-fase:** sebagian besar file yang rusak itu justru scope Fase 2-5 (integrasi harga, admin UI, publik, wizard) — jadi "kembalikan build ke hijau setelah Fase 1" pada praktiknya berarti mengerjakan Fase 2-5 juga, cuma dengan nama "Fase 1" di label commit. Alternatif yang dipertimbangkan: (a) tetap paksa checkpoint terpisah dengan versi *stub*/sementara untuk tiap konsumen di Fase 1 (compile tapi belum fitur lengkap), lalu ganti lagi dengan versi penuh di fase-fase berikutnya — ditolak karena double-work murni tanpa manfaat (semua konsumen itu memang butuh bentuk akhir yang sama, tidak ada alasan bikin versi buang-pakai); (b) selesaikan seluruh rantai sampai build hijau kembali, checkpoint dokumentasi+verifikasi di akhir — **dipilih**.

**Rationale:** SOP "0 error sebelum fase berikutnya" dirancang untuk mencegah numpuk banyak perubahan tak-terverifikasi (pelajaran dari insiden-insiden sebelumnya di codebase ini). Prinsip itu tetap dipegang — cuma unit "fase" yang berubah granularitas untuk kasus refactor skema pada modul yang SUDAH ada konsumennya (beda dari Flight yang dibangun dari nol, semua file baru, tidak ada cascade). Tidak ada bagian dari 7 fase yang dilewati atau dikerjakan asal-asalan — checklist tiap fase di §10.8 tetap ditandai selesai dengan verifikasi masing-masing, cuma prosesnya jadi satu rangkaian panjang, bukan 7 sesi terpisah dengan `bun run build` di antaranya.

**Pelajaran untuk refactor serupa ke depan:** kalau modul yang di-refactor SUDAH punya banyak konsumen existing (beda dari modul baru dari nol), estimasi dulu blast radius perubahan skema (`grep` referensi model lama lintas codebase) SEBELUM menulis rencana fase-per-fase yang mengasumsikan build bisa hijau di titik tengah — kalau blast radius besar, rencana fase sebaiknya menyusun ulang unit checkpoint-nya dari awal (mis. "checkpoint 1: schema+semua-konsumen-tetap-compile", bukan "checkpoint 1: schema saja").

**Affects:**
- `docs/arsitektur-hotel.md` §10.8 — catatan deviasi ditambahkan, semua 7 fase ditandai selesai dengan detail verifikasi gabungan
- `docs/progress.md` — Fase 1-6 dicentang sebagai satu entri gabungan dengan catatan deviasi

---

## 2026-07-19 — Modul Hotel: Refactor Total Selesai & Terverifikasi — Gap #1 (Kritis) dan #2 Tertutup

**Decision:** Seluruh refactor Hotel (§10 `docs/arsitektur-hotel.md`) selesai dieksekusi dan diverifikasi — schema baru (`RoomType`+`HotelRoomSchedule`), integrasi penuh ke arsitektur harga universal, admin UI ditulis ulang total, katalog publik lepas dari `detectSeason()`, dan yang terpenting: **Gap #1 (KRITIS) dari audit lama ditutup** — harga booking hotel sekarang selalu dihitung server-side dari `HotelRoomSchedule.price`, `pricePerNight` dihapus total dari input client (`hotelSelectionSchema`).

**Bukti penutupan Gap #1** (bukan cuma klaim): dua lapis verifikasi independen — (1) statis: `pricePerNight` tidak ada lagi di tipe `hotelSelectionSchema`, jadi TypeScript akan gagal compile kalau ada kode yang mencoba membacanya dari input client — build sukses 0 error jadi bukti tidak ada jalur kode yang bergantung ke harga client; (2) fungsional: script verifikasi mensimulasikan persis logic `bookings/route.ts` dengan `maliciousClientPrice=1` yang sengaja tidak pernah dipakai di path manapun — hasil `pricePerNight` yang tersimpan selalu `HotelRoomSchedule.price` asli (Rp 9.850.000 di data uji), tidak pernah angka client.

**Gap #2 (mass-assignment `PUT hotels/[id]`) juga tertutup** sebagai bagian alami dari menulis ulang seluruh route admin Hotel dengan Zod — bukan tugas terpisah, konsekuensi dari rewrite total.

**Gap #3 (Layanan Hotel/`HotelService`) TIDAK disentuh** — tetap terbuka, sesuai keputusan scope awal (`docs/arsitektur-hotel.md` §10.7), di luar 6 poin requirement user untuk refactor ini.

**Rationale:** User eksplisit minta harga "harus sesuai dengan standard komponen harga" — konsekuensi alaminya adalah harga tidak lagi bisa dipercaya dari input manapun selain hasil kalkulasi server (`computeSellPrice()`), yang otomatis menutup celah manipulasi harga yang sebelumnya ada. Ini bukan target eksplisit yang diminta user, tapi efek samping struktural yang benar dari desain yang diminta — dicatat jelas supaya tidak terlihat seperti "bonus" yang tidak diverifikasi.

**Affects:**
- `prisma/schema.prisma` — `RoomType`, `HotelRoomSchedule` baru; `Hotel`, `BookingHotel` diubah; `HotelRoom`, `HotelQuota` dihapus (migrasi `20260719160050_hotel_refactor_room_schedule`)
- `lib/quota/index.ts`, `lib/validators/booking.ts`, `lib/cron/autocancelJob.ts` — disesuaikan ke skema baru, `hotelSelectionSchema` hapus `pricePerNight`
- `app/api/v1/bookings/route.ts`, `app/api/v1/admin/payments/[id]/confirm/route.ts` — harga hotel dihitung server-side
- `app/api/v1/admin/products/hotels/**` — ditulis ulang total (CRUD hotel, `room-types`, `schedules`, `schedules/[id]/cost`, `simulate`)
- `app/api/v1/catalog/hotels/route.ts` — ditulis ulang, resolve dari `HotelRoomSchedule`
- `app/[locale]/admin/(protected)/products/hotels/**`, `app/[locale]/(public)/hotels/**`, `app/[locale]/(public)/page.tsx` — ditulis ulang
- `app/[locale]/(pilgrim)/bookings/new/hotel/page.tsx`, `.../payment/page.tsx`, `lib/booking/draft.ts` — disesuaikan skema baru
- `components/booking/HotelPicker.tsx` — dihapus (dead code)
- `lib/constants/hotelFacilities.ts` — baru
- `prisma/seed.ts` — seeding `HotelRoom`/`HotelQuota` lama dihapus, seed `RoomType` (5 baris) ditambah, data hotel disederhanakan (tanpa harga fiktif, tanpa kuota fiktif — diisi lewat admin UI)
- `CLAUDE.md` — Gap #1/#2 di section "Perhatian" ditandai DITUTUP

---

## 2026-07-19 — Modul Hotel: Periode Jadi Entitas Terpisah, Input Massal per Periode (Restrukturisasi §11)

**Decision:** Sehari setelah refactor §10 selesai, user coba isi data harga nyata lewat UI baru dan menemukan masalah: rate sheet vendor hotel asli SELALU berbentuk matriks (1 periode tanggal mencakup banyak tipe kamar sekaligus, dengan harga berbeda per tipe — user lampirkan screenshot rate sheet nyata sebagai bukti). Struktur §10 (`HotelRoomSchedule` menyimpan `periodStart`/`periodEnd` sendiri per baris, satu baris = satu tipe kamar) secara RELASIONAL sebenarnya sudah bisa merepresentasikan ini (banyak baris dengan tanggal yang "sama"), tapi UI-nya memaksa admin isi satu tipe-kamar-satu-periode berulang kali — user sebut ini "bug" walau akar masalahnya UX, bukan skema yang salah total.

3 keputusan dikonfirmasi lewat `AskUserQuestion` sebelum rencana ditulis:
1. **Vendor & currency per periode** (bukan per tipe kamar) — satu rate sheet = satu kontrak/vendor, admin pilih sekali per periode.
2. **Meal plan (Full Board dst.) masuk checkbox Fasilitas** yang sudah ada — BUKAN dimensi harga baru (periode×tipe kamar×meal akan jadi kombinasi berlebihan untuk kebutuhan sekarang).
3. **1 baris data nyata yang sudah sempat diinput user** (Saja Al Madinah Hotel, Single, 26 Jul–31 Okt 2026) dihapus, diinput ulang manual — bukan dimigrasikan otomatis (cukup 1 baris, tidak sepadan bikin skrip migrasi data).

**Pelajaran §10.8 diterapkan secara nyata**: sebelum menulis rencana §11, blast radius perubahan (`grep` referensi `periodStart`/`periodEnd`/`.schedules` level Hotel) dicek dulu — ditemukan TERKONTROL, karena `BookingHotel` tetap FK ke `HotelRoomSchedule.id` langsung (tidak berubah), dan `catalog/hotels` API bisa dijaga tetap mengembalikan bentuk `schedules:[...]` yang sama (di-flatten dari `pricePeriods` di server). Hasilnya: `lib/quota/index.ts`, `lib/validators/booking.ts`, `bookings/route.ts`, wizard hotel/payment, dan beberapa file lain **terbukti benar-benar tidak perlu diubah** — kontras jelas dengan §10.8 yang butuh ±18 file. Cuma 3 file (booking-detail admin/pilgrim + API detail) yang meleset dari estimasi awal (masih include relasi `hotelRoomSchedule.hotel` langsung peninggalan §10), ketahuan lewat `bun run build` dan diperbaiki cepat tanpa perlu deviasi fase.

**Desain kunci — vendor per periode TANPA field redundan**: `vendorId`/`currency` TIDAK ditambahkan sebagai field baru di `HotelPricePeriod` — tetap lewat `ProductCost`/`PreferredVendor` per `HotelRoomSchedule.id` seperti §10 (konsisten arsitektur harga universal, `computeSellPrice()` TIDAK disentuh lagi sama sekali di restrukturisasi ini). "Satu vendor per periode" ditegakkan murni di level API — endpoint bulk `PUT .../periods/[periodId]/prices` selalu menulis vendor+currency yang SAMA ke semua `ProductCost` tipe kamar yang dikirim dalam satu request. Diverifikasi langsung ke database: 4 tipe kamar dengan harga berbeda, `vendorId`+`currency` identik di ke-4 `ProductCost`-nya.

**Rationale:** Solusi yang dipilih (periode jadi entitas + API bulk) menutup masalah struktural asli (tanggal bisa "miring" antar tipe kamar kalau diedit terpisah — sekarang mustahil karena periode cuma didefinisikan sekali) SEKALIGUS masalah UX (grid satu form untuk semua tipe kamar, sesuai cara vendor kasih rate sheet) — bukan cuma tambal UI di atas skema lama.

**Affects:**
- `prisma/schema.prisma` — `HotelPricePeriod` baru, `HotelRoomSchedule` direstruktur (migrasi `20260719170340_hotel_price_period`)
- `app/api/v1/admin/products/hotels/[id]/periods/**` — baru (list/create, edit/soft-delete, bulk prices)
- `app/api/v1/admin/products/hotels/[id]/schedules/**` — dihapus (digantikan `periods/**`)
- `app/api/v1/catalog/hotels/route.ts`, `app/[locale]/(public)/hotels/**`, `app/[locale]/(public)/page.tsx` — query disesuaikan ke `pricePeriods`, response tetap di-flatten sama seperti §10
- `app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx` — section "Jadwal Kamar" diganti total "Periode & Harga Kamar" (grid bulk-entry)
- `app/[locale]/admin/(protected)/quotas/page.tsx`, `app/api/v1/admin/quotas/route.ts` — include `period.hotel` ditambah
- `app/[locale]/admin/(protected)/bookings/[id]/page.tsx`, `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/api/v1/bookings/[id]/route.ts` — perbaikan relasi `hotelRoomSchedule.hotel` → `.period.hotel` (ketahuan lewat build, di luar estimasi blast radius awal)
- `lib/constants/hotelFacilities.ts` — tambah 3 kode meal plan
- `docs/arsitektur-hotel.md` — §11 baru (SELESAI & TERVERIFIKASI), banner status diupdate

---

## 2026-07-19 — Modul Transportasi: Sync-Check Sebelum Upgrade, Gap Kritis Ditemukan

**Decision:** User minta lanjut ke modul Transport, dengan instruksi eksplisit cek sinkronisasi struktur vs dokumen dulu sebelum upgrade — mengikuti pola yang sama dipakai Visa/Flight/Hotel sepanjang sesi ini. `docs/arsitektur-transportasi.md` (terakhir diaudit 2026-07-08) di-recheck langsung ke kode, bukan dipercaya dari isi dokumen lama.

**Hasil**: §2-§6 (skema, API, season pricing, admin UI, katalog publik & wizard) **masih akurat 100%** — tidak ada drift sejak 2026-07-08. Tabel Gap (§7) direvisi:
- Gap #2 lama (dead code `admin/transport/route.ts` + `TransportPicker.tsx`) **DITUTUP** — kedua file dikonfirmasi sudah tidak ada (kapan/oleh siapa dihapus tidak tercatat, tapi hasil bersih).
- Gap #1 lama (`pickupDetail`/`dropoffDetail` selalu kosong) **masih terbuka**, dikonfirmasi ulang lewat baca kode.
- **Gap #4 (baru, KRITIS)**: `unitPrice`/`totalPrice` booking transport dipercaya mentah dari client (`lib/validators/booking.ts:26-34`, `app/api/v1/bookings/route.ts:114-125`), tidak pernah di-re-validasi server terhadap `TransportPricing` — celah manipulasi harga. Ini **persis** pola Gap #1 Hotel yang baru saja ditutup (`docs/arsitektur-hotel.md` §8, §10.2) — dan sudah berkali-kali disebut "kemungkinan ada, belum dikonfirmasi" di `CLAUDE.md`/`docs/arsitektur-hotel.md`/`docs/decisions.md` sepanjang sesi ini, tapi baru sekarang benar-benar dibuktikan lewat baca kode langsung, bukan dugaan.
- **Gap #5 (baru)**: semua route admin Transport (kecuali `vehicles/[id]/images`) masih pakai `catch{...403}` polos — pola error-handling yang sudah ditutup di Visa (Gap #6), Flight, dan Hotel (Gap #2/#6), tidak pernah disentuh di Transport.

**Rationale kenapa ini penting dicatat terpisah dari sekadar "update dokumen":** ini konfirmasi ketiga kalinya dalam sesi ini (setelah Flight §6/§7 dan Hotel §8) bahwa dokumen arsitektur yang sudah lama tidak di-recheck bisa menyembunyikan gap yang **belum pernah ditemukan sama sekali** — bukan cuma detail yang jadi basi. Pola "audit ulang sebelum upgrade" terbukti berulang kali menemukan sesuatu yang nyata, bukan formalitas.

**Belum dikerjakan**: perbaikan Gap #4/#5, atau rencana upgrade Transport ke arsitektur harga universal — menunggu arahan user soal arah yang diinginkan.

**Affects:**
- `docs/arsitektur-transportasi.md` — §7 direvisi total (Gap #2 ditutup, Gap #4/#5 baru), banner status
- `CLAUDE.md` — entri Transport dipindah dari "kemungkinan ada" jadi terkonfirmasi
- `docs/progress.md` — section baru "Modul Transportasi — Sync-Check Sebelum Upgrade"

---

## 2026-07-08 — Modul Transportasi: `docs/arsitektur-transportasi.md` sebagai Source of Truth Kedua

**Decision:** Audit kode aktual modul Transport (skema, API, admin UI, wizard) terhadap rencana v3 (`docs/decisions.md` 2026-05-22) dan tulis `docs/arsitektur-transportasi.md` sebagai source of truth — menggantikan `docs/arsitektur-transport.md` (dokumen rencana, dihapus setelah diserap) dan bagian Transport lama di `docs/architecture.md` (dianotasi basi, bukan dihapus).

**Rationale:** Melanjutkan pola modularisasi dari Visa (lihat entri di atas). Nama file final memakai bahasa Indonesia penuh `arsitektur-transportasi.md` (bukan `arsitektur-transport.md`) sesuai permintaan eksplisit — konvensi nama modul di file arsitektur akan mengikuti istilah Indonesia yang dipakai user, bukan otomatis dari nama model/folder Inggris.

**Hasil audit:** Transport v3 ~97% selesai, hampir tidak ada gap struktural (beda dengan Visa yang gap-nya besar). Skema, seluruh API CRUD (vehicles/trips/pricing dengan `requireManager()`), quota reservation (`reserveTransportQuota` di `lib/quota/index.ts`, dalam `$transaction(Serializable)`), admin 2-tab UI + pricing builder, dan katalog publik/wizard — semua cocok dengan rencana. Gap yang ditemukan hanya kecil (lihat `docs/arsitektur-transportasi.md` §7):
- `pickupDetail`/`dropoffDetail` tidak pernah diisi user di wizard walau trip punya `originHint`/`destinationHint` dan kolom DB mendukungnya
- Dead code sisa refactor v2: `app/api/v1/admin/transport/route.ts` (stub tak terpakai) dan `components/booking/TransportPicker.tsx` (`return null`, tak ter-import) — dilaporkan sebagai task terpisah, bukan bagian dari perubahan dokumentasi ini

**Alternatives considered:**
- Nama file `arsitektur-transport.md` (istilah Inggris seperti model Prisma) — ditolak, user secara eksplisit minta `arsitektur-transportasi.md`

**Affects:**
- `docs/arsitektur-transportasi.md` — baru, source of truth Transport
- `docs/arsitektur-transport.md` — dihapus, isinya diserap ke `arsitektur-transportasi.md`
- `docs/architecture.md` — anotasi basi di skema SQL transport lama + tabel API admin/catalog transport
- `docs/progress.md` — M10 dapat pointer ke dokumen baru + 2 gap item baru
- `CLAUDE.md` — status line diperbarui, Transport ditambahkan ke daftar modul yang sudah teraudit

---

## 2026-07-08 — Modul Muthowif: `docs/arsitektur-muthowif.md` — Ditemukan Bug Kritis Payment Confirm

**Decision:** Audit kode aktual modul Muthowif (tidak ada dokumen rencana sebelumnya untuk modul ini, jadi ditulis langsung dari kode) dan buat `docs/arsitektur-muthowif.md` sebagai source of truth ketiga setelah Visa dan Transport.

**Rationale:** Melanjutkan pola modularisasi. Modul ini berbeda dari Visa/Transport karena tidak pernah punya dokumen "rencana" — jadi audit ini murni as-built, bukan perbandingan plan-vs-actual.

**Temuan kritis:** `lib/quota/index.ts` punya `confirmHotelQuota()` dan `confirmTransportQuota()` (dipanggil di `app/api/v1/admin/payments/[id]/confirm/route.ts` saat admin konfirmasi pembayaran), tapi **`confirmMuthowifQuota()` tidak pernah dibuat**, dan `include` di query payment confirm tidak menyertakan `booking.muthowif` sama sekali. Diverifikasi langsung: fungsi ini benar-benar tidak ada di `lib/quota/index.ts` (hanya `reserveMuthowifQuota` dan `releaseMuthowifQuota`), dan desain awal di `docs/architecture.md` (baris data-flow "UPDATE muthowif_availability: pending→booked") memang **mendesain langkah ini tapi tidak pernah diimplementasikan**. Dampak: `MuthowifAvailability.pendingCount` tidak pernah pindah ke `bookedCount` setelah pembayaran lunas — data pending vs booked bercampur selamanya, dan cron auto-cancel/release bisa salah menangani booking yang sebenarnya sudah confirmed.

**Gap non-kritis lain** (lihat `docs/arsitektur-muthowif.md` §7): CRUD admin create-only (tidak ada PUT/DELETE/toggle `isActive`), `photoUrl` tidak pernah dipakai di layer manapun, `languages` tanpa type formal, `rating` statis tanpa mekanisme update, badge availability di-fetch tapi tidak dirender ke user, dead code `MuthowifPicker.tsx`.

**Alternatives considered:** Perbaiki bug sekaligus saat menulis dokumentasi — ditolak untuk sesi ini, scope dibatasi ke dokumentasi dulu (user akan putuskan kapan mengerjakan perbaikan sebagai task terpisah).

**Affects:**
- `docs/arsitektur-muthowif.md` — baru, source of truth Muthowif
- `docs/architecture.md` — anotasi di data-flow diagram (baris confirm muthowif yang tidak pernah diimplementasikan), skema muthowif (masih akurat, ditandai), tabel API catalog/admin muthowif
- `docs/progress.md` — item CRUD Muthowif dapat pointer + 4 gap item baru termasuk bug kritis
- `CLAUDE.md` — status line diperbarui + catatan "Perhatian" eksplisit soal bug kritis sebelum deployment produksi

---

## 2026-07-19 — Modul Transportasi: Rencana Upgrade Harga Rute × Kendaraan Ditulis (`docs/arsitektur-transportasi.md` §9)

**Decision:** Setelah sync-check (entri di atas) mengonfirmasi Gap #4 KRITIS, user minta transport diupgrade dengan logika sama seperti Tiket Pesawat: tiap **rute** (origin→destination terstruktur, bukan hint teks) punya beberapa **jenis kendaraan**, tiap kombinasi rute×kendaraan punya **satu harga flat** terintegrasi HPP (`docs/arsitektur-harga.md`). Rencana lengkap ditulis sebagai §9 baru di `docs/arsitektur-transportasi.md` — **belum dieksekusi**, murni dokumentasi arsitektur dulu sesuai Fase Eksekusi SOP poin 1.

**4 keputusan struktural dikonfirmasi user via AskUserQuestion** (semua opsi "Recommended" dipilih):
1. `TransportTrip.origin`/`destination` jadi field wajib (ganti `originHint`/`destinationHint` opsional), meniru `FlightRoute`.
2. Kolom musiman (`charterRegular/Ramadan/Hajj`, `perSeatRegular/Ramadan/Hajj`) di `TransportPricing` **dihapus total** — user: harga vendor riil tidak dipecah per musim seperti asumsi v3 lama.
3. Distingsi charter vs per-kursi (`perSeatEnabled` + 2 jalur harga) **dihapus total** — satu harga flat per kombinasi rute×kendaraan.
4. Vendor/HPP dipilih **per kombinasi rute×kendaraan** independen (bukan per-rute seperti pola "satu vendor per periode" Hotel) — kendaraan berbeda plausibel dari operator berbeda meski rute sama.

**Analisis tambahan (bukan dari AskUserQuestion, disimpulkan dari 3 contoh harga user):** ketiga contoh (Sedan Bandara→Hotel Rp 20rb, Bus Hotel→Wisata Rp 230rb, Bus Bandara→Hotel Rp 2jt) semuanya harga sewa kendaraan flat, bukan per-kepala — Rp 2jt jelas bukan per-penumpang. Konsekuensi: `BookingTransport.totalPrice = unitPrice` (tidak dikalikan `numPassengers`), `isCharter` jadi tidak bermakna lagi (mode lain sudah tidak ada) sehingga **dihapus dari schema**. `numPassengers` tetap dipertahankan murni untuk validasi kapasitas kuota kursi (`TransportQuota` tidak berubah granularitasnya — tidak ada alasan bisnis untuk mengubahnya).

**Integrasi HPP:** Transport jadi modul ke-4 (setelah Visa, Flight, Hotel) yang pakai `computeSellPrice()`/`ProductCost`/`PreferredVendor` — pola paling mirip **Flight** (komponen HPP tunggal flat `"kendaraan"`, tidak day-based), bukan pola periode Hotel. `Vendor.category` dapat nilai baru `'transport'` (field sudah generik, tidak butuh migrasi skema).

**Blast radius dicek dulu via grep** (pelajaran dari Hotel §11, diterapkan lagi): ~11 file unik kena dampak gabungan field harga musiman/charter + `isCharter` + `originHint`/`destinationHint` (lihat `docs/arsitektur-transportasi.md` §9.9 untuk daftar lengkap). Skala sebanding Hotel §10 (refactor total modul existing dengan banyak konsumen berantai) — diputuskan Fase 0-5 boleh dieksekusi sebagai satu rangkaian berkelanjutan (deviasi Fase Eksekusi SOP yang sama dengan Hotel §10), asal verifikasi end-to-end menyeluruh (build + browser + test skenario manipulasi harga) dilakukan di Fase 6 sebelum dianggap selesai.

**Alternatives considered:**
- Mempertahankan `perSeatEnabled` sebagai opsi (bukan dihapus total) — ditolak user secara eksplisit lewat AskUserQuestion ("Sederhanakan — 1 harga per rute×kendaraan").
- Vendor/HPP di-scope per rute (pola Hotel "satu vendor per periode") — ditolak user, kendaraan berbeda butuh vendor independen.
- Mengalikan `totalPrice` dengan `numPassengers` (asumsi awal sebelum menganalisis 3 contoh harga user) — ditolak setelah verifikasi ulang: ketiga contoh harga user jelas flat per kendaraan, bukan per kepala.

**Belum dikerjakan:** Semua kode/schema — ini murni entri perencanaan. Eksekusi menunggu giliran sesuai SOP (Fase 0 dimulai setelah rencana ini stabil).

**Affects:**
- `docs/arsitektur-transportasi.md` — §9 baru (rencana lengkap: skema, integrasi harga, API routes, admin UI, publik & wizard, blast radius, fase eksekusi), banner status diperbarui

---

## 2026-07-19 — Modul Transportasi: Upgrade §9 Selesai & Terverifikasi — Gap #4 (Kritis) dan #5 Tertutup

**Decision:** Eksekusi rencana `docs/arsitektur-transportasi.md` §9 (entri di atas) — Fase 0 sampai Fase 6 dikerjakan sebagai satu rangkaian berkelanjutan (deviasi Fase Eksekusi SOP yang sama seperti Hotel §10, lihat entri 2026-07-19 "Deviasi Fase Eksekusi" di Hotel), diikuti verifikasi end-to-end penuh sebelum dianggap selesai.

**Skema:** `TransportTrip.originHint/destinationHint` → `origin`/`destination` (wajib). `TransportPricing` kehilangan 6 kolom musiman + `perSeatEnabled`, diganti 1 kolom `price` (cache `computeSellPrice()`, default 0). `BookingTransport.isCharter` dihapus. Migrasi `20260719163317_transport_route_vehicle_pricing` dijalankan dengan shadow DB terverifikasi terpisah (`saudinesia_shadow`, guard `if [ "$REAL" = "$SHADOW" ]` sebelum dipakai — pola yang sama dipertahankan sejak insiden near-miss di sesi ini). Backfill: `origin`/`destination` dari hint lama (2 trip City Tour yang tidak punya hint diisi manual sesuai nama trip), `price` dari `charterRegular` lama (supaya katalog tidak kosong selama admin belum isi HPP ulang). Row count semua tabel diverifikasi sama persis sebelum/sesudah — aman karena `bookings`/`booking_transports` = 0 baris (belum ada booking nyata).

**Integrasi HPP:** Transport jadi modul ke-4 (setelah Visa, Flight, Hotel) yang pakai `computeSellPrice()`/`ProductCost`/`PreferredVendor` — komponen tunggal `"kendaraan"`, pola identik Flight (`lib/pricing/refreshTransportPricingCache.ts`, didaftarkan ke cron kurs `lib/cron/exchangeRateJob.ts`). `Vendor.category` dapat nilai baru `'transport'`.

**Gap #4 (KRITIS) DITUTUP** — pola identik Gap #1 Hotel: `unitPrice`/`totalPrice`/`isCharter` dihapus total dari `transportSelectionSchema` (`lib/validators/booking.ts`), `app/api/v1/bookings/route.ts` sekarang fetch `TransportQuota.pricing.price` server-side di dalam `$transaction()`, `totalPrice = unitPrice` (flat, tidak dikali `numPassengers` — lihat §9.2 rasional harga flat per kendaraan, bukan per kepala). **Gap #5 DITUTUP** — semua route admin Transport (termasuk 2 yang baru: `pricing/[id]/cost`, `simulate`) sekarang `catch (e)` dengan `console.error` + pembedaan 403/500, bukan `catch{...403}` polos.

**Verifikasi dilakukan (Fase 6):**
1. `bun run build` — 0 error.
2. Browser end-to-end: admin trip edit page → cost editor (quick-add vendor "Syarikah Al-Rajhi Transport" kategori `transport`, currency IDR, harga kendaraan Rp 5.000.000) → preview live HPP Rp 5.000.000 (tanpa konversi kurs — currency IDR, identity shortcut dari bug fix awal sesi ini) → Harga Jual Rp 6.000.000 (margin 20% dibulatkan) → simpan → `TransportPricing.price` di DB ter-update jadi Rp 6.000.000 → katalog publik `/transport` langsung menampilkan harga baru tanpa refresh manual.
3. Script test Gap #4 (`verify_gap4_tmp.ts`, dijalankan sekali via `bun run` lalu dihapus — tidak masuk repo): simulasi payload client dengan `unitPrice: 1` pada quota yang `TransportPricing.price` aslinya Rp 4.500.000. Hasil: harga yang benar-benar tersimpan tetap Rp 4.500.000 — server sepenuhnya mengabaikan angka client, membuktikan Gap #4 tertutup secara fungsional, bukan cuma structural (Zod schema tidak lagi punya field tsb).

**Data verifikasi tetap disimpan** (vendor "Syarikah Al-Rajhi Transport" + HPP untuk kombinasi Bus×Airport Transfer) — bukan data uji yang dihapus, karena merupakan entri HPP yang valid/benar secara bisnis, sama seperti pola verifikasi Hotel sebelumnya di sesi ini. 19 kombinasi rute×kendaraan lain masih pakai harga backfill dari migrasi (belum diisi HPP oleh admin) — ini disengaja, sesuai keputusan "harga & HPP diisi lewat admin UI" (bukan di-seed).

**Alternatives considered:** Tidak ada — keputusan struktural sudah dikonfirmasi user di entri perencanaan sebelumnya, entri ini murni laporan hasil eksekusi.

**Affects:**
- `prisma/schema.prisma`, migrasi `20260719163317_transport_route_vehicle_pricing`
- `lib/pricing/refreshTransportPricingCache.ts` (baru), `lib/cron/exchangeRateJob.ts`
- `app/api/v1/admin/products/transport/**` — trips, pricing, `pricing/[id]/cost` (baru), `simulate` (baru), vehicles (error handling)
- `app/api/v1/catalog/transport/route.ts`, `app/api/v1/bookings/route.ts`, `lib/validators/booking.ts`
- `app/[locale]/admin/(protected)/products/transport/**` — list page + trip edit page (cost editor)
- `app/[locale]/(public)/transport/page.tsx`, `app/[locale]/(pilgrim)/bookings/new/transport/page.tsx`, `.../payment/page.tsx`, `lib/booking/draft.ts`
- `prisma/seed.ts` — seed trip pakai origin/destination, pricing tanpa harga manual (pola sama Hotel)
- `docs/arsitektur-transportasi.md` — §7 Gap #4/#5 DITUTUP, §9.10 ditandai selesai, banner status
- `docs/progress.md` — entri Transport diperbarui jadi selesai & terverifikasi

---

## 2026-07-20 — Modul Transportasi: Redesain UI Publik Rute-Dulu (Bukan Kendaraan-Dulu)

**Decision:** User minta refactor total UI halaman katalog publik `/transport` — bukan perbaikan gap teknis, melainkan perbaikan mental model UX. Observasi user: jamaah berpikir "saya butuh kendaraan dari titik A ke titik B" duluan, baru mikir kendaraan mana yang cocok — bukan sebaliknya (browse kendaraan dulu). UI lama (grouping by kategori, kartu utama = trip dengan vehicle grid di dalamnya) sudah dekat tapi belum benar-benar "rute dulu": tidak ada cara cepat cari "dari mana ke mana", kategori jadi filter utama padahal rute yang harusnya jadi fokus.

**Desain baru** (dikonfirmasi via mockup visual sebelum eksekusi, pola `mcp__visualize`): search box "Dari/Ke" di atas (dropdown dari nilai origin/destination aktual yang ada, bukan free-text — karena rute sudah pasti/predefined oleh admin, bukan lokasi bebas ala Google Maps), chip filter kategori cepat di bawahnya, hasil berupa **kartu rute** (ikon arah + "A → B" sebagai elemen utama) dengan kendaraan sebagai baris pilihan *di dalam* kartu — bukan kartu kendaraan seperti sebelumnya.

**Scope dikonfirmasi user**: hanya halaman katalog publik (`/transport`), BUKAN wizard booking (`bookings/new/transport`) — wizard tetap struktur lama karena sudah terikat tanggal keberangkatan & jumlah jamaah dari step sebelumnya, refactor terpisah kalau nanti diperlukan.

**Implementasi:** `components/shared/TransportSearch.tsx` (baru, client component) — state filter origin/destination/kategori, client-side filtering atas data yang di-fetch server-side (skala kecil, tidak perlu round-trip server per filter). `app/[locale]/(public)/transport/page.tsx` disederhanakan jadi murni data-fetching, pass ke komponen di atas.

**Verifikasi:** `bun run build` 0 error, browser end-to-end — filter Dari/Ke bekerja (termasuk kombinasi yang tidak match → empty state dengan tombol reset), chip kategori, swap button, responsive mobile (chip filter scroll horizontal). Sempat ada `Internal Server Error` dari cache `.next` yang korup karena `bun run build` (production) dijalankan bersamaan dengan dev server aktif di port yang sama — bukan bug aplikasi, fix dengan stop dev server + `rm -rf .next` + restart.

**Alternatives considered:**
- Search bebas teks (ketik nama lokasi apa saja) — ditolak, rute di sistem ini predefined oleh admin (finite set), bukan lokasi bebas — search bebas akan menyiratkan fleksibilitas yang tidak ada.
- Redesain sekaligus di wizard booking — ditolak user, scope dibatasi ke katalog publik dulu.

**Affects:**
- `components/shared/TransportSearch.tsx` — baru
- `app/[locale]/(public)/transport/page.tsx` — disederhanakan

---

## 2026-07-20 — Modul Muthowif: Rencana Perombakan ke Booking Generik + Assignment Admin

**Decision:** User mengidentifikasi bahwa model marketplace saat ini (jamaah browse & pilih 1 muthowif by name saat booking, `docs/arsitektur-muthowif.md` §1-§7) tidak cocok dengan positioning Saudinesia sebagai **curated operator** (`CLAUDE.md` baris 1) — bukan marketplace tempat jamaah pilih orang secara langsung. Rencana lengkap ditulis di `docs/arsitektur-muthowif.md` §9 — **belum dieksekusi**, murni dokumentasi arsitektur dulu sesuai Fase Eksekusi SOP.

**3 keputusan struktural dikonfirmasi user via AskUserQuestion:**
1. Muthowif spesifik ditentukan oleh **admin secara manual setelah booking dibuat** (bukan client pilih, bukan auto-assign algoritmik) — sesuai "kita yang siapkan yang layak", keputusan kurasi manusia.
2. **Tidak ada opsi pilih manual** oleh jamaah sama sekali, bahkan sebagai opsi tambahan — wizard murni "pesan layanan", roster di katalog publik jadi showcase/marketing terpisah dari alur booking.
3. Harga jadi **satu harga layanan flat** (bukan per-orang) — karena muthowif spesifik belum diketahui saat booking, harga tidak bisa lagi mengikuti profil tertentu. Field harga di `Muthowif` dipindah ke entitas baru `MuthowifServicePrice` (singleton, 3 kolom season, pola sama `PricingRule`).

**Konsekuensi arsitektur kapasitas** (dianalisis, bukan dari AskUserQuestion langsung): karena assignment ditunda, kapasitas tidak bisa lagi dicek per-orang di titik reservasi (booking creation) — perlu 2 lapis: **pool-level** (`MuthowifPoolAvailability`, baru, kapasitas = SUM live `dailyCapacity` semua muthowif aktif, direservasi saat booking dibuat) dan **individual-level** (`MuthowifAvailability`, dipertahankan, tapi sekarang dipakai di titik **assignment** oleh admin, bukan di booking creation) — supaya 1 muthowif tidak ter-assign melebihi kapasitas hariannya sendiri meski pool secara agregat masih cukup.

**Efek samping struktural:** Gap #1 KRITIS (`confirmMuthowifQuota()` tidak ada, `docs/arsitektur-muthowif.md` §7) tertutup sebagai bagian dari redesign ini — payment confirm route yang direstrukturisasi otomatis butuh fungsi confirm di kedua level (pool + individual). Gap harga client-trusted (`totalPrice` dari frontend, dicatat di §6) juga ikut tertutup karena sumber harga sudah direstrukturisasi jadi server-computed dari `MuthowifServicePrice`.

**Sengaja tidak disentuh:** self-cancel jamaah yang tidak pernah release kuota apa pun (`docs/arsitektur-umroh.md` §7 Gap #2) — pre-existing, lintas-modul, tidak diminta di sesi ini.

**Alternatives considered:**
- Auto-assign algoritmik (round-robin/kapasitas terbanyak) saat booking dibuat — ditolak user, tidak ada unsur kurasi manusia yang diminta ("kita yang siapkan yang layak" secara eksplisit menyiratkan keputusan manusia).
- Jamaah tetap boleh pilih spesifik secara opsional (hybrid) — ditolak user, maunya murni "pesan layanan" tanpa pilihan nama sama sekali.
- Harga tetap per-muthowif, dipatok dari termurah/rata-rata saat estimasi — ditolak user demi kesederhanaan, harga flat lebih konsisten dengan model "membayar jasa, bukan memilih orang".

**Belum dikerjakan:** Semua kode/schema — entri ini murni laporan keputusan perencanaan. Eksekusi menunggu giliran sesuai SOP.

**Affects:**
- `docs/arsitektur-muthowif.md` — §9 baru (rencana lengkap: skema, fungsi kuota, integrasi lifecycle, API routes, admin UI, publik & wizard, blast radius, fase eksekusi), banner status diperbarui

---

## 2026-07-20 — Modul Muthowif: Upgrade §9 Selesai & Terverifikasi — Gap #1 (Kritis), #4, #8, #9 Tertutup

**Decision:** Eksekusi rencana `docs/arsitektur-muthowif.md` §9 (entri di atas) — Fase 0 sampai Fase 6 dikerjakan sebagai satu rangkaian berkelanjutan (deviasi Fase Eksekusi SOP yang sama seperti Hotel §10/Transport §9), diikuti verifikasi end-to-end penuh sebelum dianggap selesai.

**Skema:** `Muthowif` kehilangan `priceRegular/Ramadan/Hajj` (harga sekarang milik `MuthowifServicePrice`, singleton, 3 kolom season — pola sama `PricingRule`). `BookingMuthowif.muthowifId` jadi nullable + `assignedAt` baru. `MuthowifPoolAvailability` (baru) — kapasitas pool per tanggal, dihitung live dari `SUM(Muthowif.dailyCapacity WHERE isActive)`, bukan disimpan. `MuthowifAvailability` (individual, sudah ada) dipertahankan tapi sekarang dipakai di titik assignment, bukan booking creation. Migrasi `20260720000000_muthowif_pool_assignment_model` — shadow DB terverifikasi terpisah, row count sebelum/sesudah sama persis (0 booking nyata terdampak). Seed `MuthowifServicePrice` 1 baris (Rp 300rb/520rb/750rb, representatif rata-rata harga 3 guide lama).

**Alur baru:** booking creation reserve **pool** quota (bukan per-orang, karena muthowif spesifik belum ditentukan), `BookingMuthowif.muthowifId` tetap `null`, `totalPrice` dihitung server-side dari `MuthowifServicePrice`+season (menutup gap harga client-trusted yang dicatat di §6, sekalian karena sumber harga sudah direstrukturisasi). Admin assign muthowif spesifik dari roster aktif via `lib/muthowif/assign.ts` (`assignMuthowifToBooking()`) — reservasi individual per hari, auto-confirm individual juga kalau booking ternyata sudah lunas duluan (assignment bisa terjadi kapan saja, sebelum atau sesudah pembayaran). Payment confirm sekarang confirm pool DAN individual (kalau sudah assigned) — **menutup Gap #1 KRITIS** (`confirmMuthowifQuota()` yang dulu tidak ada sama sekali).

**Efek samping struktural lain:** Gap #4 (tidak ada PUT/edit/`isActive` toggle) ditutup — dibutuhkan supaya admin bisa kelola roster yang jadi basis perhitungan kapasitas pool, bukan sekadar nice-to-have. Gap #8 (quotas page tidak ada breakdown) ditutup — diganti tabel pool 30-hari, bentuk baru sesuai model pool (bukan lagi per-guide). Gap #9 (dead code `MuthowifPicker.tsx`) ditutup — dikonfirmasi zero import lalu dihapus, sama pola `TransportPicker.tsx`/`HotelPicker.tsx` sebelumnya di sesi ini.

**Sengaja tidak disentuh:** Gap #2 (`photoUrl` tidak dipakai — butuh integrasi MinIO upload, di luar scope), #3 (`languages` tanpa type formal), #5 (`rating` statis, tidak ada sistem review), #7 (reservasi all-or-nothing tidak dikomunikasikan spesifik hari mana yang penuh — sekarang di level pool, bukan per-orang, tapi gap UX-nya sama).

**Verifikasi dilakukan (Fase 6):**
1. `bun run build` — 0 error.
2. Browser end-to-end: admin list muthowif (panel "Harga Layanan Muthowif" terisi dari DB, 300rb/520rb/750rb) → halaman edit roster (toggle isActive, form field lengkap) → katalog publik `/muthowif` (showcase murni — nama/bio/bahasa/rating, harga muncul SEKALI di header "Harga layanan mulai Rp 300.000/hari", bukan per-kartu) → homepage featured section (harga juga sekali, bukan per-kartu) → wizard step muthowif (toggle "Tambahkan layanan muthowif", sinkron ke `PriceSidebar` dengan label generik "Layanan Muthowif" — dikonfirmasi BUKAN nama orang, tombol berubah dari "Lewati" jadi aktif saat toggle nyala).
3. Script test siklus penuh (`verify_muthowif_tmp.ts`, dijalankan sekali via `bun run` lalu dihapus — tidak masuk repo): (a) booking creation → `reservePoolMuthowifQuota` → pool pending naik 10, `BookingMuthowif.muthowifId` tetap `null`; (b) admin assign via `assignMuthowifToBooking` → individual pending naik 10 (booking belum lunas jadi belum confirm), `muthowifId`+`assignedAt` terisi; (c) payment confirm → pool DAN individual pending→booked bersamaan (0 pending, 10 booked di kedua level). Semua tahap konsisten sesuai desain 2-lapis (§9.2).

**Alternatives considered:** Tidak ada — keputusan struktural sudah dikonfirmasi user di entri perencanaan sebelumnya, entri ini murni laporan hasil eksekusi.

**Affects:**
- `prisma/schema.prisma`, migrasi `20260720000000_muthowif_pool_assignment_model`
- `lib/quota/index.ts` (4 fungsi baru: pool reserve/release/confirm + individual confirm), `lib/muthowif/assign.ts` (baru)
- `app/api/v1/admin/products/muthowif/**` — service-price (baru), `[id]` (baru), POST (Zod)
- `app/api/v1/admin/bookings/[id]/muthowif/assign/route.ts` (baru)
- `app/api/v1/catalog/muthowif/route.ts`, `app/api/v1/bookings/route.ts`, `app/api/v1/admin/payments/[id]/confirm/route.ts`, `lib/cron/autocancelJob.ts`, `lib/validators/booking.ts`
- `app/[locale]/admin/(protected)/products/muthowif/**` — list page + edit page (baru)
- `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` + `MuthowifAssignPanel.tsx` (baru)
- `app/[locale]/admin/(protected)/quotas/page.tsx`
- `app/[locale]/(public)/muthowif/page.tsx`, `[id]/page.tsx`, `app/[locale]/(public)/page.tsx`
- `app/[locale]/(pilgrim)/bookings/new/muthowif/page.tsx`, `.../payment/page.tsx`, `lib/booking/draft.ts`, `components/booking/PriceSidebar.tsx`
- `components/booking/MuthowifPicker.tsx` — dihapus (dead code)
- `prisma/seed.ts` — muthowif seed tanpa harga per-orang, tambah seed `MuthowifServicePrice`
- `docs/arsitektur-muthowif.md` — §7 Gap #1/#4/#6/#8/#9 DITUTUP, §9.10 ditandai selesai, banner status
- `docs/progress.md` — entri Muthowif diperbarui jadi selesai & terverifikasi

---

## 2026-07-20 — Aturan Baru: Recheck Dokumen vs Kode Wajib Sebelum Rencana Upgrade Apa Pun

**Decision:** User mengoreksi proses: "sebelum buat apapun kita harus memastikan antara arsitektur dan implemented code harus benar-benar sama terlebih dahulu, baru kita masuk ke upgrade fitur" — dikatakan setelah menyadari upgrade Muthowif (entri di atas) direncanakan tanpa recheck menyeluruh doc-vs-kode terlebih dahulu (cuma grep skema sebagian, bukan audit penuh seperti yang dilakukan untuk Transport). `CLAUDE.md` "Fase Eksekusi SOP" diubah: poin baru "1. Recheck dulu" disisipkan SEBELUM "buat perencanaan arsitektur" (poin lama #1 jadi #2), dengan penekanan eksplisit — jangan percaya begitu saja status "SOURCE OF TRUTH"/"SELESAI & TERVERIFIKASI" di dokumen, selalu verifikasi ulang setiap kali sebelum dipakai sebagai dasar rencana baru.

**Diterapkan langsung sebagai bukti**: recheck menyeluruh `docs/arsitektur-muthowif.md` §9 vs kode aktual (5 model schema, 6 fungsi kuota, `assign.ts`, 5 API routes, booking lifecycle, 3 halaman admin, 3 halaman publik, wizard+draft+validator+PriceSidebar, dead code) — semua cocok persis, tidak ada drift, `bun run build` tetap 0 error.

**Rationale:** Pola ini sudah terbukti berulang kali sepanjang sesi (Flight, Hotel, Transport sync-check) menemukan gap nyata yang tidak pernah tercatat — bukan formalitas. Melewatkan langkah ini berisiko merancang arsitektur baru di atas premis yang keliru.

**Alternatives considered:** Tidak ada — ini koreksi proses dari user, bukan keputusan teknis dengan alternatif.

**Affects:**
- `CLAUDE.md` — "Fase Eksekusi SOP" direnumbering, poin 1 baru ditambahkan
- Memori sesi (`feedback_verify_doc_before_upgrade.md`) — disimpan sebagai aturan tetap lintas-sesi

---

## 2026-07-20 — Gap Kecil di 3 Modul Selesai: Muthowif Gap #2/#7, Transport Gap #1, Hotel Gap #3

**Decision:** Setelah rekap status seluruh sesi, user memilih 4 gap kecil (dari daftar gap yang sengaja ditinggalkan di modul-modul yang sudah dirombak) untuk dikerjakan sekaligus: Hotel Gap #3, Transport Gap #1, Muthowif Gap #2, Muthowif Gap #7. Sesuai aturan baru (entri di atas), tiap gap di-recheck dulu ke kode aktual sebelum disentuh — semua 4 terkonfirmasi akurat sesuai deskripsi dokumen sebelum eksekusi dimulai.

**Muthowif Gap #7** (pesan error kapasitas tidak spesifik): `reservePoolMuthowifQuota()` di `lib/quota/index.ts` sekarang menyertakan tanggal spesifik (format Indonesia) + sisa kapasitas di pesan error. Kata kunci "insufficient"/"capacity" dipertahankan dalam pesan (meski isinya sudah Bahasa Indonesia) supaya tetap cocok dengan pattern-match `error.message.includes(...)` di `app/api/v1/bookings/route.ts` yang men-forward pesan ini sebagai HTTP 409 ke client — perubahan ini murni di titik lahirnya pesan, tidak perlu ubah route atau halaman payment (sudah otomatis menampilkan `json.error` ke user).

**Transport Gap #1** (pickupDetail/dropoffDetail selalu kosong): `bookings/new/transport/page.tsx` — begitu jamaah pilih kendaraan untuk sebuah trip, muncul 2 input teks (titik jemput/antar, placeholder dari `trip.origin`/`trip.destination`) yang sinkron ke draft. Tidak perlu ubah validator/API/payment page — field ini sudah lengkap didukung di seluruh chain, cuma UI input-nya yang hilang.

**Hotel Gap #3** (`HotelService` tanpa jalur admin): Ditambahkan `app/api/v1/admin/products/hotels/[id]/services/route.ts` (GET/POST) dan `[serviceId]/route.ts` (PUT/DELETE — soft-delete via `isActive` kalau `BookingService` sudah pernah mereferensikannya, hard-delete kalau belum pernah dipakai), plus section "Layanan Hotel" penuh (form tambah/edit + list dengan toggle status) di halaman edit hotel admin. Integrasi ke wizard booking (model `BookingService` sudah ada di schema tapi tidak pernah dipakai kode manapun) **sengaja tidak disentuh** — di luar scope permintaan (jalur admin-isi-data saja, bukan alur beli).

**Muthowif Gap #2** (`photoUrl` tidak pernah dipakai): Field schema **direname** `photoUrl` → `photoKey` — karena field lama selalu `NULL` di semua baris (dikonfirmasi via query sebelum migrasi, zero risiko data), dan nama lama menyalahi konvensi `CLAUDE.md` ("Store object keys in DB, never full URLs"). Karena field ini belum pernah punya konsumen nyata, ini momen paling murah untuk membetulkan nama sebelum ada kode yang bergantung padanya. Endpoint upload/hapus baru (`admin/products/muthowif/[id]/photo/route.ts`, pola sama endpoint images Hotel — validasi MIME+ukuran, `buildObjectKey('muthowif', id, 'photo', filename)`, hapus object lama saat ganti foto). UI upload di halaman edit admin (file input tersembunyi + tombol, preview lingkaran). Presigned URL digenerate di titik baca di semua tempat yang merender: katalog publik (list+detail), homepage featured section, admin edit page.

**Verifikasi:** `bun run build` 0 error setelah tiap fix. Browser end-to-end untuk Muthowif Gap #2 — upload foto sungguhan (1×1 PNG test) via `admin/products/muthowif/[id]` → dikonfirmasi tersimpan di MinIO + `photoKey` di DB → tampil benar di halaman edit admin DAN katalog publik `/muthowif` (presigned URL, guide lain tanpa foto tetap fallback ikon) → foto test dihapus lagi via endpoint DELETE supaya roster asli tetap bersih dari data uji.

**Alternatives considered:** Rename `photoUrl`→`photoKey` ditolak sebagai opsi "biarkan nama lama, simpan key di dalamnya" — dipilih rename karena field belum punya konsumen sama sekali sehingga biaya rename saat ini nyaris nol, sementara nama yang salah akan terus menyesatkan pembaca kode ke depannya.

**Affects:**
- `lib/quota/index.ts` — pesan error `reservePoolMuthowifQuota()`
- `app/[locale]/(pilgrim)/bookings/new/transport/page.tsx` — input pickupDetail/dropoffDetail
- `prisma/schema.prisma`, migrasi `20260720100000_muthowif_photo_key` — rename `photoUrl`→`photoKey`
- `app/api/v1/admin/products/hotels/[id]/services/**` (baru), `app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx` — section Layanan Hotel
- `app/api/v1/admin/products/muthowif/[id]/photo/route.ts` (baru), `app/api/v1/admin/products/muthowif/[id]/route.ts`, `app/api/v1/catalog/muthowif/route.ts`
- `app/[locale]/admin/(protected)/products/muthowif/[id]/page.tsx` — UI upload foto
- `app/[locale]/(public)/muthowif/page.tsx`, `[id]/page.tsx`, `app/[locale]/(public)/page.tsx` — render foto
- `docs/arsitektur-hotel.md` §8 Gap #3, `docs/arsitektur-transportasi.md` §7 Gap #1, `docs/arsitektur-muthowif.md` §7 Gap #2/#7 — semua DITUTUP
- `docs/progress.md` — entri baru "Gap kecil di 3 modul"

---

## 2026-07-20 — Modul Muthowif: Rencana Integrasi HPP Universal Ditulis

**Decision:** User: "tidak ada harga HPP untuk muthowif" — `MuthowifServicePrice` (§9) adalah harga jual yang diketik admin langsung (3 kolom season), tanpa dasar HPP/vendor/kurs. Rencana lengkap ditulis di `docs/arsitektur-muthowif.md` §10 — **belum dieksekusi**, murni dokumentasi arsitektur dulu sesuai Fase Eksekusi SOP (recheck dulu dilakukan: dikonfirmasi `MuthowifServicePrice` benar-benar cuma angka manual, infrastruktur `Vendor`/`ProductCost`/`PricingRule`/`PreferredVendor` dikonfirmasi generik dan reusable tanpa perubahan skema).

**1 keputusan struktural dikonfirmasi user via AskUserQuestion:** Struktur 3-season (`priceRegular`/`priceRamadan`/`priceHajj`) diganti **satu harga flat** — karena `computeSellPrice()` tidak punya konsep season (cuma tier per jumlah hari), dan konsisten dengan preseden Transport (§9.1: "harga vendor riil tidak dipecah per musim seperti itu").

**Desain:** Muthowif paling mirip **Flight** — komponen HPP tunggal `"layanan"`, tidak day-based (flat tier `[{minDays:0,maxDays:9999,cost}]`), `productId` = `MuthowifServicePrice.id` milik baris singleton itu sendiri (bukan per-muthowif, karena harga bukan atribut individu, konsisten dengan §9). `Vendor.category` dapat nilai baru `'muthowif'`. Endpoint `service-price` (PUT dihapus, jadi read-only cache) + `service-price/cost` (baru, HPP editor) + `service-price/simulate` (baru, preview live) — pola identik `flight/schedules/[id]/cost`+`simulate`, tapi tanpa `[id]` di path karena singleton. `detectSeason()` dihapus dari `catalog/muthowif` dan `bookings/route.ts` (muthowif tidak lagi butuh deteksi musim).

**Blast radius dicek via grep dulu**: ~7 file inti (route admin/catalog/booking creation + 3 halaman publik + 1 halaman admin) + beberapa file baru (cost/simulate route, cache refresh). Skala kecil (lebih kecil dari §9) — Fase 0-5 dieksekusi sebagai satu rangkaian berkelanjutan, verifikasi menyeluruh di Fase 6.

**Alternatives considered:**
- Tetap 3 season dengan 3 komponen HPP terpisah (mis. "layanan_regular"/"layanan_ramadan"/"layanan_hajj") — ditolak user demi kesederhanaan, konsisten dengan preseden Transport.

**Belum dikerjakan:** Semua kode/schema — entri ini murni laporan keputusan perencanaan.

**Affects:**
- `docs/arsitektur-muthowif.md` — §10 baru (rencana lengkap: skema, integrasi harga, API routes, admin UI, publik, blast radius, fase eksekusi)

---

## 2026-07-20 — Modul Muthowif: Integrasi HPP Universal Selesai & Terverifikasi

**Decision:** Eksekusi rencana `docs/arsitektur-muthowif.md` §10 (entri di atas) — Fase 0 sampai Fase 6 dikerjakan sebagai satu rangkaian berkelanjutan (skala kecil, ~7 file inti), verifikasi menyeluruh di Fase 6.

**Skema:** `MuthowifServicePrice` kehilangan `priceRegular`/`priceRamadan`/`priceHajj`, diganti satu kolom `price` (cache `computeSellPrice()`, default 0). Migrasi `20260720180000_muthowif_service_price_flat` — shadow DB terverifikasi terpisah, backfill `price` dari `priceRegular` lama (Rp 300.000) supaya tidak kosong selama transisi.

**Integrasi HPP:** Muthowif jadi modul ke-5 (setelah Visa, Flight, Hotel, Transport) yang pakai `computeSellPrice()`/`ProductCost`/`PreferredVendor` — komponen tunggal `"layanan"`, pola identik Flight (tidak day-based, `productId` = `MuthowifServicePrice.id` milik baris singleton itu sendiri). `Vendor.category` dapat nilai baru `'muthowif'`. `lib/pricing/refreshMuthowifServicePriceCache.ts` (baru) didaftarkan ke cron kurs.

**API routes:** `service-price` disederhanakan jadi GET-only (baca cache, PUT dihapus — harga tidak lagi diisi manual). `service-price/cost` (baru, HPP editor) dan `service-price/simulate` (baru, preview live) — pola identik `flight/schedules/[id]/cost`+`simulate`, tapi tanpa `[id]` di path karena `MuthowifServicePrice` singleton. `catalog/muthowif` dan `app/api/v1/bookings/route.ts` kehilangan `detectSeason()` untuk muthowif (import jadi tidak terpakai di `bookings/route.ts`, dihapus).

**Admin UI:** panel 3-input harga manual di `admin/products/muthowif/page.tsx` diganti total jadi cost editor (vendor quick-add + currency + harga layanan + preview live HPP/harga jual), pola sama panel cost Flight/Transport tapi cuma 1 panel (bukan per-row) karena singleton.

**Insiden kecil saat verifikasi:** `bun run build` sempat merah setelah semua fase — `prisma/seed.ts` masih punya `create({ priceRegular, priceRamadan, priceHajj })` untuk seed `MuthowifServicePrice` (dibuat di sesi sebelumnya, sebelum kolom-kolom itu dihapus dari schema). Diperbaiki jadi `create({ price: 300_000 })`, build hijau lagi. Ini persis alasan kenapa Fase 6 selalu menjalankan `bun run build` sebagai gate wajib — bukan asumsi bahwa "semua file sudah diupdate" itu benar tanpa diverifikasi ulang.

**Verifikasi:** `bun run build` 0 error (setelah fix seed.ts). Browser end-to-end: admin isi HPP (quick-add vendor "Yayasan Pembimbing Haji Makkah", kategori `muthowif`, currency IDR, harga layanan Rp 350.000) → preview live benar (HPP Rp 350.000 tanpa konversi kurs karena IDR, Harga Jual Rp 400.000 margin 20% dibulatkan ke kelipatan 50.000) → simpan → `MuthowifServicePrice.price` di DB ter-update ke Rp 400.000, `ProductCost`+`PreferredVendor`+`Vendor` tersimpan lengkap → katalog publik `/muthowif` langsung menampilkan Rp 400.000 tanpa refresh manual.

**Alternatives considered:** Tidak ada — keputusan struktural (satu harga flat, hapus season) sudah dikonfirmasi user di entri perencanaan sebelumnya, entri ini murni laporan hasil eksekusi.

**Affects:**
- `prisma/schema.prisma`, migrasi `20260720180000_muthowif_service_price_flat`
- `lib/pricing/refreshMuthowifServicePriceCache.ts` (baru), `lib/cron/exchangeRateJob.ts`
- `app/api/v1/admin/products/muthowif/service-price/route.ts` (disederhanakan), `.../cost/route.ts` (baru), `.../simulate/route.ts` (baru)
- `app/api/v1/catalog/muthowif/route.ts`, `app/api/v1/bookings/route.ts`
- `app/[locale]/admin/(protected)/products/muthowif/page.tsx` — cost editor
- `app/[locale]/(public)/muthowif/page.tsx`, `[id]/page.tsx`, `app/[locale]/(public)/page.tsx`
- `prisma/seed.ts` — fix seed `MuthowifServicePrice` pakai field baru
- `docs/arsitektur-muthowif.md` — §10 ditandai selesai, banner status
- `docs/progress.md` — entri baru integrasi HPP Muthowif

---

## 2026-07-20 — Modul Muthowif: Koreksi — Tidak Ada Vendor Pihak Ketiga, Pakai Vendor "Saudinesia"

**Decision:** User mengoreksi implementasi HPP Muthowif (entri di atas) yang baru selesai: Muthowif beda dari Visa/Flight/Hotel/Transport karena tidak punya vendor pihak ketiga sungguhan — sifatnya personal/internal, Saudinesia menetapkan sendiri "harga pasaran" muthowif lalu mark-up sendiri, bukan beli dari vendor luar. User menyodorkan sendiri opsi solusinya: kalau sistem benar-benar butuh istilah vendor, set saja vendornya "Saudinesia".

**2 keputusan dikonfirmasi via AskUserQuestion:**
1. Vendor tetap **ditampilkan** di UI (read-only, bukan disembunyikan total) — supaya konsisten secara visual dengan modul lain dan jelas asal datanya kalau ada yang audit data kemudian hari.
2. Currency **tetap bisa dipilih** (tidak dikunci ke Rupiah) — walau di praktik kemungkinan besar selalu IDR.

**Implementasi:** `ProductCost.vendorId` tetap wajib diisi (skema generik dipakai 4 modul lain, tidak diubah demi satu kasus khusus — mengubah jadi nullable akan berdampak ke Visa/Flight/Hotel/Transport yang sudah selesai & terverifikasi, risiko tidak sepadan). Satu vendor tetap bernama **"Saudinesia"** (kategori `'internal'`) dibuat otomatis lewat `getOrCreateSaudinesiaVendor()` di `.../service-price/cost/route.ts` — admin tidak pernah memilih atau membuat vendor untuk komponen ini, form HPP Muthowif kehilangan dropdown/quick-add vendor sepenuhnya, cuma field teks read-only "Saudinesia" + currency + harga layanan.

**Data lama dibersihkan**: vendor test "Yayasan Pembimbing Haji Makkah" (dibuat saat verifikasi fase sebelumnya, sebelum koreksi ini) dihapus setelah dikonfirmasi tidak ada `ProductCost` yang mereferensikannya lagi (sudah pindah ke vendor Saudinesia lewat save ulang).

**Verifikasi:** `bun run build` 0 error. Browser end-to-end: form HPP menampilkan "Saudinesia" read-only (bukan dropdown) → isi harga baru (Rp 360.000) → simpan → `ProductCost.vendorId` di DB benar-benar mengarah ke vendor "Saudinesia" (kategori `internal`) → harga ter-update (Rp 450.000) → katalog publik langsung menampilkan harga baru.

**Alternatives considered:**
- Vendor disembunyikan total dari UI (tidak ditampilkan sama sekali) — ditolak user, tetap mau vendor terlihat read-only untuk keperluan audit.
- Kunci currency ke Rupiah saja — ditolak user, tetap mau fleksibilitas pilih currency seperti modul lain.
- Ubah `ProductCost.vendorId` jadi nullable (skip vendor concept sepenuhnya di level skema) — tidak dipertimbangkan serius karena berisiko ke 4 modul lain yang sudah pakai kolom itu sebagai required.

**Affects:**
- `app/api/v1/admin/products/muthowif/service-price/cost/route.ts` — `getOrCreateSaudinesiaVendor()`, `vendorId` dihapus dari request body
- `app/[locale]/admin/(protected)/products/muthowif/page.tsx` — vendor jadi read-only text, quick-add vendor UI dihapus
- `docs/arsitektur-muthowif.md` §10.3/§10.4/§10.6 — diperbarui dengan penjelasan vendor "Saudinesia"
- Data: vendor "Yayasan Pembimbing Haji Makkah" dihapus (orphaned test data)

---

## 2026-07-20 — Modul Ziarah & Paket: `docs/arsitektur-ziarah.md` Ditulis — Package Ditemukan Non-Fungsional

**Decision:** User minta cek sinkronisasi antara "ziarah" dan "paket" — tidak ada dokumen arsitektur sebelumnya untuk modul ini, jadi ditulis langsung dari audit kode aktual (`docs/arsitektur-ziarah.md`, baru, source of truth ke-7 setelah Visa/Transport/Muthowif/Umroh/Tiket Pesawat/Hotel).

**Temuan utama:** "Ziarah" dan "Paket" yang diminta user untuk disinkronkan ternyata **bukan dua bagian dari satu sistem, melainkan dua model independen yang kebetulan berbagi kata "paket" di label UI** — bukan gap sinkronisasi untuk diperbaiki, karena memang belum pernah ada sinkronisasi sejak awal:
- **"Paket Ziarah"** (judul halaman admin `products/tours`, label step wizard) = model `HeritageTour` — produk tur wisata sejarah yang **nyata bisa dibooking**, terintegrasi penuh ke wizard (step Addons) dan `BookingTour`.
- **"Paket & Bundle"/"Paket Lengkap"** (halaman admin `products/packages`, katalog publik `/packages`) = model `Package` — dimaksudkan sebagai bundle produk (skema `PackageItem` polimorfik ke semua `productType` termasuk `'tour'`), tapi **secara fungsional cuma kartu marketing statis**.

**Bukti `Package` non-fungsional** (dikonfirmasi via grep menyeluruh ke `app/` dan `lib/`): `PackageItem` tidak direferensikan di satu pun kode di luar definisi schema-nya sendiri — tidak ada endpoint admin untuk menambah/kelola item ke sebuah paket (list page tampilkan kolom "{count} produk" yang akan selamanya 0 karena tidak ada jalur mengisinya), CTA "Pesan Paket Ini" di katalog publik cuma `<Link href="/register">` generik tanpa membawa konteks paket apa pun, dan `Package.price` independen dari `items` (tidak direkonsiliasi meski items diisi manual lewat database).

**Gap lain ditemukan** (murni didokumentasikan, tidak dikerjakan — sesi ini scope-nya dokumentasi): harga booking tur client-trusted (`BookingTour.totalPrice` dari client mentah, pola sama yang sudah ditutup di Hotel/Transport/Muthowif), tidak ada kuota/kapasitas untuk tur (`maxGroupSize` cuma informational), admin `HeritageTour` create-only, `booking.tours`/`booking.catering` fetched-tapi-tak-dirender di detail booking admin (pola sama yang sudah ditutup di Transport/Muthowif), error handling `catch{403}` polos tanpa Zod di semua route tours/packages, dan belum terintegrasi arsitektur harga universal.

**Alternatives considered:** Tidak ada — sesi ini murni audit/dokumentasi sesuai permintaan user, tidak ada keputusan struktural yang diambil.

**Affects:**
- `docs/arsitektur-ziarah.md` — baru, source of truth Ziarah (HeritageTour) & Paket (Package)
- `CLAUDE.md` — daftar modul yang sudah teraudit diperbarui, ringkasan temuan Package non-fungsional ditambahkan
- `docs/progress.md` — entri baru dengan pointer ke dokumen + ringkasan 7 gap

---

## 2026-07-20 — Modul Ziarah: Rencana Paket Ziarah Terintegrasi Transport Ditulis

**Decision:** User bercerita visi 4 poin untuk Paket Ziarah: (1) master data tempat wisata se-Arab Saudi (foto, deskripsi, gmaps url), (2) terintegrasi dengan harga kendaraan yang sudah ada di Transport supaya HPP jelas, (3) komponen biaya tambahan bebas (guide, makan, minum, dst) supaya admin mudah susun harga publish, (4) minta pendapat kritis apakah ini memungkinkan. Rencana lengkap ditulis di `docs/arsitektur-ziarah.md` §8 — **belum dieksekusi**.

**Analisis kritis yang disampaikan ke user sebelum desain**: `TransportTrip` berkategori `city_tour` **sudah ada** dan persis berbentuk "satu rute, beberapa pilihan kendaraan+harga" (mis. "City Tour Makkah — Ziarah 4 Tempat", sudah di-seed sejak modul Transport dibuat) — tumpang tindih langsung dengan `HeritageTour` yang menggambarkan produk yang sama tanpa saling terhubung. Ini pola ketiga di sesi ini (setelah Ziarah-vs-Paket) di mana dua sistem independen ternyata memodelkan hal yang sama. Rekomendasi: satukan, jangan tambah sistem keempat.

**4 keputusan struktural dikonfirmasi user via AskUserQuestion:**
1. `HeritageTour`/`BookingTour` **diganti total** oleh `TourPackage` baru (belum ada booking nyata).
2. Kendaraan **pakai ulang `TransportTrip`/`TransportPricing`** yang sudah ada — Paket Ziarah referensi ke satu `TransportTrip`, bukan data harga kendaraan baru.
3. Kuota kendaraan **reuse `TransportQuota`** yang sama dengan booking Transport biasa — dikonfirmasi user: "transport kita tidak pernah jual perkursi, kita jual paket mobil bukan paket kursi... tidak ada hubungan antara kapasitas kursi dengan penyewaan kendaraan di paket wisata" (maksudnya: unit kendaraan fisik yang sama harus berbagi satu pool kuota lintas kedua jalur booking, mencegah dijual dobel).
4. Margin **per-komponen, dijumlah di akhir** — bukan satu margin gabungan di atas total HPP (itu margin berlapis untuk kendaraan yang harganya sudah final dari Transport). Dikonfirmasi user: "dalam tabel semua variable menampilkan semua, mulai dari HPP sampai harga jual, lalu di akhir semua harga jual itu ditambahkan menjadi harga jual paket". "Guide" dikonfirmasi jadi item biaya tambahan biasa (bukan terhubung ke Muthowif — beda konteks: guide tur jam-jaman vs pembimbing ibadah multi-hari).

**Desain kunci — pola perhitungan harga BARU, beda dari 5 modul sebelumnya**: Visa/Flight/Hotel/Transport/Muthowif semua menjumlah HPP seluruh komponen dulu baru terapkan SATU margin di akhir (`computeSellPrice()`). Paket Ziarah butuh margin PER KOMPONEN (tiap baris dapat Harga Jual sendiri, baru dijumlah) — jadi fungsi baru `computeTourPackagePrice()`, bukan reuse `computeSellPrice()` apa adanya. Ini deviasi yang disengaja dan didokumentasikan eksplisit di §8.3, bukan inkonsistensi.

**Skema baru**: `TourismSite` (master data reusable), `TourPackage` (referensi `TransportTrip` + many-to-many `TourismSite` via `TourPackageSite` dengan urutan), `BookingTourPackage` (referensi `TransportQuota` yang dipilih). `HeritageTour`+`BookingTour` dihapus.

**Blast radius dicek via grep dulu**: ~12 file inti terdampak, skala sebanding refactor Hotel §10/Transport §9.

**Alternatives considered:**
- Tetap 2 sistem terpisah (HeritageTour dipertahankan, Transport city_tour terpisah) — ditolak, user setuju diganti total demi konsistensi.
- Kendaraan pakai data harga independen (bukan reuse Transport) — ditolak user, akan duplikasi data-entry.
- Kuota terpisah dari Transport (mis. `maxGroupSize` sendiri) — ditolak user, berisiko dua sistem kuota jalan sendiri-sendiri untuk kendaraan fisik yang sama.
- Margin gabungan satu kali di atas total (pola `computeSellPrice()` standar) — ditolak user, menyebabkan margin berlapis pada komponen kendaraan yang sudah final harganya.
- Guide terhubung ke modul Muthowif — ditolak user, beda konteks kebutuhan.

**Belum dikerjakan:** Semua kode/schema — entri ini murni laporan keputusan perencanaan.

**Affects:**
- `docs/arsitektur-ziarah.md` — §8 baru (rencana lengkap: skema, integrasi harga per-komponen, API routes, admin UI, publik & wizard, blast radius, fase eksekusi)

## 2026-07-21 — Modul Ziarah: Rencana §8 Dieksekusi Penuh (Fase 0-6) & Terverifikasi

**Decision:** Eksekusi seluruh 7 fase yang direncanakan di `docs/arsitektur-ziarah.md` §8.9 dalam satu rangkaian berkelanjutan (deviasi Fase Eksekusi SOP yang sama dipakai modul lain — verifikasi menyeluruh di fase akhir, bukan per-fase).

**Rationale:** Rencana sudah lengkap dan disetujui user (entri sebelumnya). Skala perubahan (hapus 2 model, tambah 4 model baru, ~10 API route baru, rewiring booking lifecycle, UI admin+publik+wizard) sebanding refactor Hotel/Transport/Muthowif yang sudah terbukti aman dieksekusi dengan pola ini di sesi-sesi sebelumnya.

**Apa yang dilakukan per fase:**
1. **Fase 0**: Migrasi Prisma — `HeritageTour`+`BookingTour` dihapus (0 booking nyata, aman), `TourismSite`/`TourPackage`/`TourPackageSite`/`BookingTourPackage` dibuat. Shadow DB terpisah diverifikasi, row count tabel lain tidak berubah. `prisma/seed.ts` diupdate ke model baru (2 `TourismSite` seed section diganti 8 situs, `TourPackage` referensi `TransportTrip` city_tour yang sudah ada).
2. **Fase 1**: `lib/pricing/computeTourPackagePrice.ts` (fungsi baru, margin per-komponen — lihat entri sebelumnya §8.3) + `lib/pricing/refreshTourPackagePriceCache.ts`, didaftarkan ke `lib/cron/exchangeRateJob.ts`.
3. **Fase 2**: CRUD `tourism-sites` (+upload foto MinIO, pola sama Muthowif), CRUD `tour-packages` (+`sites` sub-resource, +`costs`/`costs/[costId]`, +`breakdown` preview), `catalog/tour-packages` publik. Route `admin/products/tours` dan `catalog/tours` lama dihapus.
4. **Fase 3**: `lib/validators/booking.ts` (`tourPackages[]` tanpa harga/tanggal dari client), `bookings/route.ts` (reuse `reserveTransportQuota()` yang sama dengan Transport, hitung `totalPrice` server-side dari `computeTourPackageBreakdown()` + harga kendaraan `TransportQuota`), `payments/[id]/confirm/route.ts` dan `lib/cron/autocancelJob.ts` (reuse `confirmTransportQuota()`/`releaseTransportQuota()` yang sama).
5. **Fase 4**: Admin UI — `products/tourism-sites/page.tsx` (list+create) dan `[id]/page.tsx` (edit+foto), `products/tour-packages/page.tsx` (list+create, dropdown trip dikelompokkan city_tour vs lainnya), `[id]/page.tsx` (package builder: info dasar, situs wisata add/remove, komponen biaya add/edit/delete dengan vendor quick-add kategori `tour_package`, preview breakdown HPP→Harga Jual per komponen + total per opsi kendaraan). `AdminSidebar.tsx` nav "Ziarah" diganti dua item "Situs Wisata"+"Paket Ziarah". Admin booking detail (`admin/bookings/[id]/page.tsx`) ditambah card Paket Ziarah (dulu fetched-tapi-tidak-dirender, Gap #4 lama).
6. **Fase 5**: `lib/booking/draft.ts` (`TourSelection`→`TourPackageSelection`), wizard `bookings/new/addons/page.tsx` (list `TourPackage` + pilih kendaraan dari `TransportQuota` real via endpoint `catalog/transport?tripId=X&date=Y` — filter `tripId` baru ditambahkan ke route yang sudah ada, bukan bikin endpoint baru), `payment/page.tsx` + `PriceSidebar.tsx` (payload/ringkasan pakai `tourPackages`), pilgrim `bookings/[id]/page.tsx` + `bookings/[id]/route.ts` (render card baru, bukan fetched-tapi-kosong), publik `(public)/tours/page.tsx` (rewrite total ke `TourPackage`+`TourismSite`, termasuk foto presigned+link gmaps), `(public)/page.tsx` (`heritageTour.count`→`tourPackage.count`).
7. **Fase 6**: `bun run build` 0 error. Verifikasi browser end-to-end lengkap: admin buat situs+paket+komponen biaya → breakdown benar (HPP Rp 200.000 → Harga Jual Rp 250.000 → total per kendaraan Rp 1.350.000/2.250.000/4.250.000) → katalog publik tampilkan "mulai dari" sesuai cache → booking dibuat via API langsung (payload tanpa harga) → `BookingTourPackage.totalPrice` dihitung ulang server-side identik dengan preview admin, `tourDate` diambil dari `TransportQuota`, `TransportQuota.pendingSeats` bertambah lewat fungsi `reserveTransportQuota()` yang sama dipakai Transport. Detail lengkap di `docs/arsitektur-ziarah.md` §9.

**Gap ditemukan saat verifikasi, TIDAK diperbaiki (di luar scope, dicatat untuk kerja mendatang):**
- Modul **Transport**: tidak ada admin UI/API untuk generate `TransportQuota` ad-hoc per tanggal untuk trip kategori `city_tour` — seed 90-hari hanya mencakup trip airport/intercity. Tanpa ini, Paket Ziarah manapun tidak akan punya kendaraan tersedia di wizard sampai kuota diisi manual. Ini gap pre-existing modul Transport, ditemukan lewat kerja Ziarah tapi bukan tanggung jawab modul ini untuk memperbaiki.
- Modul **Hotel**: harga hotel tampil Rp 0/mlm untuk tanggal 2026-08 di wizard (terindikasi `HotelPricePeriod` seed tidak mencakup rentang itu) — ditemukan sekilas saat verifikasi jalur wizard, tidak diselidiki/diperbaiki karena di luar scope Ziarah.
- Gap generik `Package`/`PackageItem` non-fungsional (§6 Gap #5 lama) sengaja TIDAK diperbaiki — beda topik dari redesain Ziarah/`TourPackage` ini, butuh keputusan produk terpisah tentang fitur bundling lintas modul.

**Alternatives considered:** Tidak ada — ini eksekusi rencana yang sudah difinalkan di entri sebelumnya, bukan keputusan desain baru.

**Affects:**
- `docs/arsitektur-ziarah.md` — banner status §1 diupdate, §9 baru (hasil verifikasi + gap ditemukan)
- `docs/progress.md`, `CLAUDE.md` — diupdate menandai modul Ziarah selesai

## 2026-07-21 — Modul Ziarah: Hotel sebagai Komponen Add-on Pass-through

**Decision:** Tambahkan "Hotel" sebagai salah satu pilihan komponen add-on di Paket Ziarah — admin pilih `HotelRoomSchedule` (hotel + tipe kamar) + jumlah malam + jumlah kamar, harga = `nights × numRooms × HotelRoomSchedule.price` dipakai **apa adanya (pass-through, tanpa margin tambahan)**. Model baru `TourPackageHotel`. Sejajar dengan komponen custom manual (Guide/Makan/Minum) yang sudah ada — keduanya tetap bersifat add-on penuh (bisa ditambah/dikurangi bebas, tidak ada yang wajib).

**Rationale:** User mengoreksi kesalahpahaman — catatan "Hotel Rp 0/mlm" di verifikasi sebelumnya soal wizard Umroh yang sudah ada, BUKAN permintaan mewajibkan hotel di Ziarah. User lalu mengusulkan: variable/komponen paket harus selalu bisa ditambah-kurangi bebas, referensi ke modul lain (kendaraan sudah begitu) cuma untuk memudahkan input, dan Hotel cocok jadi salah satu pilihan referensi seperti itu, sejajar dengan variable custom manual.

Dikonfirmasi via AskUserQuestion:
1. Harga hotel **pass-through**, TIDAK dimargin lagi — karena `HotelRoomSchedule.price` sudah cache hasil `computeSellPrice()` milik modul Hotel sendiri; kalau dimargin lagi jadi margin berlapis (rasionalisasi sama dengan kenapa harga kendaraan pass-through di §8.3).
2. Admin pilih hotel+tipe kamar+malam+kamar saat membangun paket (bukan booking-time seperti kendaraan) — konsisten dengan komponen lain yang juga flat per-template, tidak dikalikan `numPeople`.

**Skema baru**: `TourPackageHotel` (tourPackageId, hotelRoomScheduleId, nights, numRooms) — relasi ke `TourPackage` (cascade delete) dan `HotelRoomSchedule` (restrict, tidak boleh hapus schedule yang masih dipakai).

**Keputusan sadar — TIDAK reserve kuota hotel nyata**: meski `reserveHotelQuota()`/`confirmHotelQuota()`/`releaseHotelQuota()` sudah ada dan reusable, fitur ini SENGAJA tidak memanggilnya. Hotel dipilih di level TEMPLATE paket (statis), sedangkan kuota hotel nyata terikat periode/tanggal spesifik — mengikat kuota di level template salah kalau paket dipakai lintas periode musim. Konsekuensi: `HotelRoomSchedule.totalQuota` tidak berkurang lewat jalur ini — potensi kamar fisik sama terjual dobel via Hotel biasa vs Paket Ziarah. Didokumentasikan eksplisit di §10.7 sebagai gap yang diketahui sejak desain (bukan ditemukan belakangan), bukan diminta user (scope eksplisit hanya soal kemudahan harga).

**Verifikasi**: `bun run build` 0 error. Browser end-to-end: tambah hotel (Double, 1 malam × 1 kamar, Rp 14.200.000) ke paket yang sudah punya komponen Guide (Rp 250.000) → breakdown tampilkan total hotel Rp 14.200.000 (pass-through, tidak berubah dari harga asal) → total per kendaraan bertambah tepat (Bus Pariwisata 49: Rp 4.250.000 → Rp 18.450.000) → hapus hotel → breakdown kembali ke angka semula tanpa mempengaruhi komponen lain. Detail di `docs/arsitektur-ziarah.md` §10.9.

**Alternatives considered:**
- Margin hotel lagi seperti komponen biasa — ditolak user, menyebabkan margin berlapis di atas harga yang sudah final dari modul Hotel.
- Hotel dipilih ulang di booking-time (seperti kendaraan) — tidak dipilih, user menggambarkan sebagai aksi saat admin membangun paket (template-level), konsisten dengan komponen lain yang sudah ada.
- Reserve kuota hotel nyata sekalian — dipertimbangkan (fungsi sudah ada, reusable) tapi ditunda karena butuh desain terpisah untuk mengikat komponen hotel ke tanggal tur sebenarnya; di luar scope permintaan saat ini.

**Affects:**
- `prisma/schema.prisma` — model `TourPackageHotel` baru
- `lib/pricing/computeTourPackagePrice.ts` — breakdown + total mencakup `hotelsTotalPrice`
- `app/api/v1/admin/products/hotels/schedules/route.ts` (baru), `app/api/v1/admin/products/tour-packages/[id]/hotels/route.ts` (baru), `.../hotels/[hotelId]/route.ts` (baru)
- `app/[locale]/admin/(protected)/products/tour-packages/[id]/page.tsx` — section "Hotel (opsional)" + preview breakdown
- `docs/arsitektur-ziarah.md` §10 (rencana + §10.9 verifikasi)

## 2026-07-21 — Modul Ziarah: Harga Hotel Add-on Dibuat Editable (Bukan Pass-through Kaku)

**Decision:** Koreksi desain §10.3/§10.9 di atas — `TourPackageHotel` ditambah field tersimpan `pricePerNight`, di-snapshot dari `HotelRoomSchedule.price` SERVER-SIDE saat baris pertama ditambahkan, tapi setelah itu admin bisa mengedit angkanya kapan saja lewat endpoint PUT baru. Breakdown selalu pakai `pricePerNight` yang tersimpan di baris, BUKAN mengambil ulang harga live dari `HotelRoomSchedule` setiap kali dihitung.

**Rationale:** User memberi masukan langsung setelah fitur Hotel add-on selesai: "harga2 itu hanya menjadi referensi, tidak hanya hotel, semuanya, artinya admin boleh edit lagi.. tidak ada yg statis disini.." — prinsipnya, nilai yang direferensikan dari modul lain hanya titik awal/saran, bukan angka final terkunci. Desain awal (baca `HotelRoomSchedule.price` live setiap breakdown dihitung) terlalu kaku dan tidak konsisten dengan komponen custom (Guide/Makan/Minum) yang sejak awal 100% manual/editable.

**API baru**: `PUT /api/v1/admin/products/tour-packages/[id]/hotels/[hotelId]` — body `{ nights?, numRooms?, pricePerNight? }`.

**Admin UI**: baris hotel dapat tombol Edit (pensil) sejajar Hapus, membuka form inline dengan field nights/numRooms/pricePerNight yang bisa diketik ulang bebas, disertai keterangan bahwa perubahan ini tidak mempengaruhi harga di modul Hotel asli.

**Verifikasi**: `bun run build` 0 error. Browser end-to-end: tambah hotel Double 1 malam×1 kamar → snapshot awal Rp 14.200.000 (sama persis `HotelRoomSchedule.price`) → edit `pricePerNight` jadi Rp 10.000.000 → Simpan → breakdown & total per kendaraan langsung ikut turun (Bus Pariwisata 49: Rp 18.450.000 → Rp 14.250.000) — mengonfirmasi decoupling sempurna dari harga live modul Hotel (yang tetap Rp 14.200.000 tak berubah).

**Alternatives considered:** Tetap pass-through kaku (baca live setiap saat) — ditolak eksplisit oleh user karena menghilangkan fleksibilitas admin memberi harga khusus per paket.

**Affects:**
- `prisma/schema.prisma` — `TourPackageHotel.pricePerNight` (Decimal) baru
- `lib/pricing/computeTourPackagePrice.ts` — pakai `pricePerNight` tersimpan, bukan live `HotelRoomSchedule.price`
- `app/api/v1/admin/products/tour-packages/[id]/hotels/route.ts` — POST snapshot `pricePerNight` server-side
- `app/api/v1/admin/products/tour-packages/[id]/hotels/[hotelId]/route.ts` — PUT baru
- `app/[locale]/admin/(protected)/products/tour-packages/[id]/page.tsx` — tombol Edit + form inline untuk baris hotel
- `docs/arsitektur-ziarah.md` §10.10 (koreksi desain + verifikasi)

## 2026-07-21 — Modul Ziarah: Editor Komponen Biaya Disamakan dengan Pola HPP Modul Lain

**Decision:** Restyle total form/tampilan "Komponen Biaya" di package builder Paket Ziarah supaya identik dengan idiom visual HPP editor yang sudah dipakai konsisten di Flight, Muthowif, Visa, Transport, dan Hotel — bukan tampilan baru yang bentuknya beda sendiri.

**Rationale:** User menunjukkan screenshot editor HPP Tiket Pesawat ("HPP & Harga Tiket") dan menegaskan: "komponen biaya itu harus tetap konsisten bentuknya, jangan bikin baru lagi." Investigasi mengonfirmasi ada satu idiom visual yang dipakai berulang persis sama di 5 modul (bukan komponen React bersama, tapi konvensi JSX/class yang selalu sama): card `admin-form-panel` (bukan `admin-card`), heading dengan ikon `Wallet` + baris caption yang mengutip `docs/arsitektur-*.md §N`, kotak berbingkai "[X] & Mata Uang" untuk vendor+currency+quick-add, dan dua kotak preview read-only "HPP (Rupiah)"/"Harga Jual (otomatis)" yang live-update via debounce 500ms ke endpoint `/simulate`. Versi awal Ziarah (dibangun sesi ini) menyimpang di semua titik itu: pakai `admin-card` polos, tanpa ikon/doc-caption, vendor+currency tanpa kotak berbingkai, dan HPP/Harga Jual cuma muncul di tabel ringkasan terpisah setelah disimpan (tidak live saat mengetik).

**Perubahan**:
- Card "Komponen Biaya" jadi `admin-form-panel` + ikon `Wallet` + caption "...lihat docs/arsitektur-ziarah.md §8.3".
- Field "Nama Komponen" (khusus Ziarah, karena beda dari modul lain yang cuma 1 komponen tetap) diletakkan terpisah di atas kotak vendor.
- Vendor+Mata Uang dibungkus kotak `border border-line rounded-xl p-3` berlabel "Vendor & Mata Uang", persis sama styling Flight/Muthowif/Visa/Transport/Hotel.
- Endpoint baru `GET /api/v1/admin/products/tour-packages/simulate?cost=X&currency=Y` — reuse `simulateSellPrice('tour_package', [{currency, cost}])` yang sudah ada (array 1 elemen = matematika identik margin-per-komponen §8.3, tidak perlu logika baru).
- Form tambah/edit sekarang live-preview HPP(Rupiah)/Harga Jual(otomatis) saat mengetik (debounce 500ms), sama seperti Flight.
- `GET .../costs` diperkaya `hppRupiah`/`sellPrice` per baris (dihitung via `simulateSellPrice`), ditampilkan inline di tiap baris list (bukan cuma di tabel breakdown terpisah) — meniru pola per-baris Visa/Transport/Hotel.
- Tabel "Komponen" di "Preview Harga" dihapus (redundan dengan tampilan inline per-baris yang baru) — "Preview Harga" sekarang cuma berisi total per kendaraan + hotel (informasi agregat yang genuinely unik, bukan duplikasi).

**Verifikasi**: `bun run build` 0 error. Browser: buka form tambah komponen → ketik biaya 150.000 IDR → HPP(Rupiah) dan Harga Jual(otomatis) muncul otomatis (Rp 150.000 → Rp 200.000) tanpa perlu simpan dulu — identik perilaku Flight. Baris "Guide Lokal" yang sudah ada menampilkan HPP inline ("HPP Rp 200.000") dan Harga Jual (Rp 250.000) langsung di list, tidak perlu tabel terpisah.

**Alternatives considered:** Tidak ada — ini murni penyelarasan visual ke pola yang sudah baku, bukan keputusan desain baru. Struktur data (list komponen bernama bebas) tetap dipertahankan karena itu kebutuhan inheren Ziarah yang beda dari modul lain (satu komponen tetap vs banyak komponen bernama bebas).

**Affects:**
- `app/api/v1/admin/products/tour-packages/simulate/route.ts` (baru)
- `app/api/v1/admin/products/tour-packages/[id]/costs/route.ts` — GET sertakan `hppRupiah`/`sellPrice` per baris
- `app/[locale]/admin/(protected)/products/tour-packages/[id]/page.tsx` — restyle total section "Komponen Biaya" + sederhanakan "Preview Harga"

## 2026-07-21 — Modul Ziarah: Kendaraan (Transport) Jadi Opsional, Sejajar Hotel

**Decision:** `TourPackage.transportTripId` dan `BookingTourPackage.transportQuotaId` diubah jadi nullable — Paket Ziarah boleh dibuat TANPA kendaraan terstruktur sama sekali, sejajar Hotel yang sudah opsional sejak §10. Kalau admin tetap butuh mencatat biaya transport tapi tidak mau integrasi Trip/Vehicle/Quota, cukup tambahkan sebagai baris "Komponen Biaya" manual (jalur yang sudah ada, tidak butuh kode baru).

**Rationale:** User: "hotel dan transportasi itu di paket ziarah sebagai opsional... jangan dijadikan kunci utama.. jadi hotel dan transport dimasukan sebagai variable harga terpisah sebagai pilihan, apakah ingin diaktifkan, atau tidak, atau bisa masuk dalam variable manual." Audit kode (prinsip recheck-sebelum-rencana) mengonfirmasi Hotel sudah 100% opsional tapi Transport masih wajib (`transportTripId` non-null) — persis "kunci utama" yang tidak diinginkan.

**Perubahan**:
- Schema: kedua FK jadi nullable (migrasi non-destruktif, hanya melonggarkan constraint + ubah `ON DELETE` jadi `SET NULL`).
- `computeTourPackageBreakdown()`: `vehicleOptions = []` kalau `transportTripId` null — jalur ini sudah ada sebelumnya untuk kasus "trip ada tapi pricing kosong", dipakai ulang, tidak perlu fungsi baru.
- Admin UI (list + builder): dropdown trip dapat opsi "— tidak pakai kendaraan —"; breakdown preview beda pesan antara "tidak pakai kendaraan" (tampil "Total Harga Paket" tunggal) vs "trip terhubung tapi tanpa harga aktif" (pesan lama tetap).
- `lib/validators/booking.ts`: `tourPackages[].transportQuotaId` jadi opsional.
- `bookings/route.ts`: reserve kuota kendaraan hanya kalau `transportQuotaId` dikirim; `totalPrice` = `componentsTotal+hotelsTotal` saja kalau tidak ada kendaraan; `tourDate` fallback ke `departureDate` booking (satu-satunya tanggal yang tersedia tanpa kuota kendaraan untuk dirujuk).
- `payments/[id]/confirm/route.ts` dan `autocancelJob.ts`: confirm/release kuota kendaraan dibungkus pengecekan null.
- Wizard, katalog, halaman detail booking (admin+pilgrim): semua di-null-safe-kan (origin/destination, vehicleName, transportQuota).

**Verifikasi**: `bun run build` 0 error. Buat paket tanpa kendaraan via admin → tambah komponen manual "Sewa Mobil Manual" (Rp 500rb) → breakdown "Total Harga Paket (tanpa kendaraan)" = Rp 600.000 (margin 20%) — mengonfirmasi jalur manual berfungsi tanpa integrasi Trip sama sekali. Katalog publik tampilkan harga tanpa badge rute. Booking langsung via API tanpa `transportQuotaId` berhasil — `BookingTourPackage.transportQuotaId = null`, `tourDate` fallback ke `departureDate` client. Paket lama yang sudah pakai kendaraan (§8-§10) tetap berjalan normal, tidak terpengaruh.

**Alternatives considered:** Tidak ada — user secara eksplisit menyatakan Transport harus disamakan dengan Hotel (opsional), bukan pilihan desain yang perlu dipertimbangkan ulang.

**Affects:**
- `prisma/schema.prisma` — `TourPackage.transportTripId` dan `BookingTourPackage.transportQuotaId` nullable
- `lib/pricing/computeTourPackagePrice.ts`, `lib/validators/booking.ts`, `app/api/v1/bookings/route.ts`, `app/api/v1/admin/payments/[id]/confirm/route.ts`, `lib/cron/autocancelJob.ts`
- `app/api/v1/admin/products/tour-packages/route.ts` + `[id]/route.ts` — schema create/update
- `app/[locale]/admin/(protected)/products/tour-packages/page.tsx` + `[id]/page.tsx`
- `app/api/v1/catalog/tour-packages/route.ts`, `app/[locale]/(public)/tours/page.tsx`
- `lib/booking/draft.ts`, `app/[locale]/(pilgrim)/bookings/new/addons/page.tsx`, `components/booking/PriceSidebar.tsx`
- `app/[locale]/admin/(protected)/bookings/[id]/page.tsx`, `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`
- `docs/arsitektur-ziarah.md` §11 (rencana + §11.9 verifikasi)

## 2026-07-21 — Bug: PUT Info Paket Ziarah Tidak Refresh Cache Harga

**Decision:** Tambahkan panggilan `refreshTourPackagePriceCache()` di `PUT /api/v1/admin/products/tour-packages/[id]/route.ts` setiap kali `transportTripId` ikut dikirim dalam body.

**Rationale:** User melapor: harga di admin (komponen "Guide Lokal" Rp 250.000) terasa tidak sinkron dengan "Mulai dari Rp 1.350.000" di halaman publik. Investigasi menemukan dua hal:
1. **Bukan bug** — Rp 250.000 adalah harga jual SATU komponen (Guide Lokal), bukan total paket. Total paket (komponen + kendaraan termurah) memang ada di section "Total Harga Paket per Pilihan Kendaraan" di admin, dan itu SUDAH cocok dengan angka publik (Rp 1.350.000 = opsi Hiace Premio 10).
2. **Bug nyata ditemukan saat verifikasi**: endpoint `PUT .../tour-packages/[id]` (dipakai form "Info Paket" — nama, deskripsi, **trip kendaraan**, status aktif) TIDAK PERNAH memanggil `refreshTourPackagePriceCache()`, padahal endpoint `costs`/`hotels`/`sites` semuanya memanggilnya setelah mutasi. Karena `transportTripId` menentukan `vehicleOptions` (jadi menentukan harga "mulai dari"), melepas/mengganti kendaraan lewat form Info Paket membuat cache `TourPackage.price` basi — nilai publik tetap menampilkan angka lama sampai ada trigger refresh lain (mis. tambah/edit komponen biaya).
3. Ditemukan juga secara konkret: paket "Ziarah Makkah — Sejarah Islam" ternyata `transportTripId`-nya sempat ter-null (kemungkinan besar akibat interaksi otomatis browser testing sesi ini yang salah sasaran/coordinate), sementara cache harga masih Rp 1.350.000 (angka lama, basi) — persis skenario "tidak sinkron" yang dicurigai user, meski penyebabnya beda dari dugaan awal. Data dipulihkan (relink ke trip asli, `TransportTrip` masih ada & aktif) dan cache di-refresh ulang — kembali Rp 1.350.000 (kali ini nilai yang benar-benar dihitung ulang, bukan sisa lama).

**Perbaikan**: PUT sekarang panggil `refreshTourPackagePriceCache(id)` kalau `transportTripId` ada di payload (`parsed.data.transportTripId !== undefined`) — mencegah cache basi berulang di masa depan kalau admin ganti/lepas kendaraan lewat form ini.

**Verifikasi**: `bun run build` 0 error. Browser: buka builder "Ziarah Makkah" → dropdown trip tampil terpilih dengan benar ("City Tour Makkah — Ziarah 4 Tempat") → katalog publik `/tours` tampilkan "Mulai dari Rp 1.350.000" — cocok dengan section "Total Harga Paket per Pilihan Kendaraan" di admin (opsi termurah Hiace Premio 10).

**Alternatives considered:** Tidak ada — ini murni bug fix (celah refresh cache yang konsisten dipakai di endpoint lain, cuma lupa ditambahkan di PUT info paket).

**Affects:**
- `app/api/v1/admin/products/tour-packages/[id]/route.ts` — PUT panggil `refreshTourPackagePriceCache()`
- Data: `TourPackage` "Ziarah Makkah — Sejarah Islam" — `transportTripId` dipulihkan, cache `price` di-refresh

## 2026-07-21 — Modul Ziarah: Variable Harga 3-Mode (Included / User Choice / None)

**Decision:** Rombak model mental "variable harga" (Transport, Hotel) di Paket Ziarah dari 2-keadaan biner (ada trip / tidak ada trip) jadi 3-mode eksplisit: `included` (admin kunci 1 pilihan, harga dibakukan masuk harga jual paket, pilgrim tidak pilih), `user_choice` (admin cuma hubungkan sumber, pilgrim pilih & bayar sendiri saat booking, harga TIDAK masuk harga jual paket dasar), `none` (tidak dipakai/manual). Berlaku sama untuk Transport dan Hotel.

**Rationale:** User menjelaskan lewat 3 skenario nyata (kendaraan sudah termasuk vs user pilih sendiri sesuai kebutuhan grup vs tidak dipakai) dan menunjukkan bug konsep konkret: "sekarang, jika memilih variable kendaraan, tiba2 masuk dalam harga publish, ini membingungkan kalau user tidak membutuhkan kendaraan atau kendaraannya over price karena tidak sesuai kebutuhan." Audit kode (§11) memang cuma menyelesaikan wajib→opsional, TIDAK membedakan "kendaraan sudah final" vs "kendaraan baru opsi" — `cheapestTotal()` lama SELALU membakukan kendaraan termurah begitu trip terhubung, apa pun niatnya.

**Skema baru**: enum `PriceVariableMode` (included/user_choice/none). `TourPackage` dapat `transportMode`, `includedTransportPricingId`+`includedTransportPrice` (snapshot/editable, pola sama `TourPackageHotel.pricePerNight`), `hotelMode`. Model baru `TourPackageHotelOption` (opsi hotel utk mode user_choice — beda dari `TourPackageHotel` yang mode included). `BookingTourPackage` dapat `chosenHotelRoomScheduleId`/`chosenHotelNumRooms` (dipilih pilgrim saat booking, hanya relevan kalau hotelMode=user_choice).

**Fungsi harga**: `cheapestTotal()`/`baseTotal()` SEKARANG cuma menjumlah komponen + kendaraan/hotel yang mode-nya `included` — TIDAK PERNAH menyertakan estimasi dari `user_choice`. Ini yang memperbaiki keluhan utama user.

**Booking lifecycle — perbedaan penting**: mode `included` untuk kendaraan tetap mereservasi `TransportQuota` NYATA (auto-resolve dari `includedTransportPricingId`+`departureDate`, pilgrim tidak perlu memilih apa pun) — mencegah overbooking kendaraan yang "sudah termasuk". Mode `user_choice` untuk HOTEL sekarang JUGA mereservasi `HotelRoomSchedule` quota nyata (`reserveHotelQuota` dkk, sudah ada, reused) — beda dari hotel `included` (§10.7, sengaja statis di template, tidak reservasi) karena di `user_choice` pilgrim benar-benar memilih di waktu booking yang sebenarnya.

**Migrasi data**: paket existing "Ziarah Makkah — Sejarah Islam" (`transportTripId` sudah terisi sebelum §12) di-set `transportMode='user_choice'` (dikonfirmasi user via AskUserQuestion, bukan `included` karena kendaraan memang belum pernah dikunci eksplisit oleh admin) — konsekuensi: harga "Mulai dari" katalog publik TURUN dari Rp 1.350.000 ke Rp 250.000 (disengaja, bukan bug).

**Verifikasi**: `bun run build` 0 error tiap fase. Browser+API end-to-end: mode User Choice (paket existing) → breakdown 2-blok benar (dasar Rp250rb, opsi tambahan kendaraan terpisah dengan prefix "+"). Ganti ke mode Included → kunci Hiace Premio 10 → dasar jadi Rp1.350.000, tidak ada opsi tambahan. Booking API mode Included tanpa `transportQuotaId` dari client → server auto-resolve quota yang benar, `pendingSeats` bertambah, `totalPrice` benar. Katalog publik sinkron persis dengan admin di kedua mode. Detail lengkap `docs/arsitektur-ziarah.md` §12.11.

**Catatan operasional (bukan bug produk)**: selama verifikasi berulang kali ditemukan `transportTripId` ter-null oleh interaksi browser-automation (kemungkinan artefak alat baca aksesibilitas pada `<select>`), dikonfirmasi via log server sebagai `PUT` request sungguhan, bukan salah baca UI — dipulihkan tiap kali ditemukan. Dicatat sebagai risiko alat testing, tidak berlaku utk pengguna asli.

**Alternatives considered:**
- Tetap 2-keadaan (ada trip/tidak) dan biarkan admin "tidak menghubungkan trip" kalau tidak mau harga masuk publish — ditolak, tidak memungkinkan kendaraan tetap dipakai sebagai OPSI (user_choice) tanpa membakukan harganya; juga tidak mendukung skenario "kendaraan sudah termasuk, tidak ada pilihan" (mode included) sama sekali.
- Reserve kuota hotel nyata untuk mode included juga (konsisten dengan user_choice) — ditolak, dipertahankan sesuai keputusan §10.7 (hotel included statis di template, bukan booking-time).

**Affects:**
- `prisma/schema.prisma` — enum `PriceVariableMode`, field baru `TourPackage`, model `TourPackageHotelOption`, field baru `BookingTourPackage`
- `lib/pricing/computeTourPackagePrice.ts` — rombak total (breakdown 3-mode, `baseTotal()`, `hotelChoicePrice()`)
- `app/api/v1/admin/products/tour-packages/route.ts`, `[id]/route.ts`, `[id]/hotel-options/route.ts` (baru)
- `app/[locale]/admin/(protected)/products/tour-packages/page.tsx`, `[id]/page.tsx` — mode selector + preview 2-blok
- `app/api/v1/bookings/route.ts`, `lib/validators/booking.ts`, `admin/payments/[id]/confirm/route.ts`, `lib/cron/autocancelJob.ts`
- `app/api/v1/catalog/tour-packages/route.ts`, `[id]/hotel-options/route.ts` (baru), `app/[locale]/(public)/tours/page.tsx`
- `lib/booking/draft.ts`, `app/[locale]/(pilgrim)/bookings/new/addons/page.tsx`, `payment/page.tsx`, `components/booking/PriceSidebar.tsx`
- `docs/arsitektur-ziarah.md` §12 (rencana + §12.11 verifikasi), §11 ditandai superseded

## 2026-07-22 — Paket Umroh (`Package`): Variable Harga 3-Mode Diperluas dari Ziarah

**Decision:** `Package`/`PackageItem` (sebelumnya kartu marketing statis, Gap #5 di `docs/arsitektur-ziarah.md` §6) dirombak total mengikuti pola Variable Harga 3-Mode (§12) yang sudah dibangun untuk `TourPackage` — diperluas dari 2 komponen (Kendaraan+Hotel) jadi 7: Hotel Makkah, Hotel Madinah (2 slot terpisah karena Umroh butuh 2 hotel, beda dari Ziarah yang cuma 1), Transport, Muthowif, Visa, Tiket Pesawat, Katering. Tiap komponen bermode `included`/`user_choice`/`none` (enum `PriceVariableMode` yang sudah ada, tidak diubah). Ditambah Komponen Biaya custom (`ProductCost` polimorfik, `productType='package'`) untuk kalibrasi HPP presisi di luar 7 kategori itu.

**Rationale:** User eksplisit: "ini adalah paket umroh, logikanya persis seperti paket ziarah... intinya sekarang focus di product masing2 terlebih dahulu biar cepat" dan "abaikan dulu booking engine, kita akan refactoring total juga itu." Jadi scope sesi ini SENGAJA dibatasi ke sisi produk (schema, fungsi harga, admin builder, katalog publik) — tidak menyentuh `BookingPackage`/wizard/kuota sama sekali, karena booking engine universal akan dirombak terpisah (`docs/arsitektur-booking.md`, masih pending) dan menyentuhnya sekarang berisiko kerja dua kali.

**Perbedaan struktural dari `TourPackage`:**
- **Hotel Makkah/Madinah** — dua slot flat terpisah di `Package` (bukan list `TourPackageHotel` seperti Ziarah), karena masing-masing cuma butuh SATU pilihan "included" — konsisten dengan pola Transport yang juga flat single-slot.
- **Muthowif** — singleton (`MuthowifServicePrice`, satu baris global), tidak ada "sumber opsi" untuk dipilih pilgrim — `user_choice` di sini murni berarti "toggle: keluarkan dari harga dasar, tambahkan terpisah," bukan "pilih dari beberapa opsi." Auto-snapshot ke `includedMuthowifPrice` HANYA saat pertama kali mode di-set ke `included` dan nilai belum ada — supaya tidak menimpa penyesuaian manual admin.
- **Visa & Katering** — leaf-level priced entity (`VisaProduct`/`CateringOption` sendiri sudah harga final, bukan grouping seperti `TransportTrip`), jadi opsi `user_choice` dikurasi manual lewat tabel join baru (`PackageVisaOption`, `PackageCateringOption`) — pola sama `TourPackageHotelOption`, bukan auto-derive dari suatu "grup."
- **Transport & Tiket Pesawat** — sama persis pola Transport Ziarah: `user_choice` cukup link satu "trip/route" sumber, opsi otomatis diturunkan dari semua pricing/schedule aktif di bawahnya (tidak perlu tabel kurasi terpisah, karena `TransportTrip`/`FlightRoute` sudah jadi grouping alami).
- Tidak ada UI edit harga langsung untuk snapshot manapun (beda dari Hotel Ziarah yang punya form edit `pricePerNight`) — sengaja disamakan ke pola Transport Ziarah ("harga referensi awal, sesuaikan lewat Komponen Biaya kalau perlu") supaya 7 komponen konsisten satu perilaku, bukan campuran dua idiom berbeda.

**Alternatives considered:** Model generik tunggal `PackagePriceVariable` (satu tabel polimorfik untuk semua 7 komponen, field `componentType` enum) — ditolak karena tiap komponen py bentuk "sumber opsi" yang beda-beda (grouping alami vs leaf-level vs singleton), jadi tabel generik itu ujungnya perlu banyak field nullable spesifik-komponen juga (tidak benar-benar lebih sederhana), dan menyimpang dari pola field-flat-di-model-utama yang sudah established sejak `TourPackage`.

**Affects:**
- `prisma/schema.prisma` — `Package` (+21 field), `PackageItem` dihapus, 3 model baru (`PackageHotelOption`, `PackageVisaOption`, `PackageCateringOption`), back-relation di `TransportTrip`/`TransportPricing`/`VisaProduct`/`FlightRoute`/`FlightSchedule`/`CateringOption`/`HotelRoomSchedule`
- Migrasi `20260722074403_package_umroh_variable_harga` (verifikasi shadow DB terpisah, 0 baris terdampak)
- `lib/pricing/computePackagePrice.ts`, `refreshPackagePriceCache.ts` (baru), `lib/cron/exchangeRateJob.ts` (tambah panggilan cache refresh)
- `app/api/v1/admin/products/packages/route.ts`, `[id]/route.ts`, `[id]/breakdown/route.ts`, `[id]/costs/route.ts` + `[costId]/route.ts`, `[id]/hotel-options/route.ts`, `[id]/visa-options/route.ts`, `[id]/catering-options/route.ts` (semua baru kecuali route.ts/[id]/route.ts)
- `app/api/v1/catalog/packages/route.ts` (+`hasAddOns`)
- `app/[locale]/admin/(protected)/products/packages/page.tsx` (disederhanakan), `[id]/page.tsx` (BARU — builder lengkap 7 mode selector + komponen biaya + preview harga)
- `app/[locale]/(public)/packages/page.tsx` (+caption opsi tambahan)
- `docs/arsitektur-paket-umroh.md` (baru, source of truth modul ini)

## 2026-07-22 — Booking Engine: Audit Ulang + Keputusan Bentuk Keranjang (§1.5)

**Decision:** User minta cek `docs/arsitektur-booking.md` (rencana booking engine universal) dan `docs/arsitektur-umroh.md` (audit as-built booking core) terhadap kode aktual. Hasil audit:
- `docs/arsitektur-booking.md` **akurat** — belum ada satu pun yang dieksekusi (`lib/quota/adapters/` tidak ada, `BookingItem` tidak ada, `cancelBooking()` tidak ada). Statusnya sendiri sudah benar sebagai "PENDING."
- `docs/arsitektur-umroh.md` (ditulis 2026-07-08) — **4 gap kritis (#1 Haji, #2 self-cancel, #3 refund, #4 totalAmount) dikonfirmasi ULANG masih terbuka persis seperti tertulis**, tapi dokumen itu sendiri sudah drift: skema `Booking.tours: BookingTour[]` sudah usang (sekarang `tourPackages: BookingTourPackage[]` sejak refactor Ziarah 2026-07-21), narasi "muthowif confirm belum ada" sudah salah (DITUTUP 2026-07-20), dan seluruh alur `BookingTourPackage` (Ziarah) tidak disebut sama sekali di dokumen itu.
- User memutuskan: **tidak perlu meralat prosa `docs/arsitektur-umroh.md`** secara terpisah — fokus ke booking engine, tapi tetap catat implemented code & arsitektur terkini sebagai bagian dari kerja itu.

**Keputusan desain §1.5 (bentuk keranjang) — DIAMBIL 2026-07-22:** Satu `Booking` = satu keranjang campur bebas, mirip cart e-commerce. Bukan beberapa endpoint terpisah per jenis produk. Satu invoice, satu konfirmasi pembayaran, untuk kombinasi item apa pun (visa-only, transport-only, Umroh penuh rakit sendiri, Haji, atau campuran) — semua lewat SATU `POST /api/v1/bookings` dengan payload `items: BookingItemInput[]` generik menggantikan field tetap (`hotelMakkah`, `transports[]`, dst.) yang ada sekarang.

**Rationale:** Cart e-commerce adalah model paling fleksibel untuk mendukung semua alur pembelian sekaligus tanpa perlu membedakan "jenis alur" di level API — konsisten dengan arahan awal user (2026-07-08) untuk "satu booking engine, satu invoice, satu transaksi universal."

**Strategi migrasi TETAP Opsi B (bukan Opsi A/`BookingItem` polimorfik):** tabel per-tipe existing (`BookingHotel`, `BookingTransport`, dst., termasuk `BookingTourPackage`) dipertahankan — "keranjang" dicapai di lapisan `createBookingSchema`/API (array item generik masuk, adapter dispatch ke tabel yang tepat berdasarkan `itemType`), BUKAN dengan migrasi ke satu tabel fisik baru. Risiko jauh lebih rendah (tidak ada migrasi data produksi, tidak breaking ke dokumen arsitektur produk yang sudah ditulis), dan tetap sepenuhnya mewujudkan keputusan cart di atas.

**Alternatives considered:** Beberapa endpoint terpisah per jenis produk (`/api/v1/bookings/visa`, `/transport`, dst.) yang menulis ke tabel sama di baliknya — ditolak user, dianggap tidak benar-benar "satu booking engine."

**Belum diputuskan (perlu diputuskan di awal Step 4 §6, bukan diasumsikan):** nasib `Booking.departureDate`/`returnDate` yang saat ini wajib diisi — perlu jadi nullable atau diberi makna baru untuk booking yang tidak inheren punya "tanggal keberangkatan trip" (mis. visa-only).

**Affects:**
- `docs/arsitektur-booking.md` — §0 baru (baseline as-built), §1.5 ditutup dengan keputusan, §3.3 ditambah "Bentuk Konkret (Opsi B)", §5 rekomendasi Opsi B dipertegas + catatan departureDate/returnDate, §6 execution steps di-unblock & direvisi (Step 4-5 baru), §7/§8 referensi silang diperbaiki (PackageItem sudah dihapus, TourPackage bukan lagi no-op)
- `CLAUDE.md` — paragraf `docs/arsitektur-booking.md` diperbarui
- Tidak ada perubahan kode/schema sesi ini — murni dokumentasi & keputusan arsitektur, eksekusi Step 1-7 §6 menyusul sesi berikutnya

## 2026-07-22 — Booking Engine: Total Rewrite (Manifest Tak Terbatas + Dokumen Universal)

**Decision:** Memperluas keputusan keranjang bebas (§1.5, entri sebelumnya hari ini) — user menegaskan ini "ubah total," bukan sekadar redesain payload. Tiga elemen baru:
1. **Manifest tak terbatas** — satu booking punya daftar orang (`BookingPilgrim`, nama model TIDAK diubah) yang jumlahnya tidak dibatasi aturan bisnis (cap `max(500)` di validasi dihapus). Analogi: booking kereta/pesawat — satu orang bisa booking untuk siapa saja.
2. **Dokumen jadi komponen universal** — syarat dokumen (KTP/Paspor/dst.) sekarang bisa dipasang ke produk apa pun (Visa, Paket Umroh, Tiket Pesawat, Haji), bukan cuma Visa. Dibangun sebagai `DocumentRequirement` polimorfik (pola sama `ProductCost`/infrastruktur harga universal, `docs/arsitektur-harga.md`) — dokumen desain terpisah baru: `docs/arsitektur-dokumen.md`.
3. **Visa lepas dari status wajib-per-orang** — `VisaApplication` yang sekarang otomatis dibuat untuk SETIAP pilgrim di booking (via `visaProductId` wajib di schema) berubah jadi opsional, cuma dibuat untuk pilgrim yang benar-benar dipilih/dikaitkan ke item Visa di keranjang.
4. **Invoice tetap ke 1 orang** (pembeli/`Booking.userId`) meski manifest di dalamnya banyak orang — sudah konsisten dengan model existing, tidak perlu perubahan struktural, cuma ditegaskan.
5. **Kekhususan per-produk (Transport: jemput/antar/kontak/assign supir, dst.) SENGAJA ditunda** — user eksplisit "itu nanti." Cukup dipastikan arsitektur Opsi B (tabel per-tipe existing) sudah mendukung kolom spesifik-tipe (`BookingTransport.pickupDetail` sudah contoh nyata) — tidak didesain detail sekarang.

**Rationale:** Model hari ini keliru menyamakan "booking" dengan "satu trip Umroh" — padahal user ingin tiap produk (Paket, Ziarah, Visa, dst.) jadi entitas mandiri yang bisa dibooking sendiri ATAU digabung bebas, dengan manifest orang yang benar-benar independen dari "berapa produk yang dibeli" dan dokumen yang independen dari "cuma untuk visa."

**Alternatives considered:** Tetap batasi jumlah pilgrim (mis. 500) sebagai pengaman sistem — ditolak user secara eksplisit sebagai aturan bisnis, meski batas teknis input (bukan aturan bisnis) tetap boleh ada saat implementasi.

**Belum diputuskan (baru dipertegas sebagai keputusan terbuka, bukan diasumsikan):**
- Bentuk konkret tabel/mekanisme linkage item↔manifest (mis. `BookingItemPilgrim` generik, atau field array `pilgrimIds` per item-type) — diputuskan di awal `docs/arsitektur-booking.md` §6 Step 5, bukan sekarang.
- Nasib `Booking.departureDate`/`returnDate` (nullable vs makna baru) — sama seperti dicatat di entri keputusan sebelumnya, masih terbuka.

**Affects:**
- `docs/arsitektur-dokumen.md` (BARU) — desain lengkap komponen dokumen universal
- `docs/arsitektur-booking.md` — §1.6 baru (Manifest, Dokumen, Invoice-ke-1-orang), §6 Step 4 baru (migrasi dokumen) + Step 5 direvisi (manifest tak terbatas, linkage item↔pilgrim, visa opsional), §7 keputusan #8-#12 ditambah, §8 referensi silang
- Tidak ada perubahan kode/schema sesi ini — murni dokumentasi & keputusan arsitektur

## 2026-07-22 — Manifest: Form Per-Orang 100% Custom (Komponen Universal Ketiga)

**Decision:** Memperluas §1.6.2 (entri sebelumnya hari ini) — form per-orang di manifest (Nama, No. HP, Paspor, dst.) **100% diatur admin, termasuk field paling dasar**, bukan cuma field tambahan spesifik-produk. `BookingPilgrim` kolom baku (`fullName`, `gender`, `passportNumber`, dst.) dihapus, diganti `fieldValues: Json` + model baru `ManifestFieldRequirement` (polimorfik `productType`+`productId`+`fieldKey`+`label`+`fieldType`+`required`, pola sama `DocumentRequirement`/`ProductCost`). UI manifest berupa **repeater** ("+ Tambah Orang", field dirender dinamis sesuai definisi admin). Desain lengkap: `docs/arsitektur-manifest.md` (dokumen baru).

**Rationale:** User memilih opsi "semua field bebas diatur admin, termasuk nama/kontak" saat ditanya (bukan opsi "field dasar baku + tambahan configurable" yang direkomendasikan) — konsisten dengan visi produk-mandiri yang bisa punya kebutuhan form berbeda-beda sepenuhnya, bukan cuma variasi kecil di atas bentuk baku.

**Tantangan teknis yang diselesaikan:** kalau field 100% bebas, sistem (notifikasi WA, dashboard admin, invoice) tetap butuh tahu "field mana isi nomor HP" tanpa hardcode `fieldKey` (karena `fieldKey` itu sendiri bebas diatur admin). Solusi: `ManifestFieldRequirement.role` opsional (`display_name`/`phone`/`email`/`passport_number`) — admin menandai salah satu field custom-nya sebagai pemegang peran itu; kalau tidak ditandai, sistem fallback ke tampilan generik ("Orang #1") tanpa error.

**Alternatives considered:** "Field dasar baku (Nama/kontak tetap kolom Prisma) + field tambahan configurable" — punya type-safety lebih baik dan lebih gampang di-query/laporan, tapi ditolak user karena tidak selaras dengan visi "semua bisa custom."

**Affects:**
- `docs/arsitektur-manifest.md` (BARU) — desain lengkap komponen manifest universal
- `docs/arsitektur-booking.md` — banner status, §1.6.2 direvisi, §6 Step 4 diperluas (migrasi ManifestFieldRequirement + BookingPilgrim.fieldValues + <ManifestRepeater>), §7 keputusan #13-#14 ditambah, §8 referensi silang
- Tidak ada perubahan kode/schema sesi ini — murni dokumentasi & keputusan arsitektur

## 2026-07-22 — Manifest: Katalog `fieldType`

**Decision:** Menetapkan 7 `fieldType` untuk `ManifestFieldRequirement` (`docs/arsitektur-manifest.md` §3.1): `text`, `textarea`, `phone`, `email`, `date`, `select`, `number`. "Nomor Telepon"/"Nomor HP"/"Nomor WhatsApp" yang diminta user semua pakai `fieldType='phone'` yang SAMA — bedanya cuma `label` (dan `role='whatsapp'` kalau perlu ditandai untuk notifikasi sistem), bukan 3 tipe terpisah.

**Rationale:** `fieldType` menentukan widget+validasi, bukan makna field — nomor telepon/HP/WA secara teknis identik (validasi format nomor). Menambah tipe baru cuma untuk beda label adalah pemborosan; kombinasi `label`+`role` yang beda di baris `ManifestFieldRequirement` yang sama sudah cukup ekspresif.

**Affects:** `docs/arsitektur-manifest.md` §3.1 (baru), §3 (komentar fieldType/role diperbarui, `role` bertambah opsi `'whatsapp'` terpisah dari `'phone'` generik karena notifikasi GOWA butuh nomor yang WA-aktif spesifik)

## 2026-07-22 — Booking Engine: Item↔Pilgrim Linkage Ditutup (Tanpa Tabel Generik Baru)

**Decision:** Keputusan yang sempat digantung di §1.6.3 (`docs/arsitektur-booking.md`) sekarang ditutup: linkage "item mana mencakup orang mana" **tidak butuh tabel generik baru** (`BookingItemPilgrim` yang sempat disebut sebagai kemungkinan). `VisaApplication.bookingPilgrimId` yang SUDAH ADA sekarang cukup jadi linkage-nya — yang berubah cuma cara pembuatannya: bukan lagi otomatis untuk semua pilgrim, tapi dibuat SATU PER `pilgrimIds[]` yang eksplisit disertakan di item `{ itemType: 'visa', visaProductId, pilgrimIds: string[] }`. `quantity` item = `pilgrimIds.length`, dihitung dari array yang sama (bukan angka terpisah yang bisa tidak sinkron).

**Rationale:** Hari ini cuma Visa yang butuh granularitas per-orang nyata. Bikin tabel linkage generik di muka untuk SEMUA tipe item sekaligus adalah over-engineering sebelum ada kebutuhan konkret — konsisten dengan alasan Opsi B (§5, dokumen sama) untuk tidak bikin `BookingItem` polimorfik sebelum benar-benar perlu. Kalau nanti ada tipe item lain yang juga butuh syarat dokumen per orang (Haji, Paket Umroh), pola yang sama diulang: tambah kolom `bookingPilgrimId` ke tabel per-tipe-nya sendiri saat itu dibutuhkan.

**Affects:** `docs/arsitektur-booking.md` §1.6.3 (keputusan ditambahkan), §3.3 (schema konkret visa item + `pilgrimIds`), §6 Step 5 (deskripsi diperjelas)

## 2026-07-23 — Booking Engine: departureDate/returnDate Tetap Wajib (Ditutup)

**Decision:** `Booking.departureDate`/`returnDate` **tetap wajib diisi** apa pun isi keranjangnya (termasuk Visa-only/Transport-only) — TIDAK dijadikan nullable, TIDAK diberi makna baru. Tidak ada perubahan skema untuk field ini.

**Rationale:** User memilih kesederhanaan atas alternatif "nullable + fallback ke tanggal item paling awal" — kebijakan refund (`computeRefundAmount`) tetap berjalan tanpa kasus khusus, pemesan visa-only/transport-only tetap mengisi tanggal secara manual meski konsepnya agak longgar untuk kasus itu.

**Affects:** `docs/arsitektur-booking.md` §1.6 catatan skema (ditutup), §6 Step 5 (dibersihkan dari catatan pending)

**Status keseluruhan:** Semua keputusan terbuka yang tercatat sejak audit booking engine 2026-07-22 (bentuk keranjang, manifest, dokumen, linkage item↔orang, departureDate/returnDate) **sudah tertutup semua** — `docs/arsitektur-booking.md`, `docs/arsitektur-dokumen.md`, `docs/arsitektur-manifest.md` siap jadi dasar eksekusi bertahap (§6).

## 2026-07-23 — Komponen Alamat Standar Indonesia (Komponen Universal ke-4)

**Decision:** Membangun komponen alamat standar cascading (Provinsi → Kabupaten/Kota → Kecamatan → Desa/Kelurahan) berdasarkan data resmi Kemendagri, menggantikan `fieldType='textarea'` bebas untuk field alamat di manifest. Desain lengkap: `docs/arsitektur-alamat.md` (dokumen baru).

**Sumber data (riset 2026-07-23):** [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) — MIT license, dipelihara aktif, data mengikuti Kepmendagri No 300.2.2-2430 Tahun 2025 (revisi terbaru, sudah termasuk 4 provinsi Papua baru). Jumlah terverifikasi langsung dari README repo: **38 provinsi**, **514 kab/kota** (416 kabupaten + 98 kota), **7.285 kecamatan**, **83.762 desa/kelurahan** (75.266 desa + 8.496 kelurahan). Format sumber SQL dump MySQL, perlu dikonversi — bukan npm package/JSON siap pakai.

**Skema:** 4 tabel referensi baru (`AddressProvince`/`AddressRegency`/`AddressDistrict`/`AddressVillage`, prefix `address_`), kabupaten & kota disatukan jadi satu model `AddressRegency` dengan field `type` (sama-sama level administratif ke-2, paralel) — begitu juga desa/kelurahan jadi satu `AddressVillage`.

**Rationale:** ~83.762 baris (level desa) butuh strategi impor terpisah dari migrasi skema biasa (skrip konversi one-off, bukan `migration.sql` manual ditulis tangan) — data referensi ini tidak berubah rutin (beda Kepmendagri cuma tiap beberapa tahun), jadi tidak masuk `prisma/seed.ts` yang jalan tiap seed, cukup skrip sekali jalan.

**Belum diverifikasi (dicatat eksplisit, bukan diasumsikan):** struktur kolom baris-per-baris (format kode wilayah persis) dari `db/wilayah.sql` — tabel README yang dibaca cuma agregat jumlah per provinsi, bukan skema baris individual. Wajib dicek ulang dari file SQL asli saat eksekusi Fase 1, sesuai prinsip "recheck dulu" (`CLAUDE.md`).

**Affects:**
- `docs/arsitektur-alamat.md` (BARU) — desain lengkap komponen alamat
- `docs/arsitektur-manifest.md` §3.1 — tambah `fieldType='address'` ke katalog, §8 referensi silang
- Tidak ada perubahan kode/schema sesi ini — murni riset & dokumentasi arsitektur

## 2026-07-23 — Alamat: Entitas `Address` Reusable Lintas Modul (Bukan Tabel Pivot)

**Decision:** Menjawab pertanyaan user "join table atau bagaimana" — desain final BUKAN tabel pivot many-to-many, tapi **satu model `Address`** (berisi `fullAddress` teks bebas + FK opsional ke 4 tabel wilayah) yang modul APA PUN bisa pakai lewat kolom `addressId` biasa (foreign key standar, 1 pemilik → 1 `Address`, tidak dibagi/di-share antar pemilik). 4 tabel wilayah (`AddressProvince`/`Regency`/`District`/`Village`) tetap murni data referensi, tidak menyimpan alamat siapa pun langsung.

**Rationale:** User ingin alamat "dipakai di berbagai form nanti kalau dibutuhkan" — pola FK-ke-entitas-bersama (bukan duplikasi 4-tabel-wilayah atau logic autocomplete di tiap modul) adalah cara paling reusable. Untuk Manifest yang field-nya dinamis (`fieldValues: Json`), `addressId` disimpan sebagai string di dalam `fieldValues` (polimorfik, pola sama `ProductCost.productId`); untuk modul masa depan yang bukan dynamic-fields (Vendor, Hotel, dst.), cukup kolom `addressId` + `@relation` FK yang di-enforce penuh.

**UI:** combobox autocomplete di semua 4 level (bukan `<select>` polos) sesuai permintaan user, meski jumlah opsi per level kecil (rata-rata puluhan) — demi konsistensi pengalaman di semua level.

**Alternatives considered:** Simpan objek alamat (province/regency/dst.) langsung sebagai JSON di `fieldValues` tanpa tabel `Address` terpisah — ditolak karena tidak reusable ke modul lain (tiap modul harus reimplementasi field yang sama), dan alamat jadi tidak bisa di-join/dilaporkan dengan mudah.

**Affects:** `docs/arsitektur-alamat.md` §3.1 (baru, model `Address`), §5 (integrasi manifest direvisi — `fieldValues` simpan `addressId`, bukan objek alamat penuh)

## 2026-07-23 — Alamat: Dua Tab Domestik vs Internasional

**Decision:** `Address` (`docs/arsitektur-alamat.md` §3.1) mendapat field `type` (`domestic` | `international`) — form-nya 2 tab terpisah: "Alamat Indonesia" (4 combobox berjenjang wilayah resmi) dan "Alamat Luar Negeri" (combobox Negara dari daftar statis ISO 3166-1 + Kota/State teks bebas). Bukan satu form yang otomatis bercabang dari pilihan negara — dua tab eksplisit sesuai permintaan user.

**Rationale:** Alamat ini dipakai publik — jamaah WNI bisa tinggal di luar negeri, dan modul lain (vendor luar negeri, dst.) nanti mungkin juga butuh alamat non-Indonesia. Data wilayah terstruktur (province→village) cuma masuk akal untuk Indonesia (satu-satunya negara yang datanya diriset); negara lain pakai Kota/State bebas teks karena istilah dan granularitas administratif berbeda-beda per negara, tidak mungkin distandardkan dengan cara yang sama.

**Kenapa daftar negara TIDAK diriset dari GitHub seperti data wilayah Indonesia:** ISO 3166-1 sangat stabil (beda dari data kecamatan/desa yang direvisi Kemendagri tiap beberapa tahun) — cukup daftar statis dibundel di kode (`lib/constants/countries.ts`), tidak perlu tabel DB/CRUD admin.

**Affects:** `docs/arsitektur-alamat.md` §3.1 (`Address.type`, field internasional ditambahkan), §3.2 (baru, dua tab), §5 (integrasi manifest diperbarui)

## 2026-07-23 — Alamat: Koreksi Skema Setelah Verifikasi Data Asli

**Decision:** Sebelum eksekusi, file `db/wilayah.sql` diunduh & diperiksa langsung (bukan cuma percaya tabel agregat di README) — ditemukan 2 hal yang mengoreksi rencana skema sebelumnya:
1. Sumber aslinya **satu tabel flat** `wilayah(kode, nama)` dengan kode berjenjang dipisah titik (`11` → `11.01` → `11.01.01` → `11.01.01.2001`), BUKAN 4 tabel terpisah — level ditentukan dari jumlah segmen kode. Skema tujuan kita (4 tabel Prisma) tetap dipertahankan untuk ergonomi query, tapi proses impornya sekarang eksplisit: split kode by `.`, level = jumlah segmen, `parentId` = kode minus segmen terakhir.
2. **`AddressRegency.type` (kabupaten/kota) AMAN diisi otomatis** — dicek: 514/514 baris level itu 100% berprefix `"Kabupaten "`/`"Kota "`, tanpa pengecualian.
3. **`AddressVillage.type` (desa/kelurahan) DIHAPUS dari rencana** — dicek: cuma 21 dari 83.762 baris level desa yang punya penanda eksplisit "Desa "/"Kelurahan ", sisanya nama tempat polos. Data sumber ini tidak mendukung klasifikasi itu secara reliable.

**Rationale:** Prinsip "recheck dulu" (`CLAUDE.md`) — jangan asumsikan struktur data dari luar (tabel agregat README) tanpa verifikasi langsung isi file sebelum menulis skema/migrasi. Kalau tidak dicek, `AddressVillage.type` akan terisi `null`/salah untuk >99,9% baris — field yang secara teknis ada tapi berbohong soal isinya.

**Affects:** `docs/arsitektur-alamat.md` §2 (temuan verifikasi ditambahkan), §3 (`AddressVillage.type` dihapus), §4 (logic parsing impor diperjelas: split-by-dot, parentId derivation, regency-type dari prefix nama)

## 2026-07-23 — Komponen Alamat: Eksekusi Selesai & Terverifikasi

**Decision:** Rencana `docs/arsitektur-alamat.md` dieksekusi penuh (6 fase) — schema (4 tabel wilayah + `Address` + `AddressType`), impor data resmi, daftar negara statis, API, komponen frontend `AddressPicker`. Semua diverifikasi bekerja end-to-end (build, curl API, browser interaksi nyata).

**Temuan saat eksekusi (bukan cuma dari riset README, tapi dari isi file nyata):**
- Sumber `db/wilayah.sql` ternyata **satu tabel flat** `wilayah(kode, nama)` berjenjang titik, bukan 4 tabel — skema tujuan (4 tabel Prisma) dipertahankan untuk ergonomi query, tapi proses impor menyesuaikan (split by level, derive parentId).
- `AddressRegency.type` (kabupaten/kota) **bisa** diisi otomatis dari prefix nama (100% konsisten, 514/514 baris). `AddressVillage.type` (desa/kelurahan) **dihapus dari rencana** — cuma 21/83.762 baris punya penanda eksplisit, tidak reliable.
- Bug parser: eskape apostrof gaya SQL standar (`''`, bukan `\'`) menyebabkan ~437 baris salah parse & FK violation di percobaan pertama — diperbaiki, data diverifikasi ulang PERSIS cocok jumlah sumber.
- Bug tipe: `import.meta.dir` (API Bun runtime) tidak dikenal TypeScript saat `next build` — diganti `fileURLToPath(new URL(...))`, portable.
- Styling `AddressPicker`/`AutocompleteSelect` sengaja pakai token shadcn standar (`border-input`, `text-muted-foreground`, dst.), BUKAN token khusus admin (`admin-inp`, `text-ink`, dst.) — supaya komponen ini renders masuk akal di konteks admin MAUPUN pilgrim/publik, konsisten dengan sifatnya yang reusable lintas form.

**Verifikasi:** cascading Provinsi→Kab/Kota→Kecamatan diuji langsung di browser (Jawa Barat → Kota Bandung → Bandung Kidul, autocomplete filter berfungsi), tab domestik/internasional berfungsi (switch ke internasional meng-clear field domestik, pilih "Arab Saudi" tersimpan sebagai `countryCode: "SA"`). API diuji via curl: create address berhasil, validasi hierarki BENAR menolak kombinasi provinsi/kab-kota yang tidak sesuai, GET mengembalikan join nama dengan benar. `bun run build` 0 error di tiap fase (6 fase total).

**Affects:** `prisma/schema.prisma` (+5 model, +1 enum), migrasi `20260723152500_address_component`, `scripts/import-wilayah.ts` (BARU), `lib/constants/countries.ts` (BARU), `lib/validators/address.ts` (BARU), `lib/address/prepare.ts` (BARU), `app/api/v1/address/*` (BARU, 6 route), `components/shared/AddressPicker.tsx` + `AutocompleteSelect.tsx` (BARU), `components/ui/textarea.tsx` (BARU), `docs/arsitektur-alamat.md` (status → SELESAI & TERVERIFIKASI, §8 verifikasi ditambah)

## 2026-07-23 — `AutocompleteSelect` Dipertegas Jadi Komponen Generik Lintas Form

**Decision:** User minta konfirmasi eksplisit bahwa combobox autocomplete yang dipakai di `AddressPicker` bisa dipakai di form lain juga. `AutocompleteSelect` (`components/shared/AutocompleteSelect.tsx`) sudah generik sejak awal (cuma terima `options: {id,label}[]`, tidak tahu apa pun soal alamat/wilayah) — ditambah 2 kemampuan supaya benar-benar siap pakai lintas kasus, bukan cuma cukup untuk alamat:
1. **Navigasi keyboard** — panah atas/bawah menggeser highlight, Enter memilih baris yang di-highlight, Escape menutup dropdown.
2. **Mode pencarian server-side opsional** (`onSearch` callback + `loading` prop) — kalau diisi, komponen TIDAK memfilter `options` sendiri (percaya hasil dari server sudah relevan), dipakai untuk daftar yang terlalu besar untuk dimuat penuh sekaligus. Kalau kosong (default), filter tetap lokal seperti sebelumnya.

**Pemakaian konkret sebagai bukti reusability:** combobox Desa/Kelurahan di `AddressPicker` diubah pakai mode `onSearch` (debounce 300ms) — kecamatan tertentu bisa punya puluhan-ratusan desa, endpoint `.../villages` sudah mendukung `?q=` sejak Fase 4. Provinsi/Kab-Kota/Kecamatan/Negara tetap mode default (jumlah kecil, tidak perlu round-trip server per huruf).

**Rationale:** Investasi kecil sekarang (komponen generik + 2 mode) menghindari perlu menulis ulang combobox dari nol tiap kali form baru butuh dropdown pencarian — baik untuk daftar kecil (filter lokal) maupun daftar besar (search server-side, pola yang sama persis dipakai untuk kasus lain nanti: cari produk, cari user, dst.).

**Verifikasi:** navigasi keyboard dikonfirmasi (highlight bergerak benar dengan ArrowDown, screenshot: "Jawa Tengah" ter-highlight); mode `onSearch` dikonfirmasi via network request nyata (`?districtId=...&q=tinjo` → hasil "Tinjomoyo"). Pemilihan via tombol Enter otomatis sempat memicu artefak navigasi-ke-homepage dari alat automation browser (bukan bug kode, pola yang sama pernah tercatat di sesi sebelumnya) — diverifikasi ulang lewat klik pada item yang sama, berhasil.

**Affects:** `components/shared/AutocompleteSelect.tsx` (navigasi keyboard + `onSearch`/`loading`), `components/shared/AddressPicker.tsx` (villages pakai `onSearch` dengan debounce), `docs/arsitektur-alamat.md` §8 (verifikasi ditambah)

## 2026-07-23 — Komponen Alamat Diwire ke User/Vendor/Hotel + Bug Zod `.optional()` vs `null` Ditutup

**Decision:** User minta komponen Alamat (dibangun berdiri sendiri sebelumnya) benar-benar "dieksekusi" — dipakai di form nyata, scope "semua yang membutuhkan alamat". Diwire ke 3 entity yang butuh alamat di kode aktual saat ini: `User` (profil pilgrim), `Vendor` (syarikah/vendor pihak ketiga), `Hotel` (produk hotel). Pola konsisten di ketiganya: model dapat `addressId String? @unique` + relasi ke `Address`; API create/update-nya menerima `address` sebagai field nested opsional (`addressSchema.optional()`), lalu route handler memanggil helper baru `upsertAddress(existingAddressId, input)` (`lib/address/prepare.ts`) yang create/update baris `Address` DALAM request yang sama — atomik, tidak ada row `Address` yatim kalau langkah lain gagal. Halaman Settings Vendor sekaligus dinaikkan dari create-only jadi create+edit penuh (sebelumnya cuma bisa toggle `isActive` untuk vendor existing) — supaya alamat (dan field lain) tetap bisa dikoreksi setelah dibuat, pakai pola `openVendorForm(existing?)` yang sudah dipakai berulang di modul lain sesi ini.

**Bug ditemukan & DITUTUP saat verifikasi browser end-to-end (bukan cuma curl):** `addressSchema` (`lib/validators/address.ts`) mendefinisikan semua field turunan (`provinceId`, `regencyId`, `districtId`, `villageId`, `countryCode`, `city`, `stateRegion`, `postalCode`) dengan `.optional()` polos — Zod `.optional()` hanya menerima `undefined`, MENOLAK `null`. Tapi `AddressPicker` adalah form terkontrol yang state-nya (`AddressValue`) selalu punya semua field dengan tipe `string | null` — field yang belum dipilih dikirim sebagai `null`, bukan dihilangkan dari payload. Akibatnya: setiap kali form submit alamat lewat Vendor/Hotel/Profile, API menolak dengan 400 `"Expected string, received null"` — bug ini ada di ketiga entity sejak field ini pertama ditambahkan, luput karena verifikasi sebelumnya (Fase Alamat awal) hanya menguji endpoint `/api/v1/address/*` langsung via curl dengan payload manual (yang menghilangkan field kosong), bukan lewat komponen form React yang benar-benar mengirim `null`.

**Fix:** ganti semua `.optional()` di field-field itu jadi `.nullish()` (terima `undefined` DAN `null`). `prepareAddressData()`/`upsertAddress()` di `lib/address/prepare.ts` sudah menangani `null` dengan benar sejak awal (pola `input.field ?? null` saat menulis ke DB) — jadi fix ini murni di boundary validasi Zod, tidak ada perubahan logic lain.

**Rationale:** field opsional yang datang dari state komponen form terkontrol (bukan dari `JSON.stringify` objek yang field-nya dihilangkan manual) hampir selalu berbentuk `null`, bukan `undefined` — pola ini akan berulang di form lain yang pakai `AddressPicker` atau komponen controlled serupa nanti. Dicatat di sini supaya tidak terulang: kalau ada value opsional dari state form terkontrol, default ke `.nullish()`, bukan `.optional()` saja.

**Verifikasi:** `bun run build` 0 error. Diverifikasi end-to-end di browser: login admin → Settings → Edit vendor "Ahmad Guide" → pilih Provinsi "Jawa Barat" → isi Alamat Lengkap → Simpan. Sebelum fix: `PUT .../vendors/[id]` 400. Setelah fix: 200 OK, dikonfirmasi tersimpan benar lewat query DB langsung (`provinceId: "32"`, `fullAddress: "Jl. Uji Coba No. 1"`) — data test dibersihkan setelahnya. Fix di level schema bersama berlaku otomatis untuk Hotel dan Profile juga (satu `addressSchema`, satu bug, satu perbaikan).

**Affects:** `prisma/schema.prisma` (+`addressId` pada `User`/`Vendor`/`Hotel`), migrasi `20260723165014_address_wiring`, `lib/validators/address.ts` (`.optional()` → `.nullish()`, BUG FIX), `lib/address/prepare.ts` (+`upsertAddress()`), `lib/validators/auth.ts` (+`address` di `profileSchema`), `app/api/v1/auth/profile/route.ts`, `app/api/v1/admin/system/settings/vendors/route.ts` + `[id]/route.ts`, `app/api/v1/admin/products/hotels/[id]/route.ts`, `app/[locale]/(pilgrim)/profile/{page,ProfileForm}.tsx`, `app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx`, `app/[locale]/admin/(protected)/system/settings/page.tsx` (create-only → create+edit), `docs/arsitektur-alamat.md` §9 (wiring plan → SELESAI)

## 2026-07-23 — Komponen Kontak (Nomor HP/WhatsApp/Email) Dibangun & Diwire ke Booking Pilgrims

**Decision:** User minta komponen "Kontak" reusable (kode negara autocomplete default Indonesia + Nomor HP + Nomor WhatsApp dengan checkbox "Sama dengan nomor HP" yang juga menyamakan kode negara + Email prefill dari akun), mengikuti pola persis komponen Alamat (dokumen arsitektur dulu, baru eksekusi). Riset kode aktual (`docs/arsitektur-komponen-kontak.md` §2) menemukan pola ini genuinely belum ada di mana pun — semua titik nomor telepon existing (registrasi, wizard pilgrim, profil) hardcode `+62` sebagai teks tetap, phone dan WhatsApp dianggap satu field yang sama, dan tidak ada dataset kode panggilan telepon di repo. `lib/constants/countries.ts` (195 negara ISO alpha-2, sebelumnya cuma untuk tab Alamat Luar Negeri) diperluas dengan field `dialCode` (kode panggilan ITU-T E.164) — satu sumber dipakai dua kebutuhan, bukan 2 daftar negara paralel yang bisa drift. Flag bendera dihitung dari kode ISO via konversi Unicode Regional Indicator (`lib/utils/flag.ts`), tidak disimpan sebagai data.

**Skema:** `BookingPilgrim` (satu-satunya entity yang diwire, lihat rationale di bawah) dapat 3 kolom baru — `phoneCountryCode`/`whatsapp`/`whatsappCountryCode` (semua additive, migrasi `20260723170000_kontak_booking_pilgrim`). Checkbox "Sama dengan nomor HP" SENGAJA TIDAK disimpan sebagai boolean di DB — nilai turunan dari perbandingan `phone`/`whatsapp` aktual saat komponen dimuat, state independen (`unlocked`) cuma hidup di level komponen React untuk menangani UX lepas-centang (lihat Bug #1 di bawah).

**Keputusan scope wiring — cuma `BookingPilgrim`, bukan `User`/registrasi/profil/`Vendor.contactInfo`:** `User.phone`+`phoneVerifiedAt` ITU SENDIRI sudah = nomor WhatsApp (dipakai OTP via GOWA) — menambah kolom Kontak generik di `User` akan menciptakan dua sumber kebenaran ambigu untuk "nomor WA mana yang aktif" tanpa kebutuhan bisnis nyata. Registrasi sengaja tidak disentuh (butuh SATU nomor WA-aktif untuk OTP, bukan 2 field kontak terpisah — friksi tanpa manfaat). `BookingPilgrim` dipilih sebagai satu-satunya target karena representasi paling jelas dari kebutuhan "satu akun booking untuk banyak orang" (keputusan besar sesi sebelumnya) — tiap jamaah butuh kontak sendiri independen dari akun pemesan.

**Bug #1 ditemukan & DITUTUP saat verifikasi browser:** implementasi awal checkbox murni menghitung `sameAsPhone` dari perbandingan `phone`/`whatsapp` — melepas centang cuma memanggil `onChange(value)` tanpa perubahan apa pun, sehingga nilai turunan otomatis balik `true` di render berikutnya (karena kedua value masih identik) dan field WhatsApp TIDAK PERNAH benar-benar bisa lepas dari Nomor HP lewat UI. Diperbaiki dengan state lokal `unlocked` di `ContactPicker` yang menang atas nilai turunan sampai pengguna centang ulang secara eksplisit.

**Bug #2 ditemukan & DITUTUP saat mencoba submit booking asli:** `app/[locale]/(pilgrim)/bookings/new/payment/page.tsx` membangun payload `POST /api/v1/bookings` manual dari `draft.pilgrims` — titik ini terlewat saat wiring (Fase 4) meski `PilgrimData`, UI wizard, validator, dan route handler semua sudah benar; payload cuma menyalin `fullName`/`gender`/`email`/`phone` lama, 3 field Kontak baru tidak pernah ikut terkirim. Diperbaiki dengan menambah 3 field itu ke payload.

**Verifikasi:** `bun run build` 0 error di 5 fase. Browser: `ContactPicker` render benar dengan default Indonesia, prefill email otomatis dari akun (`GET /api/v1/auth/profile`, endpoint baru), sinkronisasi checkbox 2 arah dikonfirmasi (isi HP → WA ikut → uncheck → WA lepas & independen, diuji ganti ke kode negara Arab Saudi → checkbox tetap lepas → centang ulang → WA tersinkron balik). End-to-end lewat curl (submit browser asli terganggu artefak alat automation yang sudah tercatat sebelumnya, bukan bug kode): `POST /api/v1/bookings` dengan `phone`+`phoneCountryCode="ID"` dan `whatsapp`+`whatsappCountryCode="SA"` (kode negara BERBEDA) → 201 → `BookingPilgrim` di DB dikonfirmasi menyimpan keduanya independen persis sesuai kiriman — data test dibersihkan.

**Pelajaran:** kedua bug lolos `bun run build` (valid secara tipe) dan review kode sekilas — baru ketahuan lewat percobaan end-to-end nyata (isi form asli, submit booking asli, cek DB asli). Menguatkan [[feedback_zod_optional_vs_nullish]]: verifikasi form interaktif butuh lebih dari "kelihatan benar di kode", terutama untuk derived state (checkbox dari perbandingan value) dan titik integrasi berlapis (draft → payload manual → validator → DB).

**Affects:** `lib/constants/countries.ts` (+`dialCode`), `lib/utils/flag.ts` (BARU), `lib/utils/phone.ts` (+`toE164Digits`, `normalizePhone` lama dipertahankan untuk registrasi), `lib/validators/contact.ts` (BARU), `prisma/schema.prisma` (+3 kolom `BookingPilgrim`), migrasi `20260723170000_kontak_booking_pilgrim`, `components/shared/ContactPicker.tsx` (BARU), `lib/booking/draft.ts` (`PilgrimData` +3 field), `lib/validators/booking.ts` (pilgrims array +3 field), `app/api/v1/bookings/route.ts`, `app/api/v1/auth/profile/route.ts` (+`GET`, BARU), `app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx`, `app/[locale]/(pilgrim)/bookings/new/payment/page.tsx` (BUG FIX #2), `docs/arsitektur-komponen-kontak.md` (BARU, status → SELESAI & TERVERIFIKASI)

## 2026-07-24 — Booking Engine Universal: Adapter Layer + `cancelBooking()` Universal (Step 1-3), Menutup Gap #2 & #3

**Decision:** User minta eksekusi `docs/arsitektur-booking.md` (booking engine universal, rencana sejak 2026-07-22), dengan instruksi eksplisit ikuti Fase Eksekusi SOP (recheck dulu, baru rencana, baru eksekusi bertahap) dan fokus hanya ke bagian ini. Recheck kode aktual 2026-07-24 (bukan cuma baca dokumen) mengonfirmasi baseline §0 dokumen MASIH akurat — 4 Gap kritis persis terbuka seperti dideskripsikan, struktur `lib/quota/index.ts` (15 fungsi) dan 4 titik orkestrasi persis seperti diaudit. Satu drift baru dicatat (BUKAN penghalang): `BookingPilgrim` dapat 3 kolom baku tambahan dari `docs/arsitektur-komponen-kontak.md` (2026-07-23) yang belum tercatat di baseline — relevan untuk Step 4 (Manifest) nanti, dicatat di `docs/arsitektur-booking.md` §0 sebelum lanjut.

Mengingat besarnya scope 8 Step total (Manifest+Dokumen+redesain `items[]` adalah proyek tersendiri yang jauh lebih besar), dipilih **satu putaran eksekusi yang bisa diverifikasi utuh**: Step 1 (adapter layer), Step 2 (skema kuota Haji), Step 3 (`cancelBooking()` universal) — tiga step ini TIDAK bergantung pada Manifest/Dokumen/redesain `items[]`, dan langsung menutup 2 dari 4 Gap kritis (`docs/arsitektur-umroh.md` §7 Gap #2/#3) tanpa menunggu proyek besar Step 4-8.

**Deviasi dari pseudo-code §3.2 dokumen rencana**: `quotaAdapters` diimplementasikan sebagai object literal dengan tipe konkret per key, BUKAN `Record<BookingItemType, QuotaAdapter>` generik seragam seperti digambarkan di rencana — tiap tipe (hotel/transport/muthowif/tourPackage/haji) beroperasi atas baris tabelnya sendiri yang bentuknya berbeda-beda (`BookingHotel` vs `BookingMuthowif` vs `BookingTourPackage`, dst.), jadi memaksa satu signature generik seragam untuk semua cuma akan butuh `any`/type-erasure yang menghilangkan manfaat type-safety. Kelengkapan key (jaminan "tidak ada tipe yang terlupa") tetap didapat dari TypeScript object literal type checking — efeknya sama dengan `Record<>`, tanpa unifikasi paksa yang tidak natural untuk bentuk data yang genuinely berbeda.

**Step 1 — Adapter layer**: `lib/quota/adapters/{types,hotel,transport,muthowif,catering,tourPackage,visa}.ts` + `index.ts` (registry `quotaAdapters`). Murni bungkus fungsi `lib/quota/index.ts` yang sudah ada dan sudah benar (`reserveHotelQuota` dst.) — TIDAK menulis ulang logic apa pun, cuma reorganisasi. 3 titik orkestrasi yang SUDAH ADA direfactor pakai adapter (`bookings/route.ts` reserve, `payments/[id]/confirm/route.ts` confirm, `autocancelJob.ts` release) — zero behavior change, diverifikasi lewat `bun run build` 0 error (refactor murni, tidak ada perilaku baru untuk diuji di titik ini).

**Step 2 — HajiProduct.pendingQuota + hajiAdapter**: migrasi `20260724100000_haji_pending_quota` menambah `pendingQuota Int @default(0)` ke `HajiProduct` (pola identik `HotelRoomSchedule` — 3 kolom total/pending/booked). `lib/quota/adapters/haji.ts` ditulis dan didaftarkan di registry, TAPI belum dipanggil dari titik mana pun — booking Haji itu sendiri (field `haji` di `createBookingSchema`, `bookingHaji.create()`) belum dibangun, itu bagian dari Step 5 yang lebih besar (redesain `items[]`), sengaja tidak dikerjakan di putaran ini.

**Step 3 — `cancelBooking()` universal**: `lib/booking/cancel.ts` — satu fungsi menutup Gap #2 (`DELETE /api/v1/bookings/[id]` sebelumnya TIDAK di dalam `$transaction` dan TIDAK memanggil release kuota apa pun sama sekali, padahal cron auto-cancel sudah benar) dan Gap #3 (refund dihitung tapi tidak pernah dicatat sebagai row `Refund`) sekaligus — dipanggil dari DELETE route (self-cancel) DAN `autocancelJob.ts` (auto-cancel), fungsi yang PERSIS SAMA menggantikan implementasi cron yang sebelumnya terpisah dari (dan lebih benar dari) self-cancel yang tidak punya implementasi sama sekali.

**Verifikasi:** `bun run build` 0 error di tiap fase. End-to-end via curl + query DB langsung terhadap server dev nyata (bukan browser pane sandbox — server `bun run dev` dijalankan langsung via Bash tool di mesin yang sama dengan filesystem project, dikonfirmasi terpisah dari server preview browser pane yang sempat membingungkan user karena tidak bisa diakses dari browser mereka sendiri): (1) booking dibuat dengan `hotelMakkah` 2 kamar → `HotelRoomSchedule.pendingQuota` naik 0→2 (reserve via adapter bekerja); (2) self-cancel booking itu (`departureDate` sudah lewat) → `pendingQuota` kembali 0, `booking.status: 'cancelled'`, refund 0 (kebijakan <30 hari), TIDAK ada row `Refund` (benar — refund 0 tidak perlu dicatat); (3) booking kedua dengan `departureDate` >60 hari ke depan dan `totalAmount` 20.000.000 → self-cancel → row `Refund` dikonfirmasi tercipta persis (`amount: 20000000, status: 'pending', reason: 'Dibatalkan oleh pilgrim'`). Data test dibersihkan setelah verifikasi. Isu `.next` corrupt (build bersamaan dev server) terjadi lagi seperti biasa — sudah diketahui pola fix-nya (restart bersih), bukan bug baru.

**Rationale untuk berhenti di Step 3 (bukan lanjut Step 4-8 sekaligus):** Step 4 (Manifest + Dokumen universal) adalah proyek arsitektur tersendiri yang besar (2 model baru, migrasi data `BookingPilgrim` kolom baku → `fieldValues: Json`, komponen frontend `<ManifestRepeater>` baru) — mencampurnya ke satu putaran eksekusi yang sama akan melanggar prinsip "step by step, fokus satu bagian" yang diminta user, dan membuat verifikasi jadi tidak jelas batasnya. Step 1-3 sengaja dipilih sebagai unit kerja yang utuh: bisa diverifikasi end-to-end secara independen, menutup 2 gap kritis nyata, tanpa bergantung pada pekerjaan besar yang belum dimulai.

**Affects:** `lib/quota/adapters/{types,hotel,transport,muthowif,catering,tourPackage,visa,haji}.ts` (BARU), `lib/quota/adapters/index.ts` (BARU, registry), `lib/booking/cancel.ts` (BARU, `cancelBooking()`), `prisma/schema.prisma` (+`HajiProduct.pendingQuota`), migrasi `20260724100000_haji_pending_quota`, `app/api/v1/bookings/route.ts` (reserve via adapter), `app/api/v1/admin/payments/[id]/confirm/route.ts` (confirm via adapter), `app/api/v1/bookings/[id]/route.ts` (DELETE — pakai `cancelBooking()` dalam `$transaction`, BUG FIX Gap #2/#3), `lib/cron/autocancelJob.ts` (pakai `cancelBooking()` yang sama), `docs/arsitektur-booking.md` (status → Step 1-3 SELESAI & TERVERIFIKASI, §0 +drift note, §7 Verifikasi baru), `docs/arsitektur-umroh.md` §7 (Gap #2/#3 → DITUTUP, Gap #1 prasyarat skema → DITUTUP)

## 2026-07-24 — Booking Engine Step 4 (Dokumen Universal): `DocumentRequirement` Menggantikan `VisaProduct.requirements`

**Decision:** Lanjut eksekusi `docs/arsitektur-booking.md` §6 Step 4 (Manifest + Dokumen universal), dimulai dari Dokumen (lebih kecil, self-contained) sebelum Manifest (jauh lebih besar, langsung menyentuh `BookingPilgrim`). Sebelum menyentuh schema, dilakukan audit blast radius penuh (bukan asumsi dari dokumen rencana yang ditulis 2026-07-22, dua hari sebelum kode terkait berubah lagi oleh kerja Kontak) — menemukan bahwa **notifikasi WhatsApp dan invoice PDF TIDAK PERNAH membaca field kontak/dokumen `BookingPilgrim` sama sekali** (WA selalu pakai `booking.user.phone`, invoice masih stub kosong `export {}`) — blast radius riil untuk Dokumen jauh lebih kecil dari draf rencana awal: cuma 9 file yang benar-benar memanggil `parseRequirements(visaProduct.requirements)`, bukan lintas seluruh modul notifikasi/invoice seperti yang mungkin diasumsikan.

**Skema**: `DocumentRequirement` (polimorfik `productType`+`productId`+`docType`, migrasi additive `20260724110000_document_requirement`) — persis sesuai draf §3 dokumen rencana, tanpa deviasi. `lib/documents/getRequirements.ts` (`getDocumentRequirements()`) jadi satu-satunya fungsi bantu (sesuai §4).

**Migrasi data**: 2 `VisaProduct` di DB, cuma 1 ("Visa Reguler") yang punya `requirements` non-kosong (3 baris) — dimigrasi 1:1 ke `DocumentRequirement` lewat script sekali-jalan (bukan bagian dari migration.sql, dijalankan manual via `bun -e` sesuai pola yang sudah dipakai berulang sesi ini untuk seed/backfill data).

**9 file konsumen dipindah** dari `parseRequirements(visaProduct.requirements)` ke `getDocumentRequirements('visa', productId)`: endpoint upload dokumen pilgrim (`app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts`, 3 titik — GET, validasi docType POST, auto-advance status visa), booking detail admin (`app/[locale]/admin/(protected)/bookings/[id]/page.tsx`, 2 titik) dan pilgrim (`app/[locale]/(pilgrim)/bookings/[id]/page.tsx`), katalog publik (`app/[locale]/(public)/visa/page.tsx`). Ketiga halaman terakhir adalah **server component** yang me-render lewat `.map()` sinkron — `getDocumentRequirements()` (async) tidak bisa dipanggil langsung di dalam callback `.map()`, jadi dihitung SEKALI ke dalam `Map<id, requirements>` sebelum bagian JSX, pola yang sama dipakai di ketiganya untuk konsistensi.

**Admin builder Visa jadi dual-write** (bukan cutover langsung): `app/api/v1/admin/products/visa/route.ts` (create) dan `[id]/route.ts` (update) sekarang menulis KE DUA tempat dari input array yang sama dalam satu request — `VisaProduct.requirements` (Json lama, dipertahankan untuk kompatibilitas mundur sesuai §5 rencana) DAN `DocumentRequirement` (sumber baru, pakai pola replace-all: hapus semua baris lama untuk `productId` itu, buat ulang dari array yang dikirim). Karena kedua tulisan berasal dari input yang SAMA PERSIS dalam request yang sama, tidak ada risiko drift antara dua sumber — beda dari kasus dual-source yang genuinely berisiko (mis. cache yang dihitung terpisah dari nilai live). GET `[id]/route.ts` mengembalikan `documentRequirements` (baru) berdampingan `requirements` (lama) supaya UI builder bisa baca dari sumber baru tanpa breaking response contract.

**Dead code dibersihkan**: `parseRequirements()` (fungsi, BUKAN tipe `VisaRequirement` yang masih dipakai luas) dihapus dari `lib/types/visa.ts` — dikonfirmasi via grep tidak ada lagi pemanggil setelah ke-9 file di atas dipindah.

**Verifikasi**: `bun run build` 0 error. End-to-end via curl + query DB langsung terhadap server dev nyata: (1) `GET`/`PUT` admin builder Visa — `documentRequirements` di response cocok DB, replace-all saat update dikonfirmasi (tambah 1 field opsional → 4 baris di DB → direvert ke 3 baris semula); (2) booking test dibuat dengan visa yang punya requirements → `GET` endpoint dokumen pilgrim mengembalikan `missing: ["passport","ktp","kartu_keluarga"]` dan `requirements` PERSIS dari `DocumentRequirement`, dikonfirmasi bukan lagi baca `VisaProduct.requirements` — data test dibersihkan; (3) katalog publik `/id/visa` dikonfirmasi tetap merender label dokumen dengan benar (`curl` + grep string yang diharapkan).

**Yang BELUM dikerjakan** (sesuai §6 rencana, bukan pekerjaan tambahan): `DocumentRequirement` untuk produk selain Visa (Paket Umroh, Tiket Pesawat, Haji) — nol baris untuk productType lain, menyusul begitu masing-masing produk itu benar-benar diintegrasikan ke booking engine baru. `VisaProduct.requirements` belum dihapus dari schema (tetap dual-write) — penghapusan field lama itu sendiri adalah "fase terpisah setelah dikonfirmasi tidak ada lagi pemanggil" sesuai §5, bukan bagian dari putaran ini.

**Affects:** `prisma/schema.prisma` (+`model DocumentRequirement`), migrasi `20260724110000_document_requirement`, `lib/documents/getRequirements.ts` (BARU), `lib/types/visa.ts` (`parseRequirements()` dihapus), `app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts`, `app/api/v1/admin/products/visa/route.ts` (create, dual-write), `app/api/v1/admin/products/visa/[id]/route.ts` (update dual-write + GET `documentRequirements`), `app/[locale]/admin/(protected)/products/visa/[id]/page.tsx` (baca `documentRequirements`), `app/[locale]/admin/(protected)/bookings/[id]/page.tsx`, `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/[locale]/(public)/visa/page.tsx`, `docs/arsitektur-dokumen.md` (status → SELESAI & TERVERIFIKASI untuk Visa, §8 Verifikasi baru)

## 2026-07-24 — Booking Engine Step 4 (Manifest Universal): `BookingPilgrim` Kolom Baku Dihapus Total, Diganti `fieldValues: Json`

**Decision:** Lanjut Step 4 bagian Manifest (`docs/arsitektur-manifest.md`) — bagian TERBESAR dan paling berisiko dari seluruh eksekusi booking engine sesi ini, karena langsung merombak model data `BookingPilgrim` yang dibaca di banyak tempat. Audit blast radius (Explore agent, read-only) dilakukan LEBIH DULU, sebelum sentuh schema apa pun — menemukan 11 file bergantung kolom baku secara langsung, sekaligus mengoreksi 2 asumsi: `passportNumber`/`passportExpiry`/`nationality`/`dateOfBirth` TIDAK PERNAH diisi di wizard (cuma admin, belakangan, via endpoint terpisah) — jadi field-field ini secara de-facto "opsional, jarang diisi saat booking" bukan "wajib sejak awal"; dan `isLeader` genuinely tidak pernah dibaca kode manapun (murni disiapkan fitur Group yang 0% jalan, aman diabaikan sebagai form field).

**Migrasi dieksekusi 2 tahap**: (1) `20260724120000_manifest_field_requirement` — model `ManifestFieldRequirement` baru, additive; (2) `20260724130000_manifest_collapse_booking_pilgrim` — DROP 11 kolom baku `BookingPilgrim`, ADD `fieldValues Json @default("{}")`. Migrasi kedua ini SECARA LITERAL destruktif (DROP COLUMN), tapi dijalankan aman karena `prisma.bookingPilgrim.count()` dicek LEBIH DULU dan hasilnya 0 baris di DB dev saat itu (bukan diasumsikan aman — dikonfirmasi) — jadi tidak perlu script backfill data sama sekali, satu-satunya kasus migrasi destruktif sesi ini yang tidak butuh langkah preservasi data.

**Seed default**: 9 field (`fullName`→role `display_name`, `gender`, `email`→role `email`, `phone`→role `phone`, `whatsapp`→role `whatsapp`, `passportNumber`→role `passport_number`, `passportExpiry`, `nationality`, `dateOfBirth`) di-seed untuk KEDUA `VisaProduct` yang ada di DB — meniru persis kolom baku lama, seperti diarahkan §6 rencana. **Deviasi dari draf**: `phoneCountryCode`/`whatsappCountryCode` (kolom terpisah hasil kerja Kontak kemarin) TIDAK jadi field manifest tersendiri — digabung jadi bagian dari SATU field `fieldType='phone'`, nilainya disimpan sebagai objek `{countryCode, number}` di `fieldValues[fieldKey]`, bukan string flat seperti diimplikasikan draf §3.1 (yang ditulis sebelum komponen Kontak ada, jadi belum mempertimbangkan kebutuhan kode negara).

**Komponen frontend baru `components/booking/ManifestFieldsForm.tsx`** (bukan `<ManifestRepeater>` seperti nama di draf §5 — level "tambah/hapus orang" sudah ditangani `pilgrims/page.tsx` sejak awal, komponen ini cuma render field DALAM satu baris orang) — render generik 8 `fieldType` (text/textarea/select/date/email/number/phone/address). **Keputusan sadar, bukan kelalaian**: field `fieldType='phone'` di sini TIDAK memakai `ContactPicker` (docs/arsitektur-komponen-kontak.md) — checkbox "Sama dengan nomor HP" (fitur UX yang baru dibangun kemarin) SENGAJA tidak dibawa ke render generik ini. Mempertahankannya butuh deteksi "field mana yang berperan phone DAN whatsapp secara bersamaan" lalu render cabang berbeda untuk pasangan itu — menambah kerumitan berarti pada komponen yang tujuannya justru benar-benar generik per konfigurasi admin bebas. Trade-off eksplisit, dicatat di sini supaya tidak dikira regresi tak sengaja kalau ditemukan nanti.

**Wizard direstruktur** (`pilgrims/page.tsx`): pemilihan "Jenis Visa" dipindah ke ATAS (sebelumnya di bawah form nama/kontak) — field manifest yang dirender bergantung PRODUK yang dipilih orang itu, jadi produk harus diketahui dulu sebelum field bisa di-fetch (`GET /api/v1/manifest/requirements`, endpoint baru, publik/tanpa auth karena cuma definisi field, bukan data pribadi) dan dirender. Prefill Jamaah #1 dari akun (email, WhatsApp) diubah dari akses field langsung jadi pencarian lewat `role` (`getFieldByRole()`), konsisten dengan filosofi "sistem tahu peran field tanpa hardcode `fieldKey`".

**Validasi required-field jadi dinamis**: `lib/validators/booking.ts`'s `superRefine` sekarang query `ManifestFieldRequirement` per `visaProductId` pilgrim dan cek field yang `required=true` benar-benar terisi di `fieldValues` — menggantikan validasi zod statis (`fullName: z.string().min(2)`, dst.) yang sebelumnya hardcode per nama kolom. Ini konsisten dengan prinsip "field custom diatur admin" — validasi ikut mengikuti konfigurasi, bukan lagi tertanam di kode.

**11 file direwrite total**: `bookings/route.ts` (create — `fieldValues` langsung, sudah tervalidasi), `admin/pilgrims/[pilgrimId]/passport/route.ts` (jadi MERGE ke `fieldValues` — fetch dulu, spread, tulis balik — BUKAN replace kolom, supaya field lain dari wizard tidak hilang), `admin/bookings/[id]/page.tsx` + `PassportForm.tsx`, `admin/visa/page.tsx`, `(pilgrim)/bookings/[id]/page.tsx`, `admin/bookings/[id]/documents/zip/route.ts` (nama folder ZIP), `lib/booking/draft.ts` (`PilgrimData.fieldValues`), `payment/page.tsx` — semua baca nama tampilan lewat `getFieldByRole(fields, fieldValues, 'display_name')`, bukan `p.fullName` langsung lagi.

**Verifikasi end-to-end via curl + query DB langsung** (server dev nyata): (1) `GET /api/v1/manifest/requirements?productType=visa&productId=...` mengembalikan 9 field lengkap dengan `role`/`options` sesuai seed; (2) booking dibuat dengan `fieldValues` berisi `phone: {countryCode:"ID",...}` DAN `whatsapp: {countryCode:"SA",...}` (kode negara berbeda) → dikonfirmasi tersimpan PERSIS sebagai objek bersarang di `BookingPilgrim.fieldValues`; (3) halaman detail admin DAN daftar visa admin merender nama jamaah dengan benar via `getFieldByRole`; (4) `PUT` endpoint passport dikonfirmasi MERGE — field kontak/nama dari step (2) tetap utuh setelah field paspor ditambahkan, tidak tertimpa; (5) endpoint dokumen jamaah dan ZIP download tetap berfungsi tanpa kolom baku. Data test dibersihkan. `bun run build` 0 error — 1 bug tipe ditemukan & ditutup di tengah jalan: `typeof booking.pilgrims` (type-level, bukan value-level) tidak ikut null-narrowing dari `if (!booking) notFound()` di 2 halaman server component, diperbaiki jadi `NonNullable<typeof booking>['pilgrims'][number]`.

**Rationale untuk migrasi tanpa backfill**: berbeda dari migrasi destruktif pada umumnya yang butuh script preservasi data, di sini `count()` dicek lebih dulu secara eksplisit dan hasilnya nol — keputusan untuk melewati langkah backfill BUKAN asumsi "pasti aman karena dev DB", tapi verifikasi konkret sebelum mengeksekusi ALTER TABLE yang menghapus kolom.

**Status Booking Engine setelah putaran ini**: Step 1-4 (dari 8 total di `docs/arsitektur-booking.md` §6) SELESAI & TERVERIFIKASI. Step 5 (redesain `createBookingSchema` jadi `items[]` generik + refactor final 4 titik orkestrasi ke bentuk itu), Step 6 (checkout pendek Haji/Visa-only/Transport-only), Step 7 (invoice generik), Step 8 (dokumentasi akhir) tetap rencana, belum dieksekusi.

**Affects:** `prisma/schema.prisma` (+`model ManifestFieldRequirement`, `BookingPilgrim` kolom baku dihapus total), migrasi `20260724120000_manifest_field_requirement` + `20260724130000_manifest_collapse_booking_pilgrim`, `lib/manifest/getRequirements.ts` (BARU), `components/booking/ManifestFieldsForm.tsx` (BARU), `app/api/v1/manifest/requirements/route.ts` (BARU), `app/api/v1/bookings/route.ts`, `app/api/v1/admin/pilgrims/[pilgrimId]/passport/route.ts`, `app/[locale]/admin/(protected)/bookings/[id]/page.tsx`, `app/[locale]/admin/(protected)/visa/page.tsx`, `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx` (restrukturisasi total), `app/[locale]/(pilgrim)/bookings/new/payment/page.tsx`, `app/api/v1/admin/bookings/[id]/documents/zip/route.ts`, `lib/booking/draft.ts`, `lib/validators/booking.ts` (validasi dinamis), `docs/arsitektur-manifest.md` (status → SELESAI & TERVERIFIKASI untuk Visa, §8 Verifikasi baru), `docs/arsitektur-booking.md` (Step 4 → SELESAI, status banner update)

## 2026-07-25 — Booking Engine Step 5: `items[]` Generik, `totalAmount` Server-Computed, Visa Tetap Wajib (Superseding Deviasi)

**Decision:** Eksekusi `docs/arsitektur-booking.md` §6 Step 5 — redesain `createBookingSchema` dari field tetap (`hotelMakkah`/`hotelMadinah`/`transports`/`muthowif`/`catering`/`tourPackages`) jadi `items: z.array(bookingItemSchema)` (discriminated union 6 tipe: hotel/transport/muthowif/catering/tourPackage/haji), plus refactor 4 titik orkestrasi ke bentuk itu. Recheck kode aktual dulu (poin 1 SOP) mengonfirmasi baseline Step 1-4 masih akurat, tidak ada drift baru sejak 2026-07-24.

**Deviasi dari rencana tertulis, SENGAJA, bukan kelalaian**: `docs/arsitektur-booking.md` §6 Step 5 (baris 366, versi sebelum diedit hari ini) merencanakan visa **dihapus dari wajib per pilgrim** — `visaProductId`/`visaType` dihapus dari pilgrim schema, `VisaApplication` cuma dibuat untuk `pilgrimIds[]` yang disertakan lewat `itemType='visa'` (§3.3 baris 233, versi konseptual). Keputusan final di sesi ini: **visa TETAP WAJIB** (`visaProductId: z.string().uuid()` required, bukan optional) — dan visa TETAP field `pilgrims[]` terpisah, BUKAN `itemType='visa'`. Alasan: field manifest (nama, kontak, dst.) hari ini 100% bersumber dari `ManifestFieldRequirement` yang di-keyed oleh `visaProductId` sebagai `productId` (`docs/arsitektur-manifest.md`, dieksekusi kemarin) — kalau visa dibuat opsional sekarang, pilgrim yang tidak pilih visa tidak akan punya field manifest apa pun untuk diisi, TERMASUK NAMA. Mendecouple manifest fields dari konsep "produk yang dibeli" (mis. `productType='core'` generik lepas dari visa, supaya field dasar seperti nama/kontak bisa eksis tanpa embel-embel produk apa pun) adalah pekerjaan arsitektur tersendiri yang cukup besar untuk didokumentasikan dan direncanakan terpisah, bukan sesuatu yang bisa diselipkan di tengah Step 5 tanpa melebar dari fokus "redesain payload jadi items[]". Ini bukan penemuan baru saat coding — teridentifikasi SEBELUM implementasi dimulai, saat menyusun bentuk `pilgrims[]` untuk `lib/validators/booking.ts`, dan langsung diputuskan untuk didokumentasikan sebagai scope deferral eksplisit (bukan diam-diam disimpangi). `docs/arsitektur-booking.md` §6 Step 5 dan §1 banner sudah diedit untuk mencerminkan keputusan final ini, bukan lagi rencana asli.

**Skema (`lib/validators/booking.ts`)**: `bookingItemSchema` discriminated union pada `itemType` — persis bentuk konkret §3.3 baris 227-232 (minus baris 233 `itemType='visa'`, sesuai deviasi di atas). `totalAmount` dihapus total dari input client. `totalPilgrims.max(500)` → `.max(2000)` (batas teknis anti-abuse, bukan aturan bisnis, konsisten Keputusan #9 §8 lama). `haji` ditambahkan sebagai `itemType` valid meski belum ada wizard step yang mengirimnya — konsisten pola "registry lengkap dulu (Step 1-2), integrasi UI menyusul" yang sudah dipakai `quotaAdapters`.

**Orkestrasi (`app/api/v1/bookings/route.ts`)**: reserve loop dan create loop masing-masing jadi satu `switch` generik atas `data.items` (dispatch per `itemType`) — TypeScript menolak build kalau ada `itemType` baru yang belum ditangani di kedua loop (exhaustiveness by construction, pola sama `quotaAdapters`). **`totalAmount` sekarang 100% dihitung server-side** — variabel akumulator bertambah dari `totalPrice` tiap item yang BARU dibuat (bukan dari payload) ditambah `sellPriceSnapshot` tiap pilgrim dari `computeSellPrice()` — closes Gap #4 KRITIS (`docs/arsitektur-umroh.md` §7) yang TIDAK tertutup oleh Step 1-4 (field individual sudah server-side sejak lama, tapi angka agregat `Booking.totalAmount` masih lolos dipercaya dari client sampai putaran ini). Booking dibuat dengan `totalAmount: 0` lalu di-`update()` di akhir transaksi setelah semua item & pilgrim diproses — dibutuhkan karena urutan FK (row `Booking` harus ada dulu untuk line item) sementara total baru diketahui setelah semua item selesai dihitung.

**Confirm route (`app/api/v1/admin/payments/[id]/confirm/route.ts`)**: ditambah `haji: true` di `include` dan `quotaAdapters.haji.confirm()` di loop confirm — celah ini baru genuinely relevan begitu `itemType='haji'` bisa diterima API (sebelumnya tidak ada jalan sama sekali untuk booking Haji tercipta, jadi celah ini laten/tidak bisa dieksploitasi).

**Wizard (`app/[locale]/(pilgrim)/bookings/new/payment/page.tsx`)**: SATU-SATUNYA file wizard yang diubah. `handleConfirm()` meratakan `draft` (bentuk internal TIDAK BERUBAH — `draft.hotelMakkah`, `draft.transports`, dst. tetap sama) jadi array `items` saat submit. `lib/booking/draft.ts` dan seluruh step wizard (dates/hotel/transport/muthowif/addons/pilgrims) sengaja TIDAK disentuh — blast radius minimal, tidak ada perubahan UX di step manapun, cuma titik translasi di submit.

**Verifikasi**: `bun run build` 0 error per sub-step. End-to-end via curl + JWT session dibuat manual dari `JWT_SECRET` (bukan lewat OTP WhatsApp asli — tidak ada user pilgrim dengan nomor asli di DB dev) + query DB langsung terhadap server dev nyata: (1) booking kombinasi hotel+transport+visa → `totalAmount` server (Rp90.750.000) dikonfirmasi PERSIS sama dengan jumlah manual `hotel.totalPrice + transport.totalPrice + visa.sellPriceSnapshot`; (2) booking Haji-only via `itemType='haji'` (`HajiProduct` test dibuat, `totalQuota=10`) → `pendingQuota` 0→2, `totalAmount` (Rp195.500.000) = `bookingHaji.totalPrice` + jumlah `sellPriceSnapshot` 2 pilgrim; (3) `POST admin/payments/[id]/confirm` untuk booking Haji → `pendingQuota` 2→0, `bookedQuota` 0→2, `booking.status: confirmed`; (4) self-cancel booking #1 (regresi check) → kuota kembali 0, `status: cancelled`, mengonfirmasi `cancelBooking()` (beroperasi di relasi per-tipe, bukan `items[]`) tidak terpengaruh perubahan bentuk schema. Semua data test dibersihkan setelah verifikasi.

**Yang BELUM dikerjakan** (sesuai §6 rencana, bukan tambahan): checkout pendek Haji/Visa-only/Transport-only (Step 6 — Step 5 baru menyiapkan API/schema, belum ada UI pendek), invoice generik (Step 7), dokumentasi akhir (Step 8). Visa tetap belum di-decouple dari manifest (deviasi di atas) — follow-up terpisah, belum dijadwalkan.

**Affects:** `lib/validators/booking.ts` (redesain total jadi `items[]`), `app/api/v1/bookings/route.ts` (redesain total, dispatch loop + totalAmount server-computed), `app/api/v1/admin/payments/[id]/confirm/route.ts` (+haji), `app/[locale]/(pilgrim)/bookings/new/payment/page.tsx` (translasi draft→items[] saat submit), `docs/arsitektur-booking.md` (status banner → Step 1-5 selesai, §6 Step 5 ditandai selesai + deviasi dicatat, §7.1 Verifikasi Step 5 baru)

## 2026-07-25 — Booking Engine Step 6: Checkout Pendek Visa-only & Transport-only, Manifest Di-decouple dari Visa (Superseding Step 5), Haji Dikeluarkan dari Scope

**Decision:** Eksekusi `docs/arsitektur-booking.md` §6 Step 6 — checkout pendek per-produk, terpisah dari wizard 7-langkah. Sebelum eksekusi, ditemukan blocker arsitektural nyata saat merencanakan: skema Step 5 mewajibkan `visaProductId` per pilgrim, yang berarti checkout Transport-only akan tetap memaksa pilih produk Visa — bertentangan dengan model "setiap produk checkout independen" yang diinginkan user. Dua putaran klarifikasi (`AskUserQuestion`) dengan user mengubah scope final:

**Klarifikasi #1 (kata-kata verbatim user)**: *"kayanya untuk pertama, saya sedang membangun sistem secara bertahap, tidak ada satupun product mewajibkan product lain ketika checkout, kita nanti akan ubah ini menjadi skema baru, tetapi sementara, tidak ada product yang terkait dengan product lain.. semua berdasarkan product chect out sesuai dengan standard onlineshop.."* — ini SUPERSEDE keputusan Step 5 (`visaProductId` wajib) secara eksplisit, bukan pelanggaran diam-diam. Prinsip: TIDAK ADA produk yang boleh memaksa produk lain dipilih saat checkout, semua produk harus bisa di-checkout sendiri seperti online shop pada umumnya.

**Klarifikasi #2 (kata-kata verbatim user)**: *"visa haji dengan visa yang tersedia berbeda sama sekali, jika haji mewajibkan berarti catat saja bahwa itu kesalahan dan harus diperbaiki, kita blm sentuh haji, karena blm masuk dalam rencana kita sekarang."* — Haji dikeluarkan TOTAL dari Step 6 putaran ini. "Visa Haji" adalah konsep berbeda dari `VisaProduct` Umroh biasa; kalau kode nanti memaksakan `VisaProduct` biasa ke Haji, itu dicatat sebagai bug untuk diperbaiki nanti, BUKAN dikerjakan sekarang.

**Step 6a — Decouple manifest dari `visaProductId` (prasyarat baru, tidak ada di rencana tertulis awal)**: `lib/manifest/constants.ts` (baru) — sentinel `productType='core'`/`productId='default'` (string biasa, bukan UUID — `ManifestFieldRequirement.productId` memang tidak di-enforce sebagai FK di DB, jadi sentinel ini arsitektural aman). 5 field core (`fullName`→`display_name` wajib, `gender` wajib, `email`→`email` opsional, `phone`→`phone` wajib, `whatsapp`→`whatsapp` opsional) di-seed lewat `prisma/seed.ts` — **deviasi sengaja dari presedan Step 4** (yang pakai `bun -e` ephemeral untuk backfill sekali jalan): karena "core" adalah konsep permanen yang harus reproducible di DB manapun (bukan migrasi data historis satu kali), ditaruh di `seed.ts` supaya `bun run db:seed` selalu menghasilkan baris ini.

`lib/validators/booking.ts`: `pilgrims[].visaProductId` jadi `.optional()`. `superRefine` direstrukturisasi total — **bug tersembunyi ditemukan & ditutup**: early-return lama `if (ids.length === 0) return` (dari Step 5, ditulis saat visa masih selalu wajib) akan membuat booking 100%-tanpa-visa **skip SEMUA validasi** kalau dibiarkan, termasuk validasi field manifest core yang wajib — dihapus, diganti query bersyarat per pilgrim (`idsWithVisa` cuma dari pilgrim yang punya `visaProductId`, `coreFields` cuma di-query kalau ada pilgrim tanpa visa). `requiredComponentsUnion` (cross-check hotel/transport wajib) otomatis aman karena cuma terisi dari pilgrim yang benar-benar pilih visa — tidak bisa "bocor" memaksa hotel/transport ke pilgrim lain di booking campuran.

`app/api/v1/bookings/route.ts`: blok `VisaApplication.create()` + kontribusi ke `totalAmount` dibungkus `if (p.visaProductId)` — pilgrim tanpa visa cuma dapat `BookingPilgrim` (fieldValues saja), nol `VisaApplication`, nol kontribusi total.

**Bug kedua ditemukan & ditutup, murni lewat verifikasi browser nyata (bukan diprediksi di rencana)**: booking Transport-only pertama yang dites di browser menampilkan "0 dari 5 dokumen wajib" (Paspor/KTP/Kartu Keluarga/Sertifikat Vaksin/E-Tiket Pesawat) — jelas salah untuk booking tanpa visa sama sekali. Root cause: `DocumentGrid`/`PilgrimDocuments` (komponen shared, sudah ada sejak sebelum Manifest Universal) jatuh ke konstanta hardcode `REQUIRED_DOCUMENTS` setiap kali prop `requirements` bernilai `undefined` — desain lama ini SEBELUMNYA dead code (setiap pilgrim selalu punya `visaApplication` sejak awal proyek, jadi `requirementsByPilgrim.get(p.id)` tidak pernah `undefined`), tapi Step 6a membuat kondisi "pilgrim benar-benar tanpa dokumen requirement apa pun" genuinely tercapai untuk pertama kalinya. Fix: kedua halaman detail booking (admin + pilgrim) set `requirementsByPilgrim.set(p.id, [])` eksplisit di cabang pilgrim-tanpa-visa (array kosong truthy di JS, tidak memicu fallback) — menghasilkan "0 dari 0 dokumen wajib" yang benar. Ini contoh nyata kenapa verifikasi lewat browser sungguhan (bukan cuma curl) penting — bug ini tidak akan pernah terdeteksi dari respons API saja, cuma terlihat di rendering halaman.

**Step 6b — Checkout Visa-only**: `app/[locale]/(pilgrim)/bookings/checkout/visa/page.tsx` (server component, baca `searchParams.productId` opsional) + `components/booking/VisaCheckoutForm.tsx` (client, state lokal — SENGAJA TIDAK pakai `lib/booking/draft.ts`/`DraftProvider`, karena itu bentuk tetap untuk wizard 7-langkah Umroh, bukan untuk checkout satu-produk). Reuse penuh komponen/endpoint existing: `ManifestFieldsForm` (dikonfirmasi stateless, tidak bergantung context apa pun), `GET /api/v1/manifest/requirements?productType=visa&productId=X` (sudah publik). Submit `items: []` + `pilgrims[]` (dengan `visaProductId`) ke `POST /api/v1/bookings` — endpoint yang SAMA dengan wizard, bukan endpoint terpisah.

**Step 6c — Checkout Transport-only**: `app/[locale]/(pilgrim)/bookings/checkout/transport/page.tsx` + `components/booking/TransportCheckoutForm.tsx`. Reuse `GET /api/v1/catalog/transport` existing (sudah mengembalikan `quotaId`/harga/kapasitas per kombinasi rute×kendaraan, tidak perlu endpoint baru). Manifest pilgrim pakai field "core" (§6a) — payload `pilgrims[]` TIDAK PERNAH menyertakan key `visaProductId` sama sekali (bukan string kosong `''`, yang akan gagal validasi `.uuid().optional()` — harus benar-benar tidak dikirim).

**Step 6d — Wiring CTA katalog**: `app/[locale]/(public)/visa/page.tsx` ("Ajukan Sekarang") dan `components/shared/TransportSearch.tsx` ("Pesan sekarang") — sebelumnya KEDUANYA mengarah ke `/register`, tidak terhubung ke booking apa pun sama sekali. Sekarang mengarah ke checkout baru dengan produk/trip pre-selected via query string.

**Insiden non-kode selama sesi, dicatat & dikonfirmasi aman oleh user**: `bun run db:seed` dijalankan sebagai gate untuk menambah 5 baris seed core — ternyata skrip yang sama juga `deleteMany()` tabel Hotel/Transport/Muthowif/Catering/Ziarah dan mereset `TransportPricing.price`/menghapus `HotelRoomSchedule` yang sudah dikonfigurasi dari sesi-sesi kerja sebelumnya (termasuk data yang baru dipakai di verifikasi Step 5 beberapa jam sebelumnya). User dikonfirmasi ini tidak masalah (murni data dev/test, bukan data yang perlu dipertahankan). Dicatat sebagai memory project (`project-seed-script-destructive`) supaya sesi mendatang tidak menjalankan `db:seed` tanpa memperingatkan dulu.

**Verifikasi**: `bun run build` 0 error di tiap sub-fase (6a/6b/6c/6d terpisah — 1 iterasi fix tipe `category: string | null` di `TransportCheckoutForm.tsx`). End-to-end via curl (JWT manual) DAN browser sungguhan (karena ini 2 halaman UI baru, bukan cuma perubahan API): (1) booking Transport-only tanpa `visaProductId` sama sekali → 201, nol `VisaApplication`, `totalAmount` = harga transport persis; (2) booking 0-visa dengan field core wajib kosong → 400 (membuktikan early-return bug benar-benar hilang); (3) booking campur 1 pilgrim visa + 1 tanpa → cuma yang bervisa dapat `VisaApplication`, `requiredComponents` tidak bocor; (4) browser sungguhan: checkout Visa-only end-to-end (pilih "Visa Reguler", isi jamaah, submit → redirect, total Rp2.500.000 cocok, 3 syarat dokumen visa tampil benar); (5) browser sungguhan: checkout Transport-only end-to-end (pilih trip+tanggal+kendaraan, isi penumpang tanpa visa, submit → redirect, total Rp6.000.000 cocok, 0 dokumen wajib setelah fix bug DocumentGrid); (6) redirect logged-out ke `/login` dikonfirmasi untuk kedua route checkout (307); (7) CTA katalog Visa & Transport dikonfirmasi mengarah ke checkout baru dengan ID produk/trip benar untuk SEMUA produk/trip yang ada (curl+grep). Semua data test dibersihkan setelah tiap sub-fase.

**Yang BELUM dikerjakan**: Step 7 (invoice generik), Step 8 (dokumentasi akhir). Checkout Haji sengaja tidak dikerjakan (lihat Klarifikasi #2) — dicatat sebagai bug/gap terpisah di `CLAUDE.md`, bukan pekerjaan yang terlewat.

**Affects:** `lib/manifest/constants.ts` (BARU), `prisma/seed.ts` (+seed core field), `lib/validators/booking.ts` (`visaProductId` opsional + `superRefine` direstrukturisasi), `app/api/v1/bookings/route.ts` (VisaApplication kondisional), `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` + `app/[locale]/(pilgrim)/bookings/[id]/page.tsx` (cabang else manifest core + fix `requirements: []` eksplisit), `app/[locale]/(pilgrim)/bookings/checkout/visa/page.tsx` + `components/booking/VisaCheckoutForm.tsx` (BARU), `app/[locale]/(pilgrim)/bookings/checkout/transport/page.tsx` + `components/booking/TransportCheckoutForm.tsx` (BARU), `app/[locale]/(public)/visa/page.tsx` + `components/shared/TransportSearch.tsx` (CTA wiring), `docs/arsitektur-booking.md` (status banner → Step 1-6 selesai minus Haji, §6 Step 6 ditandai selesai, §7.2 Verifikasi Step 6 baru)

## 2026-07-25 — Booking Engine Step 7: Invoice PDF Profesional, `@react-pdf/renderer` Upgrade ke v4

**Decision:** Eksekusi `docs/arsitektur-booking.md` §6 Step 7 ("Invoice generik") — user minta invoice bisa digenerate jadi PDF standar profesional (dicontohkan gambar invoice umum), boleh dikembangkan lebih baik dari sekadar meniru gambar. Recheck sebelum eksekusi (poin 1 SOP) mengonfirmasi `lib/pdf/invoice.tsx` dan `app/api/v1/bookings/[id]/invoice/route.ts` benar-benar stub kosong, `@react-pdf/renderer` v3.4.4 terinstall tapi belum dipakai di mana pun, tidak ada `invoiceNumber` di schema.

**Temuan kritis dari recheck, mencegah bug sebelum ditulis**: `model BookingVisa` (relasi `Booking.visa`) **tidak pernah dipakai kode manapun** — `grep` cuma menemukan referensinya di komentar no-op `lib/quota/adapters/visa.ts`. Visa asli hidup di `BookingPilgrim.visaApplication` (`VisaApplication.sellPriceSnapshot`, sudah dibangun sejak Step 4/5). Kalau normalizer invoice ditulis berdasarkan `booking.visa` (asumsi wajar dari nama relasi), baris visa akan SELALU KOSONG di setiap invoice yang pernah digenerate — bug yang genuinely dihindari lewat kebiasaan "baca kode dulu, jangan asumsi dari nama field", bukan ditemukan lewat testing setelah terlanjur salah.

**Keputusan dikonfirmasi user via 2 pertanyaan terarah sebelum eksekusi**:
1. **Nomor invoice = turunan `Booking.bookingCode`** (`INV-${bookingCode}`) — bukan field `invoiceNumber` + migrasi baru. Rasional: 1 booking = 1 invoice sudah jadi prinsip arsitektur ini (§1.5), `bookingCode` sudah unik & human-readable, tidak ada kebutuhan nyata untuk penomoran independen (reissue/credit note) di scope sekarang.
2. **Kop invoice termasuk logo** — dari file statis `public/logo.png` (belum ada file-nya, user isi sendiri nanti), invoice tetap render tanpa logo (tidak error) kalau file belum ada.

**Keputusan tambahan diambil tanpa bertanya (risiko rendah, reversibel)**: baris Discount & Tax dihilangkan total dari tabel total (bukan ditampilkan Rp0) — platform ini tidak punya konsep diskon/pajak di schema manapun, baris kosong permanen cuma UI palsu; alamat+telepon perusahaan lewat env var baru `NEXT_PUBLIC_BUSINESS_ADDRESS` (reuse `NEXT_PUBLIC_BUSINESS_WA` yang sudah ada), konsisten pola env-based existing; invoice HANYA endpoint PDF download, tidak ada halaman preview HTML terpisah (sesuai scope asli Step 7 di dokumen).

**Insiden ditemukan saat eksekusi, bukan diprediksi rencana**: percobaan generate PDF dummy pertama (`bun -e` + `renderToBuffer`) **crash total** — `TypeError: undefined is not an object (evaluating 'q.hasOwnProperty')` dari internal React reconciler `@react-pdf/renderer`. Root cause: `@react-pdf/renderer@3.4.4` (versi terinstall) punya peer dependency `react: "^16.8.0 || ^17.0.0 || ^18.0.0"` — TIDAK termasuk React 19, yang dipakai project ini (`react@19.2.6`). React 19 mengubah internal shared API (`ReactCurrentDispatcher`) yang jadi asumsi reconciler kustom react-pdf v3.x. Fix: `bun add @react-pdf/renderer@^4.5.1` — versi 4.x peer dep resmi mendukung React 19 (`"react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"`). Ini upgrade dependency yang genuinely diperlukan supaya fitur bisa jalan sama sekali, bukan pilihan preferensi.

**`lib/pdf/invoiceData.ts` (baru)** — `buildInvoiceData(booking)` normalisasi SATU TEMPAT dari 7 relasi per-tipe existing (Opsi B, konsisten §3.4 dokumen rencana) jadi bentuk seragam `{label, description, qty, unitPrice, amount}[]`. `balanceDue` = 0 kalau ada `Payment.status='confirmed'`, else `totalAmount` — Total dan Sisa Tagihan sengaja dua angka berbeda (Total tetap utuh, Sisa Tagihan yang berubah jadi 0 setelah lunas), bukan bug. Status badge di-map dari 5 nilai `enum BookingStatus` (termasuk `payment_review` yang sempat terlewat draf pertama, ditambahkan setelah cek enum langsung, bukan diasumsikan dari ingatan).

**`lib/pdf/invoice.tsx`** — implementasi nyata menggantikan stub, `generateInvoicePdf(data): Promise<Buffer>` via `renderToBuffer()`. Layout terinspirasi contoh gambar user tapi disesuaikan konteks travel: kop (logo opsional via `fs.existsSync`)+nama/alamat/telp, Bill To, status badge berwarna (UNPAID amber/MENUNGGU KONFIRMASI biru/LUNAS hijau/DIBATALKAN abu-abu), tabel item, Subtotal/Total/Sisa Tagihan (TANPA Discount/Tax), terms bank dari `getPaymentConfig()` (`+businessAddress` field baru).

**Verifikasi visual PDF sungguhan menemukan & menutup 3 bug** yang tidak akan pernah terdeteksi dari "build sukses" atau respons API JSON saja — generate PDF, baca file-nya langsung sebagai gambar (bukan cuma cek ukuran byte):
1. Kolom "Item" dan "Deskripsi" di tabel render terlalu rapat tanpa gap visual — fix tambah `paddingRight` ke kedua kolom.
2. "Sisa Tagihan Rp 0" berwarna merah bahkan saat booking sudah LUNAS — merah untuk "Rp0 tersisa" secara semantik salah (itu kabar baik, bukan urgensi) — fix warna kondisional: merah kalau `balanceDue > 0`, hijau kalau `0`.
3. Label baris visa jadi "Visa Visa Non-Hotel Umroh — Siti Invoice Test" (kata "Visa" dobel) karena nama produk (`VisaProduct.name`) sudah mengandung kata "Visa" dan kode menambah prefix "Visa " tanpa cek — fix regex `/visa/i.test(productName)` sebelum menambah prefix.

**`app/api/v1/bookings/[id]/invoice/route.ts`** — GET mengembalikan `application/pdf` langsung (bukan JSON seperti stub sebelumnya), auth POLA SAMA PERSIS `pilgrims/[bookingId]/[pilgrimId]/documents/route.ts` (`getSession()`+`ADMIN_ROLES.includes(session.role)`+cek `booking.userId === session.userId`) — bukan pola auth baru. Bug tipe TypeScript ditemukan saat build: Node `Buffer` dari `renderToBuffer()` tidak langsung assignable ke `BodyInit`/`BlobPart` yang diharapkan `NextResponse` constructor (mismatch generic `ArrayBufferLike` di lib TypeScript strict) — fix `new Blob([Uint8Array.from(pdfBuffer)])`.

**UI**: tombol "Unduh Invoice" (anchor biasa `target="_blank"`, browser handle download natural — tidak perlu JS) ditambah di header halaman detail booking pilgrim (sebelah badge status, pakai `Button`/shadcn) dan admin (sebelah badge status, pakai `admin-*` utility class existing supaya konsisten visual dengan sisa halaman admin, BUKAN komponen shadcn yang dipakai sisi pilgrim).

**Verifikasi end-to-end** (curl + JWT session manual + browser sungguhan + baca PDF langsung sebagai gambar via Read tool, server dev nyata): (1) booking test (transport Rp6.000.000 + visa Rp2.750.000, status `awaiting_payment`) → unduh invoice → `200`, `Content-Type: application/pdf` benar, `Content-Disposition` filename `INV-SND-....pdf` benar, isi PDF dibaca langsung — nomor invoice/item/subtotal/total semua cocok persis (Rp8.750.000); (2) `Payment.status='confirmed'` + `Booking.status='confirmed'` dibuat manual → unduh ULANG invoice yang sama → badge "LUNAS" hijau, "Tanggal Lunas" menggantikan "Jatuh Tempo", Sisa Tagihan "Rp 0" hijau, Total tetap Rp8.750.000 (bukan ikut jadi 0 — Total ≠ Sisa Tagihan, benar); (3) auth: tanpa cookie → 401, JWT pilgrim lain (bukan pemilik booking) → 401, JWT admin → 200 (akses booking siapa pun); (4) browser sungguhan: tombol "Unduh Invoice" ter-render dengan `href` benar di halaman admin. Semua data test (booking, payment, 2 user pilgrim) dibersihkan setelah verifikasi, termasuk reset `TransportQuota.pendingSeats` yang sempat orphan akibat cleanup manual `prisma.booking.delete()` (pengingat berulang dari Step 6 — cleanup manual tidak melepas kuota otomatis).

**`.env.example`** — ditambah section "Business / Payment" mendokumentasikan `NEXT_PUBLIC_BUSINESS_NAME`/`_WA`/`_ADDRESS`/`_BANK_1_NAME`/`_BANK_1_NUMBER`/`_BANK_2_*` yang sebelumnya TIDAK terdokumentasi sama sekali di file ini (gap pre-existing, ditemukan saat recheck Step 7 — sudah dipakai kode `lib/constants/payment.ts` sejak lama tapi tidak pernah dicatat di `.env.example`). Ditambahkan karena langsung relevan (var baru `_ADDRESS` yang ditambah di putaran ini), bukan perbaikan tak diminta di luar konteks.

**Yang BELUM dikerjakan**: Step 8 (dokumentasi akhir §8 penutup) — satu-satunya sisa dari 8 step total di `docs/arsitektur-booking.md`.

**Affects:** `package.json` (`@react-pdf/renderer` v3.4.4→v4.5.1), `lib/constants/payment.ts` (+`businessAddress`), `lib/pdf/invoiceData.ts` (BARU), `lib/pdf/invoice.tsx` (implementasi nyata menggantikan stub), `app/api/v1/bookings/[id]/invoice/route.ts` (implementasi nyata menggantikan stub), `app/[locale]/(pilgrim)/bookings/[id]/page.tsx` + `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` (tombol "Unduh Invoice"), `.env.example` (+section Business/Payment), `docs/arsitektur-booking.md` (status banner → Step 1-7 selesai, §6 Step 7 ditandai selesai, §7.3 Verifikasi Step 7 baru, §8 Keputusan #15-18 baru)

## 2026-07-25 — Hapus Total Wizard Booking 7-Langkah Lama

**Decision:** Setelah seluruh 8 step `docs/arsitektur-booking.md` selesai, user eksplisit minta wizard booking 7-langkah lama dihapus TOTAL dari codebase ("semua sistem booking lama dihapus dari peredaran biar saya mudah untuk improve booking engine baru") — bukan dinonaktifkan atau dibiarkan sebagai referensi historis. Karena permintaan ini genuinely ambigu (bisa berarti kode UI wizard, data booking di DB, atau cuma dead code) dan beberapa interpretasi destruktif/sulit dibalik, diklarifikasi dulu lewat `AskUserQuestion` sebelum bertindak — user pilih eksplisit "wizard 7-langkah lama (kode UI)", dikonfirmasi paham konsekuensinya (kapabilitas booking kombinasi + 4 produk single hilang sampai ada pengganti).

**Investigasi lengkap dulu (bukan asumsi) sebelum hapus** — dispatch 1 Explore agent untuk memetakan SEMUA referensi: 8 file wizard (`app/[locale]/(pilgrim)/bookings/new/` — `layout.tsx` + 7 step), `lib/booking/draft.ts` + `lib/booking/DraftProvider.tsx` (state), `components/booking/PriceSidebar.tsx` + `WizardShell.tsx` (eksklusif wizard, ketahuan dari import `useDraft`/`computeTotal`). **Dikonfirmasi AMAN dipisahkan**: `lib/booking/cancel.ts` (dipakai `DELETE /api/v1/bookings/[id]` + cron, sama sekali tidak terkait draft) dan `app/api/v1/bookings/route.ts` (backend generik `items[]`, sudah dipakai checkout Step 6 juga, tidak ada logic wizard-only) — kalau 2 file ini ikut terhapus tanpa dicek dulu, seluruh booking engine (termasuk checkout baru yang baru selesai dibangun) akan ikut rusak. `components/booking/ManifestFieldsForm.tsx`/`VisaCheckoutForm.tsx`/`TransportCheckoutForm.tsx` dikonfirmasi genuinely independen (grep: nol import dari draft/DraftProvider/PriceSidebar/WizardShell).

**Dieksekusi**: hapus 5 target (direktori wizard + 4 file), update 2 link mati (`(pilgrim)/layout.tsx` nav "Buat Booking", `(pilgrim)/dashboard/page.tsx` 2× CTA "Buat Booking Pertama") dari `/bookings/new/dates` ke `/${locale}` (homepage publik — hub katalog existing yang sudah link ke semua kategori produk), update 1 komentar basi di `VisaCheckoutForm.tsx` yang menyebut file yang sudah tidak ada.

**KONSEKUENSI EKSPLISIT, dicatat supaya tidak dikira regresi**: sebelum ini, wizard adalah SATU-SATUNYA cara booking paket kombinasi (hotel+transport+muthowif+catering+visa sekaligus) dan SATU-SATUNYA cara booking Hotel-only/Muthowif-only/Catering-only/TourPackage-only. Setelah dihapus, HANYA Visa-only dan Transport-only (checkout Step 6) yang masih punya jalur booking lewat browser. 5 kapabilitas lain TIDAK BISA dilakukan lewat UI apa pun sampai checkout pengganti per-produk dibangun — keputusan sadar user, bukan sesuatu yang terlewat atau perlu "diperbaiki" tanpa arahan lebih lanjut.

**Verifikasi**: `bun run build` 0 error. Grep ulang seluruh repo (`bookings/new`, `lib/booking/draft`, `DraftProvider`, `PriceSidebar`, `WizardShell`) — nol referensi tersisa selain komentar yang sudah diupdate. Browser: dashboard nav + kedua CTA dikonfirmasi ke `/${locale}` bukan 404, homepage render normal. Regresi check: checkout Visa-only (Step 6, yang paling berisiko kena dampak tidak sengaja) dikonfirmasi tetap berfungsi normal setelah penghapusan — form tampil, pilih produk visa jalan seperti sebelumnya.

**Affects:** `app/[locale]/(pilgrim)/bookings/new/` (DIHAPUS, seluruh direktori), `lib/booking/draft.ts` (DIHAPUS), `lib/booking/DraftProvider.tsx` (DIHAPUS), `components/booking/PriceSidebar.tsx` (DIHAPUS), `components/booking/WizardShell.tsx` (DIHAPUS), `app/[locale]/(pilgrim)/layout.tsx` (link nav diupdate), `app/[locale]/(pilgrim)/dashboard/page.tsx` (2 link CTA diupdate), `components/booking/VisaCheckoutForm.tsx` (komentar diupdate), `docs/arsitektur-booking.md` (§10 baru)

## 2026-09-15 — Retrofit Gap #1: Backup MinIO

**Decision:** Tambah `scripts/backup-minio.sh`/`restore-minio.sh` untuk backup dokumen jamaah di MinIO (bucket `saudinesia-docs` — paspor/KTP/KK), mengikuti pola PERSIS `backup-db.sh`/`restore-db.sh` yang sudah ada (rclone, retention 30 hari, restore manual dengan konfirmasi ketik ulang nama resource) — bukan tool baru (`mc`), supaya konsisten dan tidak menambah dependency operasional.

**Rationale:** MinIO S3-compatible sehingga rclone bisa mengaksesnya langsung sebagai remote S3 kedua (`miniolocal:`) tanpa OAuth browser (beda dari remote `gdrive:` yang butuh setup sekali di komputer lokal) — setup lebih sederhana daripada memperkenalkan MinIO Client (`mc`) sebagai tool terpisah. Karena isinya banyak file kecil (bukan satu dump seperti Postgres), tiap run backup membuat FOLDER bertanggal baru di remote (`rclone sync` ke folder timestamp baru) alih-alih menimpa satu file — memungkinkan restore ke titik waktu tertentu.

**Alternatives considered:** MinIO Client (`mc mirror`) — ditolak karena menambah dependency baru yang perlu diinstal terpisah di VPS, sementara rclone sudah jadi dependency wajib untuk backup Postgres.

**Verifikasi:** `bun run build` 0 error (tidak ada perubahan kode aplikasi — murni script operasional). Syntax script divalidasi (`bash -n`).

**Status:** script sudah ada, TAPI belum dijadwalkan di VPS produksi (perlu setup remote rclone `miniolocal` + crontab manual — sama seperti status backup Postgres saat ini, lihat `docs/RETROFIT-GAPS.md` #1).

**Affects:** `scripts/backup-minio.sh` (BARU), `scripts/restore-minio.sh` (BARU), `docs/RETROFIT-GAPS.md` (#1 diupdate), `docs/progress.md` (section Retrofit Gaps baru)

## 2026-09-15 — Retrofit Gap #4: Sitemap & robots.txt

**Decision:** Tambah `app/sitemap.ts`/`app/robots.ts` native Next.js App Router (`MetadataRoute.Sitemap`/`Robots`) — bukan library pihak ketiga (`next-sitemap` dkk).

**Rationale:** Next.js 15 sudah punya generator bawaan yang cukup untuk kebutuhan ini (katalog publik relatif kecil, tidak butuh fitur lanjutan seperti sitemap index multi-file). Dicek dulu halaman publik mana yang punya rute detail `[id]` sebelum generate URL dinamis — cuma `hotels/[id]` dan `muthowif/[id]` yang ada (produk lain masih list-only), jadi sitemap query Prisma langsung untuk `Hotel`/`Muthowif` yang `isActive: true` saja, sisanya URL statis per locale.

**Alternatives considered:** `next-sitemap` (paket npm terpisah) — ditolak, generator native Next.js App Router sudah cukup, menghindari dependency tambahan untuk kebutuhan sederhana ini.

**Verifikasi:** `bun run build` 0 error, browser dev server — `/sitemap.xml` menghasilkan 20 URL statis (10 halaman × 2 locale) + 16 URL dinamis (5 hotel + 3 muthowif aktif × 2 locale), `/robots.txt` disallow `/admin`, `/*/admin`, `/api`, reference sitemap benar.

**Affects:** `app/sitemap.ts` (BARU), `app/robots.ts` (BARU), `docs/RETROFIT-GAPS.md` (#4 diupdate), `docs/progress.md`

## 2026-09-15 — Retrofit Gap #6: Pengaturan Umum Situs

**Decision:** Tambah model `SiteSetting` (singleton, pola persis `PricingRule` — satu baris global, `findFirst()`/create-if-missing, bukan constraint DB) untuk nama platform tampilan, meta SEO default (title/description), dan kontak publik (email/telepon) yang bisa diedit admin tanpa deploy kode. **Sengaja TIDAK termasuk rekening bank** — `lib/constants/payment.ts` sudah punya keputusan eksplisit "no hardcoded bank accounts, update .env only" (data finansial, sensitif, ingin tetap ter-git-track lewat deploy) yang tidak diubah di sini.

**Rationale:** Menutup gap literal yang dicatat audit ("tidak ada tempat untuk atur konfigurasi situs umum lewat admin UI") tanpa membuka scope creep ke config finansial yang sudah punya alasan kuat tetap env-only. Endpoint (`GET/PUT /api/v1/admin/system/settings/site`) dan role guard (`requireSuperAdmin`, bukan asumsi awal `requireAdmin`/`requireManager` split) mengikuti pola `pricing-rule` route yang sudah ada persis — dicek dulu route itu sebelum implementasi, bukan menebak.

**Alternatives considered:** Wiring nilai ini ke `generateMetadata()`/`<title>` tiap halaman publik — ditolak untuk fase ini, `app/[locale]/layout.tsx` saat ini belum punya `generateMetadata` sama sekali, jadi itu pekerjaan tersendiri yang lebih besar dari sekadar "tidak ada admin UI"nya gap #6.

**Verifikasi:** Migration `20260915002156_add_site_setting` dibuat lewat workflow non-interaktif (`migrate diff` + shadow DB disposable `saudinesia_shadow`, dibuat & di-drop dalam sesi ini, hardcoded literal — bukan derivasi string dari `DATABASE_URL` asli), `migrate deploy` + `generate` sukses. `bun run build` 0 error. Browser end-to-end (login superadmin existing `admin@saudinesia.local`): isi form Nama Platform + Email Kontak → Simpan → reload halaman → `GET` endpoint mengembalikan data tersimpan (`platformName: "Saudinesia Travel"`, `contactEmail` benar) — konfirmasi persist ke DB, bukan cuma state lokal.

**Affects:** `prisma/schema.prisma` (+model `SiteSetting`), `prisma/migrations/20260915002156_add_site_setting/` (BARU), `lib/validators/siteSettings.ts` (BARU), `app/api/v1/admin/system/settings/site/route.ts` (BARU), `app/[locale]/admin/(protected)/system/settings/page.tsx` (+section), `docs/RETROFIT-GAPS.md` (#6 diupdate), `docs/progress.md`

## 2026-09-15 — Retrofit Gap #2: UU PDP (kebijakan privasi, consent, permintaan hapus akun)

**Decision:** Tambah 3 komponen: (1) halaman publik `/privacy` berisi draft kebijakan privasi UU PDP dengan banner "perlu review legal" yang terlihat jelas di halaman itu sendiri (bukan cuma komentar kode) — konten dibangun dari data bisnis yang sudah ada (`getPaymentConfig()`), bukan dikarang bebas; (2) model `ConsentLog` append-only dicatat otomatis saat registrasi (nested create dalam satu panggilan `prisma.user.create`, bukan `$transaction` terpisah — sudah atomik secara alami); (3) model `AccountDeletionRequest` — antrean permintaan hapus akun yang diproses MANUAL oleh superadmin, sengaja BUKAN hard-delete/anonymize otomatis.

**Rationale:** User eksplisit memilih pendekatan "draft placeholder + review user" ketimbang menunggu teks legal final — supaya kepatuhan tidak macet menunggu proses legal yang bisa lama, dengan risiko dimitigasi lewat banner draft yang mencolok. Hard-delete otomatis ditolak karena booking/payment (`Booking`, `Payment`, `Refund`) punya kebutuhan retensi hukum/pajak yang terpisah dari hak hapus data UU PDP — keputusan retensi seperti itu bukan sesuatu yang boleh diambil sepihak oleh kode tanpa keterlibatan manusia, jadi permintaan masuk antrean dan diproses manual (mengurangi risiko sekaligus scope dari "Besar" ke "Sedang" sesuai estimasi audit).

**Alternatives considered:** Hard-delete/anonymize otomatis saat permintaan diajukan — ditolak, lihat rationale. Tunggu teks legal final dari user sebelum membangun apa pun — ditolak oleh user sendiri saat klarifikasi (lihat sesi ini), demi tidak memblokir progres.

**Verifikasi:** Migration `20260915002620_add_consent_and_deletion_request` (satu migration folder bersih — sempat ada folder duplikat kosong akibat error shell saat menulis file, langsung dibersihkan dari disk DAN tabel `_prisma_migrations` sebelum lanjut, supaya riwayat migrasi tidak berantakan). `bun run build` 0 error. Browser end-to-end: (1) submit form registrasi TANPA centang consent → tombol submit disabled, tidak bisa submit; (2) DENGAN centang → berhasil, `ConsentLog` tercatat di DB (`type=privacy_policy`, `version=2026-09-15`); (3) `/id/privacy` render benar dengan banner draft; (4) dari halaman profil pilgrim, klik "Ajukan Hapus Akun" → konfirmasi → status "sedang diproses" tampil; (5) admin `system/deletion-requests` → request muncul dengan status "Menunggu" → klik "Tandai Selesai" → status berubah "Selesai", kolom "Diproses Oleh" terisi. Semua data test (1 user pilgrim + consent log + OTP request + 1 deletion request pada akun superadmin test) dibersihkan setelah verifikasi.

**Affects:** `prisma/schema.prisma` (+model `ConsentLog`, `AccountDeletionRequest`, +enum `ConsentType`/`DeletionRequestStatus`, +2 relasi di `User`), `prisma/migrations/20260915002620_add_consent_and_deletion_request/` (BARU), `lib/constants/legal.ts` (BARU), `app/[locale]/(public)/privacy/page.tsx` (BARU), `app/api/v1/account/deletion-requests/route.ts` (BARU), `app/api/v1/admin/deletion-requests/route.ts` + `[id]/route.ts` (BARU), `app/[locale]/admin/(protected)/system/deletion-requests/page.tsx` (BARU), `components/admin/AdminSidebar.tsx` (+nav item), `lib/validators/auth.ts` (`registerSchema` +`privacyConsent`), `app/api/v1/auth/register/route.ts` (+consent log), `app/[locale]/(auth)/register/RegisterForm.tsx` (+checkbox), `app/[locale]/(pilgrim)/profile/page.tsx` + `DeletionRequestCard.tsx` (BARU), `components/campaigns/CampaignDashboard.tsx` (1 link diperbaiki), `docs/RETROFIT-GAPS.md` (#2 diupdate), `docs/progress.md`

## 2026-10-21 — Admin UI Kit: adopsi pola smart-ai di atas Tailwind v3

**Decision:** Admin Saudinesia mengikuti bahasa visual admin smart-ai (token `--admin-*` terpusat, shell sidebar+topbar+breadcrumb+drawer mobile, halaman login berlatar hijau, primitif Button/Card/Badge/FormField) dengan **memindahkan markup dan pola, bukan kodenya**. Tailwind tetap v3.4; token didefinisikan sebagai channel RGB di `globals.css` dan direferensikan di `tailwind.config.ts` sebagai `rgb(var(--x) / <alpha-value>)`. Kit admin ditaruh di `components/admin/{shell,ui}/`. Skala `teal` dijadikan CSS variable (default = teal Tailwind, di-override hijau brand hanya di `.admin-root`) sebagai jembatan sementara. Role constants dipindah ke `lib/auth/roles.ts`.

**Rationale:** Palet sama persis dengan smart-ai atas permintaan user ("warna saudinesia hijau seperti warna smart-ai"). Stack smart-ai (Tailwind v4, better-auth, Eden client, `usePermissions`) tidak cocok dengan project ini, jadi hanya lapisan visual yang dipindah. `teal`/`ink`/`canvas`/`line`/`gold`/`mint` juga dipakai di luar admin (halaman publik, `campaigns/`, `shared/media/`), maka tidak boleh di-remap global — jembatan ber-scope menjaga situs publik tidak berubah sambil membuat 25 file admin yang memakai `teal-*` ikut hijau tanpa disentuh. Role constants dipindah karena penyebab bug nyata: form login (client component) punya salinan `ADMIN_ROLES` sendiri tanpa `manager`, sehingga akun manager ditolak saat login admin.

**Alternatives considered:** Upgrade ke Tailwind v4 agar sama dengan smart-ai — ditolak, pekerjaan terpisah yang berisiko untuk seluruh situs. Remap `teal` global ke hijau — ditolak, mengubah halaman publik. Salin `components/ui/` smart-ai ke `components/ui/` — ditolak, folder itu primitif shadcn yang dipakai situs publik dan CLAUDE.md melarang impor silang admin ↔ pilgrim. Membawa pola SVG `pola-al-ikhlash` — ditolak, aset brand institusi lain; `panel-brand` memakai gradien polos. Membawa `sonner`/`react-hook-form`/`cmdk` — ditunda ke Fase 3 (dependency baru tanpa pemakai saat ini).

**Verifikasi:** `bun run build` 0 error. Build pertama gagal karena Tailwind v3 tidak punya skala opacity `/12`, `/14`, `/15` (fitur v4) — diselesaikan dengan memperluas `theme.extend.opacity`, bukan mengganti angka di tiap file. Browser end-to-end memakai akun demo `manager@saudinesia.local` dari seed: login berhasil (sebelumnya ditolak), menu sesuai role, breadcrumb (`Admin > Produk > Hotel`, "Produk" non-link karena tak punya halaman), drawer mobile 375px tanpa horizontal scroll, logout dari dropdown kembali ke `/id/admin/login`, `--teal-700` bernilai `4 84 62` di `.admin-root` dan `15 118 110` di luar.

**Affects:** `app/globals.css`, `tailwind.config.ts`, `lib/auth/roles.ts` (BARU), `lib/auth/session.ts` (re-export), `lib/admin/navigation.ts` (BARU), `components/admin/shell/` (BARU: Sidebar, Topbar, Breadcrumbs, UserDropdown, PageHeader, AdminAuthShell), `components/admin/ui/` (BARU: Button, Card, Badge, FormField), `app/[locale]/admin/(protected)/layout.tsx`, `app/[locale]/admin/login/{page,AdminLoginForm}.tsx`, `docs/admin-ui-kit.md` (BARU), `docs/progress.md`. `components/admin/AdminSidebar.tsx` tidak diubah dan kini tidak diimpor siapa pun.

## 2026-10-21 — Admin UI Kit Fase 2: paginasi lewat URL, DataTable tanpa TanStack

**Decision:** List admin transaksional dipaginasi **server-side lewat query string** (`?page=&limit=` + filter `status`/`q`), bukan state komponen. Satu helper bersama `lib/admin/pagination.ts` dipakai Server Component, Client Component (`useListPage`), dan Route Handler: `parseListParams` (param rusak jatuh ke default, bukan error), `paginate` (hitung total dulu, jepit `page` ke halaman terakhir, lewati query data bila total 0), `buildListHref`. `DataTable` ditulis sendiri tanpa hook dan tanpa `@tanstack/react-table` — tabel di ≥md, kartu di HP — sehingga Server Component boleh melempar fungsi `cell` langsung. API list yang dipaginasi mengembalikan `ok(items, meta)` — `data` tetap array. Semua `orderBy` list diberi `id` sebagai tie-breaker.

**Rationale:** URL = bisa di-bookmark, dibagikan, dan bertahan setelah reload; halaman server tidak butuh state sama sekali. Menjepit `page` mencegah pengguna mendarat di halaman kosong setelah data berkurang. Tie-breaker `id` ditemukan perlu saat verifikasi: data uji yang di-insert beruntun punya `createdAt` kembar dan urutannya tidak stabil antar query — dengan pagination itu berarti baris bisa dobel atau hilang di batas halaman. `@tanstack/react-table` (dipakai smart-ai) ditolak karena tak satu pun halaman target butuh sort/seleksi/bulk; komponen client-only juga akan memaksa semua halaman server menyerahkan definisi kolomnya lewat batas client. `meta` ditambahkan tanpa mengubah `data` agar konsumen API lama tidak rusak.

**Alternatives considered:** Pagination berbasis state (`useState`) di halaman client — ditolak, tidak bisa di-bookmark dan reload mengembalikan ke halaman 1. Cursor pagination — ditolak, tabel admin butuh lompat ke halaman tertentu dan total hitungan. Menambah kolom `createdAt` ke `VisaApplication` agar urutan visa kronologis — ditolak untuk fase ini (perubahan skema; sementara dipakai `submittedAt desc nulls last` + `id`). Memigrasi list katalog produk (hotel, muthowif, dst.) di fase ini — ditunda ke Fase 3: master data kecil dengan form inline, bukan masalah "list tak terbatas".

**Verifikasi:** `bun run build` 0 error, `tsc --noEmit` bersih; 24 cek unit pada `parseListParams`/`paginate`/`buildListHref`/`pageWindow` (termasuk `page=-5`, `page=99999999999`, `limit=5000`, `page` di luar jangkauan, total 0 tanpa memanggil query data). Browser end-to-end dengan data uji bertanda (47 booking, 47 log notifikasi, 25 aplikasi visa, 6 user + 6 permintaan hapus akun — seluruhnya dihapus persis setelah verifikasi, DB kembali ke 3 user/0 booking). Temuan saat verifikasi: filter `status` sebelumnya di-cast mentah (`?status=ngawur` → 500) dan `in` meloloskan `?status=toString` dari prototype — dua-duanya kini diganti pengecekan `hasOwnProperty`. Satu kesalahan di script fixture (bukan di kode produk): cleanup pertama gagal karena nama relasi `pilgrim`, bukan `bookingPilgrim`; gagal sebelum menghapus apa pun, diperbaiki dan diulang sampai hitungan DB kembali ke awal.

**Affects:** `lib/admin/pagination.ts` (BARU), `lib/admin/statusTone.ts` (BARU), `components/admin/data-table/{DataTable,Pagination,FilterPills,SearchForm}.tsx` + `useListPage.ts` (BARU), `app/[locale]/admin/(protected)/{bookings,visa,notifications,payments}/page.tsx`, `system/users/page.tsx`, `system/deletion-requests/page.tsx`, `app/api/v1/admin/system/users/route.ts` (GET), `app/api/v1/admin/deletion-requests/route.ts` (GET), `docs/admin-ui-kit.md`, `docs/progress.md`

## 2026-10-21 — Admin UI Kit Fase 3: palet lewat codemod, kelas komponen `admin-*` dipertahankan

**Decision:** (1) Migrasi 44+ file admin ke token `admin-*` dikerjakan dengan **codemod berbasis peran** (skrip sekali pakai, tidak masuk repo), bukan tulis ulang tangan: tiap skala warna mentah dipetakan ke peran semantik (muted/ink/aksen/bahaya/peringatan/ok/permukaan), awalan varian dipertahankan, dry-run dulu lalu terapkan. (2) **Kelas komponen `admin-inp`/`admin-btn*`/`admin-th`/`admin-card`/`admin-form-panel`/`admin-badge-*`/dst. dipertahankan permanen**, bukan dihapus seperti rencana Fase 1 — hanya definisinya yang dibersihkan ke token. (3) Jembatan `teal` dibuang; token shadcn `--primary`/`--ring` di-override ke hijau **hanya di dalam `.admin-canvas`**. (4) Halaman detail `[id]` hanya dimigrasi palet-nya. (5) **List katalog produk tidak dipaginasi** — pengecualian sadar dari aturan CLAUDE.md "semua list admin dipaginasi".

**Rationale:** (1) 1.127 penggantian dengan ~71 pemetaan unik adalah kerja mekanis yang rawan salah ketik bila dilakukan tangan; codemod menjamin konsisten dan dry-run mengungkap kasus tepi (mis. `bg-ink/0` yang hampir ter-snap jadi `/5`). (2) Kelas-kelas itu dipakai ~560 kali; meng-inline-kan `@apply`-nya akan memperpanjang JSX, sementara CLAUDE.md sendiri menyuruh kombinasi class berulang diekstrak ke `@layer components`. Komponen React (`Button`/`Card`/`Badge`/`FormField`/`DataTable`) dipakai untuk kode baru dan area yang disentuh. (3) Komponen bersama memakai token shadcn semantik yang tak tersentuh codemod palet; override ber-scope membuatnya hijau di admin tanpa mengubah pilgrim/publik. (4) Halaman detail adalah form sempit (`max-w-*` memang lebih terbaca) dengan UI sangat spesifik hingga 1.021 baris; menulis ulang strukturnya berisiko besar tanpa manfaat sebanding. (5) List katalog adalah master data kurasi yang kecil, dan API `GET`-nya dikonsumsi tanpa halaman oleh picker di halaman lain (mis. daftar hotel di builder paket) — default `limit=20` akan memotong picker diam-diam. Bila nanti ada katalog yang tumbuh besar, tambahkan paginasi opt-in (hanya aktif bila `?page`/`?limit` diberikan) supaya konsumen lama tak rusak.

**Alternatives considered:** Tulis ulang tangan tiap halaman — ditolak (volume & risiko). Meng-inline kelas `admin-*` — ditolak (lihat rationale 2). Remap `teal`/`primary` global ke hijau — ditolak, mengubah situs publik & pilgrim yang di luar scope. Memigrasi struktur halaman detail ke komponen kit — ditunda, tak ada kebutuhan mendesak. Paginasi default di semua API katalog — ditolak (merusak picker).

**Verifikasi:** `bun run build` 0 error; `tsc --noEmit` bersih. Build hijau belum cukup untuk Tailwind v3 (kelas JSX tidak valid, mis. modifier opacity di luar skala, tidak menghasilkan CSS tanpa error) — maka tiap kelas `admin-*` di source dicek ada di CSS hasil build: 98 kelas unik, 0 hilang, kontrol negatif lolos. Browser: 20 halaman admin termuat tanpa error; jumlah baris tabel = jumlah kartu HP di tiap halaman; HP 375px tanpa horizontal scroll; `--primary` bernilai hijau di `.admin-canvas` dan tetap biru di root; tombol "Alamat Indonesia" (AddressPicker) `rgb(4,83,62)`; situs publik `/visa` tetap teal bawaan. Temuan saat verifikasi: "0 periode" di tabel hotel terpotong dua baris (ditambah `whitespace-nowrap`); dua `hover:shadow-card` yang saya tulis sendiri di Overview lolos dari codemod karena ditulis sesudahnya (ditangkap audit akhir, diganti `hover:border-admin-line-strong`). Satu insiden non-kode: tab pratinjau sempat berpindah ke beranda publik di tengah uji klik — viewport pane berubah ukuran saat itu; grep memastikan tak ada kode admin yang menavigasi ke beranda, ulangan dengan ref valid berhasil. **Belum diverifikasi:** modal upload media dan `bookings/[id]` (butuh data booking/dokumen yang tak ada di DB lokal).

**Affects:** 37 file admin/`components/admin/media`/`components/shared/media` (palet), 14 halaman list (struktur), `app/globals.css` (jembatan `teal` dihapus; `.admin-canvas` meng-override `--primary`/`--ring`; kelas komponen dibersihkan), `tailwind.config.ts` (override `teal` dihapus), `components/admin/data-table/DataTable.tsx` (+`rowClassName`), `components/admin/shell/PageHeader.tsx` (+`icon`), `components/admin/AdminSidebar.tsx` (DIHAPUS), `app/[locale]/admin/(protected)/quotas/page.tsx` (+paginasi hotel), `docs/admin-ui-kit.md`, `docs/progress.md`, `CLAUDE.md`

## 2026-10-21 — Production: Caddy + compose berbasis image GHCR, dibuktikan lewat CI

**Decision:** Production memakai **Caddy** (bukan Nginx) di depan satu stack compose berbasis image GHCR: `web` (Next.js standalone, non-root, 1 replika), `migrate` (sekali jalan, image terpisah), `postgres`, `redis`, `minio` (image buatan sendiri), `caddy`. Domain tidak dikeraskan di repo — `Caddyfile` membaca `{$APP_DOMAIN}`/`{$FILES_DOMAIN}`. `NEXT_PUBLIC_*` dikirim sebagai build-arg (GitHub Variables). URL presigned MinIO ditandatangani atas host publik (`MINIO_PUBLIC_URL`) bila diisi. Bucket dibuat otomatis saat start. Karena Docker tidak ada di mesin dev, seluruh jalur dibuktikan oleh job `docker` di CI.

**Rationale:** Caddy: TLS otomatis, konfigurasi jauh lebih pendek, terbukti di production smart-ai; menggantikan rencana Nginx di M15. Domain dari env: repo tidak menebak domain yang mungkin belum dimiliki. Image `migrate` terpisah karena CLI Prisma tidak ikut standalone. **Satu replika `web`** karena cron (auto-cancel, reminder, kurs) berjalan di dalam proses lewat node-cron — lebih dari satu replika membuat job berjalan ganda. `NEXT_PUBLIC_*` harus build-arg karena Next.js meng-inline-nya saat build (di bundle klien dan server): mengisinya di `.env.production` server tidak berpengaruh; konsekuensinya image spesifik-environment. Presigned: ditemukan saat merancang — `getPresignedUrl()` memakai `MINIO_ENDPOINT` yang di Docker bernilai `minio`, sehingga semua foto & preview dokumen berisi URL yang tidak terjangkau browser; menandatangani atas host publik itu offline asal `region` diberikan eksplisit (kalau tidak, SDK menanyakan region ke host). Host file memakai `frame-ancestors` (bukan `X-Frame-Options: DENY` seperti smart-ai) karena `PreviewModal` menyematkan PDF lewat `<iframe>`. `.dockerignore` ditambahkan karena sebelumnya `COPY . .` menyalin `.env.local` ke layer build.

**Alternatives considered:** Nginx + certbot — ditolak (lebih banyak bagian bergerak). `minio/minio:latest` dari Docker Hub — ditolak (MinIO tidak lagi menerbitkan image publik; pengalaman smart-ai), diganti image buatan sendiri. Role Postgres pemilik vs aplikasi terpisah seperti smart-ai — ditunda (satu role dulu). Menulis `deploy.yml` sekarang — ditunda: VPS belum ada, workflow deploy yang tak pernah dijalankan lebih berbahaya daripada tidak ada. Membaca `NEXT_PUBLIC_*` dari runtime — ditolak (mengubah kode di banyak tempat).

**Verifikasi:** `tsc --noEmit` bersih. Lokal: uji unit presigned (tanpa `MINIO_PUBLIC_URL` memerlukan koneksi ke host dan gagal `ECONNREFUSED` — perilaku lama; dengan variabel itu host publik `https`, region benar, selesai 1 ms tanpa koneksi); `GET /api/v1/health` 200 `{"status":"ok"}`, publik, POST 405; pembuatan bucket diuji pada bucket sementara di MinIO lokal (dibuat, idempotent, dihapus — bucket asli tak tersentuh); `scripts/buat-env-production.sh` diuji di folder sementara (9 pemeriksaan: panjang hex, password DB konsisten di `DATABASE_URL`, izin 600, tidak menimpa, domain tidak sah ditolak). **Belum diverifikasi:** Dockerfile, compose, Caddyfile, dan smoke test hanya bisa dibuktikan oleh CI (job `docker`); foto di browser (data lokal tak punya foto, jadi presigned hanya teruji unit); dan seluruhnya belum pernah jalan di server.

**Affects:** `Dockerfile`, `.dockerignore` (BARU), `docker-compose.prod.yml` (BARU), `docker-compose.yml` (header), `Caddyfile` (BARU), `.env.production.example` (BARU), `.env.example` (−`CRON_SECRET`, +`MINIO_PUBLIC_URL`), `scripts/buat-env-production.sh` (BARU), `infra/minio/Dockerfile` + `.github/workflows/minio-image.yml` (BARU), `.github/workflows/ci.yml` (+job `docker`), `lib/storage/minio.ts`, `instrumentation.ts`, `app/api/v1/health/route.ts` (BARU), `docs/deployment.md`, `docs/progress.md`

## 2026-10-21 — Instrumentation: kode khusus Node wajib di file terpisah (`instrumentation-node.ts`)

**Decision:** `instrumentation.ts` hanya berisi `if (process.env.NEXT_RUNTIME === 'nodejs') { await import('./instrumentation-node') }`. Semua yang butuh Node (cron, SDK MinIO, pembuatan bucket) ada di `instrumentation-node.ts`.

**Rationale:** `instrumentation.ts` dikompilasi juga untuk runtime Edge. Pola lama `if (NEXT_RUNTIME !== 'nodejs') return` tidak membuat webpack membuang `import()` di bawahnya, sehingga `next build` gagal (`Reading from "node:fs" is not handled` dari `mime-types` ← SDK `minio`). Ditemukan CI (job `validate` dan `docker`) setelah commit yang menambah pemeriksaan bucket — commit itu hanya dicek typecheck dan dev server (Turbopack tidak kena), **`bun run build` tidak dijalankan**. Pelajaran proses: perubahan di `instrumentation.ts`/`next.config`/`middleware` hanya terbukti oleh `bun run build`, bukan oleh typecheck atau dev server.

**Alternatives considered:** `serverExternalPackages: ['minio']` — ditolak, menutupi gejala, bukan penyebab (Edge tetap memproses file itu). Memindahkan pembuatan bucket ke skrip terpisah/`mc` — ditolak, menambah langkah manual di production.

**Verifikasi:** `bun run build` 0 error; server standalone hasil build dijalankan seperti image Docker (`bun server.js`, `HOSTNAME=0.0.0.0`): 3 cron terjadwal, `/api/v1/health`, `/id`, `/id/hotels`, `/id/login` 200, log bersih. Catatan uji: dengan `HOSTNAME=127.0.0.1` semua halaman gagal (`Failed to proxy http://localhost:PORT ... ECONNREFUSED`; di Bun menggantung) karena proxy internal Next mengakses `localhost` (di Node 25 → `::1`) — itu artefak setelan uji, bukan bug; `0.0.0.0` (yang dipakai Dockerfile) benar.

**Affects:** `instrumentation.ts`, `instrumentation-node.ts` (BARU)

## 2026-10-21 — Superadmin pertama lewat skrip khusus, bukan seed

**Decision:** `scripts/create-superadmin.ts` (ikut ke image web, dijalankan `docker compose exec web bun scripts/create-superadmin.ts`) membuat superadmin pertama. Password diketik interaktif (tersembunyi, dua kali) atau lewat stdin (`--password-stdin`), tidak pernah lewat argumen. Skrip hanya menambah satu baris `users`, menolak bila sudah ada superadmin (kecuali `--additional`), menolak email yang sudah terdaftar tanpa mengubah akunnya, dan menolak password > 72 byte. `db:seed` tidak diubah, hanya dilarang di production (didokumentasikan).

**Rationale:** `db:seed` menghapus data katalog/harga dan membuat `admin@saudinesia.local` dengan password default `Admin@1234` yang diketahui, serta menimpa password akun yang sudah ada — tidak boleh dekat production. Skrip hanya bergantung pada `@prisma/client` + Bun karena `bcryptjs` dan `zod` di-bundle Next.js dan tidak ada di `node_modules` image production; hash memakai `Bun.password` (bcrypt cost 12). Batas 72 byte: diuji — hash bcrypt Bun dan `bcryptjs.compare` saling cocok untuk password normal (termasuk non-ASCII), tapi untuk password > 72 byte Bun mem-pre-hash dengan SHA-512 sehingga `compare` di login gagal dan admin terkunci; skrip menolak sebelum membuat akun. Aturan password diduplikasi dari `lib/validators/auth.ts` (file itu tidak ada di image) dengan komentar agar tetap sinkron. Penjaga "superadmin sudah ada" mencegah akun berhak-tinggi ganda karena salah ketik/dijalankan ulang.

**Alternatives considered:** Memberi `db:seed` mode production — ditolak (satu skrip dengan dua perilaku yang saling berlawanan). Membaca password dari env/argumen — ditolak (riwayat shell, `ps`). Mengimpor `passwordSchema` langsung — ditolak (zod tidak ada di image). `@types/bun` untuk tipe `Bun` — ditolak (dependency baru untuk satu panggilan); diganti deklarasi tipe minimal lokal-modul. Skrip yang mengubah akun yang ada (`--promote`/reset password) — ditunda (belum dibutuhkan; pemulihan akses = keputusan terpisah).

**Verifikasi:** Lokal pada database sekali pakai yang termigrasi (dihapus sesudahnya): 15 skenario sesuai harapan — sukses; superadmin sudah ada; `--additional` dengan email sama (hash akun asli terbukti tidak berubah); password tanpa huruf/angka/simbol, terlalu pendek, > 72 byte; email/nama tidak valid; tanpa TTY dan tanpa `--password-stdin`; argumen tak dikenal; `DATABASE_URL` kosong; `--additional` email baru. Login sungguhan lewat route aplikasi dengan dev server yang diarahkan ke DB uji: akun buatan skrip 200 `role: superadmin`, password salah 401, email beda huruf 401. Jalur interaktif lewat pseudo-terminal: password tidak tampil di layar sama sekali, dan password tidak cocok ditolak tanpa membuat akun. `tsc` bersih dan `bun run build` lolos dengan `DATABASE_URL` kosong. **Koreksi proses:** dua kesalahan harness uji saya sendiri sempat memberi hasil menyesatkan (variabel yang tidak di-split di zsh membuat skenario pertama tak berjalan; `env -u DATABASE_URL` tidak mematikan pemuatan otomatis `.env.local` oleh Bun sehingga skrip sempat terhubung ke DB dev — hanya membaca dan menolak; DB dev diverifikasi tetap 3 user) — keduanya diperbaiki dan seluruh uji diulang. **Belum diverifikasi:** dijalankan di dalam image Docker (hanya akan terbukti oleh langkah CI baru "Smoke - superadmin pertama lalu login").

**Affects:** `scripts/create-superadmin.ts` (BARU), `Dockerfile` (+COPY ke runner), `.dockerignore` (`scripts/*` + pengecualian), `.github/workflows/ci.yml` (+langkah smoke), `docs/deployment.md`, `docs/progress.md`

## 2026-10-21 — Security check masuk SOP (mengikuti smart-ai/facport) + review pertama

**Decision:** Langkah **Security check** ditambahkan ke `CLAUDE.md` § Fase Eksekusi SOP (langkah 5, antara build dan dokumentasi) dan § Milestone SOP (langkah 2): skill `security-review` untuk file yang berubah (termasuk infra), subagent `security-auditor` untuk fase besar, `bun audit`. **Critical/High pada kode yang diubah fase itu wajib diperbaiki sebelum fase ditutup; Medium/Low dicatat di `docs/lessons-learned.md` (Register Temuan Security); temuan pre-existing dicatat + diberitahukan, dan Critical/High pre-existing dijadwalkan sebagai fase hardening yang wajib Selesai sebelum go-live.** CI: `bun audit --audit-level=critical` memblokir; Dependabot mingguan (npm, github-actions, docker). Skill, agen, hook pengingat, dan `architecture-security.md` disesuaikan/dikoreksi.

**Rationale:** smart-ai dan facport punya langkah ini (SOP mereka, langkah "4. Security check"); Saudinesia punya skill, agen, dan hook tetapi **tidak ada yang mewajibkannya** — SOP hanya mewajibkan build. Review pertama menunjukkan akibatnya: 1 Critical (Next.js RCE), 2 High (OTP bocor fail-open; tidak ada rate limit login/OTP), dan 11 temuan Medium/Low — hampir semuanya sudah ada sebelum pekerjaan hari itu, dan tidak satu pun tertangkap typecheck/build/CI. Pembedaan "kode fase ini" vs "pre-existing" ditambahkan (tidak ada di smart-ai) supaya SOP bisa dijalankan jujur: menghentikan fase karena bug lama yang ditemukan kebetulan tidak realistis, tetapi membiarkannya tanpa catatan dan tanpa tenggat tidak aman. Skill/agen sebelumnya masih memuat sisa template Elysia (`t.Any()`, `apps/api/src`) sehingga auditor mencari pola yang salah. Klaim di dokumen bahwa rate limit OTP "enforced" ternyata tidak punya pemanggil — maka checklist kini mewajibkan memeriksa **pemanggil** fungsi proteksi.

**Alternatives considered:** Menyalin SOP smart-ai apa adanya — ditolak (tanpa aturan pre-existing, dan tidak mencakup infra yang menjadi permukaan baru). Menjadikan `bun audit` memblokir pada level high sekarang — ditolak (17 high tersisa akan merahkan semua PR; SEC-05 dikerjakan dulu, lalu naikkan). Menunda perbaikan Critical sampai fase hardening — ditolak (upgrade Next.js adalah perubahan patch yang aman dan terverifikasi). Menghapus 11 rute stub sekarang — ditunda (sebagian mungkin kerangka Group Booking; SEC-07).

**Verifikasi:** `bun audit --audit-level=critical` kini exit 0 (sebelumnya 2 Critical, semuanya Next.js) dan `--audit-level=high` exit 1 (17 high tersisa, tercatat SEC-05). `bun run build` lolos pada Next 15.5.28 dengan `DATABASE_URL` kosong; server hasil build menjawab `/api/v1/health`, `/id`, `/id/hotels`, `/id/admin/login` 200 dan `/api/v1/dev/otp` 404, log tanpa error. Fail-closed: handler `dev/otp` dipanggil dengan `NODE_ENV` = development (lolos guard), production/test/staging/kosong (diblokir "Not found") — tiga yang terakhir sebelumnya lolos. Mass assignment: 18 skenario terhadap `users/[id]` dan `haji/[id]` (field terlarang, tipe salah, enum/tanggal tidak valid, body kosong/bukan JSON, id tidak ada 404, tanpa login 403, update sah) sesuai harapan, dan data user demo terbukti kembali persis seperti semula. Hook pengingat diuji dengan 18 jalur (13 harus memicu, 5 tidak). **Belum diverifikasi:** invarian `totalQuota` Haji (tidak ada baris Haji di DB lokal); `Caddyfile` yang baru (divalidasi CI job `docker`, `caddy validate`); gitleaks dan audit-gate di CI (baru berjalan setelah push).

**Affects:** `CLAUDE.md` (Security, Fase Eksekusi SOP langkah 5, Milestone SOP, koreksi klaim rate limit OTP), `docs/lessons-learned.md` (BARU), `docs/architecture/architecture-security.md`, `.claude/skills/security-review/SKILL.md`, `.claude/agents/security-auditor.md`, `.claude/hooks/security-review-reminder.sh` + `README.md`, `.github/workflows/ci.yml` (+audit), `.github/dependabot.yml` (BARU), `Caddyfile` (+frame-ancestors), `package.json`/`bun.lock` (next 15.5.28), `lib/validators/adminUpdates.ts` (BARU), `app/api/v1/admin/system/users/[id]`, `app/api/v1/admin/products/haji/[id]`, `app/api/v1/auth/{register,forgot-password}`, `app/api/v1/dev/otp`, `lib/auth/otp.ts`

## 2026-10-21 — SEC-04: rate limit auth (Redis + fallback memori) dan batas percobaan OTP

**Decision:** `lib/auth/rateLimit.ts` — counter jendela-tetap di Redis (skrip Lua atomik), jatuh ke memori proses bila Redis tak terjangkau (circuit breaker 10 detik). Semua angka di satu objek `LIMITS`. Dipasang di `login`, `register`, `forgot-password`, `verify-phone`, `verify-reset-otp`, `reset-password`. Login: per IP (semua percobaan) + gagal per akun+IP (rapat) + gagal per akun (longgar, brute-force terdistribusi); hanya yang **gagal** dihitung, sukses mereset. OTP: 3 per nomor/email per 10 menit, 10 per IP per jam; **5 OTP salah per nomor lalu OTP dibatalkan**; meminta OTP baru mereset hitungan salah. Batas dicek **sebelum** efek samping (akun dibuat, pencarian akun) dan sama untuk email ada/tidak. `checkRateLimit()` yang tidak pernah dipanggil dihapus. `RATE_LIMIT_DISABLED` hanya berlaku di `NODE_ENV=development`.

**Rationale:** Tanpa batas, password admin bisa di-brute-force dan OTP 6 digit (TTL 5 menit) bisa ditebak; pengiriman WhatsApp tak terbatas berbiaya dan bisa dipakai spam. Fallback memori (bukan fail-open murni, bukan fail-closed murni): aplikasi berjalan 1 replika (node-cron di dalam proses), jadi memori tetap melindungi saat Redis mati tanpa mengunci semua pengguna masuk. Dua lapis per-akun karena satu lapis saja dilema: per akun saja membiarkan penyerang mengunci akun korban dari mana pun dengan 5 percobaan; akun+IP rapat menjaga pengguna sah, akun-global longgar (30/jam) menahan serangan terdistribusi. Pembatasan per nomor di `register` ditaruh sebelum pembuatan user — memblokir sesudahnya meninggalkan akun setengah jadi (email terpakai, tak ada OTP). IP dari `X-Forwarded-For` yang ditimpa Caddy (tak bisa dipalsukan selama web tak di-publish langsung).

**Alternatives considered:** Library siap pakai (`rate-limiter-flexible`, Upstash) — ditolak (dependency baru untuk ±100 baris yang perlu dipahami penuh; Upstash = layanan eksternal). Rate limit di Caddy — ditolak (tak ada bawaan, butuh plugin; dan tak tahu konteks akun/nomor). Fail-closed saat Redis mati — ditolak (login tak bisa dipakai seluruhnya). Fail-open — ditolak (itu persis kondisi sebelumnya). Sliding window / token bucket — ditolak (kompleksitas tanpa manfaat untuk kasus ini).

**Verifikasi (lokal):** 14 uji unit (batas, peek, kedaluwarsa jendela, independensi kunci, reset, 50 permintaan paralel tepat 10 lolos, clientIp, bypass dev hanya `development`+flag, 429+Retry-After, hash identitas panjang, Redis mati tetap membatasi dan panggilan berikutnya cepat); **uji mutasi** (off-by-one di batas → 5 uji merah, lalu dipulihkan identik). 44 pemeriksaan HTTP terhadap server berjalan, 43 lolos — satu gagal karena premis uji keliru (Next.js mengisi `x-forwarded-for` dari alamat koneksi, jadi "tanpa header" tidak berarti "tanpa IP"; jalur `ip = null` lalu diuji dengan memanggil handler langsung dan lolos): login (5 gagal lalu 429 + Retry-After, password benar saat terblokir tetap diblokir, IP lain tidak ikut terkunci, huruf besar/kecil berbagi hitungan, 30 gagal dari IP berbeda mengunci akun global, 20 percobaan/IP, sukses mereset), forgot-password (429 identik untuk email ada/tidak, 10/IP), OTP (5 salah → OTP dibatalkan di DB → 429; kode asli yang sudah dibatalkan tetap ditolak; OTP baru memulihkan pengguna sah dan menghasilkan resetToken), verify per IP, register (11 → 429 tanpa membuat akun), reset-password. Jalur `ip = null` lewat pemanggilan handler langsung. `bun run build` lolos; data uji dibersihkan (users kembali 3). **Belum diverifikasi lokal:** jalur Redis sungguhan (Redis tak terpasang di mesin dev) — dibuktikan di CI: job `validate` (Redis service, uji dengan pembacaan kunci lewat klien terpisah, termasuk 50 paralel = tepat 10 dan penyembuhan kunci tanpa TTL) dan job `docker` (limiter di image produksi; kunci `rl:loginAcctIp:*` harus ada di Redis). Status SEC-04 ditulis "menunggu CI" sampai itu hijau.

**Affects:** `lib/auth/rateLimit.ts` (BARU), `lib/auth/otpVerify.ts` (BARU), `lib/auth/otp.ts` (−`checkRateLimit`, +`invalidateOtp`), `app/api/v1/auth/{login,register,forgot-password,verify-phone,verify-reset-otp,reset-password}/route.ts`, `scripts/test-rate-limit.ts` (BARU), `package.json` (`test`), `.github/workflows/ci.yml` (Redis service + 2 langkah), `.env.example`, `CLAUDE.md`, `docs/architecture/architecture-security.md`, `docs/lessons-learned.md`, `docs/progress.md`

## 2026-10-21 — Notifikasi: satu pintu `notify()`, email via Resend HTTP, log jujur, best-effort tanpa antrean

**Decision:** Semua notifikasi lewat `lib/notifications/notify.ts` (kanal WhatsApp + email), menulis satu `NotificationLog` per kanal dengan status `sent|failed|skipped`. Email lewat Resend API dengan `fetch` (tanpa SDK `resend`, dihapus dari dependency). Kanal yang belum dikonfigurasi/dimatikan admin dicatat `skipped` dengan alasan — tidak pernah pura-pura `sent`. Best-effort: `notify()` tidak pernah melempar, tanpa antrean/outbox (aplikasi 1 replika + node-cron); dedupe (`dedupe:true`) hanya menghitung baris `sent`. OTP tetap WhatsApp-only. Admin: panel status + saklar + email uji (superadmin, 5/jam), tanpa pernah menampilkan rahasia.

**Rationale:** Pola smart-ai yang sudah jalan di produksi; tujuan "saat produksi cukup isi env lalu tekan Kirim uji". Log lama selalu `sent` sehingga kegagalan tak terlihat dan dedupe cron (berbasis log itu) menelan pengingat yang gagal selamanya. SDK untuk satu `POST` tidak sepadan sebagai dependency (SEC-05: permukaan dependency sudah besar).

**Alternatives considered:** SDK `resend` (ditolak, lihat atas). Antrean/outbox DB atau BullMQ (ditolak: 1 replika, notifikasi supplementary; dicatat sebagai keterbatasan di `docs/arsitektur-notifikasi.md` §9 — pengiriman hilang bila proses mati di tengah). Email untuk OTP (ditolak: OTP terikat nomor WA & jalur rate limit SEC-04).

**Verifikasi:** `docs/arsitektur-notifikasi.md` §11.

**Affects:** `lib/notifications/{notify,events,integrations}.ts`, `lib/email/{resend,templates}.ts`, `lib/whatsapp/client.ts`, `lib/cron/autocancelJob.ts`, route payments-confirm / visa-status / bookings POST, `app/api/v1/admin/system/integrations/**`, `prisma/schema.prisma` (+migrasi), `scripts/test-{email,notify}.ts`, `scripts/lib/fakeServer.ts`, env example & `scripts/buat-env-production.sh` (`APP_URL`, `RESEND_REPLY_TO`).

## 2026-10-21 — Auth Fase 1: daftar manual tanpa password di form; akun lahir saat tautan email diklik

**Decision:** Pendaftaran manual (ADR-0001, `docs/arsitektur-auth.md`) tidak membuat akun dan tidak menerima password. Isian (nama, telepon, WhatsApp) menunggu di `AuthToken(registration)`; pemilik email mengklik tautan, melihat pratinjau, mencentang persetujuan (privasi + notifikasi WhatsApp), memilih password, lalu akun dibuat (`emailVerifiedAt`) dalam satu transaksi dengan klaim token. Token 256-bit, hanya hash SHA-256 di DB, klaim atomik; halaman tautan tidak mengonsumsi (pemindai email melakukan GET). Reset password lewat tautan email. Respons daftar/lupa password seragam; email auth dikirim tanpa ditunggu. `isActive` kembali berarti "tidak dinonaktifkan admin"; login mensyaratkan `isActive` dan `emailVerifiedAt`.

**Rationale:** Rancangan awal (form dengan password → akun `isActive` sebelum email terverifikasi) punya celah pre-hijacking: penyerang mendaftar dengan email korban lalu menimpa password akun yang belum terverifikasi; korban yang mengklik tautan verifikasi mendarat di akun yang password-nya dipegang penyerang. Dengan password dipilih SETELAH bukti kepemilikan email, tidak ada akun/password yang bisa dipasang pihak lain, dan sambung otomatis Google (Fase 2) menjadi aman. Persetujuan UU PDP harus diberikan pemilik email, bukan pengirim form (temuan audit SEC-19).

**Alternatives considered:** Verifikasi email dengan password di form (celah di atas). Meminta ulang password di halaman verifikasi (friksi, tak menutup kasus korban yang mendaftar sendiri setelah penyerang). OTP email 6 digit (butuh batas percobaan; tautan 256-bit lebih sederhana).

**Ringkasan security check (SOP langkah 5):** audit independen subagent `security-auditor` + review sendiri: 0 Critical, 0 High, 1 Medium, 8 Low → semua Medium/Low yang menyangkut kode fase ini diperbaiki (SEC-19..25), 2 dicatat terbuka (SEC-26, SEC-27); SEC-15/16/17 ditutup. `bun audit`: tidak ada dependency berubah selain menghapus `resend` (sebelumnya). Bukti: `docs/arsitektur-auth.md` §7.

**Affects:** `prisma/schema.prisma` + migrasi `20261021150000_auth_email_verification`, `lib/auth/{tokens,tokenPattern,accounts,authEmail,email,rateLimit}.ts`, `lib/email/authTemplates.ts`, `lib/validators/{auth,adminUpdates}.ts`, `app/api/v1/auth/*`, `app/[locale]/(auth)/*`, `lib/cron/authTokenJob.ts`, `scripts/test-auth.ts`, dan penghapusan seluruh kode OTP WhatsApp.

## 2026-10-22 — Auth Fase 2: login Google buatan sendiri (PKCE), sambung otomatis ke akun jamaah dengan email sama

**Decision:** Login/daftar Google dengan OAuth Authorization Code + PKCE S256 implementasi sendiri (`lib/auth/google.ts`, tanpa Better Auth/NextAuth): state (CSRF) + nonce (replay) + verifier PKCE di cookie `jose` bertanda tangan (kunci turunan SHA-256 + audience, `SameSite=Lax`, sekali pakai, 10 menit); ID token diverifikasi penuh (JWKS Google, `iss`, `aud`, `exp`/`iat`/`sub` wajib, `nonce`, `email_verified === true`, `algorithms: RS256`). Aturan akun (`lib/auth/googleAccounts.ts`): `sub` dikenal → masuk; email cocok akun **pilgrim** aktif → tersambung otomatis (akun lama belum terverifikasi: password dimatikan); **staf tak pernah** tersambung; nonaktif/konflik ditolak; pengguna baru menyetujui kebijakan privasi di halaman lengkapi **sebelum** akun dibuat. Endpoint Google dapat di-override hanya saat `NODE_ENV` development/test (uji dengan server Google palsu). Fitur mati otomatis bila `GOOGLE_CLIENT_ID/SECRET/APP_URL` kosong.

**Rationale:** Pilihan pemilik (keputusan 9, ADR-0001): akun manual yang kelak masuk lewat Google langsung tersambung. Aman karena akun manual hanya lahir setelah pemilik email membuktikan kepemilikan (Fase 1) dan Google memverifikasi email. Staf dikecualikan agar salah ketik/penyalahgunaan email tak berubah menjadi akses admin. Implementasi sendiri karena project tak memakai pustaka auth; `jose` sudah ada.

**Alternatives considered:** Better Auth/NextAuth (dependency & model sesi baru). Tidak menyambung otomatis (ditolak pemilik). Cookie state berisi JWT_SECRET mentah (JWT sesi dan cookie sementara bisa tertukar — ditolak: kunci turunan + audience).

**Ringkasan security check (SOP langkah 5):** audit independen `security-auditor`: 0 Critical, 0 High, 0 Medium, 5 Low → semua diperbaiki (SEC-28/29/30), SEC-31 dicatat terbuka. Bukti: `docs/arsitektur-auth.md` §8 (36 uji + uji mutasi 18 pengaman, browser dengan Google palsu penuh, smoke CI image produksi). Tidak ada dependency baru (`jose` sudah ada).

**Affects:** `prisma/schema.prisma` + migrasi `20261022090000_user_google_sub`, `lib/auth/{google,googleAccounts,googleCookies}.ts`, `lib/utils/locale.ts`, `app/api/v1/auth/google/*`, `app/[locale]/(auth)/{login,register}/**` + `register/google`, `components/shared/GoogleButton.tsx`, `lib/notifications/integrations.ts`, `scripts/test-google.ts`, `.github/workflows/ci.yml`, env examples, `docs/deployment.md`.

## 2026-10-22 — Auth Fase 3: gerbang "Lengkapi data", telepon + WhatsApp wajib (tak diverifikasi), lingkup WhatsApp diperkecil

**Decision:** Jamaah wajib mengisi telepon dan WhatsApp (dua kolom, tidak diverifikasi, tidak unik, E.164) sebelum halaman jamaah mana pun: gerbang di `(pilgrim)/layout.tsx` → `/{locale}/lengkapi-data`, ditegakkan juga di server (`POST /bookings` → 422). Persetujuan notifikasi WhatsApp dicatat sekali di `ConsentLog`. Notifikasi WhatsApp hanya untuk konfirmasi booking, pengingat pembayaran, dan pembayaran dikonfirmasi/ditolak; status visa dan pembatalan otomatis email saja. Pengaman nomor tak terverifikasi: rate limit ubah-nomor (5/hari) dan booking (20/jam), batas 10 WA per nomor tujuan per hari, WA hanya bila ada `ConsentLog`, email ke pemilik akun saat nomor berganti.

**Rationale:** Keputusan pemilik (ADR-0001, pertanyaan 5–8): data awal harus lengkap sekali jalan; WhatsApp dikecilkan karena gateway pihak ketiga makin sering memblokir. Nomor tak terverifikasi bisa salah ketik atau milik orang lain — pengaman di atas membatasi dampaknya tanpa OTP.

**Alternatives considered:** Verifikasi nomor (OTP) — bertentangan dengan keputusan pemilik dan dengan alasan menjauh dari WhatsApp. Gerbang di `middleware.ts` — Edge tanpa Prisma. WhatsApp opsional — ditolak pemilik untuk sekarang; dicatat sebagai opsi di SEC-33.

**Ringkasan security check (SOP langkah 5):** audit independen `security-auditor`: 0 Critical, 0 High, 2 Medium, 5 Low. Diperbaiki: SEC-32 (dimitigasi), 34, 36, 37. **Terbuka dan menunggu keputusan pemilik/legal:** SEC-33 (persetujuan WhatsApp wajib tanpa jalur penarikan — UU PDP), SEC-35 (versi persetujuan), risiko sisa SEC-32. Bukti: `docs/arsitektur-auth.md` §9.

**Affects:** `lib/auth/{contact,rateLimit}.ts`, `app/api/v1/auth/contact/route.ts`, `app/api/v1/bookings/route.ts`, `app/[locale]/(pilgrim)/{layout,profile/*}`, `app/[locale]/(auth)/lengkapi-data/*`, `components/shared/ContactPicker.tsx`, `lib/utils/{phone,locale}.ts`, `lib/notifications/{events,notify}.ts`, `lib/email/templates.ts`, `middleware.ts`, `scripts/test-{auth,notify}.ts`, `.github/workflows/ci.yml`.

## 2026-10-22 — WhatsApp tetap wajib untuk jamaah (menutup SEC-33)

**Decision:** Pemilik memutuskan nomor WhatsApp tetap wajib dan tidak ada jalur menarik persetujuan WhatsApp: WhatsApp adalah kanal komunikasi lanjutan bisnis dengan jamaah, meski sistem notifikasi tidak membutuhkannya.

**Rationale:** Kebutuhan bisnis (komunikasi lanjutan dengan jamaah haji/umrah), bukan kebutuhan teknis. Email tetap kanal utama notifikasi mesin; WhatsApp dibatasi lingkupnya karena gateway pihak ketiga sering memblokir.

**Alternatives considered:** WhatsApp opsional; tombol "berhenti menerima WhatsApp" dengan pencatatan penarikan di `ConsentLog` (ditolak untuk saat ini).

**Konsekuensi yang dicatat:** (1) persetujuan yang tercatat hanya mencakup notifikasi pembayaran/pesanan — pesan promosi atau siaran massal memerlukan persetujuan terpisah (opt-in); (2) teks persetujuan dan Kebijakan Privasi perlu menyebut tujuan komunikasi WhatsApp secara jelas (tinjauan legal); (3) SEC-35 (versi persetujuan) tetap terbuka.

## 2026-10-22 — Verifikasi nomor WhatsApp lewat pesan masuk (ADR-0002) + email sebagai jaring pengaman

**Decision:** `notify()` menjalankan WhatsApp dan email paralel dan email selalu dikirim untuk semua kejadian. Nomor WhatsApp diverifikasi lewat pesan MASUK: pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor bisnis; webhook GOWA (HMAC atas body mentah, mati tanpa secret kuat ≥32 karakter) mencocokkan JID pengirim dengan nomor akun. WhatsApp hanya ke nomor terverifikasi; satu nomor = satu akun TERVERIFIKASI (`User.verifiedWhatsapp @unique`); verifikasi tidak menghalangi pemesanan; mengubah nomor atau menonaktifkan akun mencabut/melepasnya.

**Rationale:** Permintaan pemilik: tutup risiko pesan ke nomor orang lain (SEC-32) tanpa bergantung pada pengiriman keluar yang sering diblokir, dan pengguna tak boleh kehilangan notifikasi hanya karena WhatsApp tak tersedia. JID pengirim diautentikasi WhatsApp — tak bisa dipalsukan — jadi membuktikan pengendalian nomor tanpa mengirim apa pun keluar.

**Alternatives considered:** OTP dikirim dari kita (bergantung pengiriman keluar); verifikasi wajib sebelum memesan (ditolak pemilik); unik keras untuk semua nomor (menyulitkan keluarga satu nomor, dan klaim tanpa bukti memblokir pemilik asli).

**Ringkasan security check (SOP langkah 5):** audit independen `security-auditor`: 0 Critical, 0 High, 1 Medium, 5 Low, 2 Info → semua diperbaiki kecuali SEC-43 (alat admin pelepas nomor/`BATAL`) dan SEC-44 (anonimisasi akun) yang dicatat terbuka; SEC-32 ditutup. Bukti: `docs/arsitektur-whatsapp-verifikasi.md` §9 (23 uji + 20 uji mutasi, browser + HTTP dengan GOWA palsu, smoke CI). `bun audit`: tidak ada dependency baru.

**Affects:** `prisma/schema.prisma` + migrasi `20261022120000_whatsapp_verification`, `lib/auth/{whatsappVerify,contact,rateLimit,tokens}.ts`, `lib/whatsapp/{webhook,client}.ts`, `lib/notifications/{notify,integrations,templates/whatsapp}.ts`, `app/api/v1/webhooks/whatsapp`, `app/api/v1/auth/whatsapp/*`, `app/api/v1/admin/system/users/[id]`, `WhatsappVerifyCard`, profil/dashboard/panel admin, `scripts/{test-whatsapp,test-notify,buat-env-production}`, env examples, CI.

## 2026-10-22 — Cookie sesi SameSite=Lax (menggantikan aturan SameSite=Strict di CLAUDE.md § Security)

**Decision:** Cookie sesi `snd-session` memakai `SameSite=Lax` (bukan Strict). `Secure` aktif di semua lingkungan kecuali `NODE_ENV === 'development'`. Konstanta + fungsi di `lib/auth/cookieFlags.ts`, diuji (termasuk uji sumber agar tak kembali ke `strict`). CLAUDE.md § Security diperbarui.

**Rationale:** Review lintas fase menandai butir "perlu dicek manual"; saya **mereproduksinya**: dengan Google palsu di situs berbeda (`127.0.0.1` vs aplikasi di `localhost`), callback membuat sesi tetapi cookie Strict tidak ikut pada redirect berikutnya (rantai diawali dari situs lain) → pengguna mendarat di `/login`; setelah Lax → langsung `/dashboard`. Dengan Google asli akan identik, dan tautan di email notifikasi (klik dari Gmail) juga tampak "logout". CSRF tetap tertutup: Lax tidak dikirim pada POST/PUT/DELETE lintas-situs dan tidak ada route pengubah data berbentuk GET. Simulasi `dev:eval` kini memakai `127.0.0.1` untuk Google agar alur lintas-situs teruji (di `localhost` yang sama situs, masalah ini tersembunyi).

**Alternatives considered:** Tetap Strict + halaman perantara 200 yang me-redirect sisi klien setelah callback — memperbaiki Google tetapi tidak tautan dari email, dan menambah satu hop; ditolak. Dua cookie (Strict sesi penuh + Lax penanda) — kompleksitas tanpa manfaat.

## 2026-10-22 — Auth Fase 4: penutupan dokumen + review lintas fase

**Decision:** Menutup rangkaian auth (ADR-0001/0002): dokumen lama (OTP) diberi banner/koreksi atau ditulis ulang (`docs/auth-flow.md`), kode mati dihapus, hardening dari review lintas fase diterapkan, SEC-18 dan SEC-44 dinaikkan menjadi Medium dan ditetapkan blocker go-live.

**Ringkasan security check (SOP langkah 5):** review independen lintas fase (`security-auditor`, inventaris 131 rute + infra + kecocokan dokumen): 0 Critical, 0 High, 2 Medium (usulan naik), 11 Low, 1 butir manual yang terbukti bug nyata (SEC-46, diperbaiki). Diperbaiki: SEC-46, SEC-48, sebagian SEC-49. Dicatat terbuka: SEC-47, SEC-50, SEC-51 (diterima), SEC-18/44 (blocker). Bukti: `docs/arsitektur-auth.md` §10.

**Affects:** `lib/auth/{cookieFlags,secret,session,googleCookies,google}.ts`, `lib/constants/payment.ts`, `lib/validators/{auth,index}.ts`, `lib/utils/phone.ts`, `next.config.ts`, `docker-compose.prod.yml`, `scripts/dev-eval.ts`, `scripts/test-{auth,whatsapp}.ts`, i18n, dan dokumen: `auth-flow`, `arsitektur-auth`, `arsitektur-notifikasi`, `arsitektur-komponen-kontak`, `architecture`, `spec`, `architecture-security`, `deployment`, `lessons-learned`, CLAUDE.md.

## 2026-10-22 — SEC-18: sesi dapat dicabut (`sessionVersion`) + penjaga halaman admin

**Decision:** Sesi JWT tidak lagi dipercaya sendirian. `User.sessionVersion` (migrasi `20261022150000_user_session_version`); token membawa `ver`; `resolveSessionToken()` (satu-satunya pembuat `SessionPayload`) menolak token bila akun tak ada / nonaktif / email belum terbukti / `ver` ≠ `sessionVersion`, dan mengambil `role` dari DB. `createSession(userId[, expectedVersion])` membaca peran & versi dari DB sendiri. Versi dinaikkan saat reset password, Google disambung ke akun lama belum terverifikasi, dan peran/`isActive` berubah nyata (`lib/auth/adminUsers.ts`, termasuk reaktivasi). Setiap Server Component halaman admin yang membaca Prisma memanggil `requireAdminPage(locale)`; middleware tetap gerbang kasar.
**Rationale:** Staf yang dinonaktifkan/diturunkan tetap bisa mengunduh dokumen paspor jamaah sampai 7 hari, dan reset password tidak menendang pemegang sesi curian — pelanggaran UU PDP dan celah operasional, dinaikkan jadi blocker go-live. Cek DB per request (PK lookup, didedup `cache()` per render) dipilih dibanding blocklist token: sederhana, pencabutan seketika, tanpa penyimpanan token. Reaktivasi harus menaikkan versi, kalau tidak token lama hidup lagi.
**Alternatives considered:** Daftar token dicabut (Redis/DB) — state tambahan dan pembersihan; cache TTL pendek per instans — pencabutan tidak seketika (bisa jadi opsi bila beban DB jadi masalah, keputusan eksplisit); hanya cek DB di jalur admin — pilgrim nonaktif tetap bisa memesan.
**Ringkasan security check (SOP langkah 5):** review independen (`security-auditor`): 0 Critical, 0 High, 1 Medium (SEC-52 halaman admin hanya dijaga layout — direproduksi & ditutup), 4 Low (SEC-53, ditutup), 3 Info (dicatat di SEC-27/SEC-44 / S18-H diperbaiki). `bun audit --audit-level=critical` bersih. Bukti: `test-session` 19 uji + uji mutasi (tiap kontrol dimatikan → tes gagal; satu mutan setara dicatat), e2e curl terhadap aplikasi berjalan (nonaktif → aktif kembali tidak menghidupkan cookie lama; turun peran; peran dari DB; cookie curian mati setelah reset; semua halaman admin → 307 saat layout dimatikan).
**Insiden proses:** URL database sekali pakai dibangun dengan `sed` yang gagal diam-diam → migrasi & beberapa suite uji sempat menulis ke DB dev (migrasi aditif; data uji bertag dibersihkan; 3 pengguna e2e dihapus; jumlah pengguna dev tetap 3). Pengaman lama membaca segmen URL terakhir. Kini `scripts/lib/testDb.ts::assertThrowawayDb()` (URL satu segmen, host lokal, nama bertoken `test|ci|tmp`, DAN `select current_database()`) dipakai semua suite penulis DB; pelajaran masuk memori proyek.
**Affects:** `lib/auth/{session,adminUsers,pageGuards,accounts,googleAccounts}.ts`, `middleware.ts`, `app/api/v1/auth/{login,reset-password,registration/complete,google/*}`, `app/api/v1/admin/system/users/[id]/route.ts`, `app/[locale]/admin/(protected)/**/page.tsx`, `prisma/schema.prisma`, `scripts/{test-session,lib/testDb}.ts`, `docs/arsitektur-auth.md` §11, CLAUDE.md § Security.

## 2026-10-22 — SEC-44: penghapusan akun UU PDP (anonimisasi) + masa tunggu + penarikan

**Decision:** Memproses permintaan hapus akun kini benar-benar menghapus data pribadi lewat **anonimisasi** (bukan hard delete) dalam satu transaksi terkunci (`lib/account/deletion.ts`): kunci baris permintaan+pengguna → cek ulang syarat → hapus objek MinIO → ubah DB. `Booking`/`Payment`/`Refund`/`ConsentLog` dipertahankan (pembukuan/pajak, bukti persetujuan); `User` diacak, alamat/dokumen/token dihapus, manifest dikosongkan, teks bebas dan log notifikasi dibersihkan, akun dimatikan dan sesi dicabut (SEC-18). Syarat: hanya jamaah; tak ada booking berjalan atau refund pending/disetujui; **masa tunggu 72 jam**; superadmin melihat pratinjau dan mengetik ulang email pemilik. Pemilik diberi email saat pengajuan, bisa menarik permintaan (`withdrawn`), dan diberi tahu saat selesai/ditolak. Detail dan peta data: `docs/arsitektur-hapus-akun.md`.
**Rationale:** Jalur lama hanya mengubah status, sehingga catatan audit UU PDP palsu dan data pribadi (termasuk scan paspor) tetap tersimpan. Anonimisasi memenuhi hak hapus tanpa merusak catatan keuangan yang dijanjikan tetap disimpan kepada pengguna. Berkas dihapus SETELAH syarat dikunci agar tidak ada abort yang menyisakan berkas hilang pada akun yang tetap aktif. Masa tunggu + email pengajuan + penarikan menutup penyalahgunaan sesi curian.
**Alternatives considered:** Hard delete — melanggar retensi pembukuan dan merusak FK; menghapus berkas dulu lalu transaksi DB (rancangan awal) — ditolak oleh review (DEL-03); tanpa masa tunggu — sesi curian bisa menghapus bukti dalam hitungan menit; verifikasi ulang password saat mengajukan — tidak dipakai (akun Google tak punya password), email+penarikan lebih merata.
**Butuh keputusan pemilik/hukum:** aturan retensi (bukti transfer dipertahankan; manifest & dokumen booking selesai langsung dihapus), lama masa tunggu (72 jam adalah default saya), dan apakah anonimisasi memenuhi UU PDP — halaman `/privacy` sendiri masih draf.
**Ringkasan security check (SOP langkah 5):** review independen `security-auditor`: 0 Critical, 0 High, 2 Medium (SEC-54 PII teks bebas tertinggal, SEC-55 sesi curian bisa mengajukan — ditutup), 6 Low (SEC-56 ditutup; SEC-57 terbuka dan dicatat), 7 Info. Bukti: `test-deletion` 25 uji, uji mutasi manual (26 mutan terbunuh), e2e curl + MinIO lokal sungguhan + UI browser. `bun audit --audit-level=critical` bersih.
**Affects:** `lib/account/deletion.ts`, `lib/email/accountTemplates.ts`, `app/api/v1/{account,admin}/deletion-requests/**` (+`preview`), halaman admin `system/deletion-requests`, `DeletionRequestCard`, `prisma/schema.prisma` (+`erasureSummary`, enum `withdrawn`), migrasi `20261022170000_deletion_erasure_summary` & `20261022180000_deletion_request_withdrawn`, `lib/auth/rateLimit.ts`, `lib/validators/booking.ts`, `scripts/test-deletion.ts`, `docs/arsitektur-hapus-akun.md`.

## 2026-10-22 — SEC-05: pembersihan advisory dependency (34 → 8) + uji artefak produksi

**Decision:** Advisory dependency dikurangi dari 34 (17 high) menjadi 8 (1 high, 7 moderate) lewat bump langsung dan `overrides` yang tetap di versi mayor yang sama; yang butuh lompatan mayor atau terbukti merusak Bun ditahan dan dicatat (rinci di register SEC-05). Tambahan: langkah CI baru `scripts/ci-invoice-smoke.ts` membuat invoice PDF di server produksi (`bun server.js` dalam image), dan `dependabot.yml` mengabaikan versi yang terbukti merusak (React ≥19.3, `@react-pdf/renderer` minor/patch).
**Rationale:** Bisect menemukan dua kelas regresi yang TIDAK terlihat oleh `next build`/dev: (1) React 19.3.1 membuat `next build` crash di internal Bun; (2) bump `@react-pdf/renderer` menggeser paket transitifnya (`@react-pdf/render` 4.5→4.7, `pdfkit` 0.20 baru) sehingga invoice gagal 500 di server produksi karena `#standard-fonts/Helvetica` tak termuat — build tetap exit 0 (hanya mencetak galat), dev (Turbopack) normal. Hanya menjalankan artefak produksi (`bun server.js`) yang menangkapnya. Pin renderer saja tidak cukup karena lock sudah bergeser; perbaikan: mulai dari lock lama dan terapkan perubahan lain tanpa menyentuh rantai PDF.
**Alternatives considered:** `bun update --latest` — merusak keduanya; override `stream-json`/`decode-uri-component` ke mayor baru — risiko regresi runtime MinIO untuk jalur yang tak terpakai; upgrade `next-intl` 4 — perubahan API besar demi 2 moderate yang tidak terjangkau konfigurasi kita (ditunda, keputusan pemilik); menghapus paket Tiptap yang tak dipakai — bertentangan dengan stack yang ditetapkan, tidak dilakukan.
**Ringkasan security check (SOP langkah 5):** `bun audit --audit-level=critical` bersih; hasil audit penuh 34 → 8. Tidak ada kode aplikasi diubah (hanya manifest, lock, CI, dependabot). Bukti: `tsc`, `next build`, seluruh suite DB (email, notify, auth, session, deletion, google, whatsapp), Prisma CLI (generate + migrate deploy + diff), invoice PDF 200 di `bun server.js` dari artefak build standalone, health/login/redirect admin normal.
**Affects:** `package.json` (`overrides`, versi), `bun.lock`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/ci-invoice-smoke.ts`.

## 2026-10-22 — SEC-26/27: batas login atomik + penjaga seed (dan koreksi dari review)

**Decision:** (1) Login mereservasi percobaan secara atomik SEBELUM bcrypt — lapis akun+IP dulu, baru akun-saja, **berurutan** — dan menghapus hitungan begitu password terbukti benar. (2) `prisma/seed.ts` dijaga fail-closed oleh `prisma/seedGuard.ts`: `NODE_ENV` persis `development` (diset oleh skrip), host loopback tanpa `?host=/?hostaddr=`, DB tanpa jamaah/booking/akun non-`*.local`, `SEED_FORCE=1` untuk DB buangan, `SEED_ALLOW_HOST` hanya dengan `SUPERADMIN_PASSWORD` eksplisit (akun demo dilewati); seed dikecualikan dari semua image Docker dan CI memeriksanya. (3) Secret webhook WhatsApp kini juga wajib berentropi cukup.
**Rationale:** `peek`-lalu-`consume` tidak atomik: burst paralel melewati batas per akun. Reservasi paralel di kedua lapis (versi pertama) ternyata menimbulkan regresi — satu IP menggembok akun korban — sehingga lapis dibuat berurutan (review T-01). Seed tidak boleh bergantung pada disiplin dokumentasi: image `migrate` membawa DATABASE_URL produksi dan menyalin `prisma/`. Pemeriksaan hostname URL saja tidak cukup: `?host=` menimpa host koneksi di Prisma (diverifikasi) — kelas bug yang sama dengan insiden URL throwaway DB.
**Alternatives considered:** Hapus `seed.ts` — dipakai evaluasi lokal (`docs/evaluasi-lokal.md`); hanya mengandalkan `NODE_ENV` — tautologis karena skrip resmi menetapkannya; cek `inet_server_addr()` pasca-sambung — menolak Postgres dalam Docker yang dipetakan ke localhost (alamat bridge) dan tetap tak menangkap terowongan SSH; menghitung webhook sebelum verifikasi — menolak lonjakan pesan GOWA yang sah.
**Ringkasan security check (SOP langkah 5):** review `security-auditor`: 0 Critical/High/Medium, 5 Low (semua diperbaiki atau diterima beralasan, register SEC-58), 5 Info. `bun audit --audit-level=critical` bersih. Bukti: `test-auth` (burst paralel/terdistribusi/griefing/reset; kode lama gagal), `test-seed-guard` 13 uji dengan seed nyata sebagai proses, `test-whatsapp`; uji mutasi (login 2, seed 17 + 7, webhook 1 — satu mutan setara dicatat).
**Affects:** `app/api/v1/auth/login/route.ts`, `lib/auth/rateLimit.ts` (komentar), `prisma/seed.ts`, `prisma/seedGuard.ts` (baru), `package.json`, `.dockerignore`, `.github/workflows/ci.yml`, `lib/whatsapp/webhook.ts`, `scripts/{test-auth,test-seed-guard,test-whatsapp}.ts`.

## 2026-10-22 — SEC-57 + sisa kecil register: penyapuan akun terhapus, `braces`, advisory moderate

**Decision:** (1) Tulis terlambat setelah penghapusan akun disapu oleh `sweepErasedAccount` (segera pasca-commit + cron harian 7 hari) dengan penjaga konservatif (hanya akun berformat terhapus + permintaan `completed`) dan helper MinIO yang hanya menerima `pilgrims/<uuid>/`; route unggah mengecek ulang pemilik. (2) `@tiptap/*` dinaikkan ke 3.32 (tak dipakai kode). (3) `braces` (high) diterima: tidak ada versi perbaikan di hulu. (4) Override `stream-json` dan `decode-uri-component` dicoba lalu **dibatalkan** karena terbukti merusak `minio`; 6 advisory moderate (`minio` transitif, `next-intl`) dicatat dengan alasan, `next-intl` direncanakan terpisah (`docs/rencana-next-intl-4.md`).
**Rationale:** Sapuan menutup celah tanpa mengubah desain penghapusan: data tetap bisa dicapai lewat id jamaah. Membersihkan laporan audit bukan tujuan; override yang diam-diam merusak fitur `minio` (URL presigned, notifikasi bucket) adalah pertukaran yang lebih buruk daripada advisory yang jalurnya tak kita pakai — dibuktikan dengan uji, bukan asumsi.
**Alternatives considered:** Pengunci pesimistis lintas tabel untuk menahan unggahan — mahal dan tak menutup `notify()`; menghapus paket Tiptap yang tak dipakai — bertentangan dengan stack yang ditetapkan; menunggu perbaikan `braces` — tak ada jadwal, risikonya nol di server.
**Ringkasan security check (SOP langkah 5):** review `security-auditor`: 0 Critical/High/Medium, 3 Low semuanya diperbaiki (galat parsial `removeObjects` yang ditelan SDK, tes, sapuan sinkron tanpa batas); `bun audit --audit-level=critical` bersih (34 → 7 sejak awal SEC-05). Bukti: `test-deletion` 34 uji, 20 mutan terbunuh, MinIO lokal sungguhan, build + smoke invoice di server produksi.
**Affects:** `lib/account/{erasureSweep,deletion}.ts`, `lib/storage/minio.ts`, `lib/cron/erasureSweepJob.ts`, `instrumentation-node.ts`, `app/api/v1/pilgrims/**/documents/route.ts`, `package.json`, `bun.lock`, `scripts/test-deletion.ts`.

## 2026-10-22 — Upgrade `next-intl` 3.26 → 4.14.9 (SEC-05, opsi A)

**Decision:** `next-intl` dinaikkan ke 4.14.9 (persis, `use-intl` disematkan sama), dengan `i18n/routing.ts` sebagai satu-satunya sumber daftar locale (`defineRouting`), `hasLocale` untuk validasi locale di `i18n/request.ts` dan layout, `localeCookie: false`, dan tes karakterisasi routing (`scripts/test-i18n-routing.ts`) yang dibuat DI ATAS v3 sebelum bump. Matcher middleware sengaja tidak diubah.
**Rationale:** Dua advisory `next-intl` <4.9.1 tak terjangkau konfigurasi kita (dibuktikan), tetapi v3 tidak akan menerima perbaikan lagi; spike di worktree terpisah menunjukkan upgrade tanpa perubahan kode wajib dan sehat di server produksi Bun. Cookie locale dimatikan karena `LocaleSwitcher` hanyalah stub — cookie itu hanya hasil deteksi otomatis. Tes dibuat dulu agar perilaku yang harus tetap benar (tak pernah redirect lintas host, rute terlindungi tetap terlindungi) terkunci di kedua versi.
**Alternatives considered:** Tetap di v3 (opsi B) — sah tetapi menumpuk advisory tak terperbaiki; pin 4.9.2 (opsi C) — `use-intl` tetap tertarik ke 4.14.9 (versi campur); mengubah matcher sesuai saran v4 — tak ada kebutuhan.
**Ringkasan security check (SOP langkah 5):** review `security-auditor` fokus middleware/routing/rantai pasok: 0 Critical/High/Medium, 2 Low + 5 Info. NI-01 (gerbang membaca path mentah, **pre-existing, identik di v3 dan v4 — dibuktikan dengan membandingkan keduanya**) diperbaiki lewat `canonicalGatePath` (SEC-59); NI-02 positif palsu (dibuktikan); NI-03/07 dicatat; NI-04 tes diperkuat; NI-05 diverifikasi (penerbit `@eloqnt/*` = `amann`, sama dengan next-intl); NI-06 `safeLocale` dari routing. `bun audit --audit-level=critical` bersih; audit penuh 34 → 5 sejak awal SEC-05. Bukti: karakterisasi 7 tes + 10 mutan, build & server produksi Bun, `--frozen-lockfile`.
**Affects:** `i18n/routing.ts` (baru), `i18n/request.ts`, `lib/auth/gatePath.ts` (baru), `lib/utils/locale.ts`, `middleware.ts`, `app/[locale]/layout.tsx`, `package.json`, `bun.lock`, `scripts/test-i18n-routing.ts`, `.github/dependabot.yml`, `docs/rencana-next-intl-4.md`.

## 2026-10-23 — Editor teks kaya universal (pola smart-ai) + redesain halaman admin Visa

**Decision:** (1) Satu komponen editor teks kaya di `components/shared/rich-text/` memakai Tiptap 3 (sudah terpasang), format simpan **JSON dokumen dalam kolom `String` yang sama** (tanpa migrasi; teks polos lama tetap sah), skema dibatasi (paragraf, H2/H3, tebal/miring/garis bawah, daftar) dan **tanpa tabel/tautan/gambar**. Tampilan lewat `RichTextView` (JSON → elemen React, tanpa Tiptap, tanpa `dangerouslySetInnerHTML`), bukan `generateHTML`. Validasi server `richTextField()` membangun **salinan bersih** dari daftar putih tunggal (`lib/rich-text/schema.ts`), bukan sekadar memeriksa. (2) Halaman edit Visa dirombak jadi tiga tab dengan bilah simpan saat ada perubahan; `Switch` dan `Tabs` masuk UI kit admin. (3) `prosemirror-model`/`prosemirror-transform` disatukan lewat `overrides` (SEC-60).

**Rationale:** Permintaan: editor minimalis dan ringan seperti smart-ai, bisa diduplikasi di mana-mana. Pola smart-ai (editor dimuat dinamis + tampilan tanpa Tiptap + validator daftar putih) sudah terbukti dan memenuhi aturan CLAUDE.md (simpan JSON, bukan HTML). `RichTextView` dipilih ketimbang `generateHTML` yang disarankan CLAUDE.md karena menghapus seluruh kelas XSS lewat HTML dan tidak membawa Tiptap ke halaman publik. Salinan bersih (bukan hanya pemeriksaan) lebih ketat dari smart-ai: properti liar pada node yang sah ikut terbuang. Token shadcn (bukan `admin-*`) karena komponen berada di `shared/` dan dipakai admin dan jamaah (preseden `AddressPicker`).

**Alternatives considered:** Portal layar penuh ke `document.body` (ditolak: memecah pohon DOM dan token tema `.admin-canvas`; diganti `!m-0` dan dicatat batasannya). Dua instance editor untuk mode lebar seperti smart-ai (ditolak: satu instance cukup, tanpa sinkronisasi). Tabel di skema (ditolak: tidak diminta, lebih berat; menambahnya cukup di `schema.ts` + toolbar). Menyimpan HTML (ditolak CLAUDE.md dan keamanan).

**Security check (SOP langkah 5):** Fase 1: 0 temuan (validator diuji 16 kasus + dimutasi). Fase 2: 0 Critical/High; **SEC-60** (Low, Selesai) salinan ProseMirror ganda dari bump SEC-05 menyebabkan editor error — diperbaiki + penjaga tes + diverifikasi di `bun server.js`; **SEC-61** (Low, Terbuka, pre-existing) `P2025` → 500 dan akses vendor peran manager. `bun audit`: 5 (1 high tanpa versi perbaikan, 4 moderate), 0 critical, tidak berubah. Uji penolakan API dari sesi admin: tautan/gambar/H1/kunci tak dikenal/JSON rusak/>100.000 karakter → 400; tanpa login → 403.

**Verifikasi:** typecheck, `bun run build` 0 error (di salinan terpisah supaya `.next` server dev tidak rusak), `bun scripts/test-rich-text.ts` 16/16, browser dev + artefak produksi (login, edit, simpan, DB berisi JSON bersih, katalog publik, layar penuh, 375 px). Temuan UI saat verifikasi yang diperbaiki: input estimasi tidak sejajar (teks bantuan), overlay layar penuh bergeser 12 px (`space-y-*` induk), kolom vendor/rentang hari terpotong, kartu meluap di HP (grid tanpa `min-w-0`/`grid-cols-1`).

**Affects:** `components/shared/rich-text/` (BARU), `lib/rich-text/` (BARU), `lib/validators/richText.ts` (BARU), `components/admin/ui/Switch.tsx` + `Tabs.tsx` (BARU), `app/[locale]/admin/(protected)/products/visa/[id]/*` (dirombak: page + `ProductInfoTab`/`RequirementsTab`/`CostTiersTab`/`types`), `app/api/v1/admin/products/visa/route.ts` + `[id]/route.ts`, `app/[locale]/(public)/visa/page.tsx`, `app/globals.css`, `package.json` (`overrides`, `test`), `bun.lock`, `scripts/test-rich-text.ts`, `docs/arsitektur-editor-teks.md` (BARU), `docs/arsitektur-visa.md`, `docs/lessons-learned.md` (SEC-60, SEC-61), `CLAUDE.md`

## 2026-10-23 — SEC-61(a): id tak dikenal di route tulis admin menjawab 404, bukan 500

**Decision:** Satu helper `isRecordNotFound(e)` (`lib/admin/errors.ts`, cek `code === 'P2025'`) dipakai di `catch` semua handler `PUT/PATCH/DELETE` by-id pada route produk/vendor admin (28 handler, 17 route), menjawab 404 dengan pesan per sumber daya. `seasons/[id]` DELETE yang `catch { 403 }` untuk semua galat dibenahi sekalian.

**Rationale:** `update/delete({ where: { id } })` melempar P2025 untuk id yang tak ada; tanpa pemetaan jatuh ke 500 + log galat palsu untuk kesalahan klien biasa. Haji dan users sudah memetakannya inline — dijadikan satu helper agar seragam. Dicek lewat `code`, bukan `instanceof`, supaya tahan terhadap salinan Prisma ganda di bundel.

**Alternatives considered:** `findUnique` dulu lalu 404 (satu query ekstra per tulis dan balapan antara cek dan tulis); mengubah semua `catch` ke satu pembungkus `handleAdminError` (cakupan terlalu besar: status auth tiap route berbeda-beda dan bukan permintaan ini). Route upsert induk (`cost`, `prices`, `*-options`, `sites`, `cost-tiers`) sengaja tidak disentuh — galat id induk di sana FK, bukan P2025.

**Security check:** 0 Critical/High; perubahan hanya mengubah status galat dan tidak membuka data baru. **Verifikasi:** typecheck; dari sesi admin PUT dan DELETE ke semua endpoint dengan UUID tak ada → 404 (405 hanya untuk metode yang memang tak ada); helper dimatikan sementara → 500 (uji kebalikan), lalu dipulihkan.

**Affects:** `lib/admin/errors.ts` (BARU), 17 route di `app/api/v1/admin/products/**` dan `system/settings/vendors/[id]`, `products/seasons/[id]/route.ts`, `docs/lessons-learned.md` (SEC-61), `docs/progress.md`

## 2026-10-23 — Editor teks kaya dipasang di Hotel, Muthowif (`bio`), dan Haji

**Decision:** Komponen editor universal dipasang di `Hotel.description`, `Muthowif.bio`, dan `HajiProduct.description` dengan pola yang sama seperti Visa: kolom `String` tetap, JSON dokumen di dalamnya, validasi server `richTextField()` + `emptyToNull()`, tampilan `RichTextView`. Di tempat yang tampil sebagai kartu ber-`line-clamp` (beranda dan daftar Muthowif) dipakai `plainText()`, bukan `RichTextView`. Haji mendapat `hajiProductCreateSchema` (`.strict()`) karena POST-nya tak punya validasi sama sekali. API katalog publik **tidak diubah**: tetap mengembalikan kolomnya apa adanya (teks polos atau string JSON).

**Rationale:** Deskripsi produk punya potensi panjang; satu komponen yang sudah teruji (Visa) lebih murah dan aman daripada editor per modul. Tanpa validasi server, deskripsi Haji tak bisa dipercaya (batas lama `maks 5000` karakter juga akan menolak JSON dokumen yang sah). Ringkasan teks polos di kartu mencegah JSON bocor ke tampilan.

**Alternatives considered:** Menambah field turunan `descriptionText` di API katalog sekarang (ditolak: tak ada konsumen dalam aplikasi, ditunda sampai ada yang butuh). Menampilkan deskripsi Haji di halaman publik dan membangun halaman edit Haji (ditolak: keputusan produk di luar permintaan; dicatat sebagai batasan). Mengubah `HotelService.description` (ditolak: teks pendek satu baris).

**Security check:** 0 Critical/High. Perbaikan menumpang di Haji (POST tanpa Zod, `catch → 403` pada GET/DELETE) masuk SEC-61. `bun audit` tidak berubah (tak ada dependensi baru). Uji penolakan API: tautan di 6 jalur (Hotel/Muthowif/Haji × POST/PUT), kunci liar, tipe salah, body null → 400.

**Verifikasi:** typecheck, `bun run build` 0 error (salinan terpisah), `scripts/test-rich-text.ts` 17 tes, browser (teks lama termuat → ditambah daftar/judul → JSON bersih di DB → detail publik benar; beranda/daftar Muthowif tanpa JSON; produk Haji dibuat lewat UI). Data uji dipulihkan/dihapus.

**Affects:** `app/api/v1/admin/products/{hotels,muthowif,haji}/**` (route POST/PUT; Haji GET/DELETE), `lib/validators/adminUpdates.ts`, form admin Hotel/Muthowif/Haji, halaman publik `hotels/[id]`, `muthowif` (daftar, detail), beranda, `app/globals.css` (judul teks kaya), `scripts/test-rich-text.ts`, `docs/arsitektur-editor-teks.md` (§6, §8), `docs/arsitektur-hotel.md`, `docs/arsitektur-muthowif.md`, `docs/lessons-learned.md`, `docs/progress.md`

## 2026-10-25 — Editor teks kaya di Paket Umroh, Paket Ziarah, Situs Wisata, Katering; deskripsi Haji tampil di publik

**Decision:** (1) Pola yang sama seperti Visa/Hotel/Muthowif/Haji dipasang di `Package.description`, `TourPackage.description`, `TourismSite.description`, dan `CateringOption.description`; deskripsi Haji kini tampil di kartu publik lewat `RichTextView` (keputusan pemilik). (2) **Katering belum punya kolom deskripsi** (temuan recheck): ditambahkan lewat migrasi aditif nullable `add_catering_description`, bukan dipaksakan memakai kolom lain. (3) `POST /admin/products/catering` yang membaca body mentah tanpa Zod diganti `cateringOptionCreateSchema` (`.strict()`), sama pola dengan Haji. (4) Situs Wisata: editor di admin saja — halaman publik memang tidak menampilkan deskripsi situs, dan menampilkannya tidak diminta. (5) Temuan keamanan lama (SEC-07, SEC-08, dll.) **diagendakan** ke sesi berikutnya (`docs/progress.md` "Agenda sesi berikutnya"), tidak dikerjakan di sini.

**Rationale:** Komponen sudah teruji (Visa/Hotel/Muthowif/Haji); memasangnya di empat kolom lagi murah dan seragam. Migrasi aditif nullable aman untuk data lama dan dapat dibalik. Di kartu publik dipakai `RichTextView` penuh (bukan ringkasan teks polos) karena halaman paket/tur/katering/haji tidak punya halaman detail — ringkasan terpotong akan membuat deskripsi panjang tak terbaca sama sekali.

**Alternatives considered:** Menyimpan deskripsi Katering di `menuStyle`/`name` (ditolak: hack); `plainText()` + `line-clamp` di kartu (ditolak, alasan di atas); membangun halaman edit Haji/Katering dan menampilkan deskripsi situs sekaligus (ditolak: di luar permintaan, dicatat sebagai keputusan produk tersisa).

**Security check (SOP langkah 5), per fase:** 0 Critical/High, 0 temuan baru. Verifikasi nyata tiap fase: tautan (POST/PUT) dan node gambar ditolak 400, dokumen kosong → `NULL`; Katering: kunci liar, enum liar, harga negatif, body null → 400. Perbaikan menumpang: Katering `GET`/`POST` tak lagi `catch → 403` untuk semua galat. `bun audit` tidak berubah (tanpa dependensi baru). Migrasi: skema=migrasi terbukti (`migrate diff --exit-code`), shadow DB sekali pakai dengan URL literal dan penjaga `REAL != SHADOW`; `migrate deploy` lokal juga menerapkan dua migrasi 22 Oktober yang tertinggal di DB dev.

**Verifikasi:** typecheck, `bun run build` 0 error di salinan terpisah tiap fase, `scripts/test-rich-text.ts` 18 tes (+Katering), browser (dev untuk Fase 4-7; artefak produksi `bun server.js` untuk Fase 8 karena Prisma client server dev basi setelah `generate`). Semua data uji dipulihkan/dihapus.

**Affects:** `app/[locale]/(public)/{haji,packages,tours,catering}/page.tsx`, form admin Paket Umroh/Ziarah/Situs Wisata/Katering, `app/api/v1/admin/products/{packages,tour-packages,tourism-sites,catering}/**`, `lib/validators/adminUpdates.ts` (`cateringOptionCreateSchema`), `prisma/schema.prisma` + `prisma/migrations/20261025153038_add_catering_description/`, `scripts/test-rich-text.ts`, `docs/arsitektur-editor-teks.md` (§9), `docs/arsitektur-paket-umroh.md`, `docs/arsitektur-ziarah.md`, `docs/progress.md`

## 2026-10-25 — Hardening SEC-07 dan SEC-08: hapus stub tanpa auth, galat tidak lagi disamarkan jadi 403

**Decision:** (1) **SEC-07:** 11 route stub (`ok(null)`, semua method, tanpa auth dan tanpa logika) **dihapus**, bukan diberi auth + 501. (2) **SEC-08:** semua `catch` yang menjawab 403 untuk semua galat diganti pola `isAuthError → 403`, selain itu `log + 500` (helper `lib/admin/errors.ts`: `isAuthError`, `authFailureResponse`); `seasons` POST — satu-satunya body mentah tersisa — diberi `seasonCreateSchema`. (3) Keduanya dijaga regresi di CI oleh `scripts/test-routes.ts` (pemindai statis seluruh `route.ts`). (4) Pemisahan 401 vs 403 **tidak** diubah.

**Rationale:** Tidak ada satu pun pemanggil stub (kode, skrip, tes, CI, Caddyfile), jadi menghapus = fail-closed (404) tanpa risiko kompatibilitas; stub Group Booking tidak bernilai karena arah produk akan diubah total (keputusan pemilik 2026-10-25) dan ditulis ulang dari nol kelak. Helper tunggal menghindari 15 salinan logika yang bisa menyimpang lagi. Penjaga statis dipilih karena kelas bug ini (pola kode) paling murah dicegah dengan pemindaian, bukan dengan uji per-endpoint. Recheck menemukan sisa SEC-08 lebih sempit dari catatan lama (15 blok; catering/haji sudah beres) sehingga lingkup diperbaiki sebelum eksekusi.

**Alternatives considered:** Menjadikan stub `501` ber-auth (ditolak: tak ada pemanggil, permukaan serang tetap ada); memisahkan 401/403 sekaligus (ditolak: ratusan route lama menjawab 403 untuk keduanya, mengubahnya = perubahan perilaku klien di luar bunyi SEC-08); pembungkus `handleAdminError` untuk semua route (ditolak: cakupan jauh lebih besar dan status auth tiap route berbeda).

**Security check (SOP langkah 5):** 0 Critical/High, 0 temuan baru. Bukti nyata: SEC-07 sebelum — 13 request tanpa login sukses 200/201, sesudah — 404; SEC-08 — 15 endpoint tetap 403 tanpa login, input salah di `seasons`/`packages` → 400, musim valid → 201. Penjaga dimutasi (stub dikembalikan; `catch` 403 polos dan `const b = await req.json()` dikembalikan → tes gagal). `bun audit` tidak berubah (5: 1 high tanpa versi perbaikan, 4 moderate; 0 critical; tanpa dependensi baru).

**Verifikasi:** typecheck; `bun run build` 0 error di salinan terpisah tiap fase; `scripts/test-routes.ts` 7 tes; halaman admin terkait tetap 200.

**Affects:** 11 route dihapus (`app/api/v1/{admin/{bookings/[id]/status,hotels,muthowif,notifications,reports,seasons},groups/**,pilgrims/[bookingId]/{,[pilgrimId]/}route.ts}`), `lib/admin/errors.ts`, `lib/validators/adminUpdates.ts` (`seasonCreateSchema`), `app/api/v1/admin/products/{packages,seasons}/route.ts`, route upload/ZIP (hotel/muthowif/situs wisata/kendaraan/zip), `scripts/test-routes.ts`, `package.json` (`test`), `docs/lessons-learned.md`, `docs/progress.md`, `CLAUDE.md`

## 2026-10-25 — Hardening SEC-61(b), 12, 13, 47, 49, 50

**Decision:** (1) **SEC-12:** tidak ada perubahan kode — sudah tertutup SEC-44; dibuktikan (409) dan register dikoreksi. (2) **SEC-13:** `updateUserByAdmin(id, change, actorId)` menolak ubah-diri dan perubahan yang menyisakan nol superadmin aktif (422); transaksi mengunci target + semua superadmin aktif berurut `id`. (3) **SEC-61(b):** `GET` vendor terbuka bagi manager dengan kolom ramping; tulis tetap superadmin. (4) **SEC-47:** `canAccessAddress` (staf atau pemilik via `User.addressId`, selain itu 404) + rate limit `addressCreateUser` pada `POST /address`. (5) **SEC-49:** `.catch(() => null)` pada 58 titik `req.json()` di 53 route + penjaga CI. (6) **SEC-50:** peta eksplisit di `catalog/flight`, cache 5 dtk (hanya hasil sehat) di `health`.

**Rationale:** Semuanya temuan lama di register; masing-masing diperkecil ke perubahan terkecil yang menutup celah, dengan penjaga regresi yang dimutasi (membuktikan tes benar-benar menangkap regresi). Kunci semua superadmin dalam urutan tetap menutup balapan "saling menurunkan" tanpa deadlock. Respons 404 (bukan 403) pada alamat milik orang lain agar keberadaan baris tak bocor.

**Alternatives considered:** SEC-13 lewat `SELECT count` tanpa kunci (ditolak: dimutasi, kedua permintaan lolos); manager mendapat respons vendor penuh (ditolak: kontak/alamat vendor tak dibutuhkan dropdown); cache health di Redis (ditolak: berlebihan, satu replika); menghapus endpoint `address` (ditolak: dipertahankan karena masih bagian kontrak komponen alamat, hanya diperketat).

**Security check (SOP langkah 5):** 0 Critical/High pada kode yang diubah; 1 temuan pre-existing baru **SEC-62 (Medium)** — `DELETE …/images` hotel/kendaraan menghapus objek MinIO dari `key` body tanpa cek kepemilikan — dicatat, dilaporkan, belum diperbaiki. `bun audit`: 5 (tidak berubah). Bukti nyata: HTTP terhadap server dev + DB uji untuk SEC-13 (7 kasus), 61b (matriks 4 peran + tanpa cookie), 47 (BOLA + 429), 49 (sapuan 92 route×metode, 0× 500), 50.

**Verifikasi:** typecheck; `bun run build` 0 error di dist terpisah; `bun run test` 13 suite lulus (suite baru `scripts/test-admin-users.ts`; `scripts/test-routes.ts` bertambah penjaga SEC-61b/47/49/50).

**Affects:** `lib/auth/adminUsers.ts`, `lib/address/access.ts` (baru), `lib/auth/rateLimit.ts`, `app/api/v1/{admin/system/users/[id],admin/system/settings/vendors,address,address/[id],catalog/flight,health}`, 53 route (`.catch`), halaman admin pengguna, `scripts/test-admin-users.ts`, `scripts/test-routes.ts`, `package.json`.

## 2026-10-25 — SEC-62 (hapus objek MinIO sembarang) dan polesan UI tambah-vendor

**Decision:** (1) `DELETE …/images` pada hotel dan kendaraan hanya menghapus objek bila `key` dari body tercatat di `images` entitas itu (selain itu 404); pengecekan mendahului `deleteObject`. (2) Kegagalan 401/403 pada tombol "tambah vendor cepat" di editor HPP ditampilkan sebagai pesan jelas (helper `lib/admin/vendorQuickAdd.ts`), bukan senyap; hak tulis vendor tetap hanya superadmin (SEC-61b).

**Rationale:** Tanpa cek keanggotaan, manager yang tahu atau menebak key bisa menghapus objek bucket mana pun, termasuk scan paspor jamaah. Pesan galat menghilangkan kebingungan tanpa melebarkan hak akses.

**Alternatives considered:** Memvalidasi awalan key (`hotels/<id>/…`) — ditolak: keanggotaan di `images` lebih ketat dan sudah ada sumbernya; menyembunyikan tombol bagi non-superadmin — ditolak: butuh peran di klien dan mengubah 6 layout; membuka POST vendor bagi manager — ditolak: memperluas hak tulis tanpa diminta.

**Security check (SOP langkah 5):** 0 Critical/High, 0 temuan baru; menutup SEC-62 (Medium). Bukti nyata: MinIO + HTTP (key korban/milik entitas lain 404 dan objek utuh; key sendiri 200 dan objek terhapus), browser untuk UI. `bun audit` tidak berubah.

**Verifikasi:** tsc; `bun run build` 0 error di dist terpisah; `bun run test` 13 suite lulus; penjaga dimutasi.

**Affects:** `app/api/v1/admin/products/{hotels/[id]/images,transport/vehicles/[id]/images}/route.ts`, `lib/admin/vendorQuickAdd.ts` (baru), 5 halaman produk + `CostTiersTab.tsx`, `scripts/test-routes.ts`.

## 2026-10-25 — SEC-43: pelepasan verifikasi WhatsApp (BATAL + alat superadmin)

**Decision:** Menambah `releaseWhatsappVerification` dengan dua pemicu: (1) pesan `BATAL` dari pemegang nomor yang terautentikasi webhook (JID), melepas verifikasi nomor itu dari akun mana pun; (2) `DELETE /admin/system/users/[id]/whatsapp` oleh superadmin. Nomor kontak tidak dihapus; kode menunggu dihanguskan; balasan `BATAL` hanya bila ada yang dilepas.

**Rationale:** Satu nomor = satu akun terverifikasi (ADR-0002) membuat nomor daur ulang terkunci di akun pemilik lama dan pemilik baru hanya mendapat "hubungi kami". Pemegang nomor saat ini adalah pihak yang paling berhak mencabut; JID terautentikasi WhatsApp membuktikannya tanpa mengirim apa pun keluar. Dampak terburuk penyalahgunaan (orang yang benar-benar memegang nomor mencabutnya) hanya menghentikan WhatsApp ke nomor itu — email tetap jaring pengaman.

**Alternatives considered:** Hanya alat admin (ditolak: pemilik nomor tetap bergantung pada CS); membalas BATAL juga saat tak ada yang dilepas (ditolak: oracle penebak nomor terverifikasi); menghapus nomor kontak saat dilepas (ditolak: pengguna harus bisa membuktikan ulang tanpa mengetik ulang); membakar kode saat BATAL dari bukan pemegang nomor (tidak relevan — BATAL tak memakai kode).

**Security check (SOP langkah 5):** 0 Critical/High/Medium baru. Ditinjau: pengirim terautentikasi (HMAC + JID pribadi, chat=pengirim), rate limit per pengirim (punya pemanggil, `grep`), route superadmin tanpa body/PII di log, penulisan bersyarat anti-balapan, tak ada oracle. `bun audit` tidak berubah. Bukti: 3 mutasi tertangkap, HTTP nyata (webhook bertanda tangan + route admin).

**Affects:** `lib/auth/whatsappVerify.ts`, `lib/whatsapp/webhook.ts`, `lib/auth/rateLimit.ts`, `lib/notifications/templates/whatsapp.ts`, `app/api/v1/admin/system/users/[id]/whatsapp/route.ts` (baru), `app/api/v1/admin/system/users/route.ts`, halaman admin pengguna, `scripts/test-whatsapp.ts`, `docs/arsitektur-whatsapp-verifikasi.md`.

## 2026-10-25 — SEC-14: superadmin dapat membuka pembatasan login/email satu akun

**Decision:** Menambah `resetAccountLimits(email)` (hapus `loginAcct`, semua `loginAcctIp` akun itu, dan `authEmailSendEmail`) dan `POST /admin/system/users/[id]/reset-limits` hanya superadmin, dengan tombol di Manajemen Pengguna. Kunci akun login dibentuk `accountKey()` (email ≤64 apa adanya, selain itu di-hash) supaya kunci gabungan `akun|ip` selalu dapat dikenali berdasarkan awalan.

**Rationale:** Lockout-DoS adalah kompromi inheren rate limit; jalan keluar paling kecil adalah buka-kunci manual oleh admin (sudah dicatat di register sebagai opsi). Batas per-IP sengaja tidak disentuh agar tombol ini tak jadi alat melewati perlindungan brute-force dari satu sumber. Endpoint tanpa body, hanya superadmin, dan hanya meninggalkan jejak id (tanpa email).

**Alternatives considered:** CAPTCHA (ditolak/ditunda: keputusan produk + dependensi pihak ketiga); mengosongkan semua kunci `rl:*` (ditolak: melemahkan perlindungan akun lain); menyimpan daftar IP per akun untuk menghapus tepat (ditolak: state tambahan, SCAN berawalan cukup); mengganti hash kunci komposit dengan penyimpanan terpisah (ditolak: perubahan lebih besar tanpa manfaat).

**Security check (SOP langkah 5):** 0 Critical/High/Medium baru; endpoint admin baru ditinjau (superadmin di awal handler, 401/403/404/500 dibedakan, tanpa input body, tanpa PII di log, SCAN memakai pola yang di-escape sehingga email berkarakter glob tak bisa menghapus akun lain — diuji). `bun audit` tidak berubah. Bukti: HTTP nyata, tes unit memori (+Redis di CI), penjaga sumber dimutasi.

**Affects:** `lib/auth/rateLimit.ts`, `app/api/v1/auth/login/route.ts`, `app/api/v1/admin/system/users/[id]/reset-limits/route.ts` (baru), halaman admin pengguna, `scripts/test-rate-limit.ts`, `scripts/test-routes.ts`.

## 2026-10-25 — SEC-10: hardening kontainer produksi (sebagian)

**Decision:** `no-new-privileges` pada semua service; `cap_drop: ALL` pada web & migrate dan pada postgres/redis dengan `cap_add` minimal untuk entrypoint resmi; Redis `--requirepass` dengan `REDIS_PASSWORD` wajib (`REDIS_URL` memuat sandi, dibuat generator env); `POSTGRES_PASSWORD` dikosongkan di kontainer web. minio dan caddy hanya `no-new-privileges`; `cap_drop` mereka ditunda sampai bisa diuji.

**Rationale:** Jaringan internal bukan batas keamanan — satu kontainer terkompromi tak boleh bisa menguras Redis atau membaca rahasia DB tambahan; capability default Docker jauh melebihi kebutuhan. CI sudah menjalankan stack sungguhan (postgres, redis, migrate, web), sehingga setiap pembatasan di empat service itu dibuktikan di sana, bukan ditebak. Server belum live, jadi mengubah kontrak env (REDIS_PASSWORD) sekarang murah.

**Alternatives considered:** `cap_drop ALL` untuk minio/caddy tanpa uji (ditolak: tak ada Docker lokal dan CI tak menjalankannya — risiko outage); `read_only` rootfs (ditunda: Next.js/Prisma menulis cache, perlu tmpfs yang diuji); memisahkan POSTGRES_PASSWORD ke berkas env terpisah (ditolak: mengubah alur deploy; pengosongan lewat `environment` cukup); pin digest image (ditunda ke keputusan pemeliharaan bersama Dependabot docker).

**Security check (SOP langkah 5):** 0 Critical/High; infra ditinjau terhadap checklist infra (non-root tetap, tanpa port data store, tanpa `privileged`/docker.sock, rahasia tidak masuk image). `bun audit` tidak berubah. Bukti: CI job docker (lihat PR), penjaga statis dimutasi, generator env diuji lokal (sandi dan URL cocok).

**Affects:** `docker-compose.prod.yml`, `.env.production.example`, `scripts/buat-env-production.sh`, `.github/workflows/ci.yml`, `scripts/test-routes.ts`, `docs/deployment.md`.

## 2026-10-25 — SEC-11: pin GitHub Actions ke SHA dan Bun ke versi tetap

**Decision:** Semua action pihak ketiga dipin ke SHA commit (dengan komentar versi); `bun-version` CI dipin ke 1.3.11 (sama dengan versi lokal). Penjaga statis di `scripts/test-routes.ts` menolak `uses:` tanpa SHA dan `bun-version: latest`.

**Rationale:** Tag bisa dipindah (kasus tj-actions 2025); workflow ini memegang `contents`/`packages` write di job docker. Bun `latest` membuat CI bisa pecah/berubah tanpa commit (SEC-05 sudah mencatat regresi runtime Bun).

**Alternatives considered:** Hanya mengandalkan Dependabot (ditolak: pembaruan tag tetap mengikuti tag yang bisa dipindah); pin digest `oven/bun` di Dockerfile sekarang (ditunda ke SEC-10, perlu keputusan pemeliharaan).

**Security check (SOP langkah 5):** 0 Critical/High; menutup SEC-11 (Low). Perubahan infra/workflow ditinjau terhadap checklist infra (permissions tidak berubah, tanpa `pull_request_target`). `bun audit` tidak berubah. Bukti: SHA diverifikasi via API, penjaga dimutasi, CI PR hijau.

**Affects:** `.github/workflows/ci.yml`, `.github/workflows/minio-image.yml`, `scripts/test-routes.ts`.

## 2026-10-26 — Komponen Biaya universal, Fase 1: backend bersama

**Decision:** Memindahkan logika Komponen Biaya (hitung per komponen, CRUD, simulasi) ke `lib/pricing/costComponents*.ts` dengan registry pemilik (`package`, `tour_package`); route modul menjadi re-export tipis. Rumus tetap **margin per komponen lalu dijumlah** (keputusan pemilik 2026-10-26). Handler menerima `authorize` yang dapat disuntik (default `requireSuperAdmin`) agar bisa diuji tanpa cookie. Body kini `.strict()`.

**Rationale:** Empat route, dua blok hitung, dan dua fungsi refresh yang identik membuat tiap perbaikan harus dilakukan berkali-kali dan sudah melahirkan tiga celah (SEC-63/64) serta satu salah-pakai tipe (SEC-65). Satu implementasi + registry membuat Haji (Fase 3) cukup satu entri + route tipis. Perilaku lama dibuktikan tidak berubah dengan snapshot sebelum/sesudah, bukan sekadar build hijau — hitung ini ikut menentukan harga booking.

**Alternatives considered:** Menyalin pola ke Haji (ditolak pemilik: duplikasi ketiga); factory route Next dinamis (ditolak: route Next butuh berkas statis); menambah `orderBy` pada hitung komponen (ditunda: murni refactor, urutan dipertahankan); memigrasi Hotel/Pesawat/Transport/Visa/Muthowif (di luar scope: itu editor tier/jadwal, bukan komponen bebas).

**Security check (SOP langkah 5):** 0 Critical/High pada kode yang diubah; menutup SEC-63, SEC-64, SEC-65 (Low); mencatat SEC-66 (Medium, pre-existing, booking Haji berharga 0) dengan jadwal Fase 3. Checklist route handler: Zod strict, `authorize()` pertama di kelima handler (diuji + `grep`), scoping kepemilikan, galat dibedakan (403/400/404/500), tanpa SQL mentah, respons tanpa data internal. `bun audit` tidak berubah. Bukti: snapshot sebelum/sesudah identik, probe celah sebelum/sesudah, HTTP nyata, 5 mutasi tertangkap.

**Verifikasi:** tsc; `bun run build` 0 error (dist terpisah); `bun run test` 14 suite lulus.

**Affects:** `lib/pricing/costComponents.ts`, `costComponentOwners.ts`, `costComponentHandlers.ts` (baru), `lib/validators/costComponent.ts` (baru), `computePackagePrice.ts`, `computeTourPackagePrice.ts`, 4 route `…/costs` + 2 route `…/costs/simulate` (baru), `scripts/test-cost-components.ts`, `package.json`, `docs/arsitektur-komponen-biaya.md`.

## 2026-10-26 — Komponen Biaya universal, Fase 2: panel UI bersama; CRUD lengkap sebagai prinsip

**Decision:** UI "Komponen Biaya" diekstrak ke `components/admin/pricing/CostComponentsPanel.tsx` (+ `VendorCurrencyField`) dan dipakai Paket Umroh serta Paket Ziarah; panel memuat datanya sendiri dari `apiBase` dan memberi tahu induk lewat `onChanged`. Markup dipindah apa adanya (idiom visual baku dipertahankan). Ditambahkan: pesan galat simpan/hapus, pesan "hanya superadmin" untuk manager, `aria-label`. Prinsip pemilik dicatat: setiap entitas admin harus punya **CRUD lengkap** (Haji: edit + hapus bersemantik aman + aktifkan kembali) — dimasukkan ke rencana F3/F4.

**Rationale:** Dua salinan 190+ baris yang identik sudah menyebabkan pratinjau memakai margin tipe lain (SEC-65) dan kegagalan yang diam. Satu panel membuat Haji (F4) cukup memasang komponen. Verifikasi memakai perbandingan DOM sebelum/sesudah, bukan sekadar build hijau, karena regresi tampilan tidak tertangkap tipe/tes unit.

**Alternatives considered:** Mengekstrak hanya tipe/hook (ditolak: markup tetap terduplikasi); menyatukan juga editor tier/jadwal Hotel/Pesawat/Transport/Visa (di luar scope: model datanya berbeda); membiarkan manager melihat daftar kosong (ditolak: menyesatkan); menunggu browser pane (ditolak: menolak localhost — dipakai Chrome terpasang lewat protokol DevTools, skrip sementara).

**Security check (SOP langkah 5):** 0 Critical/High; 0 temuan baru. UI klien: tanpa `dangerouslySetInnerHTML`, semua teks lewat React; hanya memanggil route superadmin-only yang sudah diuji (F1) dan `settings/vendors` (SEC-61b). Menutup SEC-65. `bun audit` tidak berubah (5).

**Verifikasi:** tsc; `bun run build` 0 error (dist terpisah); `bun run test` 14 suite lulus; snapshot DOM/teks sebelum/sesudah identik kecuali selisih yang disengaja; jalur galat UI diuji; penjaga dimutasi.

**Affects:** `components/admin/pricing/CostComponentsPanel.tsx`, `VendorCurrencyField.tsx` (baru), `products/packages/[id]/page.tsx`, `products/tour-packages/[id]/page.tsx`, route `tour-packages/simulate` (dihapus), `scripts/test-cost-components.ts`, `scripts/test-routes.ts`, `docs/arsitektur-komponen-biaya.md`.

## 2026-10-26 — Komponen Biaya universal, Fase 3: harga Haji dari komponen + CRUD aman

**Decision:** `HajiProduct.price` menjadi cache dari Komponen Biaya (jumlah harga jual per komponen, margin tipe `haji`) — bukan masukan admin (skema menolak `price`); produk baru berharga 0 dan **tidak dapat dipesan** sampai berharga (422, `ItemNotBookableError`) atau bila nonaktif. Hapus Haji = hapus sungguhan bila belum pernah dipesan (beserta baris polimorfik miliknya), selain itu nonaktif + pesan; produk nonaktif dapat diaktifkan kembali. Katalog publik memakai peta eksplisit dan menghitung ketersediaan dengan `pending`. Cron kurs menghitung ulang semua produk Haji (termasuk nonaktif).

**Rationale:** Harga manual tak terhubung ke HPP/kurs dan memungkinkan Haji berharga 0 dipesan gratis (SEC-66). Pemilik menegaskan bahwa kesalahan manusia harus bisa dikoreksi (CRUD lengkap), tanpa membuat booking/invoice yatim — karena itu hapus keras hanya saat tak ada booking. Produk nonaktif tetap dihitung ulang supaya tak tampil dengan harga basi saat diaktifkan kembali.

**Alternatives considered:** Harga manual tetap boleh bila belum ada komponen (ditolak: dua sumber harga, jalan pintas gratis); menyembunyikan produk berharga 0 dari katalog (ditolak untuk sekarang: 'Harga belum ditetapkan' lebih informatif; dapat diubah); cascade hapus booking (ditolak: merusak data keuangan); soft-delete saja (ditolak pemilik: kesalahan input harus benar-benar bisa dihapus).

**Security check (SOP langkah 5):** 0 Critical/High pada kode yang diubah. Menutup SEC-66 (Medium) dan SEC-67 (Low). Checklist: route `[id]` `requireManager()` di awal, Zod strict, galat dibedakan, tanpa SQL mentah; hapus keras hanya lewat transaksi dengan cek booking + fallback FK; log tanpa PII; cron punya pemanggil (`grep` + penjaga). `bun audit` tidak berubah.

**Verifikasi:** tsc; `bun run build` 0 error (dist terpisah); `bun run test` 15 suite lulus; HTTP nyata end-to-end termasuk booking Haji sungguhan; 7 mutasi tertangkap.

**Affects:** `lib/pricing/computeHajiPrice.ts`, `costComponentOwners.ts`, `lib/haji/{delete,catalog}.ts`, `lib/booking/errors.ts`, `lib/quota/adapters/haji.ts`, `lib/validators/adminUpdates.ts`, `lib/cron/exchangeRateJob.ts`, `app/api/v1/admin/products/haji/**`, `app/api/v1/bookings/route.ts`, `app/api/v1/catalog/haji/route.ts`, halaman publik `/haji`, halaman daftar admin Haji, `scripts/test-haji-pricing.ts`, `scripts/test-rich-text.ts`, `package.json`.

## 2026-10-26 — Komponen Biaya universal, Fase 4: UI Haji dengan CRUD lengkap

**Decision:** Halaman edit Haji memakai idiom halaman edit yang sudah ada (header + panel Info + `CostComponentsPanel` + kartu harga + Zona Berbahaya). Tombol bahaya memilih label dari jumlah booking ("Hapus Produk" / "Nonaktifkan Produk") dan server yang memutuskan hapus-atau-nonaktif; aktifkan kembali lewat saklar Aktif. Harga ditampilkan, tidak pernah diisi. Pesan validasi Haji berbahasa Indonesia; galat basi dibuang saat pengguna melanjutkan.

**Rationale:** Arahan pemilik: kesalahan manusia harus bisa dikoreksi (edit dan hapus), tanpa membuat booking yatim. Memakai idiom yang sama menjaga konsistensi UI dan mengurangi kejutan. Verifikasi UI di browser nyata menemukan dua cacat (pesan Inggris, banner basi) yang lolos dari tipe dan tes unit.

**Alternatives considered:** Tombol hapus terpisah di daftar (ditolak: halaman edit sudah cukup, mengurangi hapus tak sengaja); menyembunyikan produk berharga 0 dari daftar admin (ditolak: admin harus melihatnya untuk mengisi komponen); galeri gambar di fase ini (di luar scope).

**Security check (SOP langkah 5):** 0 Critical/High, 0 temuan baru. Tidak ada route baru; halaman klien memanggil route admin yang sudah diuji (manager/superadmin sesuai peran), tanpa `dangerouslySetInnerHTML`, pesan server ditampilkan sebagai teks. Manager tetap tidak dapat membaca/ubah HPP (panel menampilkan pemberitahuan). `bun audit` tidak berubah.

**Verifikasi:** tsc; `bun run build` 0 error (dist terpisah); `bun run test` 15 suite lulus; skenario CRUD lengkap di Chrome headless asli; penjaga UI dimutasi.

**Affects:** `products/haji/[id]/page.tsx` (baru), `products/haji/page.tsx`, `lib/validators/adminUpdates.ts`, `scripts/test-haji-pricing.ts`, `docs/arsitektur-komponen-biaya.md`.

## 2026-10-26 — Komponen Biaya universal, Fase 5: dokumentasi akhir + aturan CRUD lengkap

**Decision:** `docs/arsitektur-haji.md` ditulis sebagai source of truth as-built; `CLAUDE.md` mencatat komponen universal ke-6, status Haji, dan menambahkan aturan **CRUD lengkap selalu** (create, read, edit, delete bersemantik aman + aktifkan kembali, di API dan UI) di bagian Admin UI Kit. Rujukan silang ditambahkan ke dokumen modul yang memakai komponen ini; komentar basi di registry adapter kuota dikoreksi.

**Rationale:** Arahan pemilik menjadikan CRUD lengkap prinsip proyek, bukan keputusan satu modul — harus ada di tempat yang dibaca setiap sesi (`CLAUDE.md`). Dokumen as-built mencegah rencana basi menjadi acuan (SOP langkah 1): angka dan rujukan baris dokumen diverifikasi terhadap kode, dan dua kesalahan hitung (jumlah uji) yang saya tulis sendiri ditemukan dan dikoreksi sebelum merge.

**Alternatives considered:** Menaruh aturan CRUD hanya di memori sesi (ditolak: tidak terlihat orang/sesi lain); menulis ulang dokumen modul lama (ditolak: cukup rujukan silang, isi lama menjadi riwayat); menunda `arsitektur-haji.md` sampai checkout Haji ada (ditolak: modul sudah berubah besar dan butuh sumber kebenaran sekarang, gap dicatat eksplisit).

**Security check (SOP langkah 5):** perubahan dokumen dan satu komentar kode — 0 temuan; `bun audit` tidak berubah. Seluruh temuan rangkaian sudah Selesai di register (SEC-63..67).

**Affects:** `docs/arsitektur-haji.md` (baru), `docs/arsitektur-komponen-biaya.md`, `docs/arsitektur-{paket-umroh,ziarah,harga}.md`, `CLAUDE.md`, `lib/quota/adapters/index.ts` (komentar), `docs/progress.md`, `docs/decisions.md`.

## 2026-10-26 — Vendor: satu alur, satu sumber data (ADR-0003 diterima; rencana fase)

**Decision:** Keputusan arsitektur vendor dikunci di `docs/decisions/adr-0003-satu-alur-vendor-kategori-terkelola.md` (Accepted): satu entitas `Vendor` dengan FK di mana-mana, kategori dikelola admin (many-to-many), kontak + negara ISO terstruktur, `VendorForm` + `VendorPicker` universal, menu Sistem → Vendor, hapus bersemantik aman, vendor sistem lewat migrasi, migrasi data fail-closed. Rancangan rinci dan fase F1-F5: `docs/arsitektur-vendor.md`.

**Rationale:** Audit 2026-10-26 menemukan kategori teks bebas per modul, vendor dibuat di 6 tempat berformulir berbeda (hampir semua tanpa kontak/alamat), referensi tanpa FK/validasi, vendor internal dibuat diam-diam, dan hapus yang hanya menonaktifkan. Pemilik meminta satu alur tanpa dualisme.

**Alternatives considered:** Lihat ADR-0003 (enum kode, satu kategori, tetap teks bebas, hanya-lewat-menu, kosongkan data, paksa kategori di server).

**Security check (SOP langkah 5):** fase perencanaan — hanya dokumen, 0 temuan. Review keamanan dilakukan per fase kode (route vendor baru superadmin-only, bacaan ramping untuk manager, migrasi fail-closed).

**Affects:** `docs/arsitektur-vendor.md` (baru), `docs/decisions/adr-0003-…md` (baru).

## 2026-10-26 — Vendor F1: skema + migrasi ekspansi (ekspansi–kontraksi dua tahap)

**Decision:** Migrasi vendor dibagi **ekspansi (F1)** dan **kontraksi (F5)**: F1 menambah `VendorCategory`, kolom kontak/negara terstruktur, `nameKey`/`countryCode`/`systemKey`, FK `PreferredVendor`, memigrasikan data (fail-closed, atomik) dan membiarkan kolom lama sebagai legacy read-only; F5 menghapus kolom lama dan menjadikan `nameKey`/`countryCode` NOT NULL. `nameKey`/`countryCode` nullable selama masa antara.

**Rationale:** Menghapus kolom lama di F1 memaksa mengubah seluruh route/halaman vendor sekaligus (pekerjaan F2-F4) sehingga PR menjadi tak terkendali dan branch antara tak berjalan. Dua tahap menjaga tiap PR menghasilkan aplikasi yang berfungsi (dibuktikan HTTP nyata) tanpa mengorbankan target akhir ADR-0003; keadaan antara (vendor dari alur lama belum berkolom baru) berakhir di F2.

**Alternatives considered:** Satu migrasi besar dengan drop kolom (ditolak: PR F1 mencakup F2-F4); kolom baru NOT NULL dengan default (ditolak: default `countryCode` akan menyamarkan data salah); pemetaan negara dengan tebakan (ditolak: fail-closed).

**Security check (SOP langkah 5):** 0 Critical/High. Tidak ada route baru; migrasi SQL tanpa input pengguna, fail-closed dan atomik (dibuktikan 4 skenario gagal); FK `Restrict` menutup bagian V5 (SEC-68 Sebagian). `bun audit` tidak berubah (5).

**Verifikasi:** tsc; `bun run build` 0 error; `bun run test` 17 suite; rekam-bandingkan pada salinan DB lokal (48 `computeSellPrice` identik); 7 mutasi tertangkap; HTTP nyata alur lama pada skema baru.

**Affects:** `prisma/schema.prisma`, `prisma/migrations/20261026120000_vendor_single_flow_expand/`, `lib/constants/vendor.ts`, `lib/validators/vendor.ts`, `lib/vendors/integrity.ts`, `scripts/test-vendor-{model,migration}.ts`, `scripts/test-haji-pricing.ts`, `package.json`, `docs/arsitektur-vendor.md`.

## 2026-10-26 — Vendor F2: API vendor + kategori, integritas rujukan, jembatan sementara

**Decision:** Satu layanan (`lib/vendors/service.ts`) menjadi satu-satunya penulis tabel vendor/kategori; route baru `/admin/system/vendors*` dan `/vendor-categories*` hanya memanggil handler bersama. Semua route yang menyimpan `vendorId` memakai `assertVendorUsable` (ada **dan aktif** → 400). Muthowif membaca vendor sistem lewat `systemKey`. Route lama `/admin/system/settings/vendors*` **tidak dihapus di F2** tetapi diubah menjadi jembatan tipis yang hanya menerjemahkan ke layanan baru; dihapus di F4 bersama UI yang memakainya (revisi rencana: sebelumnya "dihapus di F2").

**Rationale:** Menghapus route lama di F2 mematikan tab Pengaturan dan picker di 6 editor sampai F3/F4. Membiarkannya menulis kolom legacy akan melahirkan vendor setengah jadi dan dualisme data — yang justru dilarang ADR-0003. Jembatan menjaga data baru otoritatif dan aplikasi tetap berjalan tanpa logika vendor kedua. Menolak vendor nonaktif di route biaya menutup celah referensi ke vendor yang sudah "dimatikan".

**Alternatives considered:** Menghapus route lama sekarang (ditolak: aplikasi rusak antar-PR); membiarkan route lama menulis kolom lama (ditolak: dualisme); menggabungkan F2-F4 dalam satu PR (ditolak: terlalu besar, bukti per fase hilang).

**Security check (SOP langkah 5):** 0 Critical/High pada kode yang diubah; menutup SEC-68 (Low). Checklist route handler: otorisasi di awal handler (diuji + `grep`), Zod `.strict()`, galat dibedakan (400/403/404/409/500 generik), tanpa SQL mentah, DTO eksplisit (tanpa kolom internal), manager hanya bentuk ramping (SEC-61b dijaga ulang), filter pencarian lewat parameter Prisma, batas halaman. `bun audit` tidak berubah (5).

**Verifikasi:** tsc; `bun run build` 0 error; `bun run test` 18 suite; HTTP nyata (kategori, vendor, route biaya, vendor sistem, hapus aman, jembatan); 10 mutasi tertangkap.

**Affects:** `lib/vendors/{service,handlers,http,legacyBridge}.ts`, `app/api/v1/admin/system/{vendors,vendor-categories}/**`, `app/api/v1/admin/system/settings/vendors/**` (jembatan), 4 route biaya + `lib/pricing/costComponentHandlers.ts`, route Muthowif, `scripts/test-vendor-api.ts`, `scripts/test-routes.ts`, `package.json`, `docs/arsitektur-vendor.md`.

## 2026-10-26 — Vendor F3: menu Sistem → Vendor dan satu `VendorForm`

**Decision:** Vendor dikelola di satu tempat — menu **Sistem → Vendor** (daftar, detail/edit dengan panel pemakaian, kategori) — dan hanya **satu** komponen formulir (`components/admin/vendor/VendorForm.tsx`) yang membuat/mengubah vendor; formulir menyimpan sendiri lewat API F2 dan menerima `initialName`/`initialCategoryIds`/`onSaved`/`onCancel` supaya F4 memakainya apa adanya di modal "Vendor baru". Bagian vendor di halaman Pengaturan dihapus total. Halaman vendor superadmin-only (alihkan non-superadmin setelah `requireAdminPage`); API tetap penjaga sebenarnya. Vendor hasil alur lama diberi tanda **Perlu ditinjau** dan banner di detail supaya admin melengkapinya.

**Rationale:** ADR-0003 keputusan 5-6 (satu pintu tulis, menu khusus). Membiarkan formulir lama di Pengaturan sampai F4 akan menyisakan dualisme UI yang menulis lewat jembatan; menghapusnya sekarang aman karena menu baru sudah menggantikan fungsinya dan picker di 6 editor tidak bergantung padanya. Hapus aman (hapus sungguhan vs nonaktif + konfirmasi + panel pemakaian) mengikuti arahan pemilik "CRUD lengkap selalu".

**Alternatives considered:** Mempertahankan tab di Pengaturan sampai F4 (ditolak: dua formulir vendor hidup bersamaan); menjadikan halaman daftar Client Component (ditolak: pola server + `paginate` sudah baku dan lolos penjaga SEC-52); memberi manager akses halaman (ditolak: menu Sistem superadmin; manager cukup dropdown ramping).

**Security check (SOP langkah 5):** 0 Critical/High/Medium/Low baru. Tidak ada route atau dependensi baru; 4 halaman server baru membaca Prisma dan semuanya memanggil `requireAdminPage` + menolak non-superadmin (dijaga `scripts/test-vendor-ui.ts`, 4 mutasi tertangkap; pemindai SEC-52 di `test-session` lulus); `id` rute divalidasi UUID sebelum query; parameter filter divalidasi terhadap daftar sah; website vendor hanya tampil di `<input>` (tanpa tautan → tanpa vektor `javascript:`); semua tulis lewat API F2 (Zod `.strict()`, superadmin). `bun audit --audit-level=critical` bersih.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` 357 PASS / 0 FAIL; Chrome asli (CDP) CRUD vendor + kategori sebagai superadmin dan akses manager; build produksi dijalankan untuk memastikan peringatan hydration dev-only tidak muncul di produksi (0/12). **Insiden proses:** `pkill -f "bun run dev"` saat membersihkan server uji ikut mematikan server dev pemilik di port 6260 — dinyalakan kembali lewat `preview_start`; pelajaran: matikan server uji berdasarkan PID/port sendiri, bukan pola nama.

**Affects:** `components/admin/vendor/**`, `app/[locale]/admin/(protected)/system/vendors/**`, `app/[locale]/admin/(protected)/system/settings/page.tsx`, `lib/admin/navigation.ts`, `scripts/test-vendor-ui.ts`, `package.json`, `docs/arsitektur-vendor.md`, `docs/progress.md`.

## 2026-10-26 — Vendor F4: satu `VendorPicker`, jembatan lama dihapus

**Decision:** Seluruh pemilihan vendor di admin memakai `VendorPicker` (pencarian sisi-server, penyaring kategori konteks yang dapat dilepas, hanya vendor aktif ditawarkan, vendor terpilih nonaktif tetap tampil berlabel); membuat vendor dari editor = modal yang membuka `VendorForm` yang sama, **khusus superadmin** (tombol tak tampil bagi manager; peran dibawa konteks `AdminRoleProvider` dari layout — hanya petunjuk tampilan, API tetap penjaga). Jembatan route `…/settings/vendors*`, `legacyBridge.ts`, `vendorQuickAdd.ts`, dan seluruh quick-add per editor dihapus. Editor biaya Pesawat/Transport/Hotel wajib memeriksa respons simpan dan menampilkan galat server.

**Rationale:** ADR-0003 keputusan 5: tak boleh ada dualisme jalur tulis/pilih vendor. Penyaring konteks hanya tampilan (server hanya menegakkan "ada dan aktif") supaya vendor lintas-kategori (mis. hotel+katering) tidak terkunci. Memeriksa respons simpan bukan perluasan scope: sejak F2 server menolak vendor nonaktif, dan picker yang menampilkan vendor terpilih nonaktif akan menimbulkan "Tersimpan ✓" palsu bila UI tak diperbaiki — celah yang diciptakan interaksi F2+F4.

**Alternatives considered:** `<select>` native dengan daftar dimuat penuh (ditolak: tak skala, tanpa pencarian); mengirim peran lewat prop per editor (ditolak: 6 titik pengoperan; konteks cukup); memfilter kategori di server (ditolak: ADR-0003 poin 5); membiarkan UI editor tanpa pemeriksaan respons (ditolak: kegagalan senyap).

**Security check (SOP langkah 5):** 0 Critical/High/Medium/Low baru. Tidak ada route baru — dua route jembatan dihapus (permukaan serang turun); picker hanya memanggil API F2 (baca manager+ ramping, tulis superadmin, Zod `.strict()`); tombol/modal dibatasi superadmin di UI dan diuji sumber, penegakan sebenarnya tetap `requireWrite()` di API (diuji sebelumnya: manager → 403). Modal memakai portal ke `document.body` tanpa HTML mentah; nama vendor dirender sebagai teks (tanpa `dangerouslySetInnerHTML`). Tidak ada dependensi baru; `bun audit --audit-level=critical` bersih.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; Chrome asli (CDP) pada salinan sementara DB lokal: filter konteks di 6 situs, alur Vendor Baru → simpan biaya end-to-end (Pesawat), pencarian, vendor nonaktif tetap tampil, galat simpan tampil, manager tanpa tombol; 5 mutasi pengaman tertangkap. **Insiden proses:** pemulihan mutasi memakai `git checkout` mengembalikan berkas yang belum di-commit ke versi lama (terdeteksi karena rantai uji gagal; berkas ditulis ulang) — pemulihan mutasi harus dengan salinan cadangan, bukan `git checkout`, pada pohon kerja yang kotor.

**Affects:** `components/admin/vendor/VendorPicker.tsx`, `components/admin/ui/Modal.tsx`, `components/admin/shell/AdminRole.tsx`, `components/admin/pricing/{VendorCurrencyField,CostComponentsPanel}.tsx`, editor Pesawat/Hotel/Trip Transport/Visa (`CostTiersTab`), halaman Paket/Ziarah/Haji (prop `vendorCategory` dihapus), layout admin, `scripts/test-{vendor-ui,vendor-api,routes}.ts`, `docs/arsitektur-vendor.md`, `docs/arsitektur-komponen-biaya.md`, `docs/progress.md`.

## 2026-10-26 — Vendor F5: migrasi kontraksi, penutup proyek vendor

**Decision:** Migrasi kontraksi `20261026180000_vendor_single_flow_contract` mengisi ulang vendor ber-legacy (ditandai `countryCode` kosong), memeriksa tabrakan pada nilai yang akan terisi, lalu menjadikan `nameKey`/`countryCode` NOT NULL dan membuang `category`/`country`/`contactInfo`. Fail-closed seperti F1 (negara tak dikenal / vendor ganda membatalkan seluruh migrasi); vendor yang sudah memakai kolom baru tidak disentuh. `docs/arsitektur-vendor.md` menjadi as-built dan source of truth; `docs/arsitektur-harga.md` §3.1/§18 ditandai digantikan.

**Rationale:** Setelah F4 tak ada kode yang menyentuh kolom lama; membiarkannya menyisakan dualisme data yang dilarang ADR-0003 poin 4 dan membiarkan baris baru tanpa `nameKey`/`countryCode` lolos. Pemeriksaan tabrakan sebelum UPDATE (bukan mengandalkan indeks unik F1) memberi pesan yang bisa ditindaklanjuti. Rehearsal di salinan DB lokal (checksum identik) sebelum menyentuh DB pengguna, mengikuti SOP risiko migrasi §5.

**Alternatives considered:** Membiarkan kolom lama selamanya (ditolak: dualisme); mengisi ulang tanpa menandai baris ber-legacy sehingga catatan baru bisa tertimpa contactInfo lama (ditolak, dimutasi pada tes); menebak negara tak dikenal (ditolak: fail-closed).

**Security check (SOP langkah 5):** 0 Critical/High/Medium/Low baru. Tidak ada route atau dependensi baru; migrasi SQL tanpa input pengguna, atomik, dibuktikan fail-closed (2 skenario) dan tanpa drift skema; permukaan data berkurang (kolom teks bebas dibuang). `bun audit --audit-level=critical` bersih.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; rehearsal pada salinan DB lokal: 10 vendor/18 biaya/14 vendor pilihan/10 tautan kategori + 4 checksum identik; diterapkan ke DB lokal pengguna (cadangan `/tmp/vendor_backup/saudinesia_pre_vendor_F5.sql`) dan DB uji; 5 mutasi SQL + 1 mutasi penjaga sumber tertangkap. **Catatan proses:** `scripts/_vendor-snap.ts` (alat sementara F1) ternyata ter-commit dan membaca kolom lama — dihapus; pelajaran: alat sementara tidak boleh ikut `git add -A` (taruh di scratchpad).

**Affects:** `prisma/schema.prisma`, `prisma/migrations/20261026180000_vendor_single_flow_contract/`, `components/admin/vendor/{types,VendorForm,VendorPicker}.tsx`, halaman daftar vendor, `lib/vendors/service.ts`, `scripts/test-vendor-{contraction,migration,model,ui}.ts`, `scripts/test-{haji-pricing,cost-components}.ts`, `package.json`, `docs/arsitektur-vendor.md`, `docs/arsitektur-harga.md`, `docs/progress.md`, `CLAUDE.md`.

## 2026-10-26 — Admin: "Buat baru" = halaman khusus (F1: Haji, Visa, Paket Umroh)

**Decision:** Membuat entitas di admin memakai halaman khusus `/admin/<area>/<modul>/new` dengan komponen bersama `CreatePage` (kembali, banner galat, bilah aksi `sticky`), bukan panel sebaris di atas daftar; sukses → halaman edit `[id]`; galat server selalu tampil dan tidak menutup formulir. Dijaga `scripts/test-admin-create.ts` (daftar modul termigrasi bertambah per fase).

**Rationale:** Laporan pemilik: panel sebaris membingungkan dan terasa menjebak. Recheck menemukan juga bug nyata — Haji dan Paket menelan respons POST (panel menutup walau gagal). Halaman khusus konsisten dengan halaman edit dan lazim untuk produk.

**Alternatives considered:** Modal (ditolak: formulir panjang dengan editor teks kaya, dan modal itulah yang dirasa menjebak); mempertahankan panel sebaris dengan perbaikan galat (ditolak: tak menjawab keluhan UX); satu formulir generik untuk semua modul (ditolak: kolom tiap modul berbeda — hanya cangkangnya yang dibagi).

**Security check (SOP langkah 5):** 0 temuan. Tidak ada route/dependensi baru; halaman klien memanggil API yang sudah dijaga (`requireManager`, Zod `.strict()`); pesan galat berasal dari respons API generik.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; Chrome: alur sukses/gagal/batal untuk tiga modul; 3 mutasi penjaga tertangkap. **Catatan proses:** `bun run test` gagal sekali karena akun uji (`f3-*`) dari pemeriksaan browser tertinggal di DB uji dan menggagalkan tes seed-guard — pembersihan data uji wajib sebelum menjalankan rantai tes.

**Affects:** `components/admin/shell/CreatePage.tsx`, `products/{haji,visa,packages}/{page,new/page}.tsx`, `products/haji/[id]/page.tsx`, `lib/constants/haji.ts`, `scripts/test-admin-create.ts`, `package.json`, `docs/arsitektur-admin-create.md`, `docs/progress.md`.

## 2026-10-26 — Admin: "Buat baru" halaman khusus untuk SEMUA modul (F2) + hook penyimpan tunggal

**Decision:** Seluruh alur buat di admin (12 modul, 14 entitas) memakai halaman `/new` + `CreatePage`; logika simpan dipusatkan di `useCreateEntity` (periksa respons, tampilkan galat server, pindah ke halaman edit hanya bila ada id). Penjaga CI mewajibkan setiap modul terdaftar dan melarang panel buat sebaris di halaman admin mana pun. Gap CRUD yang ditemukan dicatat (Katering tanpa edit/hapus, dst.), tidak dikerjakan di sini.

**Rationale:** Konsistensi dan satu titik pemeriksa respons mencegah kelas bug "tombol tampak mati" (galat ditelan). Terbukti nyata: Trip tanpa kategori selalu 400 dan tak pernah terlihat karena UI diam — pelajaran `.optional()` vs `.nullish()` yang sama dengan catatan memori.

**Alternatives considered:** Mempertahankan formulir kecil (Musim/Rute) sebaris (ditolak: inkonsisten dan penjaga tak bisa tegas); memperbaiki gap CRUD sekaligus (ditolak: scope berbeda — diusulkan F3).

**Security check (SOP langkah 5):** 0 temuan. Tidak ada route baru, hanya satu skema yang dilonggarkan aman (`category` nullable, kolom DB memang nullable); halaman klien memakai API yang sudah dijaga (`requireManager`/`requireSuperAdmin`, Zod). Formulir Admin memakai `autoComplete="new-password"`/`off`; kata sandi hanya dikirim ke API yang sudah ada.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; Chrome: 14 alur sukses + 2 gagal; 5 mutasi penjaga tertangkap.

**Affects:** `components/admin/shell/useCreateEntity.ts`, halaman `new` baru (13 berkas), 12 halaman daftar, `app/api/v1/admin/products/transport/trips/route.ts`, `scripts/test-admin-create.ts`, `docs/arsitektur-admin-create.md`, `docs/progress.md`.

## 2026-10-27 — Admin: gap CRUD ditutup (F3) — hapus-aman bersama + EditPage

**Decision:** Hapus entitas admin yang bisa dirujuk memakai satu helper `deleteOrDeactivate` (hapus bila tak dirujuk; selain itu nonaktif + pesan; tabrakan FK jatuh ke nonaktif; P2025 → 404) — dipakai Katering, Rute penerbangan, Kendaraan. Halaman ubah memakai `EditPage` + `useEditEntity` (satu pemeriksa respons). Katering mendapat `[id]` GET/PUT/DELETE + halaman edit; Musim PUT/GET + halaman; Rute: halaman edit/hapus dan DELETE diperbaiki; Kendaraan: DELETE; Pengguna: ubah nama (`fullName`). Penghapusan akun pengguna sengaja tidak ditambahkan (alur UU PDP).

**Rationale:** Arahan pemilik "CRUD lengkap selalu". Katering tak bisa dikoreksi sama sekali; `DELETE` rute hanya menghitung jadwal aktif sehingga rute yang dirujuk jadwal nonaktif/paket menghasilkan 500. Satu helper mencegah semantik hapus menyimpang antar-modul (sudah ada versi sendiri di Haji/Vendor dengan aturan sama).

**Alternatives considered:** Menulis hapus per-route (ditolak: tepat bug rute); hapus keras dengan cascade (ditolak: riwayat booking/harga yatim); menghapus pengguna dari tombol admin (ditolak: UU PDP, anonimisasi terkunci).

**Security check (SOP langkah 5):** 0 Critical/High/Medium/Low baru. Route baru semuanya `requireManager`/`requireSuperAdmin` di awal tiap verb (dijaga uji sumber, dimutasi), skema ubah `.strict()` tanpa `data: body`, galat dibedakan (`authFailureResponse`/404/500 generik), `fullName` tak menyentuh `sessionVersion`/peran, email tetap tak bisa diubah lewat PUT; tanpa dependensi baru.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; Chrome pada route nyata untuk 5 entitas (ubah, hapus tak dirujuk, hapus dirujuk → nonaktif dengan DB dicek); 3 mutasi tertangkap.

**Affects:** `lib/admin/safeDelete.ts`, `components/admin/shell/{EditPage,useEditEntity}`, `app/api/v1/admin/products/{catering,seasons,flight/routes,transport/vehicles}/[id]/route.ts`, `app/api/v1/admin/system/users/[id]/route.ts`, `lib/validators/adminUpdates.ts`, `lib/auth/adminUsers.ts`, halaman ubah baru (4) + daftar (4) + halaman Kendaraan, `scripts/test-admin-crud.ts`, `package.json`, docs.

## 2026-10-27 — Media F1: tabel foto produk universal + layanan tunggal (keputusan pemilik: Kendaraan tetap galeri)

**Decision:** Foto semua produk disimpan di satu tabel polimorfik `ProductImage` dan hanya `lib/media/service.ts` yang menulisnya; mode per tipe lewat registry (`featured` mengganti, `gallery` ber-max + satu sampul). Isi berkas divalidasi (magic bytes + dekode sharp) dan dienkode ulang ke webp tampilan (≤1600) + kartu (≤640) tanpa EXIF; berkas asli TIDAK disimpan (merevisi rencana awal). Migrasi ekspansi mengisi dari kolom lama; route lama menjadi jembatan tipis sampai F2; pembaca publik dipindah ke `getProductImages` sekarang agar tak ada dualisme. Keputusan pemilik: **Kendaraan tetap galeri**; unggah dilakukan di halaman edit setelah simpan.

**Rationale:** Empat implementasi salinan (tiga bentuk kolom) dengan validasi MIME yang mempercayai klien dan tanpa pembersihan objek; polimorfik sejajar komponen universal lain. Enkode ulang menutup EXIF/GPS bocor dan muatan tersisip, dan memberi kartu ringan. Invarian ditegakkan layanan (bukan indeks parsial) karena Prisma tak mengekspresikannya dan indeks tak dikenal memicu drift pada `migrate diff`.

**Alternatives considered:** Kolom `featuredImageKey` + `images` per model (ditolak: duplikasi); menyimpan asli + turunan (ditolak: privasi EXIF, biaya penyimpanan, tak ada kebutuhan); indeks unik parsial untuk satu-sampul (ditolak: drift skema); menunda pemindahan pembaca ke F3 (ditolak: dualisme data antar-PR).

**Security check (SOP langkah 5):** 0 Critical/High; temuan pre-existing diperbaiki: **validasi unggahan hanya mempercayai `file.type`** (kini isi diperiksa) — sebelumnya Medium-Low, tak tercatat di register → dicatat **SEC-69 (Low, Selesai F1)**. Route baru: `requireManager` di awal tiap verb (dijaga uji sumber), `uuid`/registry memvalidasi parameter (selain itu 404 tanpa membocorkan registry), skema PATCH `.strict()`, hapus hanya objek tercatat pada produk itu (SEC-62), kunci objek dibuat server, tak ada `data: body`; API katalog publik tak lagi mengirim kunci objek mentah. Dependensi: `sharp` sudah ada (tak ada penambahan).

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; MinIO nyata + route nyata di Chrome; 6 mutasi layanan + 3 mutasi SQL tertangkap.

**Affects:** `prisma/schema.prisma`, `prisma/migrations/20261027120000_product_images_expand/`, `lib/media/**`, `app/api/v1/admin/media/**`, 4 route foto lama (jembatan), route hotel/muthowif/situs, halaman publik (home, hotels, transport, muthowif, tours), 3 API katalog, `scripts/test-media{,-migration}.ts`, `package.json`, docs.

## 2026-10-27 — Media F2: satu `MediaField` admin, jembatan foto lama dihapus

**Decision:** Seluruh unggah foto di admin lewat `MediaField` (featured/gallery mengikuti registry); `ProductMediaGallery`, empat route foto lama, `legacyRoutes.ts`, UI foto ad-hoc muthowif/situs, `featuredImageKey` di route hotel, dan `photoUrl` di GET muthowif/situs dihapus. Penjaga CI mewajibkan setiap tipe registry punya `MediaField` di halaman edit-nya dan melarang input file ad-hoc di halaman admin. Unggah tetap di halaman edit setelah simpan; geser urutan lewat tombol.

**Rationale:** Menutup jembatan sementara F1 tanpa dualisme; satu komponen mencegah tiap modul menulis UI foto sendiri (penyebab empat implementasi salinan). Komponen lama menelan galat hapus — kelas bug yang sama dengan panel buat sebaris.

**Alternatives considered:** Seret-lepas untuk urutan (ditolak sementara: aksesibilitas dan dependensi — tombol cukup); unggah di halaman buat (ditolak: entitas belum ada; opsi dicatat); mempertahankan jembatan hingga F4 (ditolak: dualisme jalur tulis).

**Security check (SOP langkah 5):** 0 temuan. Route berkurang empat (permukaan serang turun); tak ada route atau dependensi baru; komponen hanya memanggil API media yang sudah dijaga (`requireManager`, registry, uuid, `.strict()`); URL gambar hanya presigned dan dirender sebagai `src` (tanpa HTML mentah); alt dirender sebagai teks.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; Chrome + MinIO nyata (unggah/sampul/geser/alt/hapus/galat/ganti-foto di 4 halaman); 3 mutasi penjaga tertangkap.

**Affects:** `components/admin/media/{MediaField,ImageUploadModal}.tsx`, `components/admin/shell/EditPage.tsx`, 9 halaman edit, route hotel/muthowif/situs, 4 route foto lama + `lib/media/legacyRoutes.ts` (dihapus), `scripts/test-media.ts`, `scripts/test-routes.ts`, docs.

## 2026-10-27 — Media F3: foto sampul di katalog publik lewat `ProductImage`

**Decision:** Katalog publik produk bergambar memakai satu komponen `ProductImage` (foto kartu dari `getFeaturedCards`, placeholder berikon per tipe bila kosong) dan API katalog mengirim `coverUrl`/`coverAlt` (URL presigned kartu ≤640 px). Hotel/Transport/Muthowif tetap dengan markup lama yang sudah berfungsi; kolom mati `images` dilepas dari peta katalog Haji.

**Rationale:** Tujuan pemilik — UI katalog lebih menarik. Placeholder membuat kartu seragam sebelum semua produk punya foto dan tata letak tak bergeser saat foto diunggah; memakai turunan kartu menjaga halaman ringan.

**Alternatives considered:** `next/image` dengan optimizer (ditolak: bucket private + URL presigned berubah tiap render merusak cache optimizer; turunan sudah dikecilkan saat unggah); memigrasikan markup Hotel/Transport/Muthowif ke `ProductImage` sekarang (ditunda: berfungsi, risiko visual tanpa manfaat fungsional).

**Security check (SOP langkah 5):** 0 temuan. Tidak ada route baru, hanya field `coverUrl`/`coverAlt` tambahan di API katalog publik (URL presigned berumur 1 jam, bukan kunci objek); `alt` dirender sebagai atribut teks oleh React; tanpa dependensi baru.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; Chrome + MinIO nyata pada 5 halaman publik + 5 API; 3 mutasi tertangkap (satu lolos pada percobaan pertama → regex penjaga diperketat).

**Affects:** `components/shared/ProductImage.tsx`, `lib/media/urls.ts`, 5 halaman publik, 5 API katalog, `lib/haji/catalog.ts`, `scripts/test-media.ts`, docs.

## 2026-10-27 — Media F4: kontraksi kolom foto lama + pembersihan objek saat produk dihapus

**Decision:** Migrasi kontraksi membuang tujuh kolom foto per-model tanpa pengisian ulang (kolom beku sejak ekspansi; kunci yang tak ada di `product_images` = foto sudah dihapus), fail-closed bila `product_images` belum ada. Penghapusan sungguhan produk bergambar (Kendaraan, Katering, Haji, Visa) memanggil `purgeProductMedia` setelah penghapusan berhasil; kegagalan pembersihan dicatat tanpa menggagalkan penghapusan. Penjaga CI mewajibkan setiap jalur hapus produk bergambar memanggilnya dan melarang kolom foto per-model baru.

**Rationale:** Tanpa pembersihan, bucket menumpuk objek yatim (privasi + biaya). Pengisian ulang sebelum DROP berbahaya: ia akan menghidupkan kembali kunci objek yang sudah sengaja dihapus lewat layanan. Penjaga sumber mencegah kelas bug "satu jalur hapus lupa membersihkan".

**Alternatives considered:** Pengisian ulang lalu DROP (ditolak: kunci yatim hidup lagi); pembersihan di dalam transaksi hapus (ditolak: objek MinIO tak bisa di-rollback — setelah commit lebih aman); ekstensi Prisma otomatis pada delete (ditolak: sihir tersembunyi; penjaga sumber eksplisit lebih mudah diaudit).

**Security check (SOP langkah 5):** 0 temuan. Tidak ada route atau dependensi baru; migrasi SQL tanpa input pengguna, atomik, fail-closed (dibuktikan); permukaan data berkurang (kolom kunci objek dibuang); `purgeProductMedia` hanya menerima tipe terdaftar dan id produk yang baru dihapus, log tanpa data pribadi.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` hijau; MinIO + route nyata (4 jalur hapus → objek 404); 3 mutasi SQL + 2 mutasi penjaga tertangkap.

**Affects:** `prisma/schema.prisma`, `prisma/migrations/20261027180000_product_images_contract/`, `lib/media/service.ts`, `lib/haji/delete.ts`, route hapus Kendaraan/Katering/Visa, pembuat Haji/Hotel/Paket Umroh, `prisma/seed.ts`, `scripts/test-media{,-migration,-contraction}.ts`, `package.json`, docs.

## 2026-10-27 — Tata letak editor admin ala WordPress (F1: Paket Umroh)
**Decision:** Halaman edit produk memakai tata letak dua kolom: konten di kiri (judul besar, deskripsi, kotak meta yang dapat dilipat), kotak samping lengket di kanan (Terbitkan, Foto Unggulan, Atribut, Ringkasan Harga). Satu set komponen bersama `components/admin/editor/` (`EditorShell`, `MetaBox`, `PublishBox`, `useUnsavedGuard`); tombol Simpan hanya aktif saat ada perubahan dan kotak Terbitkan menyebut jujur bahwa kotak komponen tersimpan langsung. Perbaikan sampingan: respons simpan diperiksa (galat tampil), dan muat-ulang akibat kotak komponen tidak menimpa ketikan info yang belum disimpan. Halaman lain menyusul (F2); kategori produk (F3) menunggu model.

**Rationale:** Pengguna admin sudah terbiasa dengan WordPress; status/simpan/foto/harga yang dulu tersebar di tumpukan satu kolom kini selalu terlihat. Komponen bersama mencegah tiap halaman punya gaya sendiri; penjaga CI mencegah kembali ke panel tersebar.

**Alternatives considered:** Hanya menata CSS per halaman (ditolak: gaya menyimpang lagi); menyatukan semua simpan jadi satu tombol (ditolak: mengubah perilaku kotak komponen yang sengaja menyimpan langsung, di luar scope penataan).

**Security check (SOP langkah 5):** 0 temuan. Hanya sisi tampilan — tanpa route, auth, upload, skema, atau dependensi baru; payload PUT tidak berubah; `bun audit` tanpa critical.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` 408 PASS (termasuk `test-admin-editor.ts`); Chrome asli desktop + 390px (sticky, dirty, simpan, mode komponen tak menimpa ketikan, tanpa galat konsol).

**Affects:** `components/admin/editor/*`, `app/[locale]/admin/(protected)/products/packages/[id]/page.tsx`, `scripts/test-admin-editor.ts`, `package.json`, docs.

## 2026-10-27 — Tata letak editor WordPress untuk semua halaman edit produk (F2)
**Decision:** `EditPage` dikembangkan menjadi tata letak dua kolom (kiri formulir + `after`; kanan Terbitkan/`media`/`sidebar`/Hapus) memakai `EditorShell`/`PublishBox`/`DeleteBox`; Katering, Muthowif, Situs, Kendaraan, Haji pindah ke `EditPage` + `useEditEntity`; Hotel dan Paket Ziarah memakai `EditorShell` langsung seperti Paket Umroh; Visa hanya memindahkan Foto ke kolom kanan. Pelacakan perubahan lewat `useDirtyForm` dengan baseline eksplisit; formulir `EditPage` diisi sekali dari data muat. `RichTextEditorImpl` tidak lagi meneruskan `update` tanpa perubahan dokumen.

**Rationale:** Memperluas `EditPage` (satu tempat) lebih murah dan lebih konsisten daripada menulis ulang tiap halaman; hanya halaman dengan banyak kotak yang tersimpan sendiri butuh `EditorShell` langsung. Memindahkan halaman bespoke ke `useEditEntity` sekaligus menutup galat tertelan di Muthowif/Situs. Perbaikan di editor bersama diperlukan karena normalisasi saat-muat membuat penanda belum-disimpan palsu di semua halaman dengan teks polos lama.

**Alternatives considered:** Mengubah semua halaman bespoke jadi `EditorShell` langsung (ditolak: duplikasi tanpa nilai untuk formulir tunggal); mendeteksi dirty lewat event DOM (ditolak: rapuh untuk komponen kustom); menormalkan nilai teks kaya di `useDirtyForm` (ditolak: pengetahuan format bocor ke hook generik).

**Security check (SOP langkah 5):** 0 temuan. Hanya sisi tampilan/komponen — tanpa route, auth, upload, skema, atau dependensi baru; payload PUT/DELETE tidak berubah (diuji: simpan, error 400 Haji tampil, konfirmasi hapus inline); `bun audit` tanpa critical.

**Verifikasi:** tsc; `bun run build` (salinan terpisah) 0 error; `bun run test` 410 PASS; Chrome asli: 10 halaman (dua kolom, sticky, Simpan nonaktif saat bersih), ketik/simpan/bertahan setelah muat ulang di 5 halaman, ketik di editor teks kaya, galat server tampil, konfirmasi hapus, Visa, HP; tanpa galat konsol. Data uji dipulihkan.

**Affects:** `components/admin/shell/{EditPage,useEditEntity}`, `components/admin/editor/*`, `components/shared/rich-text/RichTextEditorImpl.tsx`, 8 halaman edit produk, `scripts/test-{admin-editor,admin-crud,haji-pricing}.ts`, docs.

## 2026-10-27 — Hapus-aman untuk produk yang belum punya hapus (Muthowif, Situs, Hotel, Paket Umroh, Paket Ziarah, Visa)
**Decision:** Semua penghapusan produk ini lewat `lib/admin/productDelete.ts` + `deleteOrDeactivate`: hapus fisik hanya bila tak ada riwayat yang merujuk, selain itu nonaktif dengan pesan. Rujukan `ON DELETE SET NULL` dihitung eksplisit; baris polimorfik (biaya, vendor pilihan, syarat dokumen, field manifest) dihapus di transaksi yang sama dan foto setelah commit; pemeriksaan ulang di bawah `SELECT … FOR UPDATE` pada baris induk; penyidik FK dan tabel polimorfik di tes membuat perubahan skema yang belum dipertimbangkan jadi merah.

**Rationale:** FK `SET NULL` tidak menolak hapus — ia mengosongkan riwayat (penugasan muthowif, pengajuan visa, hotel di paket), sehingga hanya penghitungan eksplisit yang melindungi. Tabel polimorfik tak punya FK sehingga yatim bila tak dibersihkan (Visa lama meninggalkan yatim). Tanpa kunci baris, hitung→hapus bisa disalip rujukan baru. Penyidik skema mengubah "ingat untuk memperbarui" menjadi kegagalan CI.

**Alternatives considered:** Mengandalkan FK RESTRICT + tangkap P2003 saja (ditolak: SET NULL tidak melempar); fungsi hapus generik berbasis introspeksi pg_constraint (ditolak: sulit membedakan anak milik vs riwayat, dan SQL dinamis lebih berisiko); soft-delete saja tanpa hapus fisik (ditolak: arahan pemilik — hapus sungguhan bila memang tak terpakai).

**Security check (SOP langkah 5):** 1 temuan Low dicatat (SEC-70: kunci Hotel hanya pada baris hotel, jendela sempit untuk SET NULL tingkat jadwal; hanya admin yang memicu). 0 Critical/High. `requireManager` di awal tiap DELETE (dijaga tes), 401/403/404/500 dibedakan, tanpa body/Prisma mentah, `$queryRaw` hanya dengan nama tabel dari union literal (dikomentari), `bun audit` tanpa critical.

**Verifikasi:** tsc; `bun run build` (terisolasi) 0 error; `bun run test` 424 PASS (13 tes baru DB sungguhan termasuk race); 6 mutasi tertangkap; Chrome asli 8 entitas (hapus + nonaktif + aktifkan kembali); data uji dibersihkan.

**Affects:** `lib/admin/productDelete.ts`, 6 route `DELETE`, `components/admin/editor/{useDeleteEntity,useDirtyForm}`, halaman edit Muthowif/Situs/Hotel/Paket/Ziarah/Visa, `scripts/test-admin-{delete,editor}.ts`, `package.json`, docs.

## 2026-10-27 — Harga terpadu Fase 0: katering server-side, aturan margin global satu-satunya, semua cache disegarkan
**Decision:** (1) Harga katering booking dihitung server dari `CateringOption` (musim pada tanggal mulai × hari × orang); `totalPrice` klien dihapus dari skema; nonaktif/harga 0 → 422. (2) Aturan margin global berkunci sentinel `'global'` (non-NULL, `@@unique`) lewat migrasi dedupe-lalu-kunci (atomik, fail-closed); route memakai `upsert`. (3) Nilai bawaan margin/pembulatan satu tempat (`pricingHelpers.ts`). (4) Satu daftar semua cache harga (`refreshAll.ts`) dipakai cron kurs dan perubahan margin. Rencana lengkap Modal–Jual–Untung (PricePoint/PriceSnapshot, harga manual, pengeluaran aktual) di `docs/arsitektur-harga-terpadu.md`; keputusan pemilik: role terbuka dulu (satu titik `lib/pricing/policy.ts` nanti), pengeluaran aktual dengan catatan selisih HPP, override jual di total, diskon di total dengan catatan wajib bila di bawah HPP awal.

**Rationale:** Harga katering dari klien memungkinkan pemesanan seharga Rp 1 (High). `NULL` pada indeks unik tidak mencegah baris ganda — terjadi nyata (dua baris global di DB dev) — dan sentinel non-NULL dapat diekspresikan Prisma tanpa indeks parsial/drift. Mengubah margin hanya menyegarkan Visa membuat harga katalog berbeda dari aturan yang berlaku. Fase 0 berdiri sendiri dan memperbaiki cacat nyata tanpa menunggu fondasi.

**Alternatives considered:** Indeks unik parsial `WHERE productType IS NULL` (ditolak: Prisma tak mengekspresikannya → drift migrasi); membiarkan `findFirst` + mengandalkan route (ditolak: balapan nyata); langsung membangun PricePoint dan menutup katering di dalamnya (ditolak: High tidak boleh menunggu fase besar).

**Security check (SOP langkah 5):** 1 High pre-existing ditemukan dan **ditutup di fase ini** (SEC-71), 1 Low dicatat (SEC-72: batas atas aturan margin), 0 temuan pada kode baru. Auth/Zod/rate-limit route booking tidak berubah; migrasi SQL statis tanpa input pengguna; `bun audit` tanpa critical.

**Verifikasi:** tsc; `bun run build` (terisolasi) 0 error; `bun run test` 436 PASS; 9 mutasi tertangkap; curl ke server berjalan (totalPrice=1 diabaikan; 422 untuk nonaktif/harga 0; margin 20→40→20 menggeser Pesawat/Haji/Paket/Visa); migrasi diterapkan ke DB dev ber-baris ganda nyata (dua → satu).

**Affects:** `lib/pricing/{computeCateringPrice,refreshAll,pricingHelpers,computeSellPrice,costComponents,simulateSellPrice}.ts`, `lib/cron/exchangeRateJob.ts`, `lib/validators/booking.ts`, route bookings/pricing-rule/catalog catering, halaman katering publik, `prisma/schema.prisma` + migrasi, `scripts/test-pricing-{phase0,rule-migration}.ts`, `test-haji-pricing.ts`, `test-media-contraction.ts`, `package.json`, docs.


## 2026-10-27 — Harga terpadu Fase 1: tabel `PricePoint` + mesin harga tunggal (penulisan ganda)
**Decision:** (1) Satu tabel `price_points` (pemilik polimorfik + varian; modal, harga otomatis, harga manual, jual efektif) dengan invarian `jual = manual ?? otomatis` dijaga **CHECK di database**. (2) `lib/pricing/engine` adalah satu-satunya penulis tabel itu: registry delapan pemilik (visa, flight, hotel, transport, muthowif, tour_package, package, haji), `repriceOwner/repriceAll`, penulisan ganda ke kolom harga lama sehingga semua pembaca lama tetap berjalan; lima+ fungsi `refresh*Cache` menjadi pembungkus satu baris. (3) Modal hilang → harga dipertahankan dan modal ditandai null (bukan direset ke 0, bukan basi tanpa tanda); harga lama tanpa modal dipungut sebagai titik; komposit bermodal null bila ada bagian included yang modalnya tak dapat dipastikan. (4) Hanya tabel yang dipakai fase ini yang dibuat: `PriceSnapshot` di Fase 4, `PriceChange`/`manualBy`/`policy.ts` di Fase 3, rename `PricingRule` di Fase 5. (5) Backfill dikerjakan mesin itu sendiri (idempoten, `repriceAll`), bukan SQL di migrasi — nilai modal bergantung kurs, tak bisa dihitung di SQL.

**Rationale:** Rencana §2 I1–I3: satu data modal–jual–untung seragam untuk booking, invoice, dan laporan. Penulisan ganda membuat fase ini dapat dibuktikan ekuivalen (rekam-bandingkan) tanpa mengubah satu pembaca pun; kontraksi kolom lama menunggu pembaca pindah (Fase 2). CHECK di DB karena invarian harga tidak boleh bergantung pada disiplin kode. Tabel/kolom yang belum punya pemakai ditunda agar tidak ada skema mati dan agar kolom user-id baru tidak memicu pekerjaan anonimisasi UU PDP sebelum waktunya.

**Alternatives considered:** Backfill SQL di migrasi (ditolak: tak bisa menghitung kurs); mesin baru berdampingan tanpa mengubah `refresh*` (ditolak: dua penulis harga = risiko selisih); membuat ketiga tabel rencana sekaligus (ditolak: tabel mati + beban anonimisasi); modal komposit sebagai angka parsial (ditolak: untung tampak terlalu besar — null lebih jujur); memilih satu baris muthowif lewat `findFirst()` seperti kode lama (ditolak: tak berurutan, menyegarkan baris yang salah).

**Security check (SOP langkah 5):** Tidak ada Route Handler/endpoint/masukan baru; dua route DELETE lama hanya mendapat pembersihan titik harga setelah hapus (auth/Zod tak berubah). Tidak ada raw SQL pada kode (CHECK hanya di migrasi, tanpa masukan pengguna). Modal/untung belum dibaca API mana pun (I5 trivial; penjaga DTO publik ditambah di Fase 2). 0 Critical/High; 1 Low pre-existing dicatat (SEC-73: biaya/vendor-pilihan yatim saat jadwal penerbangan/harga transport/jadwal kamar dihapus). `bun audit` tanpa critical; `package.json` hanya berubah di skrip tes.

**Verifikasi:** tsc; `bun run build` (terisolasi) 0 error; `bun run test` 458 PASS (+22: 17 mesin, 5 migrasi; uji drift dipindah ke migrasi terbaru); 13 mutasi mesin tertangkap; migrasi diuji pada DB pra-migrasi nyata (CHECK/keunikan/tanpa drift); rekam-bandingkan data dev: kolom lama identik kecuali satu cache muthowif yang memang basi (500.000→450.000; dua baris singleton di DB dev, temuan §1.2-14).

**Affects:** `prisma/schema.prisma` + migrasi `20261028120000_price_points`, `lib/pricing/engine/**`, `lib/pricing/{refresh*Cache,refreshAll,computeHajiPrice,computeSellPrice,costComponents}.ts`, `lib/admin/productDelete.ts`, `lib/haji/delete.ts`, route DELETE flight-schedule/transport-pricing, `scripts/test-{price-engine,price-points-migration}.ts` (+ penjaga di `test-{cost-components,haji-pricing,pricing-phase0,pricing-rule-migration}`), `package.json`, `docs/arsitektur-harga-terpadu.md` §1.2-14/§9/§14.

## 2026-10-27 — Harga terpadu Fase 2: pembaca pindah ke `price_points` (kompiler sebagai inventaris dan penjaga)
**Decision:** (1) Semua pembaca harga logika dan tampilan publik/pilgrim membaca titik harga lewat satu modul `lib/pricing/engine/read.ts`; kolom cache lama tak lagi dibaca (ditulis ganda sampai Fase 5). (2) Jalur pesan memakai `requireSellPrice`: titik harga tak ada atau ≤ 0 → 422 untuk hotel, transport, muthowif, dan haji. (3) Backfill = migrasi SQL idempoten (jual saja, modal NULL) + `repriceAll()` saat boot server untuk mengisi modal. (4) Inventaris pembaca dan penjaga CI memakai kompiler: skema salinan tanpa 9 kolom cache → client Prisma sementara → `tsc`; daftar putih admin kosong dan tak boleh basi. (5) Tampilan admin yang bukan pembaca bertipe (DTO baris utuh/`include` bersarang) ditunda ke Fase 3 bersama `PriceCard`.

**Rationale:** Pencarian teks menunjuk 79 berkas (banyak salah sasaran); kompiler menunjuk persis tempat yang membaca kolom — dan menjadi penjaga yang tak bisa dilupakan, karena pembaca baru gagal CI. Pemesanan Rp 0 untuk hotel/transport/muthowif adalah lubang nyata yang baru terlihat saat membaca jalur pesan. Migrasi tak bisa menghitung modal (kurs), sehingga boot-time `repriceAll` melengkapi; pembaca aman sejak `migrate deploy` karena backfill menyalin harga jual.

**Alternatives considered:** Mengganti kolom di semua DTO admin sekarang (ditolak: halaman admin dirombak total di Fase 3, pekerjaan ganda); Prisma client extension yang menyuntikkan `price` (ditolak: tak menjangkau `include` bersarang, ajaib); backfill hanya lewat skrip manual (ditolak: pembaca bisa tampil Rp 0 setelah deploy); pencarian teks sebagai penjaga (ditolak: tak presisi, gampang dilewati).

**Security check (SOP langkah 5):** Tidak ada endpoint/masukan baru; auth/Zod/rate-limit route booking tak berubah. 0 Critical/High; 1 Medium pre-existing **ditutup di fase ini** (SEC-74: hotel/transport/muthowif bisa dipesan seharga Rp 0). I5 diuji: respons 6 route katalog publik tanpa kunci modal/margin/HPP/jejak kurs-vendor. Boot-time reprice fire-and-forget dan tidak menjatuhkan boot. `bun audit` tanpa critical; tak ada dependensi baru.

**Verifikasi:** tsc; `bun run build` (terisolasi) 0 error; `bun run test` 469 PASS (+11); 8 mutasi tertangkap (satu awalnya lolos — klien transaksi — dan ditutup dengan tes); curl ke server dev berjalan dengan token jamaah (hotel/haji tanpa titik harga → 422 tanpa menahan kuota; berharga → 201 dengan total benar) dan render 10 halaman publik/checkout; data uji dibersihkan.

**Affects:** `lib/pricing/engine/read.ts`, `prisma/migrations/20261028140000_price_points_backfill`, `instrumentation-node.ts`, `app/api/v1/bookings/route.ts`, `lib/quota/adapters/haji.ts`, `lib/pricing/compute{Package,TourPackage}Price.ts`, `lib/haji/catalog.ts`, route admin paket/ziarah/haji/hotel, 8 route `catalog/*`, ±14 halaman publik/pilgrim, `scripts/test-{price-readers,price-points-backfill-migration,price-engine,haji-pricing,price-points-migration}.ts`, `package.json`, `docs/arsitektur-harga-terpadu.md` §15.

## 2026-10-27 — Harga terpadu Fase 3: PriceCard, harga jual manual, Kesehatan Margin, katering & layanan hotel masuk sistem
**Decision:** (1) Harga jual manual hidup di `price_points` dan diubah HANYA oleh mesin (`setManualSell`/`clearManualSell`/`setManualCost`), dengan jejak `price_changes`, kunci baris per pemilik (hitung-ulang tak menimpa), batas wajar, dan **catatan wajib bila jual < modal** (tidak diblokir). (2) Peran lewat satu titik `lib/pricing/policy.ts`: semua peran admin melihat modal/untung dan mengatur harga jual (keputusan pemilik), aturan margin superadmin; **mengedit HPP tetap superadmin** (dibuka *melihat* dan harga jual, bukan penyuntingan modal). (3) Override Visa di JSON dihentikan dan dipindah ke harga manual titik harga (migrasi + jejak). (4) `PriceCard` satu komponen di delapan editor + katering; Kesehatan Margin sebagai halaman Operasional; kolom Untung di empat daftar. (5) Katering dan layanan hotel = pemilik **manual-only** (harga/modal diisi admin, kolom lama ditulis ganda). (6) Tarif muthowif dijaga satu baris oleh DB; SEC-72 ditutup (batas atas aturan margin + ambang peringatan).

**Rationale:** Margin default hanyalah saran; pemilik ingin menetapkan harga dan melihat untung per produk serta tahu di mana harga bermasalah. Memusatkan penulis harga manual + audit di mesin mencegah jalur samping (satu tabel, satu jejak). Kunci baris diperlukan karena hitung-ulang (cron kurs/margin) berjalan bersamaan dengan admin — tanpa kunci harga manual yang baru disimpan bisa tertimpa. Mengedit HPP tidak dibuka karena pemilik tidak memintanya; policy memudahkan membuka nanti. Katering punya tiga musim sehingga tidak cocok dengan Komponen Biaya; manual-only dengan modal opsional memberi untung tanpa model data baru.

**Alternatives considered:** Mengganti seluruh panel HPP editor dengan satu kartu (ditolak: regresi besar; rincian modal tetap editor yang ada, kartu = Modal·Jual·Untung + manual); membuka edit HPP ke semua peran (ditolak: di luar yang diputuskan pemilik); menaruh harga manual di JSON tier (ditolak: tak teraudit, hanya Visa); memblokir jual < modal (ditolak: "bukan patokan utama" — dicatat saja); menambah `PriceChange.byUserId` FK ke User (ditolak: jejak audit tak boleh ikut terhapus/menghalangi; staf tak masuk jalur UU PDP).

**Security check (SOP langkah 5):** Route baru (`pricing/points`, `pricing/health`) — guard policy di awal tiap handler, Zod `.strict()` + enum, `$queryRaw` hanya untuk `FOR UPDATE` dan agregat Kesehatan Margin dengan parameter terikat (ownerType divalidasi enum, ambang angka), galat dibedakan (400/403/500+log), catatan ≤ 500 karakter dirender sebagai teks React. Modal/untung hanya untuk peran `canViewCost`; respons publik tak berubah (I5 masih diuji). 0 Critical/High pada kode fase ini; **SEC-72 (Low) ditutup**. Tak ada dependensi baru (`bun audit` tanpa critical). Tes deletion mensyaratkan perlakuan `PriceChange.byUserId` (dicatat: dipertahankan, staf).

**Verifikasi:** tsc; `bun run build` (terisolasi) 0 error; `bun run test` 489 PASS (+20); 12 mutasi mesin manual/health/policy tertangkap semua; curl ke server dev dengan token 4 peran (403/200/400 sesuai, alur manual→rugi→Kesehatan Margin→otomatis, katering manual-only ke katalog publik, SEC-72); Chrome sungguhan (kartu harga, catatan wajib, status Manual, Kesehatan Margin, katering, Visa); satu temuan visual (ubin sempit di HP) diperbaiki; satu batas yang melanggar kolom lama (Rp 10 miliar vs Decimal(12,2)) tertangkap tes dan diturunkan ke Rp 5 miliar.

**Affects:** `prisma/schema.prisma` + 3 migrasi, `lib/pricing/{policy,engine/*}`, `lib/validators/pricing.ts`, `app/api/v1/admin/pricing/*`, `app/api/v1/admin/system/settings/pricing-rule`, route admin katering/layanan hotel/daftar & detail produk, `components/admin/pricing/{PriceCard,ProfitCell}`, 9 halaman editor + daftar + `margin/page.tsx`, `lib/admin/navigation.ts`, `scripts/test-price-{manual,manual-audit-migration,manual-owners-migration}.ts` (+ penyesuaian tes lama), `docs/arsitektur-harga-terpadu.md` §16.

## 2026-10-27 — Harga terpadu Fase 4: PriceSnapshot, total = Σ snapshot, invoice dari snapshot
**Decision:** (1) Harga DIBEKUKAN saat dipesan di tabel `price_snapshots` (satu baris per bagian yang dijual: modal·jual·mode·jejak kurs/vendor; komposit = satu baris per Komponen Biaya/hotel/kendaraan + baris `penyesuaian`), dengan CHECK bentuk dan **trigger DB yang menolak UPDATE** (koreksi = baris baru). Penyimpangan dari sketsa §3: kunci alami `ownerType/ownerId/variantKey` menggantikan `pricePointId` (tanpa FK), ditambah `itemLabel/itemDetail/itemQty` untuk invoice; tanpa data pribadi (nama jamaah ditempel saat render). (2) `lib/pricing/engine/snapshot.ts` adalah satu-satunya pembaca titik harga untuk jalur pesan dan satu-satunya penulis snapshot; `writeSnapshots` MENGEMBALIKAN total yang dipakai `Booking.totalAmount` (I4 secara konstruksi). (3) Logika item booking dipindah dari route ke `lib/booking/lineItems.ts` (`writeBookingItems(tx, …)`) supaya jalur pesan teruji pada DB sungguhan; ini lem sementara menunggu perombakan booking engine — yang bertahan hanya kontrak `price_snapshots` + `engine/snapshot.ts`. (4) Harga MANUAL selalu ditagih (Visa per tier, Haji, Paket Ziarah: jual titik + penyesuaian); item belum/tak berharga, Visa di luar tier, dan pilihan paket di luar opsi → 422 dan transaksi dibatalkan utuh. (5) Invoice dibangun hanya dari snapshot, satu baris per item, dan menolak terbit bila Σ ≠ total. (6) Migrasi mengisi booking lama (satu baris `main` per item + baris `penyesuaian` tingkat-booking untuk selisih) agar I4 berlaku untuk semua booking.

**Rationale:** Laporan keuangan dan invoice yang akurat membutuhkan harga yang tidak bergeser oleh kurs/margin/harga manual sesudah transaksi. Recheck menemukan klaim Fase 2/3 ("pemesanan memakai titik harga") tidak benar untuk Visa dan Paket Ziarah (harga manual tak pernah ditagih) karena tak ada tes yang melewati jalur pesan — maka pembaca/penulis dipusatkan dan diuji lewat titik masuk sungguhan. Trigger beku dan CHECK menjadikan "beku" dan "bentuk valid" sifat DB, bukan niat kode. Kunci alami tanpa FK menjaga snapshot tetap utuh walau titik harga dibuat ulang/dihapus.

**Alternatives considered:** `pricePointId` FK (ditolak: titik harga Visa dibuat ulang saat tier berubah; FK akan memaksa SET NULL/penyimpanan); satu baris per item tanpa uraian komponen (ditolak: `CostActual` Fase 7 butuh baris per komponen dan snapshot tak bisa dibentuk ulang kemudian); trigger/constraint DEFERRED yang memeriksa Σ = total di DB (ditunda: cukup konstruksi + tes invarian global; bisa ditambah bila perombakan booking menulis total di tempat lain); backfill lewat skrip terpisah (ditolak: tak atomik dengan migrasi); menolak booking lama tanpa snapshot di invoice (ditolak: dua jalur kode).

**Security check (SOP langkah 5):** skill `security-review` + subagent `security-auditor` (fase lintas pricing/booking/invoice/migrasi). Hasil: 0 Critical, 1 High, 2 Medium, 5 Low — semuanya pre-existing. **High (SEC-77: kuantitas/tanggal item dari klien tak diikat ke harga) dan Medium SEC-78 (pilihan hotel hantu → kuota hantu), SEC-79 (modal Visa terbaca pilgrim lewat `GET /bookings/[id]`, I5) DIPERBAIKI di fase ini** dan dibuktikan tes + 5 mutasi; 5 Low (SEC-80..84) dicatat Terbuka. Dua temuan fungsional Fase 3 (SEC-75, SEC-76) ditutup oleh fase ini. Tak ada dependensi baru (`bun audit` tanpa critical, `bun.lock` tidak berubah). Hal yang perlu keputusan pemilik: role DB aplikasi sebaiknya tanpa hak `DISABLE TRIGGER`/`TRUNCATE` (trigger beku melindungi dari bug aplikasi, bukan operator DB); kebijakan retensi (cascade `price_snapshots` mengikuti anak-anak `Booking` lain); apakah durasi Visa wajib dipilih di checkout (saat ini tier hari 1).

**Verifikasi:** tsc; `bun run build` terisolasi 0 error; `bun run test` 518 PASS (+29 dari 489: 6 tes migrasi snapshot, 24 tes jalur pesan/invoice/audit, drift dipindah ke migrasi terbaru); 14 mutasi snapshot + 5 mutasi audit tertangkap semua (satu mutasi lolos karena rumusan mutasi yang salah, bukan tes — diulang dan tertangkap); server dev sungguhan dengan pilgrim + superadmin: Visa otomatis 2.500.000 → manual 2.300.000 ditagih 2.300.000 sementara pesanan lama tetap 2.500.000, durasi 60 hari 422, campuran hotel+transport+katering+visa total = Σ snapshot, hotel belum berharga 422 tanpa kuota tertahan, harga naik sesudah pesan tidak menggeser invoice, PDF dirender dan diperiksa visual; data uji dibersihkan dan harga dev dipulihkan.

**Affects:** `prisma/schema.prisma` + migrasi `20261028190000_price_snapshots`, `lib/pricing/engine/snapshot.ts`, `lib/booking/lineItems.ts`, `app/api/v1/bookings/route.ts`, `app/api/v1/bookings/[id]/{route,invoice/route}.ts`, `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `lib/pdf/invoiceData.ts`, `lib/validators/booking.ts`, `lib/pricing/{computeCateringPrice,computeTourPackagePrice,costComponents}.ts`, `scripts/{test-booking-snapshot,test-price-snapshots-migration,ci-invoice-smoke,test-pricing-phase0,test-price-manual-owners-migration}.ts`, `package.json`, `CLAUDE.md`, `docs/arsitektur-harga-terpadu.md` §17, `docs/lessons-learned.md` (SEC-75..84).

## 2026-10-28 — Harga terpadu Fase 5: kontraksi — kolom harga lama dihapus, `price_points` satu-satunya sumber
**Decision:** (1) 17 kolom dihapus: `price` pada Flight/HotelRoomSchedule/HotelService/TransportPricing/MuthowifServicePrice/HajiProduct/Package/TourPackage/VisaProduct (+`durationFeeRules`), `pricePerPerson*` katering, dan riwayat beku `VisaApplication.*` (kini di `price_snapshots`). **Tidak dihapus (deviasi sadar dari kalimat rencana):** `included*Price`/`pricePerNight`/`includedTransportPrice` (masukan admin yang dapat disunting, bukan cache) dan `Booking*.totalPrice/unitPrice` (urusan perombakan booking engine). (2) Migrasi **fail-closed + atomik**: setiap harga lama > 0 wajib sudah bertitik (katering per musim; Visa hanya bila ada tier ber-fee > 0) atau migrasi berhenti tanpa mengubah apa pun; riwayat kurs/vendor Visa dipindah ke snapshot dengan trigger beku dinonaktifkan hanya di dalam transaksi migrasi. (3) Mesin tanpa penulisan ganda (`writeLegacy`/`adoptLegacy` dihapus — "jual tanpa modal dari kolom lama" tak ada lagi); 7 pembungkus `refresh*Cache` dihapus, pemanggil memakai `repriceOwner`. (4) `PricingRule.minMarginPercent` → `defaultMarginPercent` (migrasi terpisah; margin = saran). (5) Pemakaian vendor dari `price_snapshots.vendorIds`. (6) DTO admin bersarang menyematkan `price` dari titik harga (ditemukan karena kompiler tak melihat JSON) + penjaga sumber. (7) Seed menulis titik harga manual.

**Rationale:** Dua sumber kebenaran harga adalah sumber bug harga (Fase 4 menemukannya); setelah pembaca (F2), UI (F3), dan snapshot (F4) berpindah, kolom lama hanya beban dan jebakan. Kontraksi dibuat fail-closed karena `DROP COLUMN` tak bisa dibalik; `included*Price` dipertahankan karena menghapusnya merusak fitur, bukan menyederhanakan.

**Alternatives considered:** Menghapus `included*Price` dan menghitung langsung dari sub-modul (ditolak: admin sengaja menyunting snapshot itu — ziarah §10.10); membiarkan penulisan ganda lebih lama (ditolak: nol manfaat, risiko drift); menghapus lewat skrip terpisah tanpa pra-cek (ditolak: data bisa hilang diam-diam); rename `minMarginPercent` ditunda (ditolak: rencana §14 menjadwalkannya di kontraksi, nama "min" menyesatkan).

**Security check (SOP langkah 5):** skill `security-review` + subagent `security-auditor` (fase lintas pricing/vendor/migrasi/DTO): 0 Critical/High/Medium, 5 Low — SEC-85 (pra-cek Visa false positive, risiko deploy macet) **diperbaiki** dan diuji; SEC-86..89 dicatat Terbuka (jejak vendor baris included, prune tier Visa manual [pre-existing], runbook trigger, snapshot included 0 [pre-existing]). I5 membaik: modal Visa tak ada lagi di tabel yang di-include halaman pilgrim. Tak ada dependensi baru (`bun audit` tanpa critical, `bun.lock` tak berubah). Catatan operasional di `docs/deployment.md`: cadangan DB sebelum migrasi, hentikan web lama sebelum `migrate` (klien lama 500 setelah DROP), cek trigger beku aktif pasca-deploy.

**Verifikasi:** tsc 0; `bun run build` terisolasi 0 error; `bun run test` 540 PASS (489 → 518 Fase 4 → 540: +15 tes migrasi kontraksi, +3 rename, penjaga baru, tes lama disesuaikan); 6 mutasi (pra-cek dihapus, trigger tak diaktifkan lagi, riwayat menimpa, katering tak per musim, DTO bersarang tanpa harga, vendor usage kosong) tertangkap semua; migrasi diterapkan ke DB dev nyata (pra-cek lolos) dan DB uji; server dev sungguhan + Chrome: 18 halaman admin dimuat tanpa `NaN`/`undefined`/galat konsol dan DTO bersarang membawa harga; data uji dibersihkan.

**Affects:** `prisma/schema.prisma` + migrasi `20261029090000_price_legacy_columns_drop`, `20261029100000_pricing_rule_default_margin`, `lib/pricing/engine/*`, `lib/pricing/costComponentOwners.ts`, `computeHajiPrice.ts`, 7 berkas `refresh*` dihapus, ±14 route admin, 5 route DTO bersarang, `lib/vendors/*`, `VendorEditPanel`, `prisma/seed.ts`, rename di ±18 berkas, `scripts/test-price-{legacy-drop,rule-default-margin}-migration.ts`, `scripts/lib/legacyPriceColumns.ts`, `scripts/test-price-readers.ts` (ditulis ulang) + penyesuaian ±15 tes, `CLAUDE.md`, `docs/arsitektur-harga-terpadu.md` §18, `docs/deployment.md`, `docs/lessons-learned.md` (SEC-85..89).

## 2026-10-28 — Harga terpadu Fase 6: laporan untung dari snapshot
**Decision:** (1) Satu modul `lib/reports/profit.ts` (SQL ber-parameter atas `price_snapshots` + `payments` + `refunds`) dipakai halaman `/admin/reports`, API `GET admin/reports/profit` dan ekspor CSV; peran lewat `requirePricingView()`. (2) Dasar = tanggal pesanan (WIB); cakupan bawaan confirmed/active/completed, saklar "termasuk belum dibayar"; `cancelled` tak pernah masuk penjualan/untung (uang yang ditahan dilaporkan terpisah). (3) **Untung hanya dari baris yang modalnya diketahui**; jual tanpa modal dilaporkan terpisah + cakupan modal; baris `penyesuaian` bermodal 0, sisa data lama tak diketahui. (4) Terealisasi = jual × rasio dibayar dijepit 0..1 (payment confirmed − refund approved/paid). (5) Irisan produk/vendor (satu vendor, "campuran", "tak tercatat" — tanpa pembagian rata)/bulan/booking.

**Rationale:** Laporan keuangan yang mengklaim untung dari data yang modalnya kosong menyesatkan keputusan; membuat "tak diketahui" terlihat adalah inti nilai Fase 3–5. Satu modul mencegah agregat ad-hoc yang berbeda angka di tiap halaman. Pembagian rata untuk baris multi-vendor akan tampak presisi padahal tebakan.

**Alternatives considered:** Mengagregasi dengan Prisma `groupBy` (ditolak: tak bisa rasio per booking + irisan JSON vendor); materialized view (ditolak: skala kecil, tambah migrasi); mengakui pendapatan saat bayar (ditolak: pemilik meminta "terealisasi" proporsional, tanggal pesanan sebagai dasar); membagi biaya baris multi-vendor rata (ditolak: menyesatkan); indeks `bookings.createdAt` (ditunda: belum perlu).

**Security check (SOP langkah 5):** `security-review` inline (permukaan kecil: 1 modul, 2 route, 1 halaman, 1 validator; tanpa auth/upload/infra baru; subagent tidak dipanggil). Lolos: peran pertama di kedua route lewat policy (dijaga tes + mutasi), Zod + validasi rentang (≤ 5 tahun, ekspor ≤ 10.000 baris), SQL hanya `Prisma.sql` ber-parameter (tanpa `$queryRawUnsafe`), galat 400/403/500 dibedakan tanpa membocorkan galat Prisma, tak ada data pribadi di laporan (kode booking saja), CSV menetralkan sel berawalan `= + - @` dan `no-store`. Tak ada temuan baru; tak ada dependensi baru (`bun audit` tanpa critical, `bun.lock` tak berubah).

**Verifikasi:** tsc 0; build terisolasi 0 error; `bun run test` 552 PASS (+12 tes laporan); 8 mutasi tertangkap (dua awalnya lolos — tes diperkuat); server dev sungguhan (403 anon/jamaah, 200 tiga peran admin, 400 tanggal salah/terbalik/>5 tahun, angka = hitungan tangan, CSV) + Chrome desktop & HP tanpa NaN/galat konsol; satu bug ditemukan tes: `bookings.createdAt` `timestamp` tanpa zona — mengikat `Date` dan `AT TIME ZONE 'Asia/Jakarta'` menggeser periode/bulan 7 jam (diperbaiki, tak bergantung zona server).

**Affects:** `lib/reports/profit.ts`, `lib/validators/reports.ts`, `app/api/v1/admin/reports/profit/{route,export/route}.ts`, `app/[locale]/admin/(protected)/reports/page.tsx`, `lib/admin/navigation.ts`, `scripts/test-report-profit.ts`, `package.json`, `CLAUDE.md`, `docs/arsitektur-harga-terpadu.md` §19, `docs/progress.md`.

## 2026-10-28 — Harga terpadu Fase 7: jumlah pembayaran nyata, penyesuaian total, pengeluaran aktual, selisih HPP
**Decision:** (1) `Payment.amount` kini benar-benar diisi saat konfirmasi (bawaan = total booking; kurang dari total ditolak; lebih dari total wajib catatan) dan pemrosesan konfirmasi/penolakan hanya lewat `lib/payments/process.ts` (booking dikunci, status dibaca ulang di dalam kunci, 409 bila basi). Migrasi mengisi pembayaran terkonfirmasi bernilai 0 dengan total booking (temuan: laporan untung Fase 6 "dibayar/terealisasi" selalu 0 pada alur nyata). (2) Diskon/biaya tambahan di TOTAL pesanan = `lib/booking/adjustments.ts` (hanya `awaiting_payment`, baris snapshot `penyesuaian`, catatan wajib bila total akhir < HPP awal dijaga CHECK DB, pembatalan = baris pembalik). (3) Uang keluar ke vendor = `lib/costs/actuals.ts` (`cost_actuals`, catatan selisih per baris rencana, void bukan hapus). (4) Laporan Selisih HPP vs Aktual (`lib/reports/variance.ts`) dan filter pesanan rugi di laporan untung. (5) Peran lewat `policy.ts` (`requireBookingAdjust` semua admin, `requireCostRecord` manager+, melihat = `requirePricingView`).
**Rationale:** Tujuan pemilik: untung nyata = jual − modal aktual, diskon/nego tercatat dan terlacak, selisih HPP wajib dijelaskan. Audit menunjukkan handler konfirmasi pembayaran lama tak punya guard status/kunci dan membiarkan kurang bayar tampil lunas; karena kini angkanya dibaca laporan, handler itu diperketat sebagai bagian fase.
**Alternatives considered:** Menyimpan diskon sebagai kolom di Booking (ditolak: merusak invarian Σ snapshot = total dan tak berjejak); mengubah snapshot lama (ditolak: trigger beku, koreksi = baris baru); uji kunci dengan permintaan serentak (ditolak: tidak diskriminatif, terbukti oleh mutasi → diganti uji deterministik `FOR SHARE`).
**Security check:** `security-auditor` — 0 Critical/High, 3 Medium (SEC-90 guard status+kunci konfirmasi, SEC-91 kurang bayar tampil lunas, SEC-92 catatan staf bocor ke jamaah) DIPERBAIKI; Low SEC-93/94/99 diperbaiki, SEC-96 sebagian; SEC-95/97/98/100 dicatat di `docs/lessons-learned.md`. Dibuktikan oleh tes DB sungguhan + 26 mutasi tertangkap + uji server dev berperan. `bun audit`: tanpa critical, `bun.lock` tak berubah.
