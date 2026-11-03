# Arsitektur — Data Jamaah Tersimpan + Komponen Dokumen Dinamis

> **Status: RENCANA DISETUJUI PEMILIK (2026-11-02) — keputusan Q1–Q12 (§2) dan konfirmasi C1–C3 (§14) final; fase §13 disetujui. Fase 1 (fondasi `lib/pii/`) SELESAI 2026-11-02 (§6 as-built); Fase 2 (skema identitas + kartu + layanan dedup + hapus akun) SELESAI 2026-11-02 (§5.1 as-built); Fase 3 (API + UI Jamaah Saya + admin atas nama pelanggan) SELESAI 2026-11-02 (§5.2 as-built); Fase 4 (dokumen jamaah: katalog jenis, unggah cek isi + WebP, repeater) SELESAI 2026-11-03 (§7.5 as-built); Fase 5 (syarat dokumen per produk atas katalog + evaluator kelengkapan + aturan paspor 6 bulan) SELESAI 2026-11-03 (§7.7 as-built); Fase 7a+7b (tautan kartu ↔ jamaah booking, segel NIK/paspor, sisi jamaah, alamat terstruktur) SELESAI 2026-11-03 (§5.4/§5.6 as-built); Fase 6 (pengajuan & verifikasi data jamaah) SELESAI 2026-11-03 (§8.5 as-built); Fase 8 (gudang identitas admin) SELESAI 2026-11-03 (§4.5 as-built) — seluruh rencana selesai.** Keputusan struktural (identitas global berkunci NIK + salinan per akun) dicatat sebagai ADR-0005 di Fase 1.
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

### 4.4 Rancangan rinci Fase 8 — gudang identitas admin (2026-11-03, sebelum eksekusi)

**Recheck (SOP 1):** skema `PilgrimIdentity`/`SavedPilgrim`/`PilgrimIdentityEvent` sama dengan §5; belum ada route/halaman admin identitas; `pg_trgm` tersedia di Postgres dev tetapi belum dipasang; CI membandingkan skema ↔ DB (`migrate diff`), jadi indeks trigram harus dinyatakan di `schema.prisma` (`@@index([nameKey(ops: raw("gin_trgm_ops"))], type: Gin)`), bukan hanya di SQL. Status cocok kartu bisa basi sesudah verifikasi F6 (deviasi §8.5 butir 3) → gudang menghitung status saat dibaca.

**Keputusan pemilik (2026-11-03):**
- **Gabung:** admin ditanya identitas mana yang dipakai, lalu yang lain digabung ke sana. Kunci (NIK/paspor) identitas yang digabung disimpan sebagai **alias** supaya kartu yang masih memakai kunci itu tetap tertaut ke identitas tujuan, tidak membuat identitas baru.
- **Konflik:** "Orang yang sama" → kartu **cocok manual** (berlaku sampai NIK/nama/tanggal lahir kartu diubah); "NIK tidak sesuai" → kartu **dilepas**; admin juga dapat menjadikan data satu kartu sebagai data kanonik.
- **Pesan generik** ke pemilik kartu yang dilepas: "Mohon periksa kembali NIK jamaah ini" di Jamaah Saya, hilang setelah NIK diubah; selama NIK belum diubah kartu tidak ditautkan ulang otomatis.
- **Hapus identitas** hanya bila tak pernah dipakai booking (jamaah booking); bila pernah → ditolak dengan pesan (menunggu prosedur hukum). Kartu akun tetap milik akunnya (dilepas, tidak dihapus).

**Skema (migrasi `pilgrim_identity_warehouse`):**
- `CREATE EXTENSION IF NOT EXISTS pg_trgm` + indeks GIN trigram `pilgrim_identities.nameKey` (cari nama `contains` → ILIKE memakai indeks).
- `PilgrimIdentityAlias` (`keyHash` unik, `kind` `nik|passport`, `identityId` FK Cascade, `createdById`) — hanya hash, tanpa ciphertext (minimisasi; kartu menyimpan salinannya sendiri). Satu hash tak boleh sekaligus kunci utama dan alias: dijaga di layanan di bawah kunci advisory.
- `SavedPilgrim.matchConfirmedAt`/`matchConfirmedById` (cocok manual), `nikCheckRequestedAt` (pesan generik + tahan tautan otomatis).
- `PilgrimIdentity.canonicalPinnedAt` (kanonik ditetapkan admin — tidak digeser kartu tertua, sejajar `lastVerifiedAt`).
- `PilgrimIdentityErasure` (jejak penghapusan tanpa PII: pelaku, jumlah kartu dilepas, waktu) — jejak identitas ikut terhapus bersama identitasnya.

**Kunci:** advisory lock selalu atas **kunci utama** identitas (atau kunci yang akan menjadi kunci utama bila identitas belum ada). Penulis kartu: kunci kartu → cari identitas lewat kunci utama ATAU alias tanpa kunci → kunci kunci utama identitas itu → baca ulang pemetaan (berubah karena gabung serentak → 409 "coba lagi"). Gabung mengunci kedua kunci utama (terurut). Pemegang baris kartu selalu sudah memegang kunci identitasnya (aturan SEC-174 tetap).

**Layanan:** `lib/pilgrims/warehouse.ts` — satu-satunya penulis alias, cocok manual, lepas, pin kanonik, gabung, hapus identitas, dan jejak `nik_revealed`; membaca/menulis atas helper `service.ts` (`settleIdentity`, kunci). `service.ts` tetap satu-satunya penulis kartu dari formulir (menghormati alias, cocok manual, dan penahanan tautan). Semua fungsi menerima `Actor` staf (`ADMIN_ROLES`, K4), memanggil `ensurePiiKeysMatch()` sebelum membuka/menghitung indeks, dan berbatas laju per staf.

**Route (semua `requireAdmin`, `.strict()`, galat lewat `lib/admin/errors.ts`):** `GET /api/v1/admin/identities` (cari: 16 digit → NIK tepat lewat hash/alias; selain itu nama; filter konflik/tanpa verifikasi; berpaginasi), `GET|DELETE /api/v1/admin/identities/[id]`, `POST …/[id]/reveal` (NIK identitas atau paspor kartu; `no-store`; jejak), `POST …/[id]/cards/[cardId]` (`confirm|detach|pin`), `POST …/[id]/merge` (`otherId`, `keep`), `GET /api/v1/admin/identities/unmatched` + `POST …/unmatched/[cardId]/link` (kartu bayi tanpa kunci → identitas, saran nama + tanggal lahir sama).

**UI:** menu **Identitas Jamaah** (Operasional): daftar (`DataTable`, `FilterSelect`, cari) + tampilan "Kartu tanpa identitas"; halaman detail: data kanonik, kartu (pemilik, status, aksi), riwayat booking (jumlah), alias, jejak, Buka NIK, Gabung (pilih identitas yang dipakai), Hapus (`DeleteBox`). Jamaah Saya: pesan generik pada kartu yang ditandai.

**Uji (`scripts/test-identity-warehouse.ts`):** peran (jamaah 403/404 di setiap route — penemu route), cari NIK tepat/nama, buka NIK berjejak + `no-store`, cocok manual lengket & gugur saat kartu diubah, lepas → tak tertaut ulang sampai NIK diubah + pesan generik, pin kanonik tahan kartu tertua, gabung → kartu/jamaah booking/alias pindah dan kartu berkunci lama tetap ke tujuan saat diedit, gabung serentak dengan edit kartu → tak deadlock (uji deterministik), hapus ditolak bila ada booking / berhasil bila tidak, jejak lengkap tanpa PII, penjaga penulis tunggal.

**D6:** `arsitektur-manifest.md` §8 dan `arsitektur-komponen-kontak.md` diberi catatan basi (wizard/`PassportForm`/`lib/booking/draft.ts`/3 kolom kontak sudah dihapus).

### 4.5 As-built Fase 8 (2026-11-03)

**Skema** (migrasi `20261117090000_pilgrim_identity_warehouse`): `pg_trgm` + indeks GIN `pilgrim_identities_nameKey_trgm_idx` (dinyatakan di `schema.prisma` supaya `migrate diff` CI bersih); `PilgrimIdentity.canonicalPinnedAt`; `SavedPilgrim.matchConfirmedAt/ById` (CHECK pelaku ⇒ waktu) + `nikCheckRequestedAt`; `pilgrim_identity_aliases` (hash saja, `kind` CHECK `nik|passport`, Cascade); `pilgrim_identity_erasures` (`reason` CHECK `staff_erase|staff_detach`, `cardsDetached`, `revealEvents` — tanpa PII).

**Kode:**
- `lib/pilgrims/warehouse.ts` — satu-satunya penulis alias, cocok manual, lepas, pin, gabung, hapus, tautan kartu tanpa kunci, jejak buka NIK/paspor dan jejak hapus. Status cocok kartu dihitung saat dibaca (`liveStatus`). Transaksi diulang pada deadlock/serialisasi lalu 409 (`retryConflict`, juga dipakai `review.ts`/`bookingLink.ts`).
- `lib/pilgrims/service.ts` — `identityByKey` (kunci utama ATAU alias), `primaryKeyOf`, kunci advisory selalu atas kunci utama, pemetaan dibaca ulang di dalam kunci (berubah → 409); `write()` menahan tautan bila `nikCheckRequestedAt` dan kunci tak berubah, mempertahankan tautan petugas pada kartu tanpa kunci, menggugurkan cocok manual saat kunci/nama/tanggal lahir/identitas berubah; `settleIdentity` menghormati `canonicalPinnedAt` dan `matchConfirmedAt`; `eraseSavedPilgrimsOf` membaca ulang identitas kartu di dalam kunci; DTO pemilik `needsNikCheck`.
- Route `app/api/v1/admin/identities/**` (7), validator `lib/validators/identities.ts`, batas laju `identitySearchStaff` (cari NIK) dan `identityRevealStaff` (60/jam).
- UI: menu **Identitas Jamaah** (`/admin/identitas-jamaah`: daftar + "Kartu tanpa identitas"; detail: data kanonik, kartu + aksi, riwayat booking, jejak, Buka NIK, Gabung dengan pilihan identitas yang dipakai, Hapus). Jamaah Saya: lencana "Periksa NIK" + pesan generik.
- D6: catatan basi di `arsitektur-manifest.md` §8 dan `arsitektur-komponen-kontak.md`.

**Deviasi / keputusan saat eksekusi:**
1. Gabung menetapkan (pin) data kanonik identitas yang dipakai — itulah "identitas yang mau dipakai" pilihan petugas; `lastVerifiedAt` diambil dari yang digabung bila yang dipakai belum terverifikasi.
2. Kartu yang dilepas tetap menyimpan NIK/paspornya sendiri (data akun pemiliknya). Hapus identitas TIDAK menahan tautan: simpanan kartu berikutnya oleh pemilik akun membentuk identitas baru dari kartunya (pemrosesan data akun itu) — **diterima pemilik 2026-11-03** (SEC-206: kartu = data akun pemiliknya; gudang hanya dibentuk ulang dari kartu itu, riwayat lama tetap terhapus).
3. Jejak buka NIK/paspor ikut terhapus bersama identitasnya (Cascade); jumlahnya dicatat di `pilgrim_identity_erasures.revealEvents` saat petugas menghapus atau melepas kartu terakhir (SEC-207). Penghapusan akun UU PDP tidak mencatat baris ini (permintaan hapus akun sudah berjejak).
4. Halaman server tidak mengirim `icon` ke `MetaBox` (komponen klien) — fungsi tak bisa diserialkan (ditemukan saat uji server dev; build tidak menangkapnya).

**Bukti:** `scripts/test-identity-warehouse.ts` (14 skenario, termasuk uji mutasi: tanpa alias / tanpa penahanan tautan → 4 uji merah), `test-deletion` (3 kolom pelaku baru), `test-table-consistency`; uji API ke server dev dengan akun uji sementara (jamaah 403, kolom/aksi liar 400, buka NIK `no-store`, cocok manual, hapus; halaman daftar/kartu tanpa identitas/detail 200).

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


### 5.1 As-built Fase 2 (2026-11-02)

- **Skema** (`prisma/schema.prisma`, migrasi `20261112090000_pilgrim_identity`): `PilgrimIdentity`, `SavedPilgrim`, `PilgrimIdentityEvent`, `PiiKeyCheck`, enum `Gender`/`PilgrimMatchStatus`; `BookingPilgrim` + `savedPilgrimId`/`identityId` (SetNull) dan FK `userId → users` (SetNull, menutup D2 — migrasi berhenti bila ada `userId` yatim). Model dokumen/verifikasi (`DocumentType`, `PilgrimDocument`, `PilgrimReviewEvent`, …) menyusul di F4/F6, jadi relasi `documents` belum ada di kartu.
- **CHECK di DB** (invarian yang tak bisa dinyatakan Prisma): identitas berkunci tepat satu (`nikHash` XOR `passportKeyHash`); hash dan ciphertext berpasangan (NIK; paspor + `passportLast4`); `selfOfUserId` hanya sama dengan `ownerId`; `matchStatus = 'unmatched'` ⇔ `identityId IS NULL`.
- **Kunci identitas**: WNI = HMAC NIK; WNA = HMAC `negara:nomor paspor` (negara penerbit = kewarganegaraan). Paspor WNI hanya untuk keunikan per akun, bukan kunci identitas. Bayi WNI tanpa NIK = kartu `unmatched` tanpa identitas.
- **Penulis tunggal `lib/pilgrims/service.ts`**: `createSavedPilgrim`/`updateSavedPilgrim`/`deleteSavedPilgrim`/`restoreSavedPilgrim`/`getSavedPilgrim` (pemilik atau staf `ADMIN_ROLES`; akun lain → 404), `settleIdentity`, `eraseSavedPilgrimsOf`/`countErasableIdentities` (dipakai `lib/account/deletion.ts`). Masukan = `savedPilgrimInputSchema` (`lib/validators/pilgrims.ts`, `.strict()`; kolom tak dikirim = tetap, `null` = dikosongkan — NIK tak pernah dikirim balik, jadi "tetap" satu-satunya cara mengubah kolom lain tanpa mengetik ulang NIK).
- **Urutan kunci**: baris `users` pemilik `FOR SHARE` (penghapusan akun memegang `FOR UPDATE`, jadi keduanya berurutan dan akun terhapus/nonaktif/staf → 422) → `pg_advisory_xact_lock` per **hash kunci identitas** (satu namespace untuk buat, tautkan, lepas, dan pangkas; diurutkan) → baru kartu `FOR UPDATE`, lalu kartu dibaca ulang (kuncinya berubah di antara → 409 "baru saja diubah — muat ulang"). Kunci identitas WAJIB sebelum baris kartu: `settleIdentity` mengubah kartu akun lain, jadi urutan terbalik membuat dua ubah serentak saling menunggu (deadlock, SEC-174). Dua akun menyimpan NIK baru yang sama serentak → satu identitas (uji deterministik: kedua permintaan ditahan di kunci lalu dilepas).
- **Data kanonik**: identitas yang belum terverifikasi mengikuti kartu tertua yang menautnya (`settleIdentity`, jejak `canonical_updated`); status setiap kartu dihitung ulang (nama ternormalisasi `nameKeyOf` + tanggal lahir). Identitas tanpa kartu dan tanpa riwayat booking dihapus. Sesudah F6 hanya pengajuan terverifikasi yang mengubah identitas berverifikasi.
- **Tanpa orakel**: `SavedPilgrimView` hanya berisi isi kartu itu (NIK = `NIK_MASK`, paspor = `maskPassport`), tanpa `identityId`/`matchStatus`; peringatan (`nikHints` + provinsi tak dikenal) diturunkan dari masukan saja. Menghitung ulang status kartu akun LAIN tidak menyentuh `updatedAt`-nya (SEC-173: tanpa itu, kartu A yang tiba-tiba "diubah" saat akun B menyimpan NIK yang sama membocorkan keberadaan NIK) — uji orakel membandingkan respons dan cap waktu. Pemilik kartu belum bisa melihat NIK utuh kartunya sendiri (§6 menyebutnya boleh) — bila dibutuhkan, F3 menambah tindakan "tampilkan" berjejak untuk pemilik.
- **Hapus-aman**: kartu yang dirujuk `BookingPilgrim` diarsipkan (`archivedAt`; ubah ditolak 409, bisa dipulihkan), selain itu dihapus beserta alamatnya. NIK/paspor ganda di daftar akun sendiri (termasuk arsip) → 409.
- **Cek kunci PII di DB (SEC-168)**: `ensurePiiKeysMatch()` (`lib/pii/keyCheck.ts`) dipanggil sebelum setiap tulis — baris `pii_key_checks` `index` dan `enc:<versi>` ditulis pada pemakaian pertama lalu dibandingkan; kunci indeks/enkripsi/pensiun yang salah → `PiiKeyMismatchError` (tak ada yang ditulis).
- **Rate limit**: `pilgrimWriteUser` 60/jam per akun, `pilgrimWriteStaff` 600/jam per staf (`lib/auth/rateLimit.ts`), berlaku untuk buat, ubah, hapus, dan pulihkan; batas per IP ditambahkan bersama route di F3. Tanggal lahir ≥ 1900-01-01.
- **Cek kunci = percaya-saat-pertama**: baris `pii_key_checks` ditulis oleh pemakaian pertama. Lingkungan baru WAJIB memulai dengan kunci yang benar (dari `scripts/buat-env-production.sh`, dicadangkan) — kunci salah pada pemakaian pertama "dibakukan" sampai baris itu dihapus manual saat tabel PII masih kosong.
- **Hapus akun (§10 butir 1–2)**: di transaksi penghapusan, `eraseSavedPilgrimsOf` memutus tautan kartu/identitas pada manifest booking akun (dihitung eksplisit), menghapus kartu + alamatnya, lalu merapikan setiap identitas tersentuh; pratinjau menampilkan jumlah kartu dan identitas yang hanya milik akun itu. Sapuan susulan tidak perlu diperluas: layanan mengunci baris pemilik dan menolak akun terhapus, jadi tak ada tulis terlambat. `scripts/test-deletion.ts` kini juga mendeteksi setiap relasi ke `User` (bukan hanya nama `*UserId`).
- **Penjaga klien transitif (SEC-170)**: `scripts/test-pii.ts` menelusuri rantai impor (statis, ekspor ulang, dinamis) dari setiap berkas `'use client'` dan merah bila mencapai `lib/pii` selain `mask.ts` atau `lib/pilgrims/service.ts` — dipilih ketimbang paket `server-only`, yang melempar di skrip Bun dan instrumentation.
- **Bukti**: `scripts/test-pilgrims.ts` (18 uji, DB sekali pakai) — dedup baru/cocok/konflik/ganda sendiri/bayi/WNA, uji orakel, serentak deterministik, ubah NIK, kanonik bersama, hapus-aman, kepemilikan, "Saya sendiri", `.strict()`, rate limit, hapus akun; mutasi (kunci advisory dimatikan; `matchStatus` dibocorkan ke DTO; `updatedAt` kartu lain tidak dipertahankan; urutan kunci lama kartu-dulu) membuat uji terkait merah. Uji yang menahan kunci selalu melepasnya di `finally` (gagal = merah, bukan menggantung). `test-deletion` + `test-admin-delete` hijau.

### 5.2 As-built Fase 3 (2026-11-02)

- **API jamaah** (`app/api/v1/account/pilgrims/…`): `GET`/`POST /account/pilgrims` (daftar berpaginasi `page`/`limit`, cari nama `q`, `archived=1`; simpan), `GET`/`PUT`/`DELETE /account/pilgrims/[id]`, `POST /account/pilgrims/[id]/restore`. Pemilik = sesi (`requirePilgrimActor`, `lib/pilgrims/session.ts`: tanpa sesi 401, staf 403); tulis/pulihkan → `onboardingRefusal()` (SEC-107) + batas per IP `pilgrimWriteIp` 300/jam (di atas batas per akun layanan); `DELETE` tanpa gerbang onboarding (hak subjek data), tetap dibatasi laju. Id bukan UUID / kartu akun lain → 404 yang sama.
- **API admin atas nama pelanggan** (`app/api/v1/admin/customers/[id]/pilgrims/…`, `requireCustomerManage` = semua peran admin, §9): bentuk sama; cakupan `{ id: cardId, ownerId: [id] }` di layanan (kartu pelanggan lain → 404); pemilik bukan akun jamaah aktif → 422 (`lockOwner`). Gudang identitas/NIK utuh TIDAK lewat sini (F8).
- **Lapisan HTTP bersama** `lib/pilgrims/http.ts` (galat layanan → status + `meta.field`, 429 + `Retry-After`, hapus-aman `{ deleted }` / `{ archived, message }` — bentuk `useEditEntity`, parameter daftar). Layanan menambah `listSavedPilgrims` ("Saya sendiri" di atas, urut `nameKey`, cari `nameKeyOf(q)` lewat `escapeLike`) dan `address` kartu itu sendiri di DTO (untuk `AddressPicker`).
- **UI jamaah**: menu **Jamaah Saya** (`/{locale}/jamaah` — `DataTable` + `SearchForm` + `FilterSelect` Aktif/Arsip + `Pagination`), `/jamaah/new`, `/jamaah/[id]` (`SavedPilgrimEditor`: simpan/hapus-aman dengan konfirmasi sebaris/pulihkan; peringatan NIK dari masukan sendiri tampil sesudah simpan — sesudah "Tambah" lewat `?w=` yang disaring `Object.hasOwn`).
- **UI admin**: bagian **Jamaah tersimpan** di detail pelanggan (tabel kedua berawalan param `jpage`/`jlimit`/`jarchived`), `customers/[id]/pilgrims/new` (`CreatePage`) dan `customers/[id]/pilgrims/[cardId]` (`EditPage` + `useEditEntity` + `useDirtyForm`, kotak Arsip/Pulihkan); segmen URL divalidasi UUID di klien sebelum membangun URL API.
- **Satu formulir** `components/shared/pilgrims/SavedPilgrimFields.tsx` + nilai murni `savedPilgrimForm.ts` (`formFromCard`/`bodyFromForm`): NIK dan nomor paspor tersimpan hanya tampil sebagai samaran di placeholder; kolom kosong = tetap (tidak dikirim), centang "Hapus NIK tersimpan"/"Hapus data paspor" = `null`; kontak lewat `ContactPicker`, alamat lewat `AddressPicker` (dikosongkan → alamat kartu dihapus). Kode klien hanya `import type` dari layanan (SEC-170).
- **Bukti**: `scripts/test-pilgrims.ts` (+daftar, alamat DTO), `scripts/test-pilgrim-form.ts` (badan formulir, termasuk hapus paspor; mutasi → merah), penemu rute `test-customers-create` mengenali `requirePilgrimActor`, halaman terdaftar di `test-admin-editor`/`test-admin-create`; curl 32 kasus terhadap server berjalan (tanpa sesi 401, onboarding belum lengkap 422, staf di route jamaah 403, jamaah di route admin 403, field asing 400, NIK tak sah 400 + field, kartu akun lain 404 di GET/PUT/DELETE/restore, kartu A lewat URL pelanggan B 404, akun staf sebagai pemilik 422, respons NIK sama vs baru identik, hapus/arsip); browser: tambah → peringatan → ubah → cari (jamaah), detail pelanggan → ubah (admin), tanpa galat konsol/server.
- **Belum** (sesuai rencana): dokumen (F4), pemakaian kartu di booking (F7), buka NIK utuh/gudang identitas (F8). Peringatan NIK belum ditampilkan di halaman admin (respons membawanya di `meta.warnings`, `useEditEntity` belum meneruskannya).

---

### 5.3 Rancangan rinci Fase 7 — integrasi booking (2026-11-03, sebelum eksekusi; urutan F6↔F7 DITUKAR)

**Kenapa ditukar (keputusan pemilik 2026-11-03):** recheck F6 menemukan tak ada kode yang mengisi `BookingPilgrim.savedPilgrimId` — jamaah booking belum bisa memakai kartu/dokumen kartu, sehingga pengajuan & verifikasi (§8) tak terjangkau dari aplikasi. F7 dikerjakan dulu, F6 sesudahnya.

**Recheck kode (2026-11-03):**
- Data jamaah booking diisi admin SESUDAH terbit lewat `PUT /admin/bookings/[id]/pilgrims/[pilgrimId]` + `PilgrimDataForm` (ketik manual, `validateFieldValues`); draf/revisi hanya membawa jumlah + visa per jamaah. Checkout jamaah (visa/transport) mengetik `fieldValues` langsung.
- `ManifestFieldRequirement.role` dipakai hanya `display_name` (nama tampilan); data dev: `core` (5 field) dan 2 visa (9 field: termasuk `passportNumber` teks polos, `passportExpiry`, `nationality`, `dateOfBirth`, `gender` tanpa peran). Tak ada UI pengelola field manifest (masih seed).
- Model `Document` lama dipakai: rute `pilgrims/[bookingId]/[pilgrimId]/documents[/docId]` (juga mengubah `VisaApplication.status` pending_documents ↔ documents_complete), komponen `components/shared/media/{DocumentGrid,DocumentCard,UploadModal,useDocuments}`, `components/admin/PilgrimDocuments`, ZIP admin, halaman booking jamaah/admin, daftar Visa admin (jumlah file), `lib/booking/revise.ts` (R3: jamaah terkunci bila sudah berdokumen), `lib/account/deletion.ts`. Data dev: 0 baris `documents`, 0 `booking_pilgrims`, 0 kartu.
- `fieldType='address'` masih teks bebas (D1).

**Rancangan:**
1. **Tautan kartu → jamaah booking** (satu penulis `lib/pilgrims/bookingLink.ts`): `linkCard(tx, { bookingPilgrimId, cardId, actor })` — kartu WAJIB milik pemilik booking (`booking.userId`), tidak terarsip; booking bukan draf, akun tidak terhapus; kunci baris `users` pemilik `FOR SHARE` lalu jamaah booking `FOR UPDATE` (urutan sama dengan layanan kartu). Mengisi `savedPilgrimId`, `identityId` (dari kartu) dan **snapshot** `fieldValues` lewat pengikat `role` (butir 2); field tanpa peran tidak disentuh. "Perbarui dari kartu" = memanggil ulang (snapshot tidak ikut berubah saat kartu diedit). `unlinkCard` melepas tautan (snapshot tetap). Pemakai: admin (atas nama pelanggan) dan jamaah (booking miliknya, kartu miliknya — `onboardingRefusal`, rate limit).
2. **Pengikat `role` diperluas** (satu daftar `MANIFEST_ROLES` di `lib/manifest/roles.ts`): `display_name`, `gender`, `birth_place`, `birth_date`, `nationality`, `passport_expiry`, `passport_issued`, `phone`, `whatsapp`, `email`, `address`, `nik`, `passport_number`. Migrasi mengisi peran baku untuk field seed yang dikenal (`gender`, `dateOfBirth`, `nationality`, `passportExpiry`) dan menolak peran di luar daftar (CHECK).
3. **NIK & nomor paspor di snapshot TIDAK disimpan polos** (aturan `lib/pii/`): `BookingPilgrim` ditambah `nikCipher`, `passportCipher`, `passportLast4` (disegel `sealNik`/`sealPassport` saat tautan dibuat); `fieldValues` untuk field berperan `nik`/`passport_number` hanya menyimpan samaran (`NIK_MASK`/`maskPassport`). Field `passportNumber` teks di seed visa diberi peran `passport_number` → input manual admin juga disegel lewat jalur yang sama (`PUT` data jamaah memanggil penyegel, bukan menyimpan polos). Dibuka hanya untuk staf (manifest/ekspor, F8 berjejak). Hapus akun: kolom ini dikosongkan bersama `fieldValues`.
4. **Dokumen jamaah booking = dokumen kartu tertaut** (dibaca langsung, bukan disalin) + **dokumen per perjalanan** (`DocumentType.reusable = false`: tiket, reservasi) disimpan sebagai `PilgrimDocument` di kartu yang sama dengan kolom baru `bookingId` (FK `Restrict`, hanya untuk jenis non-reusable — CHECK). Tabel tautan `BookingPilgrimDocument` (pembekuan saat diajukan) dibuat di **F6**, bukan di sini. Unggah per perjalanan lewat layanan `lib/documents/service.ts` yang sama (cakupan `{ card, bookingId }`), route admin `…/admin/bookings/[id]/pilgrims/[pid]/documents` dan jamaah `…/bookings/[id]/pilgrims/[pid]/documents`.
5. **Kelengkapan** di halaman booking = `evaluateCompleteness` (F5) atas syarat produk jamaah (`requirementsOfMany` visa jamaah) + dokumen kartu + dokumen per perjalanan booking itu; tanggal acuan `plannedTravelDate` → `departureDate` → hari ini. Jamaah tanpa kartu = semua syarat `missing` + ajakan menautkan kartu.
6. **Model `Document` lama DIHAPUS** (migrasi fail-closed: berhenti bila `documents` berisi baris) beserta rute lama, `components/shared/media/Document*`/`UploadModal`/`useDocuments`, `components/admin/PilgrimDocuments`; `VisaApplication.status` tidak lagi diubah otomatis oleh unggahan (admin lewat `VisaActions`; F6 menentukan alurnya). R3 di `revise.ts`: jamaah terkunci bila sudah tertaut kartu ATAU punya dokumen per perjalanan. ZIP admin membaca dokumen kartu + per perjalanan (nama aman SEC-187).
7. **Alamat (D1)**: `fieldType='address'` = `AddressPicker` di `ManifestFieldsForm`; nilai snapshot berupa objek terstruktur beku (kode wilayah + nama + baris jalan + teks terformat), bentuknya diperiksa `validateFieldValues`, hierarki wilayah + teks oleh `resolveAddressValues` (§5.5); peran `address` mengisi dari alamat kartu.
8. **UI**: admin — di tiap jamaah halaman booking: pemilih kartu pelanggan (`AutocompleteSelect`, tautan "buat kartu" ke halaman kartu pelanggan), tombol Perbarui dari kartu / Lepas, daftar syarat dengan status per syarat + `DocumentRepeater` cakupan per perjalanan; dokumen yang dapat dipakai ulang diunggah di kartu (tautan ke halaman kartu). Jamaah — halaman booking: "Pilih dari Jamaah Saya", status syarat, unggah per perjalanan; unggah paspor/KTP di halaman Jamaah Saya. Checkout jamaah tetap mengetik (engine v2 Fase 11 menyusul) — sesudah terbit bisa ditautkan.

**Keputusan pemilik (2026-11-03):** NIK/paspor di snapshot DISEGEL (butir 3); F7 dipecah **7a** (butir 1–4, 5, 6 + UI admin dari butir 8) dan **7b** (sisi jamaah dari butir 8 + alamat butir 7), dua PR bertumpuk.

**Bukti yang direncanakan:** e2e kartu → tautkan → snapshot terisi → edit kartu → snapshot TETAP → Perbarui dari kartu → berubah; kartu akun lain/terarsip → DITOLAK (404/409); NIK/paspor tak pernah polos di `booking_pilgrims` (uji kueri + penjaga sumber); unggah per perjalanan dengan jenis reusable → 400; kelengkapan halaman booking cocok dengan tabel uji F5; ZIP berisi dokumen kartu + per perjalanan; `test-deletion` (kolom segel ikut dikosongkan), migrasi fail-closed diuji.

### 5.4 As-built Fase 7a (2026-11-03)

- **Tautan kartu** — `lib/pilgrims/bookingLink.ts` satu-satunya penulis `booking_pilgrims.savedPilgrimId`/`identityId` dan kolom tersegel (`nikHash`, `nikCipher`, `passportCountry`, `passportKeyHash`, `passportCipher`, `passportLast4`; CHECK berpasangan + negara 2 huruf di DB). `linkCard` = tautkan ATAU "perbarui dari kartu" (panggil ulang), `unlinkCard` = lepas (snapshot + segel tetap; ditolak 409 bila kartu masih memegang dokumen perjalanan booking itu). Kartu akun lain = 404 identik dengan kartu tak ada; terarsip/kembar di booking sama = 409; booking draf = 404. Ganti ke kartu LAIN memakai penjaga dokumen perjalanan yang sama dengan lepas (`refuseTripDocs`); kartu dikunci `FOR SHARE` saat dibaca; satu kartu satu jamaah per booking dijaga indeks unik `(bookingId, savedPilgrimId)` (P2002 → 409) (SEC-191). Rate limit `pilgrimWriteStaff/User`.
- **Segel disalin, bukan dibuka**: ciphertext + indeks kartu disalin apa adanya; `openNik`/`openPassport` memeriksa ulang indeks baris booking. Isian manual admin di `PUT /admin/bookings/[id]/pilgrims/[pilgrimId]` lewat `sealManualPii` (samaran = tetap, kosong = hapus segel, galat per field tanpa nilai). Negara paspor = kebangsaan kartu tertaut → field berperan `nationality` bila kode ISO → bawaan `ID` (`passportCountryOf`). Jamaah BERTAUT: mengubah field tersegel ditolak 409 (dibandingkan di dalam kunci; NIK orang lain tak boleh bercampur dengan `identityId` kartu). Route mengunci `users` pemilik `FOR SHARE` lalu jamaah `FOR UPDATE` (urutan sama dengan `linkCard`). **Jamaah baru dari checkout/booking admin** juga disegel: `lib/booking/lineItems.ts` hanya membuat jamaah lewat `createPilgrim` → `sealNewPilgrim` (SEC-190).
- **Pengikat peran** — `lib/manifest/roles.ts` (`MANIFEST_ROLES`, murni/klien-aman; daftar = CHECK migrasi, satu peran per produk = indeks unik). `snapshotFromCard` mengisi HANYA field berperan dalam bentuk `fieldType`-nya (tanggal hanya ke field tanggal, telepon `{countryCode ISO, number}`, kebangsaan = nama negara untuk teks / kode untuk select, NIK/paspor = samaran). Field tanpa peran tidak disentuh.
- **Pembaca aman** — relasi `pilgrims` di halaman/API memakai `BOOKING_PILGRIM_SAFE_SELECT` (tanpa kolom tersegel), bukan `include`; dijaga penemu sumber di `scripts/test-booking-link.ts`.
- **Dokumen per perjalanan** — `PilgrimDocument.bookingId` (FK Restrict). Layanan `lib/documents/service.ts` menerima cakupan `{ bookingId }`: jenis yang boleh = `reusable = false` (deviasi rancangan butir 4: aturan jenis dijaga di layanan, bukan CHECK DB — CHECK tak bisa melihat tabel lain), kunci baris jamaah booking `FOR SHARE` (`lockTripScope`) melawan `unlinkCard` `FOR UPDATE`. Route admin `…/admin/bookings/[id]/pilgrims/[pilgrimId]/documents[/docId]` (`requireBookingManage`, 404 bila belum tertaut).
- **Kelengkapan** — `bookingChecklists` (syarat visa jamaah × dokumen kartu + dokumen perjalanan, tanggal acuan rencana berangkat → tanggal booking → hari ini).
- **UI admin** — `PilgrimCardPanel` per jamaah (pilih kartu `AutocompleteSelect` pencarian server, Tautkan / Perbarui dari kartu / Lepas dengan `useConfirm`, checklist, `DocumentRepeater` cakupan perjalanan, tautan ke kartu & "Jamaah baru"); `PilgrimDataForm` menandai field dari kartu. Halaman booking jamaah: tautan ke Jamaah Saya (unggah per perjalanan oleh jamaah = 7b). Daftar Visa admin: lencana "Kartu tertaut".
- **Migrasi** — field seed yang dikenal diberi peran baku (termasuk `passportNumber` → `passport_number`, SEC-189); BERHENTI bila field berperan `nik`/`passport_number` sudah berisi nilai polos di `booking_pilgrims.fieldValues` (SQL tak bisa menyegel).
- **Sisa terbuka** — SEC-192 (penjaga safe-select diperluas ke `lib/`), SEC-193 (draf booking menyimpan NIK/paspor ketikan admin polos sampai terbit) → 7b.
- **Dihapus** — model `Document` (migrasi `20261115090000_booking_pilgrim_cards`, fail-closed bila berisi baris), rute `api/v1/pilgrims/…`, `components/shared/media/*`, `components/admin/PilgrimDocuments`. Unggahan tidak lagi mengubah `VisaApplication.status` (F6). R3 revisi: jamaah bertaut kartu terkunci; penghapusan jamaah lewat revisi memeriksa ulang di baris (`deleteMany … savedPilgrimId: null`, 409 bila kalah balapan dengan `linkCard`). ZIP admin membaca dokumen kartu + perjalanan (nama aman SEC-187).
- **Hapus akun** — `SEALED_PII_CLEARED` dikosongkan bersama `fieldValues` (penghapusan + penyapuan terlambat); dokumen perjalanan ikut terhapus bersama kartu (`eraseSavedPilgrimsOf`).
- **Bukti** — `scripts/test-booking-link.ts` (snapshot beku vs perbarui, kartu akun lain/terarsip/kembar/draf ditolak, segel bisa dibuka & tak ada nilai polos, dokumen perjalanan reusable → 400 dan lepas diblokir, isian manual, kelengkapan, penjaga sumber), `scripts/test-booking-pilgrim-cards-migration.ts` (fail-closed `documents`, peran tak dikenal/ganda, CHECK), `test-deletion`/`test-booking-revisions`/`test-customers-create` disesuaikan; browser: tautkan → data terisi, paspor hanya samaran di DB, simpan formulir mempertahankan segel, isian paspor manual tersegel.

### 5.5 Rancangan rinci Fase 7b (2026-11-03, sebelum eksekusi)

**Recheck kode (2026-11-03, sesudah 7a):** halaman booking jamaah (`(pilgrim)/bookings/[id]/page.tsx`) hanya menautkan ke kartu bila sudah tertaut; tak ada route jamaah untuk tautan/dokumen perjalanan. `fieldType='address'` masih `z.string()` di `lib/manifest/values.ts` dan teks bebas di `ManifestFieldsForm` (D1); `snapshotFromCard` mengisi peran `address` hanya ke field teks. `useConfirm`/`ConfirmDialog` hanya ada di `components/admin/ui` (tak boleh diimpor area jamaah). **SEC-193 salah identifikasi:** `draftPilgrimSchema` `.strict()` hanya membawa visa/durasi per jamaah — draf tak pernah menyimpan `fieldValues`, jadi ditutup tanpa perubahan kode. SEC-192 benar: `lib/pdf/invoiceData.ts` dan `lib/booking/revise.ts` memuat relasi `pilgrims` lewat `include`.

**Rancangan:**
1. **Route jamaah** (pemilik = sesi, `requirePilgrimActor`; booking/jamaah/kartu akun lain = 404 seragam): `PUT|DELETE /api/v1/bookings/[id]/pilgrims/[pilgrimId]/card` → `linkCard`/`unlinkCard` (aktor jamaah sudah didukung 7a); `GET|POST …/documents`, `GET|DELETE …/documents/[docId]` → layanan dokumen cakupan `{ bookingId }` dengan `tripScopeOf` + pemilik = sesi. Tulis (PUT/POST) digerbang `onboardingRefusal` + batas IP (`pilgrimWriteIp`/`docIpLimited`).
2. **UI jamaah** — komponen klien `PilgrimTripPanel` di folder halaman booking jamaah: pilih dari Jamaah Saya (`AutocompleteSelect`, cari server `/api/v1/account/pilgrims`), Tautkan / Perbarui dari data tersimpan / Lepas (konfirmasi sebaris, bukan `window.confirm`), checklist kelengkapan (`bookingChecklists`, dihitung server), `DocumentRepeater` dokumen per perjalanan, tautan ke kartu dan "Tambah jamaah". Label status checklist satu sumber `lib/documents/checklistLabels.ts` (dipakai admin dan jamaah).
3. **Alamat terstruktur (D1)** — nilai field `address` = objek beku `{ type, fullAddress, postalCode, provinceId…villageId, countryCode, city, stateRegion, text }`. `validateFieldValues` memeriksa BENTUK (`addressSchema`, sinkron); server lalu memanggil `resolveAddressValues` (`lib/manifest/address.ts`): hierarki wilayah lewat `prepareAddressData`, `text` = `formatAddressLine` dari nama DB (tak pernah dari klien). Dipanggil route data jamaah admin dan pembuatan jamaah baru (`lineItems.ts`). `ManifestFieldsForm` merender `AddressPicker`; `snapshotFromCard` mengisi field `address` dengan alamat kartu (objek) dan field teks dengan `text`. Tak ada pembaca generik nilai field hari ini (`getFieldByRole` hanya menerima string), jadi objek alamat tak bocor ke tampilan nama.
4. **SEC-192** — `invoiceData`/`revise` memakai `select` (`BOOKING_PILGRIM_SAFE_SELECT`); penjaga sumber diperluas ke `lib/` dan pola `pilgrims: true`/`include` relasi pilgrims.

**Bukti yang direncanakan:** uji layanan + route (jamaah lain → 404, kartu akun lain → 404, tanpa onboarding → ditolak), alamat (hierarki salah → 400, `text` dari DB bukan klien, snapshot dari kartu), penjaga SEC-107 menemukan route baru, browser jamaah: tautkan → checklist → unggah tiket → lepas diblokir selama ada dokumen.

### 5.6 As-built Fase 7b (2026-11-03)

- **Route jamaah** `app/api/v1/bookings/[id]/pilgrims/[pilgrimId]/{card,documents,documents/[docId]}` — aktor = sesi (`requirePilgrimActor`, staf 403); booking/jamaah/kartu/dokumen akun lain = 404 seragam (layanan 7a + `tripScopeOf` dengan pemilik = sesi). PUT/POST: `onboardingRefusal` + batas IP + batas per akun di layanan; DELETE: batas IP (tanpa gerbang onboarding — hak jamaah membersihkan datanya). **Jamaah hanya menambah pada booking `active`** (`pilgrimBookingState` → 409 `closedBooking`); lihat/hapus/lepas tetap terbuka.
- **UI jamaah** `PilgrimTripPanel` (folder halaman booking jamaah): pilih dari Jamaah Saya, Pakai / Perbarui / Lepas dengan konfirmasi sebaris, checklist (`bookingChecklists`, label satu sumber `lib/documents/checklistLabels.ts` dipakai juga panel admin), `DocumentRepeater` dokumen per perjalanan.
- **Alamat (D1)** — `lib/manifest/addressValue.ts` (murni: bentuk, `isEmptyAddress`, `toPickerAddress`), `lib/manifest/address.ts` (`resolveAddressValues(fields, values, db)` — hierarki lewat `prepareAddressData(input, db)` dan nama wilayah lewat koneksi yang sama (transaksi booking, bukan koneksi pool kedua); `text` dari DB, nilai klien dibuang). Dipanggil route data jamaah admin dan `sealNewPilgrim` (checkout). `ManifestFieldsForm` merender `AddressPicker`; aturan "kosong" checkout = `isEmptyValue` (termasuk alamat tanpa baris jalan). Batas: ≤ 2000 jamaah per booking, kode wilayah ≤ 20 karakter.
- **SEC-192** — `BOOKING_PILGRIM_SAFE_SELECT` dipindah ke `lib/pilgrims/safeSelect.ts` (tanpa impor layanan); `invoiceData`, `revise`, rute status visa memakai `select`; tulis tunggal `bookingPilgrim.update|create|upsert|delete` wajib `select`. Penjaga `unsafePilgrimReads` (scripts/test-booking-link.ts) di `app|lib|components`: relasi `pilgrim(s)`/`bookingPilgrims` `true` atau tanpa `select`, `find*`/tulis tunggal tanpa `select`, `SELECT *` dari `booking_pilgrims` — diuji mutasi. Sisa diketahui: relasi lewat konstanta (`pilgrims: X`) tak diperiksa.
- **SEC-193 ditutup (salah identifikasi)** — draf tak menyimpan `fieldValues`.
- **Bukti** — `scripts/test-booking-link.ts` (+ alamat D1 dengan wilayah uji, booking aktif saja, mutasi penjaga), `test-customers-create` menemukan route baru (mutasi tanpa `onboardingRefusal` → merah), seluruh `bun run test` hijau, `bun run build` 0 error; browser jamaah (akun uji sementara, dihapus): pilih kartu → nama + checklist terisi; API: unggah tiket 201, lepas saat ada dokumen 409, booking asing 404, field asing 400, pratinjau `no-store`, sesudah lepas dokumen 404, tautkan ulang 200; log server bersih.

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

### 7.5 As-built Fase 4 (2026-11-03)

- **Skema** (migrasi `20261113090000_pilgrim_documents`): `DocumentType` (katalog; `key` tetap, `reusable`, `icon` dari daftar putih `lib/documents/icons.ts`, `hasExpiry`/`minValidityMonths`, `referenceLabel`/`referencePattern`, `allowMultiple`, `isSystem`, `isActive`, `order`) + `PilgrimDocument` (berkas per kartu: `objectKey` unik, `mimeType` ∈ webp/pdf, `sizeBytes` ≤ 5 MB, `sha256`, `issuedAt`/`expiresAt` `@db.Date`, `status` pending/accepted/rejected + `rejectReason`, peninjau, pengunggah; FK kartu/jenis/pengunggah `Restrict`, peninjau `SET NULL`). CHECK DB menjaga bentuk kunci, pola referensi butuh label, `rejected ⇔ rejectReason`, awalan kunci objek `saved-pilgrims/`, `issuedAt < expiresAt`. 8 jenis bawaan §7.1 di-INSERT migrasi.
- **Satu penulis** `lib/documents/`: `service.ts` (`upload`/`remove`/`previewUrl`, `listCardDocuments`, `uploadableTypes`), `types.ts` (CRUD katalog; bawaan tak bisa diubah sifatnya dan hanya dinonaktifkan; jenis yang sudah dipakai berkas → nonaktif), `purge.ts` (baris dokumen saat kartu/akun dihapus), `file.ts` (pemeriksa isi), `storage.ts` (batas MinIO yang bisa diganti di tes), `http.ts` (lapisan HTTP bersama).
- **Berkas**: jenis ditentukan dari ISI (magic bytes) — nama berkas/MIME klien tidak dipakai. Gambar didekode + dienkode ulang ke WebP (sisi terpanjang 2000 px, kualitas 85, orientasi diterapkan, EXIF/GPS dibuang); PDF diterima apa adanya bila berheader `%PDF-` + `%%EOF` dan tanpa token aksi aktif (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`). `Content-Length` diperiksa SEBELUM `formData()` (tanpa panjang 411, terlalu besar 413); field daftar putih, tepat satu berkas.
- **Kunci objek** `saved-pilgrims/{pemilik}/{kartu}/{jenis}/{ms}-{acak8}.{ext}` — DEVIASI dari §7.3 (diawali pemilik, bukan kartu) supaya hapus akun menyapu semua berkas akun lewat satu awalan meski kartunya sudah tiada; nama asli tak pernah dipakai. `deleteObjectsByPrefix` hanya menerima `saved-pilgrims/<uuid>/` dan `saved-pilgrims/<uuid>/<uuid>/` (D7).
- **Konsistensi**: urutan kunci = baris `users` pemilik `FOR SHARE` (`lockCardOwner`, sama dengan layanan kartu) → kartu `FOR UPDATE`; berkas diunggah sebelum transaksi dan dihapus bila transaksi gagal; objek yang diganti/dihapus dibuang SESUDAH commit (best-effort, sisa tersapu awalan). Jenis `allowMultiple = false` → unggahan baru menggantikan baris + objek lama (K12). Batas 30 berkas per kartu; kartu terarsip tak bisa diubah (409).
- **Pola kode referensi** ditulis admin, dijalankan server: diurai per segmen (kelas/literal, kuantor berbatas `{n}`/`{n,m}` ≤ 40, paling banyak satu kuantor variabel) — bentuk regex bebas ditolak (SEC-182, ReDoS).
- **Cakupan F4**: hanya jenis `reusable` + aktif yang bisa diunggah ke kartu; jenis per perjalanan (tiket/reservasi) menempel ke booking di F7. Status `pending` saat unggah; penilaian admin di F6.
- **API**: jamaah `GET`/`POST /account/pilgrims/[id]/documents`, `GET` (URL presigned 15 menit, `no-store`)/`DELETE …/[docId]` — `requirePilgrimActor`, unggah digerbang `onboardingRefusal`, hapus tidak (hak subjek data); admin `…/admin/customers/[id]/pilgrims/[cardId]/documents[/docId]` (`requireCustomerManage`, tercatat sebagai unggahan petugas); katalog `…/admin/products/document-types[/id]` (`requireManager`). Batas laju `pilgrimDocUser` 60/jam, `pilgrimDocStaff` 600/jam, `pilgrimDocIp` 120/jam. DTO tanpa `objectKey`/`sha256`/id pengunggah (hanya `byStaff`).
- **UI**: `components/shared/documents/DocumentRepeater.tsx` (+ nilai murni `documentRows.ts`) di editor kartu jamaah dan kartu admin; konfirmasi hapus sebaris (pola `DeleteBox`), bukan `ConfirmDialog`. Katalog di **Produk → Jenis Dokumen** (manager+, `CatalogList`/`CreatePage`/`EditPage`) — DEVIASI dari §7.1 ("Sistem"): jenis dokumen adalah data produk yang diatur manager, sejajar katalog produk lain.
- **Rute lama** `POST /pilgrims/[bookingId]/[pilgrimId]/documents` kini memakai `prepareDocumentFile` (menutup D3/SEC-164); model `Document` lama tetap sampai F7 (DEVIASI: §13 menyebut `PilgrimDocument` "menggantikan" `Document` di F4 — penggantian rujukan booking menunggu F7 bersama `bookingId`/tautan dokumen booking). `validateUpload` (percaya MIME klien) dihapus dari `lib/storage/minio.ts`.
- **Hapus**: kartu dihapus sungguhan → baris dokumen dihapus di transaksi, objek + awalan kartu disapu sesudah commit; hapus akun → objek dokumen kartu dihapus di dalam transaksi sebelum baris (gagal → `storage_failed`, rollback), sapu `saved-pilgrims/{userId}/`; `ErasureCounts.pilgrimDocuments`.
- **Penjaga klien**: proyek tak memakai paket `server-only`; penjaga impor transitif `scripts/test-pii.ts` diperluas ke `lib/documents/{service,file,storage,types,purge,http}`.
- **Bukti**: `scripts/test-pilgrim-documents.ts` (15 uji: exe berganti nama .jpg ditolak, EXIF/GPS hilang, sisi 2000 px, pola ReDoS ditolak, cakupan 404, ganti menghapus objek lama, unggah staf, kartu arsip 409, batas, hapus-aman katalog, balapan hapus jenis → 400, PDF ber-escape `#xx` ditolak, penjaga satu penulis), `test-deletion` (+uji dokumen kartu); curl 34 kasus terhadap server + MinIO sungguhan (presigned menyajikan WebP tanpa EXIF, objek tanpa tanda tangan 403, objek lama 404 sesudah diganti, 401/403/404/400/413/422); browser jamaah (unggah, hapus) + admin (bagian Dokumen kartu, buat → ubah → hapus jenis dokumen).

---

### 7.6 Rancangan rinci Fase 5 (2026-11-03, sebelum eksekusi)

Recheck §3 terhadap kode dan data dev: `DocumentRequirement` masih `docType` teks (3 baris visa: `passport`, `ktp`, `kartu_keluarga`), `VisaProduct.requirements` (Json) hanya duplikat dual-write, tabel `documents` kosong. Drift kecil: `REQUIRED_DOCUMENTS` memakai kunci `evaksin`/`etiket` yang tak ada di katalog (`vaccine`/`flight_ticket`), dan `DOC_LABEL` menduplikasi label katalog. Konsumen lama: halaman booking jamaah + admin, rute dokumen booking lama, ZIP admin, `DocumentGrid`/`UploadModal`/`useDocuments`/`PilgrimDocuments`/`DocumentCard`, katalog publik `/visa`.

- **Skema**: `DocumentRequirement` = `productType`, `productId`, `documentTypeId` (FK `Restrict`), `label` opsional (null = label katalog), `description`, `required`, `order`; unik `(productType, productId, documentTypeId)`. Migrasi memetakan `docType` → kunci katalog (`passport`; `ktp`; `kk`/`kartu_keluarga` → `kk`; `evaksin`/`vaksin`/`vaccine` → `vaccine`; `etiket`/`flight_ticket` → `flight_ticket`) — kunci tak dikenal atau duplikat sesudah pemetaan → migrasi GAGAL (fail-closed). `VisaProduct.requirements` dihapus sesudah dicek setiap entrinya punya baris syarat (fail-closed).
- **Satu penulis** `lib/documents/requirements.ts`: `writeRequirements(tx, productType, productId, items)` (ganti-semua, jenis harus ada & aktif kecuali sudah ada di daftar), `loadRequirements`/`requirementsOf` (baca + info jenis), `deleteRequirementsOf(tx, scope)` (hapus produk), `DEFAULT_REQUIREMENTS` per jenis produk. Registry pemilik: hanya `visa` di F5 — produk lain menyusul saat masuk booking (F7); **Haji tidak** (Visa Haji konsep tersendiri). Visa baru tanpa daftar → bawaan paspor, KTP, KK, tiket PP (wajib), bisa diubah.
- **Evaluator** `lib/documents/completeness.ts` (murni, aman di klien): `mergeRequirements` (gabungan syarat beberapa produk per `documentTypeId`; wajib bila salah satu wajib) + `evaluateCompleteness({ requirements, documents, referenceDate })` → status per syarat `missing | rejected | expired | too_short | pending | accepted`, `ready` (semua wajib pending/accepted) dan `verified` (semua wajib accepted, dipakai F6). Masa berlaku: `expiresAt` harus ≥ `addMonths(referenceDate, minValidityMonths)` (tanggal kalender, akhir bulan dijepit; paspor 6 bulan); tanpa `minValidityMonths` cukup ≥ `referenceDate`. `referenceDate` = tanggal berangkat bila diketahui, selain itu hari ini (zona aplikasi). `addMonths` ditambahkan ke `lib/time/`.
- **Editor** tab Persyaratan Visa ditulis ulang: jenis dipilih dari katalog (`ChoiceSelect`), label pengganti opsional, petunjuk, wajib/opsional, urutan; tidak ada lagi kunci teks bebas.
- **Konsumen lama**: `REQUIRED_DOCUMENTS`, `DOC_LABEL`, `VisaRequirement`, `getRequirements.ts` dihapus (D5); jamaah tanpa syarat produk = tidak ada dokumen wajib; rute lama menerima kunci syarat produk saja dan menghitung kelengkapan lewat evaluator (D8: satu evaluator).
- **Bukti**: tabel uji evaluator (gabungan, status, paspor 5 bln 29 hr vs 6 bln tepat, akhir bulan) di beberapa `TZ`; migrasi fail-closed diuji; penjaga penulis tunggal `documentRequirement`; build + browser editor Visa.


### 7.7 As-built Fase 5 (2026-11-03)

- **Skema** (migrasi `20261114090000_document_requirements_catalog`): `DocumentRequirement.docType` (teks) diganti `documentTypeId` (FK `document_types`, `Restrict`); `label` nullable (null = label katalog), CHECK label 2–80 dan petunjuk ≤ 300; unik `(productType, productId, documentTypeId)`. Migrasi memetakan kunci lama sesuai §7.6 dan GAGAL bila ada kunci tak dikenal, duplikat sesudah pemetaan, atau entri `visa_products.requirements` tanpa baris syarat; baru sesudah itu kolom Json dihapus. Data dev: `passport`/`ktp`/`kartu_keluarga` → `passport`/`ktp`/`kk`, label lama dipertahankan sebagai label pengganti. `DocumentType` yang menjadi syarat tak bisa dihapus (dihitung di `lib/documents/types.ts` → dinonaktifkan dengan pesan).
- **Satu penulis** `lib/documents/requirements.ts`: registry `REQUIREMENT_OWNERS` (hanya `visa`; mengunci baris produk `FOR UPDATE`), `requirementsOf`/`requirementsOfMany` (satu kueri, kunci `tipe:id`), `writeRequirements(tx, …)` ganti-semua (produk tak ada → 404; jenis tak ada → 400 berindeks `requirements.i.documentTypeId`; jenis nonaktif hanya boleh bila sudah dipakai produk itu), `writeDefaultRequirements` (visa baru tanpa daftar: paspor, KTP, KK, tiket PP — jenis aktif saja), `deleteRequirementsOf` (dipanggil `lib/admin/productDelete.ts` dan `lib/haji/delete.ts`). Validator `documentRequirementListSchema` (`.strict()`, ≤ 30 baris, tanpa jenis ganda). Kesalahan di dalam transaksi produk dilempar `RequirementRejected` → 400 + `meta.field`, produk dan syarat ter-rollback bersama.
- **Evaluator** `lib/documents/completeness.ts` (murni, aman di klien): `mergeRequirements` (per jenis, urutan kemunculan pertama, wajib bila salah satu wajib, masukan tak diubah), `validUntilNeeded`, `evaluateCompleteness` → status per syarat (berkas TERBAIK per jenis dipakai: missing < rejected < expired < too_short < pending < accepted), `ready`, `verified`, `missingRequired`. Masa berlaku dihitung atas tanggal kalender lewat `addMonths` baru di `lib/time` (akhir bulan dijepit: 31 Agu + 6 bln = 28/29 Feb); jenis bermasa minimum tanpa tanggal berlaku → `too_short`. `checkValidity: false` untuk model `Document` lama (tanpa tanggal berlaku) — dipakai rute dokumen booking lama sampai F7.
- **Editor** `components/admin/documents/RequirementsEditor.tsx` (+ nilai murni `requirementRows.ts`) — satu komponen untuk semua pemilik syarat; tab Persyaratan Visa memakainya (`RequirementsTab.tsx` lama dihapus). Jenis dari katalog Produk → Jenis Dokumen (`ChoiceSelect`, hanya jenis aktif yang belum dipakai), label pengganti, petunjuk, wajib/opsional, urutan; disimpan bersama produk dalam satu `PUT` (penanda belum-disimpan + buang perubahan ikut mencakup syarat).
- **Konsumen lama** dipindah ke `requirementsOfMany`: halaman booking jamaah + admin, katalog publik `/visa` (cadangan teks lama dihapus), ZIP admin (label katalog), `DocumentGrid`/`UploadModal`/`useDocuments`/`PilgrimDocuments`/`DocumentCard` (tipe `RequirementView`). Dihapus (D5): `REQUIRED_DOCUMENTS`, `DOC_LABEL`, `DocType`, `lib/types/visa.ts` (`VisaRequirement`), `lib/documents/getRequirements.ts`. Rute lama menghitung kelengkapan lewat evaluator (D8).
- **Bukti**: `scripts/test-document-completeness.ts` (murni; tabel paspor 5 bln 29 hr → kurang, 6 bln tepat → cukup, akhir bulan + kabisat; status, berkas terbaik, ready/verified, gabungan, nilai editor, validator) lulus identik di UTC/Jakarta/Riyadh/Los Angeles, uji mutasi (`<` → `<=`, gabungan wajib) merah; `scripts/test-document-requirements-migration.ts` (6 skenario fail-closed); `scripts/test-document-requirements.ts` (DB: ganti-semua berurutan, 400/404 tanpa setengah tertulis, jenis nonaktif, bawaan, baca banyak, hapus produk, penjaga satu penulis + daftar lama tak kembali + klien tak mengimpor penulis); penjaga transitif `test-pii.ts` diperluas ke `lib/documents/requirements.ts`.

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

### 8.4 Rancangan rinci Fase 6 (2026-11-03, sebelum eksekusi; sesudah F7)

**Recheck kode (2026-11-03):** `PilgrimDocument.status/rejectReason/reviewNote/reviewedById/reviewedAt` SUDAH ada (F4, CHECK `rejected ⇔ rejectReason`), `PilgrimIdentity.lastVerifiedAt` ada; BELUM ada: `BookingPilgrim.reviewStatus/submittedAt/verifiedAt/verifiedById`, enum `PilgrimReviewStatus`, `PilgrimReviewEvent`, `BookingPilgrimDocument`, layanan/route/antrean/notifikasi apa pun. Penulis identitas hanya `lib/pilgrims/service.ts`, penulis dokumen hanya `lib/documents/` — F6 menambah fungsi di sana, bukan penulis baru. `evaluateCompleteness` sudah memberi `ready`/`verified`.

**Keputusan pemilik (2026-11-03):** dokumen yang dipakai pengajuan BOLEH diganti/dihapus kapan saja; pengajuan booking **aktif** yang memakainya (diajukan/terverifikasi) otomatis kembali ke `submitted` untuk ditinjau ulang, tercatat di riwayat. Booking selesai/batal tidak terpengaruh. Maka `BookingPilgrimDocument.pilgrimDocumentId` = `ON DELETE CASCADE` (bukan Restrict seperti draf §5).

**Rancangan:**
1. **Skema** (migrasi `pilgrim_review`): enum `PilgrimReviewStatus`; `BookingPilgrim.reviewStatus` (default `draft`) + `submittedAt`/`verifiedAt` (`timestamptz`) + `verifiedById` (FK SetNull) + indeks antrean; CHECK `verified ⇔ verifiedAt`, status ≠ draft ⇒ `submittedAt`. `PilgrimReviewEvent` append-only (trigger menolak UPDATE/DELETE kecuali kolom `note` dikosongkan oleh hapus akun; cascade bersama jamaah booking). `BookingPilgrimDocument` (cascade kedua sisi).
2. **Satu penulis status pengajuan** `lib/pilgrims/review.ts`: `submitPilgrim` (pemilik booking atau staf; booking `active`; kartu tertaut; field wajib lengkap (`completeness`) + `evaluateCompleteness().ready`; dari `draft|needs_revision`; menautkan dokumen kartu + perjalanan yang tidak ditolak untuk jenis yang disyaratkan), `decidePilgrim` (staf; hanya dari `submitted`; `verified` hanya bila data lengkap DAN `evaluateCompleteness().verified`; `needs_revision` wajib catatan), `reopenForChangedDocument(tx, docIds)` (dipanggil `lib/documents/service.ts` sebelum mengganti/menghapus — `submitted|verified` pada booking aktif → `submitted`, `verifiedAt` dikosongkan, event). Kunci: `users` pemilik FOR SHARE → `booking_pilgrims` FOR UPDATE (urutan 7a). Setiap transisi = satu `PilgrimReviewEvent` + email ke pemesan lewat `notify()` (event baru `pilgrim_review`, email saja) sesudah commit.
3. **Peninjauan dokumen** `lib/documents/review.ts` (`reviewDocument`: staf; `accepted` atau `rejected` + alasan + catatan opsional), dicakup lewat jamaah booking (dokumen milik kartu tertautnya: kartu atau perjalanan booking ini). Saran: paspor `too_short`/`expired` → alasan `expired` tersaran di UI.
4. **Data kanonik** — `verified` memanggil `applyVerifiedSnapshot(tx, identityId, …)` di `lib/pilgrims/service.ts`: nama/jenis kelamin/tempat-tanggal lahir/kebangsaan dari snapshot berperan, `lastVerifiedAt`, event `canonical_updated` (tanpa PII di detail), di bawah advisory lock identitas yang sama.
5. **Penguncian** — selama `submitted|verified`: tautkan/perbarui/lepas kartu dan edit data jamaah admin ditolak 409 ("kembalikan dulu"); revisi booking sudah mengunci jamaah bertaut (R3). Status visa `submitted_to_syarikah` mensyaratkan jamaah `verified`.
6. **Route** — jamaah `POST /api/v1/bookings/[id]/pilgrims/[pid]/submit` (onboarding + batas IP); admin `POST …/admin/bookings/[id]/pilgrims/[pid]/submit` (atas nama), `POST …/review` (`verified|needs_revision`, catatan), `PUT …/documents/[docId]/review` (dokumen kartu/perjalanan jamaah itu). Semua `.strict()`, `requireBookingManage` untuk admin.
7. **UI** — admin: panel jamaah booking menampilkan status pengajuan + riwayat, daftar dokumen yang disyaratkan dengan Terima/Tolak (alasan + catatan), tombol Verifikasi / Kembalikan (catatan wajib) / Ajukan atas nama; menu Booking → **Verifikasi Jamaah** (`/admin/verifikasi-jamaah`: `DataTable` berpaginasi server, `FilterSelect` status, cari kode booking; baris → halaman booking). Jamaah: status + catatan pengembalian + tombol "Ajukan untuk diperiksa" di `PilgrimTripPanel` (aktif bila lengkap).
8. **Hapus akun** — `PilgrimReviewEvent.note` dan `PilgrimDocument.reviewNote` akun → dikosongkan (`lib/account/deletion.ts` + penyapuan).

**Bukti yang direncanakan:** transisi tak sah ditolak (ajukan dua kali, verifikasi dari draft, jamaah memverifikasi), `verified` mustahil bila dokumen wajib belum diterima, ganti paspor sesudah terverifikasi → kembali `submitted` (+ booking selesai tak berubah), e2e: unggah → tolak (kedaluwarsa) → ganti → ajukan ulang → verifikasi → identitas kanonik berubah; `test-deletion` mengosongkan catatan; antrean terdaftar di uji kit tabel/peran.


### 8.5 As-built Fase 6 (2026-11-03)

**Skema** (migrasi `20261116090000_pilgrim_review`): enum `pilgrim_review_status`; `booking_pilgrims.reviewStatus` (bawaan `draft`) + `submittedAt`/`verifiedAt` (`timestamptz`) + `verifiedById` (FK SET NULL) + indeks antrean `(reviewStatus, submittedAt)`; CHECK `verified ⇔ verifiedAt`, status ≠ draft ⇒ `submittedAt`, `verifiedById` hanya bila verified. `pilgrim_review_events` (cascade bersama jamaah booking; trigger `pilgrim_review_events_no_change` menolak UPDATE/DELETE kecuali `note`→NULL, `actorId`→NULL, dan DELETE cascade sesudah induk terhapus; catatan ≤ 2000). `booking_pilgrim_documents` (cascade kedua sisi).

**Kode:**
- `lib/pilgrims/review.ts` — SATU-SATUNYA penulis status/riwayat/tautan dokumen: `submitPilgrim` (pemesan/staf; booking `active`; kartu tertaut; field wajib `completeness` + `evaluateCompleteness().ready`), `decidePilgrim` (staf; dari `submitted`; `verified` dinilai ULANG dari data hidup dengan dokumen dikunci FOR SHARE, `needs_revision` wajib catatan), `reopenForChangedDocument` (dipanggil `lib/documents/service.ts` saat mengganti/menghapus dan `lib/documents/review.ts` saat menolak), `reviewHistoryOf` (nama petugas hanya untuk staf). Email `pilgrim_review` (tanpa nama jamaah/catatan) sesudah commit untuk keputusan petugas dan pengajuan atas nama.
- `lib/pilgrims/reviewState.ts` — label/tone/kunci (`isReviewLocked`), aman di klien.
- `lib/documents/review.ts` — `reviewDocument` (terima/tolak + alasan wajib saat tolak + catatan), `reviewPreviewUrl` (URL presigned lewat cakupan jamaah booking).
- `lib/pilgrims/service.ts` `applyVerifiedSnapshot` — kanonik identitas dari snapshot berperan (nama, jenis kelamin, tempat/tanggal lahir, kebangsaan bila kode ISO), `lastVerifiedAt`, jejak `canonical_updated` (detail tanpa PII).
- Kunci selama `submitted|verified` (booking aktif): tautkan/perbarui/lepas kartu (`bookingLink`, ditolak SEBELUM mengunci kartu) dan edit data admin → 409. Visa `submitted_to_syarikah` → 422 bila belum `verified`.
- Route: jamaah `POST /api/v1/bookings/[id]/pilgrims/[pid]/submit`; admin `POST …/submit`, `POST …/review`, `GET|PUT …/documents/[docId]/review`.
- UI: `PilgrimReviewPanel` (admin, halaman booking), antrean `/admin/verifikasi-jamaah` (menu Operasional), status + catatan + "Ajukan untuk diperiksa" di `PilgrimTripPanel` (jamaah).
- Hapus akun: `note` riwayat dikosongkan (`lib/account/deletion.ts` + penyapuan); dokumen kartu ikut terhapus bersama kartunya.

**Deviasi dari §8.4 (diputuskan saat eksekusi):**
1. **Hanya pengajuan `verified` yang dibuka ulang** saat dokumen berubah; yang masih `submitted` dibiarkan (belum diputus, dan keputusan selalu menilai ulang dokumen hidup) — menghindari riwayat ganda tanpa perubahan status.
2. **Pembukaan ulang ditentukan dari kolom baris jamaah booking** (`savedPilgrimId` + status, dikunci FOR UPDATE) + syarat produk, bukan dari `booking_pilgrim_documents` — supaya penilaian ulang Postgres sesudah menunggu kunci (READ COMMITTED) tetap benar; tautan tetap dicatat sebagai bukti "dokumen yang dipakai".
3. **`applyVerifiedSnapshot` tidak menulis baris kartu** (status cocok kartu dihitung ulang pada penulisan kartu berikutnya): menulis kartu sambil memegang jamaah booking bisa deadlock dengan layanan dokumen (kartu → jamaah booking). Dicatat untuk Fase 8 (tampilan konflik dihitung saat dibaca).
4. Pemesan tidak diberi email atas pengajuannya sendiri; pengajuan ulang otomatis (dokumen berubah) tidak mengirim email.
5. **Urutan kunci verifikasi (SEC-200):** `decidePilgrim(verified)` mengunci dokumen kartu `FOR SHARE` SEBELUM jamaah booking — urutan dokumen → jamaah booking sama dengan layanan dokumen, yang kini mengubah/menghapus dokumen DULU baru membuka ulang. Tolak/ganti serentak menunggu keputusan lalu membuka ulang, atau keputusan menunggu lalu menilai dokumen yang sudah berubah.
6. **Syarat bertambah (SEC-201):** revisi booking yang memasang visa paket ke jamaah terverifikasi memanggil `reopenForChangedRequirements` (→ `submitted` + catatan). Status booking `active` dibaca ulang di dalam kunci (SEC-203); rute status visa membaca status pemeriksaan `FOR SHARE` di transaksi update (SEC-202).

7. **Pemisahan tugas = pengingat, bukan blokir (keputusan pemilik 2026-11-03).** Petugas yang mengajukan atas nama pemesan BOLEH menerima dokumen dan memverifikasi sendiri (tim kecil bisa hanya satu petugas). Bila pengajuan yang sedang ditinjau diajukan oleh petugas yang melihat, `PilgrimReviewPanel` menampilkan pengingat dan dialog verifikasi menyebutkannya — tidak menolak. Dasarnya `reviewHistoryOf(ids, true, viewerId)` → `byViewer` (hanya untuk staf, tak pernah ke pemesan); jejak pelaku tiap langkah tetap di `pilgrim_review_events.actorId` + `verifiedById` untuk audit. Dijaga `scripts/test-pilgrim-review.ts`.

**Bukti:** `scripts/test-pilgrim-review.ts` (12 skenario, termasuk uji kunci deterministik SEC-200 dan syarat bertambah SEC-201: transisi tak sah, verifikasi mustahil sebelum dokumen diterima, kanonik + jejak tanpa PII, buka ulang ganti/hapus/tolak, booking selesai tak terpengaruh, cakupan 404, trigger/CHECK/cascade, penjaga sumber); `test-deletion` (catatan dikosongkan, pemindai kolom pelaku); `test-notify`/`test-email` (event baru, email saja).

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
| **2 — SELESAI 2026-11-02** | Skema identitas + kartu + `PilgrimIdentityEvent`, cek kunci indeks/enkripsi di DB (SEC-168), `server-only` (SEC-170), FK `BookingPilgrim.userId` (D2) + `savedPilgrimId`/`identityId`; `lib/pilgrims/service.ts` (dedup §4.1, advisory lock, pengecualian bayi); rate limit; perlakuan hapus akun | tes dedup (baru/cocok/konflik/ganda sendiri/bayi), **tes orakel**, simpan NIK sama serentak → satu identitas (uji deterministik), `test-deletion` + `test-admin-delete` hijau |
| **3 — SELESAI 2026-11-02** | API + UI **Jamaah Saya** (CRUD, "Saya sendiri", `AddressPicker`, `ContactPicker`) + admin membuat/mengubah kartu atas nama pelanggan di detail pelanggan | curl termasuk yang DITOLAK (kartu akun lain → 404, field asing → 400, tanpa onboarding → ditolak); e2e browser; terdaftar di `test-admin-editor`/`test-admin-create`/`test-table-consistency` |
| **4 — SELESAI 2026-11-03** | Dokumen: `DocumentType` (CRUD + bawaan), `PilgrimDocument` menggantikan `Document`, layanan unggah (cek isi, konversi WebP, sha256, ganti = hapus lama), `DocumentRepeater`, admin boleh unggah (D3, D4, D7), hapus akun | berkas palsu (exe berganti nama .jpg) DITOLAK, hasil WebP tanpa EXIF dan MRZ terbaca, objek tak bisa diakses tanpa presigned, `test-deletion` hijau; security review subagent |
| **5 — SELESAI 2026-11-03** | Syarat per produk: `DocumentRequirement.documentTypeId`, editor syarat di Visa (lalu produk lain), `lib/documents/completeness.ts` + aturan paspor 6 bulan; hapus `VisaProduct.requirements`/`REQUIRED_DOCUMENTS` (D5, D8) | kelengkapan per produk benar (tabel uji), paspor 5 bln 29 hr vs 6 bln tepat di beberapa `TZ` |
| **6** (dikerjakan SESUDAH F7 — urutan ditukar 2026-11-03, §5.3) | Pengajuan & verifikasi (§8): status per jamaah + per dokumen, ajukan/kembalikan/verifikasi, riwayat, notifikasi, pembaruan data kanonik, antrean **Verifikasi Jamaah** admin (D9) | transisi tak sah ditolak; `verified` mustahil bila ada dokumen wajib belum diterima; e2e: unggah → tolak (kedaluwarsa) → perbaiki → ajukan ulang → verifikasi |
| **7** (dikerjakan SEBELUM F6, §5.3; **7a SELESAI 2026-11-03** §5.4, **7b SELESAI 2026-11-03** §5.6) | Integrasi booking: pilih kartu di Data jamaah (admin; front-end pelanggan menyusul engine v2 Fase 11), snapshot via pengikat `role`, tautan dokumen, `fieldType='address'` sungguhan (D1) | e2e: kartu → booking → snapshot tetap setelah kartu diedit; manifest/ZIP admin benar |
| **8 — SELESAI 2026-11-03** (§4.5) | Gudang admin: daftar identitas (cari nama trigram / NIK tepat via hash), konflik & kemungkinan duplikat, gabung/lepas, buka NIK berjejak, hapus identitas (hak subjek data); rapikan dokumen basi (D6) | tes peran (jamaah tak bisa mencapai satu pun route), jejak `PilgrimIdentityEvent` lengkap; security review subagent |

---

## 14. Konfirmasi kecil (DIJAWAB pemilik 2026-11-02: "Setuju semua usulan")

1. **C1 — Bayi tanpa NIK**: diizinkan bila usia **di bawah 2 tahun** menurut tanggal lahir; NIK dilengkapi begitu tercantum di KK.
2. **C2 — Jamaah WNA**: didukung, kunci = **negara + nomor paspor** (`passportKeyHash`).
3. **C3 — Berkas PDF**: diterima **apa adanya** (maks 5 MB, tidak dikonversi); gambar selalu dikonversi ke WebP.

## 15. Referensi silang
`docs/arsitektur-manifest.md` (snapshot `fieldValues`, `role`), `docs/arsitektur-dokumen.md` (`DocumentRequirement`), `docs/arsitektur-alamat.md` (`Address`, `upsertAddress`), `docs/arsitektur-komponen-kontak.md` (`ContactPicker`), `docs/arsitektur-hapus-akun.md` (anonimisasi, sapuan), `docs/arsitektur-booking-engine-v2.md` §10.3 (data jamaah setelah terbit), `docs/arsitektur-media.md` (cek isi + enkode ulang), `docs/arsitektur-auth.md` (`onboardingRefusal`), repo smart-ai (berkas architecture-pmb) (pola verifikasi per dokumen + status pengajuan).
