# Arsitektur — Data Jamaah Tersimpan + Komponen Dokumen Dinamis

> **Status: RENCANA DISETUJUI PEMILIK (2026-11-02) — keputusan Q1–Q12 (§2) dan konfirmasi C1–C3 (§14) final; fase §13 disetujui. Fase 1 (fondasi `lib/pii/`) SELESAI 2026-11-02 (§6 as-built); Fase 2–8 belum.** Keputusan struktural (identitas global berkunci NIK + salinan per akun) dicatat sebagai ADR-0005 di Fase 1.
>
> Dokumen ini akan menjadi source of truth untuk: jamaah tersimpan per akun, gudang identitas jamaah global, dokumen jamaah, serta pengajuan & verifikasi data jamaah. Ia **memperluas** `docs/arsitektur-manifest.md` (form per booking tetap ada sebagai snapshot), **menggantikan** model `Document` dan `DocumentRequirement.docType` teks bebas di `docs/arsitektur-dokumen.md`, dan wajib diselaraskan dengan `docs/arsitektur-hapus-akun.md` dan `docs/arsitektur-booking-engine-v2.md`.

---

## 1. Konteks bisnis (permintaan pemilik)

1. Akun punya **daftar jamaah tersimpan** — booking berikutnya cukup memilih, tidak mengetik ulang.
2. Satu **gudang jamaah global tanpa duplikat**: orang yang sama tetap satu, "hari ini masuk lewat jamaah B, besok lewat rombongan C, datanya satu". Penjaganya **NIK** (Nomor Induk Kependudukan — 16 digit, tercetak di KTP dan KK).
3. **Privasi**: pengguna hanya melihat jamaah yang ia input sendiri. Alur deteksi duplikat tidak boleh membocorkan keberadaan atau isi data orang lain.
4. Struktur database komprehensif, saling terikat, tahan sampai jutaan baris.
5. Pengguna bisa menjadi jamaah untuk dirinya sendiri.
6. Isi data jamaah: nama lengkap sesuai paspor, NIK, alamat lengkap (`Address`/`AddressPicker`), kontak (`ContactPicker`), tempat & tanggal lahir, dokumen.
7. **Dokumen dinamis seperti repeater**: tiap entri = label + berkas/foto. Admin menentukan dokumen apa yang wajib **per produk/jenis visa**; ada daftar bawaan (Paspor, KTP, KK, Tiket Pesawat PP, Bukti Reservasi Hotel, Bukti Reservasi Transportasi, Sertifikat Vaksin). Ikon Lucide, tanpa emoji.
8. **Verifikasi data oleh admin** (pola yang sudah dipakai di smart-ai, berkas architecture-pmb di repo smart-ai): setiap dokumen dinilai admin — diterima, atau ditolak bila tidak sesuai / sudah kedaluwarsa — dan pengguna memperbaiki lalu mengajukan ulang.

---

## 2. Keputusan pemilik (2026-11-02)

| # | Keputusan | Dampak rancangan |
|---|---|---|
| K1 | **NIK wajib** untuk setiap jamaah. | Formulir selalu meminta NIK; dedup murni oleh NIK (§4). |
| K2 | Tanpa NIK hanya **keadaan khusus: bayi**. | Kartu boleh tanpa NIK bila usia **< 2 tahun** menurut tanggal lahir (C1); kartu itu `unmatched`, dicocokkan admin. WNA didukung dengan kunci negara + nomor paspor (C2). |
| K3 | Data gudang boleh diisi dari input pertama; **tidak perlu verifikasi langsung di gudang** — verifikasi terjadi **saat pengguna mengajukan nama-nama jamaah** (untuk booking). | Tidak ada antrean verifikasi gudang. Pengajuan data jamaah per booking diverifikasi admin (§8); data yang lolos verifikasi memperbarui data kanonik identitas. |
| K4 | Membuka NIK/paspor utuh dan menggabungkan identitas: **admin dan manager boleh** (superadmin juga). | Semua peran staf, setiap pembukaan tercatat. |
| K5 | **Alur verifikasi dokumen oleh admin** seperti smart-ai: ditolak bila tidak sesuai atau kedaluwarsa. | Status per dokumen + alasan tolak + pengajuan ulang (§8). Paspor < 6 bulan diberi tanda otomatis untuk admin dan pengguna. |
| K6 | PNR diverifikasi **manual oleh admin**. | Hanya cek bentuk di server; keputusan di tangan admin. |
| K7 | "BRN" istilah internal, **tidak tampil ke publik**. Dokumen yang dibutuhkan **ditentukan admin per jenis visa/produk**; pengguna mengunggah per nama jamaah. | Tidak ada kondisi otomatis "bila tak pesan hotel" dan tidak ada istilah BRN di UI publik — cukup daftar syarat per produk (§7.3). Semua dokumen diunggah **per jamaah**. |
| K8 | Persetujuan cukup lewat dokumen yang diunggah; pengguna mengunggah dokumen miliknya. | Tidak ada kotak centang izin terpisah per jamaah (lihat catatan hukum §9). |
| K9 | Nomor paspor **dienkripsi** seperti NIK. | §6. |
| K10 | Kunci enkripsi terpisah + prosedur backup. | §6. |
| K11 | **Belum ada booking lama** — database jamaah dimulai baru. | Tidak ada migrasi data jamaah lama; model `Document` lama langsung diganti (§11). |
| K12 | Dokumen **tidak dihapus otomatis**; diganti hanya saat ada pembaruan (mis. paspor baru). Simpan **terkonversi ke WebP** supaya ringan. | Tanpa jadwal retensi; mengganti dokumen menghapus berkas lama (§7.4); gambar dienkode ulang ke WebP. Hak hapus akun (UU PDP) tetap berlaku. |

---

## 3. Hasil recheck dokumen vs kode (SOP Fase Eksekusi langkah 1, 2026-11-02)

Dicek: `prisma/schema.prisma`, `lib/manifest/*`, `lib/documents/getRequirements.ts`, `lib/booking/*` (drafts/create), `lib/validators/booking.ts`, `components/booking/ManifestFieldsForm.tsx`, `components/shared/{AddressPicker,ContactPicker}.tsx`, `lib/account/{deletion,erasureSweep}.ts`, `lib/storage/minio.ts`, `app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts`, `app/api/v1/admin/bookings/[id]/pilgrims/[pilgrimId]/route.ts`, `prisma/seed.ts`.

### 3.1 Yang akurat
- `ManifestFieldRequirement` (`schema.prisma:494`) dan `DocumentRequirement` (`:476`) polimorfik `productType`+`productId`, berindeks `(productType, productId)`.
- `BookingPilgrim` (`:834`) = `id`, `bookingId`, `userId?`, `isLeader`, `fieldValues Json`.
- Manifest `core` = 5 field (`prisma/seed.ts:387-391`); visa = 9 field.
- `lib/manifest/values.ts` (`validateFieldValues`, `completeness`) dipakai `PUT /admin/bookings/[id]/pilgrims/[pilgrimId]` (kunci baris, merge).
- Penghapusan akun: `fieldValues → {}`, `Document` + objek MinIO dihapus, draf dihapus, sapuan prefix `pilgrims/<id>/`.
- `Address` = tabel bersama, FK 1:1 per pemilik, `upsertAddress()` di `lib/address/prepare.ts`.
- `VisaProduct.requirements` (Json) masih dual-write dengan `DocumentRequirement`.

### 3.2 Drift / gap yang ditemukan

| # | Temuan | Lokasi | Ditangani |
|---|---|---|---|
| D1 | `fieldType='address'` masih teks bebas (dokumen manifest §3.1 menyebut dropdown berjenjang). | `ManifestFieldsForm.tsx`; `lib/manifest/values.ts` | F7 |
| D2 | `BookingPilgrim.userId` tanpa FK ke `users`. | `schema.prisma:837` | F2 |
| D3 | **Keamanan, pre-existing, Medium**: unggah dokumen mempercayai MIME dari klien (`file.type`) — tanpa cek isi (magic bytes), EXIF/GPS foto KTP/paspor tidak dibuang. | `documents/route.ts` → `validateUpload(file.type, …)` | Dicatat di `docs/lessons-learned.md` dan ditutup di F4 |
| D4 | Admin dilarang mengunggah dokumen atas nama jamaah (403), bertentangan dengan engine v2 "admin lebih dulu". | `documents/route.ts` POST | F4 |
| D5 | Fallback daftar keras `REQUIRED_DOCUMENTS` di luar `DocumentRequirement`. | `lib/constants/booking.ts:32` | F5 |
| D6 | Dokumen basi: `arsitektur-manifest.md` §8 (wizard, `PassportForm`, `lib/booking/draft.ts` — sudah dihapus); `arsitektur-komponen-kontak.md` (3 kolom kontak `BookingPilgrim` yang sudah di-drop). | dokumen | F8 (dirapikan) |
| D7 | `deleteObjectsByPrefix` hanya menerima `pilgrims/<uuid>/`. | `lib/storage/minio.ts:129` | F4 |
| D8 | Kelengkapan dokumen hanya dihitung dari visa jamaah. | `documents/route.ts` GET | F5 |
| D9 | Belum ada alur verifikasi dokumen: model `Document` tak punya status/penilai/alasan tolak. | `schema.prisma:886` | F4 (status) + F6 (alur) |

---

## 4. Inti rancangan: satu orang, satu identitas — banyak "kartu" milik masing-masing akun

"Datanya satu" dan "hanya melihat yang ia input sendiri" bertentangan bila diterapkan pada satu baris data yang sama — kalau B memilih orang yang diinput A lalu melihat isi baris itu, data A bocor. Maka dua lapis:

```
        ┌──────────────── gudang global (hanya staf) ────────────────┐
        │ PilgrimIdentity — satu baris per ORANG, unik = HMAC(NIK)   │
        │ data kanonik (dari pengajuan terakhir yang terverifikasi), │
        │ riwayat booking, semua kartu yang menautnya                │
        └──────▲───────────────────────▲───────────────────────▲──────┘
   akun A ─► SavedPilgrim (milik A)  akun B ─► SavedPilgrim (B)  akun C ─► SavedPilgrim (C)
               │ dokumen unggahan A           │ dokumen B                 │
               ▼                              ▼                           ▼
        BookingPilgrim (snapshot fieldValues + status pengajuan/verifikasi per booking)
```

- **`PilgrimIdentity`**: satu orang = satu baris, dijaga indeks unik hash NIK. Tidak pernah dikirim ke API jamaah.
- **`SavedPilgrim`** ("kartu"): isi persis yang diketik satu akun. Bila NIK cocok dengan identitas yang ada, kartu **ditautkan diam-diam** — pengguna tidak diberi tahu.
- **`BookingPilgrim`**: snapshot beku saat booking + status pengajuan dan verifikasi (§8).

### 4.1 Alur simpan kartu (`lib/pilgrims/service.ts`, satu-satunya penulis)
1. Validasi NIK: 16 digit; cek lunak — 2 digit provinsi ada di `address_provinces`, digit 7–12 = tanggal lahir DDMMYY (hari +40 untuk perempuan) dibandingkan dengan tanggal lahir & jenis kelamin yang diketik. Tidak cocok → **peringatan** di formulir (NIK hasil pindah domisili/lama bisa menyimpang), bukan penolakan. Tanpa NIK hanya bila bayi (K2).
2. `nikHash = HMAC-SHA256(kunciIndeks, nik)` (§6).
3. Dalam transaksi + `pg_advisory_xact_lock(hash)` (dua akun menyimpan NIK sama serentak → tetap satu identitas):
   - **Tak ada identitas** → buat `PilgrimIdentity` (data kanonik awal = input ini) + kartu `matched`.
   - **Ada, nama ternormalisasi + tanggal lahir cocok** → kartu ditautkan `matched`; data kanonik tidak ditimpa.
   - **Ada, tidak cocok** → kartu ditautkan `conflict` → terlihat oleh admin di gudang (dan saat memverifikasi pengajuan booking yang memakai kartu itu).
4. **Respons ke pengguna identik pada ketiga cabang** (bentuk, status, isi = kartunya sendiri; pekerjaan yang dilakukan sama). Tidak pernah ada pesan "sudah terdaftar".
5. Satu-satunya penolakan yang terlihat: NIK yang sama sudah ada di daftar **akun itu sendiri** — data miliknya sendiri, tidak membocorkan apa pun.

### 4.2 Kenapa ini menutup enumerasi
- Karena NIK selalu wajib (K1), formulir sama untuk semua orang — tidak ada cabang "minta NIK bila nama + alamat cocok" yang membocorkan bahwa seseorang terdaftar.
- Tidak ada endpoint pengguna yang hasilnya bergantung pada data akun lain; kartu B tidak pernah diisi dari data kanonik atau kartu A; dokumen A tidak pernah tampil di B.
- Rate limit pembuatan/ubah kartu per akun dan per IP (`LIMITS` di `lib/auth/rateLimit.ts`).
- Dibuktikan di F2 dengan **tes orakel**: respons untuk NIK baru, NIK milik akun lain, dan NIK konflik harus sama kecuali `id`/timestamp.

### 4.3 Kartu tanpa kunci, konflik, dan penggabungan (admin)
- Kartu bayi tanpa NIK (WNA memakai kunci paspor, C2) → admin melihat "kemungkinan duplikat" berdasarkan nama ternormalisasi + tanggal lahir, dan bisa menautkan ke identitas yang benar. Begitu bayi punya NIK, pengguna melengkapinya dan kartu tertaut otomatis.
- Konflik: admin menetapkan identitas yang benar atau melepas kartu ("NIK tidak sesuai" → kartu kembali `unmatched`, pengguna diminta memeriksa NIK lewat pesan generik tanpa menyebut ada orang lain).
- Gabung dua identitas, lepas kartu, buka NIK → dicatat di `PilgrimIdentityEvent` (append-only). Peran: admin, manager, superadmin (K4).

---

## 5. Model data usulan (Prisma)

Konvensi project dipertahankan: `String @id @default(uuid())`, PascalCase singular, camelCase, timestamp baru `@db.Timestamptz(3)`, tanggal kalender `@db.Date` (dibaca `calendarDateOf`), **setiap FK diberi `@@index`** (Postgres tidak membuat indeks FK otomatis).

```prisma
// ─── GUDANG IDENTITAS (hanya staf) ─────────────────────────────
model PilgrimIdentity {
  id              String    @id @default(uuid())
  nikHash         String?   @unique   // HMAC-SHA256(kunci indeks, NIK); null = bayi tanpa NIK / WNA
  nikCipher       String?             // AES-256-GCM berversi kunci — dibuka hanya lewat lib/pii, berjejak
  passportKeyHash String?   @unique   // HMAC(countryCode + nomor paspor) — kunci WNA (C2)
  // Data kanonik: awal = kartu pertama; diperbarui dari pengajuan yang lolos verifikasi (K3). Tak pernah ke API jamaah.
  fullName        String
  nameKey         String              // ternormalisasi (huruf kecil, tanpa gelar/tanda baca, spasi tunggal)
  gender          Gender?
  birthPlace      String?
  birthDate       DateTime? @db.Date
  nationality     String    @default("ID")
  lastVerifiedAt  DateTime? @db.Timestamptz(3)  // pengajuan terakhir yang terverifikasi
  createdAt       DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime  @updatedAt @db.Timestamptz(3)

  cards           SavedPilgrim[]
  bookingPilgrims BookingPilgrim[]
  events          PilgrimIdentityEvent[]

  @@index([nameKey, birthDate])       // kemungkinan duplikat (admin)
  @@map("pilgrim_identities")
}

// ─── KARTU JAMAAH MILIK AKUN ───────────────────────────────────
model SavedPilgrim {
  id               String      @id @default(uuid())
  ownerId          String
  identityId       String?
  matchStatus      PilgrimMatchStatus @default(unmatched)
  selfOfUserId     String?     @unique   // "Saya sendiri" — salinan ownerId hanya pada kartu diri (pola verifiedWhatsapp; Prisma tak punya unik parsial)
  fullName         String                // sesuai paspor
  nameKey          String
  nikHash          String?
  nikCipher        String?
  gender           Gender?
  birthPlace       String?
  birthDate        DateTime?   @db.Date
  nationality      String      @default("ID")
  passportCipher   String?               // K9
  passportLast4    String?
  passportKeyHash  String?
  passportIssuedAt DateTime?   @db.Date
  passportExpiry   DateTime?   @db.Date
  addressId        String?     @unique   // Address 1:1 milik kartu (pola arsitektur-alamat.md)
  phone            String?               // E.164 tanpa "+", bentuk sama ContactPicker / User
  whatsapp         String?
  email            String?
  createdById      String?               // staf bila dibuat atas nama pelanggan
  archivedAt       DateTime?   @db.Timestamptz(3)  // hapus-aman: kartu yang pernah dipakai booking diarsipkan
  createdAt        DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime    @updatedAt @db.Timestamptz(3)

  owner     User             @relation("SavedPilgrimOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  selfOf    User?            @relation("SavedPilgrimSelf", fields: [selfOfUserId], references: [id], onDelete: SetNull)
  identity  PilgrimIdentity? @relation(fields: [identityId], references: [id], onDelete: SetNull)
  address   Address?         @relation(fields: [addressId], references: [id], onDelete: SetNull)
  createdBy User?            @relation("SavedPilgrimCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  documents       PilgrimDocument[]
  bookingPilgrims BookingPilgrim[]

  @@unique([ownerId, nikHash])            // NIK sama dua kali di daftar sendiri ditolak (NULL tak bentrok)
  @@unique([ownerId, passportKeyHash])
  @@index([ownerId, archivedAt, nameKey, id])   // "Jamaah Saya" berpaginasi + cari nama
  @@index([identityId])
  @@index([matchStatus, createdAt])
  @@index([createdById])
  @@map("saved_pilgrims")
}

enum PilgrimMatchStatus { matched conflict unmatched  @@map("pilgrim_match_status") }
enum Gender { male female  @@map("gender") }

model PilgrimIdentityEvent {    // append-only: linked | conflict | detached | merged | nik_revealed | canonical_updated
  id         String   @id @default(uuid())
  identityId String
  actorId    String?
  kind       String
  cardId     String?
  detail     Json?              // TANPA PII mentah (id, nama field yang berubah)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  identity PilgrimIdentity @relation(fields: [identityId], references: [id], onDelete: Cascade)
  @@index([identityId, createdAt])
  @@index([actorId])
  @@map("pilgrim_identity_events")
}

// ─── KATALOG JENIS DOKUMEN (admin CRUD, ada bawaan) ────────────
model DocumentType {
  id                String   @id @default(uuid())
  key               String   @unique   // 'passport' | 'ktp' | 'kk' | 'vaccine' | 'flight_ticket' | 'hotel_reservation' | 'transport_reservation' | 'other' | buatan admin
  label             String             // label publik — istilah internal (mis. BRN) tidak ditaruh di sini (K7)
  reusable          Boolean            // true = milik orang, dipakai ulang lintas booking (paspor/KTP/KK/vaksin); false = per perjalanan (tiket, reservasi)
  icon              String             // nama ikon Lucide dari daftar putih (lib/documents/icons.ts)
  hasExpiry         Boolean  @default(false)
  minValidityMonths Int?               // paspor: 6, dihitung dari tanggal berangkat (§8.3)
  referenceLabel    String?            // "Kode Booking (PNR)" — label publik
  referencePattern  String?            // bentuk, mis. ^[A-Z0-9]{6}$
  allowMultiple     Boolean  @default(false)  // tiket pergi & pulang terpisah
  isSystem          Boolean  @default(false)  // bawaan: hanya bisa dinonaktifkan
  isActive          Boolean  @default(true)
  order             Int      @default(0)
  createdAt         DateTime @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime @updatedAt @db.Timestamptz(3)

  requirements DocumentRequirement[]
  documents    PilgrimDocument[]
  @@map("document_types")
}

// DocumentRequirement (ada) — DIPERLUAS: rujuk katalog, bukan teks bebas. Admin memilih per produk/jenis visa (K7).
model DocumentRequirement {
  id             String  @id @default(uuid())
  productType    String
  productId      String
  documentTypeId String              // menggantikan `docType` teks
  label          String?             // override label per produk (null = label katalog)
  description    String  @default("") // petunjuk publik, mis. "scan halaman identitas, masih berlaku ≥ 6 bulan"
  required       Boolean @default(true)
  order          Int     @default(0)

  documentType DocumentType @relation(fields: [documentTypeId], references: [id], onDelete: Restrict)
  @@unique([productType, productId, documentTypeId])
  @@index([documentTypeId])
  @@map("document_requirements")
}

// ─── DOKUMEN JAMAAH (satu tabel untuk semua jenis, selalu per jamaah — K7) ─
model PilgrimDocument {
  id             String   @id @default(uuid())
  savedPilgrimId String
  bookingId      String?            // null = dokumen orang (reusable); terisi = dokumen perjalanan itu (tiket, reservasi)
  documentTypeId String
  label          String             // label katalog, atau label bebas untuk 'other' (repeater)
  referenceCode  String?            // PNR dsb. — cek bentuk server, diverifikasi manual admin (K6)
  objectKey      String   @unique   // kunci MinIO, BUKAN URL
  mimeType       String             // image/webp (hasil konversi) atau application/pdf
  sizeBytes      Int
  sha256         String
  issuedAt       DateTime? @db.Date
  expiresAt      DateTime? @db.Date
  status         DocumentReviewStatus @default(pending)
  rejectReason   DocumentRejectReason?
  reviewNote     String?            // catatan staf untuk pengguna (dibersihkan saat hapus akun)
  reviewedById   String?
  reviewedAt     DateTime? @db.Timestamptz(3)
  uploadedById   String             // pemilik akun atau staf (D4)
  createdAt      DateTime @default(now()) @db.Timestamptz(3)

  savedPilgrim SavedPilgrim @relation(fields: [savedPilgrimId], references: [id], onDelete: Restrict)
  booking      Booking?     @relation(fields: [bookingId], references: [id], onDelete: Restrict)
  documentType DocumentType @relation(fields: [documentTypeId], references: [id], onDelete: Restrict)
  reviewedBy   User?        @relation("PilgrimDocReviewedBy", fields: [reviewedById], references: [id], onDelete: SetNull)
  uploadedBy   User         @relation("PilgrimDocUploadedBy", fields: [uploadedById], references: [id], onDelete: Restrict)
  usedIn       BookingPilgrimDocument[]

  @@index([savedPilgrimId, documentTypeId])
  @@index([bookingId])
  @@index([documentTypeId])
  @@index([status, createdAt])      // antrean verifikasi admin
  @@index([reviewedById])
  @@index([uploadedById])
  @@map("pilgrim_documents")
}

enum DocumentReviewStatus { pending accepted rejected  @@map("document_review_status") }
enum DocumentRejectReason { not_matching expired unreadable other  @@map("document_reject_reason") }

// Dokumen mana yang dipakai jamaah di booking tertentu (tautan; berkas tidak disalin).
model BookingPilgrimDocument {
  bookingPilgrimId  String
  pilgrimDocumentId String
  attachedAt        DateTime @default(now()) @db.Timestamptz(3)

  bookingPilgrim  BookingPilgrim  @relation(fields: [bookingPilgrimId], references: [id], onDelete: Cascade)
  pilgrimDocument PilgrimDocument @relation(fields: [pilgrimDocumentId], references: [id], onDelete: Restrict)
  @@id([bookingPilgrimId, pilgrimDocumentId])
  @@index([pilgrimDocumentId])
  @@map("booking_pilgrim_documents")
}

// BookingPilgrim (ada) — DITAMBAH tautan + status pengajuan; fieldValues tetap snapshot.
model BookingPilgrim {
  // … kolom yang ada …
  savedPilgrimId String?
  identityId     String?
  reviewStatus   PilgrimReviewStatus @default(draft)
  submittedAt    DateTime? @db.Timestamptz(3)
  verifiedAt     DateTime? @db.Timestamptz(3)
  verifiedById   String?
  // + FK baru untuk userId yang sudah ada (D2), SET NULL
  reviewHistory  PilgrimReviewEvent[]
  @@index([savedPilgrimId])
  @@index([identityId])
  @@index([userId])
  @@index([reviewStatus, submittedAt])   // antrean verifikasi admin
}

enum PilgrimReviewStatus { draft submitted needs_revision verified  @@map("pilgrim_review_status") }

model PilgrimReviewEvent {   // riwayat status pengajuan (append-only, pola riwayat_status smart-ai)
  id               String   @id @default(uuid())
  bookingPilgrimId String
  fromStatus       PilgrimReviewStatus?
  toStatus         PilgrimReviewStatus
  actorId          String?
  note             String?   // teks staf — dibersihkan saat hapus akun
  createdAt        DateTime @default(now()) @db.Timestamptz(3)

  bookingPilgrim BookingPilgrim @relation(fields: [bookingPilgrimId], references: [id], onDelete: Cascade)
  @@index([bookingPilgrimId, createdAt])
  @@index([actorId])
  @@map("pilgrim_review_events")
}
```

Catatan desain:
- **Data kanonik disalin, bukan dirujuk** — harga privasi (§4). Yang menjamin "satu orang" adalah `nikHash @unique`.
- **Satu tabel dokumen** untuk semua jenis, selalu per jamaah (K7). Pembedanya `DocumentType.reusable`: paspor/KTP/KK/vaksin disimpan di kartu dan dipakai ulang; tiket/reservasi membawa `bookingId` karena hanya berlaku untuk perjalanan itu.
- **`Restrict`** pada pemilik kartu/dokumen: penghapusan akun = anonimisasi eksplisit (`lib/account/deletion.ts`), bukan cascade diam-diam. Rujukan `SET NULL` dihitung eksplisit di jalur hapus.
- `ManifestFieldRequirement.role` diperluas jadi **pengikat ke atribut kartu** (`nik`, `birth_place`, `birth_date`, `gender`, `nationality`, `passport_expiry`, `address`, ditambah yang lama `display_name`, `phone`, `whatsapp`, `email`, `passport_number`) — satu konsep, dipakai mengisi snapshot dari kartu (F7).

---

## 6. NIK dan nomor paspor: hash + enkripsi (K9, K10)

- **Hash biasa tidak cukup**: NIK berpola (6 digit wilayah + 6 digit tanggal lahir + 4 digit urut), sehingga SHA-256 polos bisa dibalik dengan menebak. Indeks memakai **HMAC-SHA256 berkunci rahasia**.
- **Nilai asli terenkripsi** AES-256-GCM (IV acak per nilai, AAD per tujuan, prefix versi kunci untuk rotasi); membuka nilai mencocokkan indeks baris yang sama (ciphertext yang disalin ke baris lain ditolak, SEC-167). **NIK tidak punya digit polos sama sekali** (SEC-165: digit 1–6 = kode kecamatan di `Address`, 7–12 = tanggal lahir, jadi 4 digit terakhir polos akan melengkapi NIK tanpa kunci) — tampilan selalu tersamar penuh; paspor boleh `passportLast4`. Staf membuka nilai utuh lewat tindakan yang tercatat (`nik_revealed`). Pemilik kartu melihat NIK/paspor kartunya sendiri.
- **Kunci terpisah dari `JWT_SECRET`**: `PII_INDEX_KEY` dan `PII_ENCRYPTION_KEY` (≥ 32 byte, diperiksa saat boot seperti `lib/auth/secret.ts`). Merotasi `JWT_SECRET` tidak boleh merusak indeks NIK. **Kunci wajib ikut backup rahasia** — kunci hilang = NIK/paspor tersimpan tak terbaca (masuk `docs/deployment.md`).
- **As-built Fase 1 (2026-11-02):** satu modul `lib/pii/` — `normalizeNik`/`nikProblem`/`nikHints`/`sealNik`/`openNik(cipher, hash)`, `normalizePassport`/`passportIndex`/`sealPassport`/`openPassport(cipher, {countryCode, keyHash})`, `needsReencrypt`, `NIK_MASK`/`maskPassport` (klien hanya `@/lib/pii/mask`); kunci divalidasi fail-closed di `lib/pii/keys.ts` (64 hex, entropi + blok berulang, berbeda satu sama lain dan dari `JWT_SECRET`, daftar pensiun untuk rotasi), peringatan boot di `instrumentation-node.ts`. Sisa review: SEC-168 (deteksi kunci indeks tertukar, Fase 2), SEC-169/170/172 (Low). Rancangan awal: tidak ada kode lain yang memakai `crypto` untuk PII (tes penemu sumber). PII tidak pernah ke log; `select` eksplisit — kolom `*Cipher` hanya dibaca `lib/pii`.

---

## 7. Dokumen dinamis

### 7.1 Katalog bawaan (`isSystem`, label publik — tanpa istilah internal)

| key | Label | Dipakai ulang | Ikon Lucide | Aturan |
|---|---|---|---|---|
| `passport` | Foto Paspor | ya | `BookOpen` | masa berlaku; ≥ 6 bulan dari tanggal berangkat |
| `ktp` | Foto KTP | ya | `IdCard` | — |
| `kk` | Kartu Keluarga | ya | `Users` | — |
| `vaccine` | Sertifikat Vaksin | ya | `Syringe` | masa berlaku opsional |
| `flight_ticket` | Tiket Pesawat Pulang-Pergi | tidak (per booking) | `Plane` | "Kode Booking (PNR)", boleh lebih dari satu (pergi/pulang) |
| `hotel_reservation` | Bukti Reservasi Hotel Makkah/Madinah | tidak | `Hotel` | — |
| `transport_reservation` | Bukti Reservasi Transportasi | tidak | `Bus` | — |
| `other` | Dokumen Lain | ya | `FileText` | label bebas (repeater) |

Admin menambah/mengubah/menonaktifkan jenis di **Sistem → Jenis Dokumen** (CRUD lengkap; bawaan hanya bisa dinonaktifkan).

### 7.2 Syarat per produk (K7)
Di editor produk (Visa lebih dulu, lalu Paket Umroh, Tiket, dst.) admin memilih jenis dokumen dari katalog, menandai wajib/opsional, dan memberi petunjuk. Produk baru diisi **daftar bawaan** yang bisa diubah (mis. visa umroh: paspor, KTP, KK, tiket PP). Kapan bukti reservasi hotel/transport dibutuhkan (urusan BRN internal) diputuskan admin lewat jenis visa yang ia buat — sistem tidak menebak dari isi keranjang. Satu evaluator kelengkapan: `lib/documents/completeness.ts` (syarat = gabungan syarat semua produk yang dipakai jamaah itu di booking).

### 7.3 Berkas (MinIO, K12)
- Kunci objek: `saved-pilgrims/{savedPilgrimId}/{typeKey}/{unix_ms}-{nama}`. Disimpan kunci, URL presigned saat dibaca (15 menit pratinjau, 60 menit ZIP). Bucket privat.
- Validasi dari **isi berkas** (magic bytes — menutup D3), maks 5 MB masukan. **Gambar (JPG/PNG/WebP) dienkode ulang ke WebP** (EXIF/GPS dibuang; resolusi cukup untuk membaca baris MRZ paspor — angka pasti diuji di F4, usul sisi terpanjang 2000 px, kualitas ~85). PDF diterima apa adanya (header `%PDF-` diperiksa, maks 5 MB, tidak dikonversi — C3). `sha256` dicatat.
- **Tanpa penghapusan otomatis** (K12). Mengganti dokumen (mis. paspor baru) = berkas lama **dihapus** (baris + objek) dan tautan booking yang masih berjalan dipindah ke berkas baru dengan status `pending` (perlu dinilai ulang). Snapshot data booking yang sudah selesai tetap ada, berkas lamanya tidak.
- `deleteObjectsByPrefix` diperluas dengan regex ketat untuk prefix baru (D7).

### 7.4 UI repeater (`components/shared/documents/DocumentRepeater.tsx`)
Satu komponen untuk jamaah dan admin (folder shared, tanpa impor admin): baris syarat produk lebih dulu (penanda wajib), lalu baris tambahan. Tiap baris: ikon jenis + label, berkas (pratinjau), kode referensi / masa berlaku bila jenisnya punya, status (`Badge`: Menunggu / Diterima / Ditolak + alasan dan catatan admin). Tombol "Tambah dokumen lain" (label bebas); hapus lewat `ConfirmDialog`; jenis lewat `ChoiceSelect`.

---

## 8. Pengajuan & verifikasi (K3, K5, K6 — pola smart-ai)

### 8.1 Status
```
draft ──pengguna mengajukan──▶ submitted ──admin──▶ verified
                                  │  ▲
                            admin ▼  │ pengguna memperbaiki & mengajukan ulang
                             needs_revision
```
- **Per dokumen** (`PilgrimDocument.status`): `pending → accepted | rejected` dengan alasan (`not_matching` tidak sesuai, `expired` kedaluwarsa, `unreadable` tidak terbaca, `other`) + catatan untuk pengguna.
- **Per jamaah dalam booking** (`BookingPilgrim.reviewStatus`): status dokumen independen dari status pengajuan — admin menilai per dokumen lalu memutuskan status besar secara sadar; `verified` **hanya bila semua dokumen wajib `accepted`** dan data wajib lengkap. Ada dokumen ditolak → admin mengembalikan `needs_revision`.
- Mengajukan: semua field wajib terisi dan semua dokumen wajib terunggah. Setiap transisi dicatat (`PilgrimReviewEvent`) dan memberi notifikasi email ke pemesan (lewat `notify()`, aturan kanal yang ada).
- **`verified` memperbarui data kanonik identitas** dari snapshot pengajuan itu (`canonical_updated`, `lastVerifiedAt`) — inilah "verifikasi saat pengguna mengajukan nama-nama jamaah" (K3); gudang tidak punya antrean verifikasi sendiri.
- Langkah admin selanjutnya (mis. mengajukan visa ke syarikah) mensyaratkan jamaah `verified`.

### 8.2 Bantuan otomatis untuk admin (bukan pengganti penilaian)
- **Paspor**: `expiresAt` dibandingkan dengan tanggal acuan = `VisaApplication.plannedTravelDate` (bila ada), selain itu `Booking.departureDate`. Bila `expiresAt < addMonths(tanggalAcuan, 6)` (aritmetika kalender `lib/time`), pengguna diperingatkan saat mengunggah dan admin melihat tanda "Paspor kurang dari 6 bulan" dengan alasan tolak `expired` terisi sebagai saran.
- **PNR**: bentuk dicek server (`referencePattern`); keabsahan diputuskan admin (K6).
- Kartu `conflict` (§4.1) ditandai di layar verifikasi.

### 8.3 Antrean admin
Booking → **Verifikasi Jamaah**: daftar berpaginasi `BookingPilgrim` berstatus `submitted` (filter `FilterSelect`: status, produk, tanggal berangkat), detail = data snapshot + dokumen dengan pratinjau berdampingan + tombol Terima/Tolak per dokumen + Verifikasi/Kembalikan untuk jamaah. Peran: admin, manager, superadmin.

---

## 9. Privasi, UU PDP, peran

| Tindakan | Jamaah (pemilik akun) | admin / manager / superadmin |
|---|---|---|
| Lihat/buat/ubah/hapus kartu | hanya miliknya | kartu pelanggan mana pun (atas nama pelanggan, `createdById`) |
| Unggah dokumen | kartu/booking miliknya | ya, atas nama pelanggan (`uploadedById`) |
| Ajukan data jamaah | booking miliknya | ya |
| Nilai dokumen, verifikasi/kembalikan | tidak | ya |
| Gudang identitas, konflik, gabung, buka NIK/paspor | tidak pernah | ya, tercatat (K4) |
| Jenis dokumen & syarat produk | tidak | manager+ (selaras editor produk) |

- Route jamaah yang menulis data pribadi: `onboardingRefusal()` (SEC-107), rate limit, Zod `.strict()` (SEC-03), pembeda galat 401/403/400/500 (`lib/admin/errors.ts`), daftar berpaginasi server.
- **Catatan hukum (bukan penghalang, K8)**: jamaah yang didaftarkan orang lain adalah subjek data tersendiri; tanpa kotak centang terpisah, dasar pemrosesannya bertumpu pada kebijakan privasi/S&K yang disetujui pemesan saat mendaftar (`ConsentLog` yang sudah ada). Sertifikat vaksin adalah data kesehatan. Disarankan teks kebijakan privasi menyebut hal ini — ikut peninjauan hukum yang sama dengan `arsitektur-hapus-akun.md`.

---

## 10. Penghapusan akun (`lib/account/deletion.ts`, diperbarui di F2/F4/F6)

Tanpa retensi otomatis (K12), tetapi hak hapus akun UU PDP tetap berlaku. Di transaksi terkunci yang sama dengan anonimisasi sekarang:
1. Semua `SavedPilgrim` milik akun: objek `saved-pilgrims/{id}/` dan baris `PilgrimDocument` dihapus, `Address` kartu dihapus, kartu dihapus (`BookingPilgrim.savedPilgrimId` → NULL, dihitung eksplisit).
2. `PilgrimIdentity` yang tidak lagi punya kartu dan tidak dirujuk `BookingPilgrim` akun lain → dihapus (NIK, hash, data kanonik hilang). Yang masih punya kartu akun lain → dipertahankan; data kanonik yang hanya bersumber dari akun terhapus diisi ulang dari kartu yang tersisa.
3. `reviewNote` dan `PilgrimReviewEvent.note` pada data akun → `[dihapus]`; `PilgrimIdentityEvent.detail` tak memuat PII (dijaga tes).
4. Sapuan susulan (`erasureSweep.ts`) diperluas ke prefix baru.
5. Pemindai `scripts/test-deletion.ts` merah untuk setiap tabel/kolom baru ber-`userId`/PII sampai perlakuannya ditambahkan.

Permintaan hapus dari jamaah yang **bukan** pemilik akun (langsung ke Saudinesia): alur admin "hapus identitas" di F8 (prosedur menunggu peninjauan hukum).

---

## 11. Migrasi (K11)

- Belum ada data jamaah/booking nyata → **tidak ada backfill**. `BookingPilgrim.fieldValues` tetap sebagai snapshot.
- Model `Document` lama **langsung diganti** `PilgrimDocument` di F4 (migrasi fail-closed: berhenti bila tabel `documents` masih berisi baris di lingkungan non-dev, supaya tak ada berkas nyata yang hilang diam-diam).
- `DocumentRequirement.docType` (teks) → `documentTypeId`: baris yang ada dipetakan ke katalog (`passport/ktp/kk/kartu_keluarga/evaksin/etiket`); key tak dikenal → migrasi gagal (fail-closed). `VisaProduct.requirements` (Json, dual-write) dan `REQUIRED_DOCUMENTS` dihapus di F5.

---

## 12. Evaluasi saran Gemini (terhadap konvensi project ini)

| Saran | Penilaian | Keputusan |
|---|---|---|
| Tabel terpisah jamaah + alamat + dokumen dengan FK | **Setuju** — memang pola project (`Address` bersama, FK `addressId`). | Dipakai (§5). |
| Indeks pada setiap FK | **Setuju, penting**: Postgres dan Prisma tidak membuatnya otomatis. | Setiap FK diberi `@@index`, ditambah indeks gabungan untuk pola baca utama. |
| BIGSERIAL vs UUID | **Tidak diikuti.** Seluruh skema UUID; FK ke `users.id` (TEXT) harus bertipe sama. ID berurutan **berbahaya untuk privasi** (`/jamaah/1041` mengundang menebak `1042`). Selisih ukuran indeks tidak menentukan pada jutaan baris. | Tetap `uuid()`. Opsi UUIDv7 (`uuid(7)`, urut waktu) untuk tabel bervolume tinggi — dukungan di Prisma 6 terpasang diverifikasi di F2. |
| Hindari `SELECT *` | **Setuju**, sekaligus kontrol privasi (kolom `*Cipher` tak boleh ikut terbaca). | `select` eksplisit; dijaga tes. |
| Alamat sebagai JSONB | **Tidak untuk data hidup** — kehilangan integritas ke wilayah Kemendagri. | Kartu → tabel `Address`. JSONB hanya untuk snapshot booking (`fieldValues`), yang beku dan tak perlu di-join. |
| (tambahan) Partisi | Belum perlu pada jutaan baris berindeks benar. | Tinjau ulang di puluhan juta. |
| (tambahan) Cari nama admin | `LIKE '%…%'` lambat di jutaan baris. | F8: indeks trigram (`pg_trgm`) pada `nameKey`. |

---

## 13. Fase eksekusi (satu fase = satu PR; SOP: recheck → build 0 error → security review → dokumentasi)

| Fase | Isi | Bukti selesai |
|---|---|---|
| **0** | Dokumen ini — SELESAI (PR #94) | disetujui pemilik |
| **1 — SELESAI 2026-11-02** | Fondasi PII: `lib/pii/` (NIK + paspor: normalisasi, cek lunak, HMAC, AES-256-GCM berversi kunci, samaran), env `PII_INDEX_KEY`/`PII_ENCRYPTION_KEY` + pemeriksa boot + `.env.example` + catatan backup di `docs/deployment.md`, ADR-0005 | `scripts/test-pii.ts`: vektor uji, tamper GCM ditolak, kunci lemah ditolak, rotasi; penemu sumber `crypto` di luar `lib/pii` |
| **2** | Skema identitas + kartu + `PilgrimIdentityEvent`, cek kunci indeks/enkripsi di DB (SEC-168), `server-only` (SEC-170), FK `BookingPilgrim.userId` (D2) + `savedPilgrimId`/`identityId`; `lib/pilgrims/service.ts` (dedup §4.1, advisory lock, pengecualian bayi); rate limit; perlakuan hapus akun | tes dedup (baru/cocok/konflik/ganda sendiri/bayi), **tes orakel**, simpan NIK sama serentak → satu identitas (uji deterministik), `test-deletion` + `test-admin-delete` hijau |
| **3** | API + UI **Jamaah Saya** (CRUD, "Saya sendiri", `AddressPicker`, `ContactPicker`) + admin membuat/mengubah kartu atas nama pelanggan di detail pelanggan | curl termasuk yang DITOLAK (kartu akun lain → 404, field asing → 400, tanpa onboarding → ditolak); e2e browser; terdaftar di `test-admin-editor`/`test-admin-create`/`test-table-consistency` |
| **4** | Dokumen: `DocumentType` (CRUD + bawaan), `PilgrimDocument` menggantikan `Document`, layanan unggah (cek isi, konversi WebP, sha256, ganti = hapus lama), `DocumentRepeater`, admin boleh unggah (D3, D4, D7), hapus akun | berkas palsu (exe berganti nama .jpg) DITOLAK, hasil WebP tanpa EXIF dan MRZ terbaca, objek tak bisa diakses tanpa presigned, `test-deletion` hijau; security review subagent |
| **5** | Syarat per produk: `DocumentRequirement.documentTypeId`, editor syarat di Visa (lalu produk lain), `lib/documents/completeness.ts` + aturan paspor 6 bulan; hapus `VisaProduct.requirements`/`REQUIRED_DOCUMENTS` (D5, D8) | kelengkapan per produk benar (tabel uji), paspor 5 bln 29 hr vs 6 bln tepat di beberapa `TZ` |
| **6** | Pengajuan & verifikasi (§8): status per jamaah + per dokumen, ajukan/kembalikan/verifikasi, riwayat, notifikasi, pembaruan data kanonik, antrean **Verifikasi Jamaah** admin (D9) | transisi tak sah ditolak; `verified` mustahil bila ada dokumen wajib belum diterima; e2e: unggah → tolak (kedaluwarsa) → perbaiki → ajukan ulang → verifikasi |
| **7** | Integrasi booking: pilih kartu di Data jamaah (admin; front-end pelanggan menyusul engine v2 Fase 11), snapshot via pengikat `role`, tautan dokumen, `fieldType='address'` sungguhan (D1) | e2e: kartu → booking → snapshot tetap setelah kartu diedit; manifest/ZIP admin benar |
| **8** | Gudang admin: daftar identitas (cari nama trigram / NIK tepat via hash), konflik & kemungkinan duplikat, gabung/lepas, buka NIK berjejak, hapus identitas (hak subjek data); rapikan dokumen basi (D6) | tes peran (jamaah tak bisa mencapai satu pun route), jejak `PilgrimIdentityEvent` lengkap; security review subagent |

---

## 14. Konfirmasi kecil (DIJAWAB pemilik 2026-11-02: "Setuju semua usulan")

1. **C1 — Bayi tanpa NIK**: diizinkan bila usia **di bawah 2 tahun** menurut tanggal lahir; NIK dilengkapi begitu tercantum di KK.
2. **C2 — Jamaah WNA**: didukung, kunci = **negara + nomor paspor** (`passportKeyHash`).
3. **C3 — Berkas PDF**: diterima **apa adanya** (maks 5 MB, tidak dikonversi); gambar selalu dikonversi ke WebP.

## 15. Referensi silang
`docs/arsitektur-manifest.md` (snapshot `fieldValues`, `role`), `docs/arsitektur-dokumen.md` (`DocumentRequirement`), `docs/arsitektur-alamat.md` (`Address`, `upsertAddress`), `docs/arsitektur-komponen-kontak.md` (`ContactPicker`), `docs/arsitektur-hapus-akun.md` (anonimisasi, sapuan), `docs/arsitektur-booking-engine-v2.md` §10.3 (data jamaah setelah terbit), `docs/arsitektur-media.md` (cek isi + enkode ulang), `docs/arsitektur-auth.md` (`onboardingRefusal`), repo smart-ai (berkas architecture-pmb) (pola verifikasi per dokumen + status pengajuan).
