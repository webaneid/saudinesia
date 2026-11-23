# Arsitektur — Katalog Data Jamaah + Saklar per Produk

> **Status: RENCANA DISETUJUI (2026-11-24, keputusan K1–K3 di §7); D1 SELESAI (2026-11-24, as-built §8).** D2–D5 belum. Menggantikan
> pengatur kolom per produk di `docs/arsitektur-manifest.md` §9 (tab "Data jamaah" visa, sejak 2026-11-24 disembunyikan).

## 1. Permintaan pemilik (2026-11-24)

> "saya ingin data jamaah punya menu khusus dibawah jenis dokumen, tambah data dan lain2 persis dengan table jenis dokumen, agar
> konsisten. lalu disemua produk, tinggal diaktifkan menggunakan toggle apakah butuh data jamaah atau tidak. jadi client kita bisa atur
> sendiri.. apa data default-nya, dan product apa yg butuh data selengkap itu. dan itu berlaku untuk dokumen. bedanya dokumen kita bikin
> custom, masing2 bisa menambah dan menguranginya."

Tujuan yang disebut pemilik:
1. Pelanggan tidak bingung mengisi data jamaah yang berbeda-beda per produk.
2. Satu sumber utama data jamaah untuk tiap pelanggan.
3. Data jamaah dan data akun di front-end konsisten (pengguna pribadi tidak mengisi data yang berbeda-beda).

Inti: **daftar kolom data jamaah = SATU katalog global** (dikelola seperti Jenis Dokumen). **Produk hanya menyalakan/mematikan**
"butuh data jamaah lengkap". Dokumen tetap berbeda: syaratnya dipilih per produk (sudah ada, `RequirementsTable`).

## 2. Hasil recheck dokumen vs kode (SOP langkah 1)

Dibaca: `prisma/schema.prisma` (`ManifestFieldRequirement`, `SavedPilgrim`, `BookingPilgrim`, `DocumentType`), `lib/manifest/*`,
`lib/pilgrims/{extraFields,slots,bookingLink}.ts`, `lib/validators/{booking,pilgrims}.ts`, halaman Jenis Dokumen, data dev.

**Akurat:** `docs/arsitektur-manifest.md` §9 (penulis tunggal `lib/manifest/fields.ts`, 13 peran `MANIFEST_ROLES`, kolom standar
`STANDARD_FIELDS`, larangan label NIK/paspor di kolom bebas), `docs/arsitektur-jamaah.md` §5 (kartu `SavedPilgrim` berkolom tetap,
NIK/paspor disegel lewat `lib/pii`, `fieldValues` = snapshot beku dari kartu lewat `snapshotFromCard`).

**Drift / temuan:**
- `docs/arsitektur-manifest.md` §9 butir 5 masih menyebut tab "Data jamaah" — sejak 2026-11-24 editornya tidak ditampilkan
  (`docs/arsitektur-visa.md` §10). Diperbarui saat rencana ini dieksekusi.
- Kolom jamaah sekarang ditentukan per JAMAAH: visa-nya bila punya visa, selain itu set `core` (sentinel `productType='core'`,
  `productId='default'`, 5 kolom: nama, jenis kelamin, email, HP, WhatsApp). Paket Umroh, Haji, dan produk lain **tidak punya kolom
  sendiri** — jamaah paket tanpa visa sendiri hanya diminta 5 kolom `core`.
- Ada 12 pembaca `getManifestFieldRequirements` / sentinel `core` (lihat §6.1) — semuanya memilih "visa atau core".
- Kolom bebas yang ada (dev): `Nomor HP Host`, `Short Address / Unwan Wathoni` pada satu produk visa — keduanya **data per
  perjalanan**, bukan data pribadi (tidak cocok disimpan di kartu).
- Kartu (`SavedPilgrim`) hanya punya kolom tetap; tidak ada tempat untuk kolom pribadi buatan admin (mis. golongan darah).
- Gap lama (manifest §9): `POST /bookings` tidak memvalidasi isian kolom di server. Rencana ini menutupnya (§5.5).

## 3. Rancangan

### 3.1 Katalog "Data Jamaah" (menu baru: Produk → Data Jamaah, di bawah Jenis Dokumen)

Tabel baru `pilgrim_fields` (model `PilgrimField`) — pola sama `DocumentType`:

| Kolom | Arti |
|---|---|
| `key` (unik, tak pernah berubah) | kunci mesin = kunci di `fieldValues`; dibuat server dari label |
| `label`, `fieldType`, `options` | tampilan dan bentuk isian (katalog `fieldType` yang sudah ada: text, textarea, phone, email, date, select, number, address) |
| `role` (nullable, unik) | pengikat ke kolom kartu (13 peran `MANIFEST_ROLES`) — hanya kolom bawaan |
| `required` | wajib diisi |
| `isSystem`, `isActive`, `order` | bawaan (hanya bisa dinonaktifkan, tipe/peran terkunci), status, urutan |

- **Kolom bawaan** = 13 `STANDARD_FIELDS` (nama, jenis kelamin, tempat & tanggal lahir, kewarganegaraan, NIK, nomor/terbit/kadaluarsa
  paspor, HP, WhatsApp, email, alamat) — sudah ada kolomnya di kartu. Nama Lengkap tak bisa dinonaktifkan dan selalu wajib.
- **Kolom buatan admin** (mis. golongan darah): SEMUA kolom katalog = **data milik jamaah**, disimpan di kartu dan dipakai ulang lintas
  booking (K1: tidak ada kolom "per perjalanan"). Larangan label NIK/KTP/paspor tetap (`looksLikeSealedData`) karena nilainya tidak disegel.
- **Hapus aman** (aturan CRUD pemilik): kolom yang nilainya sudah pernah dipakai (ada di kartu atau booking) → dinonaktifkan, selain itu
  dihapus. Bawaan → hanya nonaktif.

"Data default" pemilik = kolom aktif katalog beserta wajib/tidaknya. Set `core` dihapus (K2: saklar mati = tidak ada data jamaah).

### 3.2 Saklar per produk

Tabel polimorfik `product_pilgrim_data` (`productType`, `productId`, `enabled`) + registry pemilik `PILGRIM_DATA_OWNERS`
(pola `REQUIREMENT_OWNERS`): Visa, Paket Umroh, Haji, Paket Ziarah, Hotel, Transport, Pesawat, Katering, Muthowif (layanan).
Satu penulis `lib/pilgrim-data/products.ts`; penghapus produk membersihkan barisnya (penjaga `test-admin-delete`).

UI: satu komponen `PilgrimDataToggle` ("Minta data jamaah lengkap", tautan ke katalog) di setiap halaman edit produk, dekat
Persyaratan dokumen. Produk baru: bawaan **mati**, kecuali Visa, Paket Umroh, Haji = **nyala** (setara perilaku visa hari ini).

### 3.3 Kolom apa yang diminta untuk satu jamaah booking

Satu fungsi `pilgrimFieldsFor(...)` (pengganti semua pilihan "visa atau core"): **semua kolom aktif katalog bila ada produk ber-saklar
nyala yang berlaku untuk jamaah itu, selain itu TIDAK ADA** (K2):
- produk melekat per jamaah (visa-nya, Paket Umroh/Haji tempat ia jadi anggota) → hanya jamaah itu;
- produk tingkat booking (hotel, transport, pesawat, ziarah, katering, muthowif) → semua jamaah booking itu.

Kata pemilik (K2): pesanan yang produknya tidak butuh data jamaah (mis. sewa bus Jeddah–Madinah 30 kursi) cukup dipesan; manifest dan siapa
penumpangnya kewajiban pelanggan. Data PEMESAN tetap dipegang dari akunnya (email/WhatsApp terverifikasi — jalur notifikasi, termasuk
perkembangan visa). Jamaah booking tanpa kolom dan tanpa syarat dokumen: tak ada yang wajib diisi, tak perlu "Ajukan"; bagian jamaah di
halaman booking pelanggan disembunyikan/ditandai "tidak diperlukan" (rincian di D3/D4). Catatan: `POST /bookings` hari ini mewajibkan
minimal 1 baris jamaah untuk semua pesanan — baris tetap dibuat sebagai slot jumlah orang, tetapi tanpa kewajiban isian.

Data yang sudah tersimpan tetap tampil walau kolomnya kini tak diminta (tampilan membaca katalog + nilai yang ada).

### 3.4 Satu sumber data per pelanggan (front-end)

- **Kartu Jamaah Saya** (`SavedPilgrimFields`) dan profil "Saya sendiri" menampilkan kolom bawaan (kolom kartu) + kolom buatan admin
  dari katalog. Nilai kolom buatan disimpan di kolom baru `SavedPilgrim.extraValues Json` (penulis tetap
  `lib/pilgrims/service.ts`, dibersihkan `lib/account/deletion.ts`).
- Saat kartu ditautkan ke booking, `snapshotFromCard` mengisi kolom bawaan (sudah) DAN kolom buatan admin (baru) — semua data jamaah
  berasal dari kartu. Isian non-kartu oleh pemesan (`lib/pilgrims/extraFields.ts` + route-nya) tidak diperlukan lagi → dihapus di D5.
  Petugas tetap bisa mengisi manual di halaman Kelola jamaah (bila jamaah tanpa kartu).
- Kelengkapan ("data lengkap") dinilai dari daftar §3.3 — satu aturan untuk checkout, halaman jamaah, admin, dan gerbang "Ajukan".

### 3.5 Yang tidak berubah

`fieldValues` tetap snapshot beku (kunci kolom = `key` katalog, tak pernah berubah); NIK/paspor tetap hanya lewat `lib/pii`; syarat
dokumen tetap per produk (`RequirementsTable`, `pilgrimRequirements`); status pemeriksaan jamaah (`lib/pilgrims/review.ts`) tetap.

## 4. Migrasi (fail-closed)

1. Buat `pilgrim_fields`; isi 13 kolom bawaan dari `STANDARD_FIELDS` dengan `key` = `fieldKey` standar (sama di semua produk hari
   ini → nilai `fieldValues` lama tetap terbaca). Label/wajib bawaan diambil dari set `core`.
2. Kolom bebas dari `manifest_field_requirements` (peran null; dev: Nomor HP Host, Short Address) **tidak dibawa** (K1). Nilai lamanya tetap
   di snapshot `fieldValues` booking (tidak dihapus), hanya tidak diminta/ditampilkan lagi.
3. Kolom berperan dengan kunci non-standar → migrasi gagal (tidak ada di dev).
4. `product_pilgrim_data`: semua produk visa yang punya kolom manifest → nyala.
5. Kontraksi (fase terakhir): hapus `manifest_field_requirements`, sentinel `core`, `lib/manifest/fields.ts` +
   `ManifestFieldsEditor` (sudah disembunyikan; digantikan katalog), dengan pemeriksaan tak ada data hilang.


## 5. Fase eksekusi (satu fase = satu PR; SOP: build 0 error → security review → dokumentasi)

| Fase | Isi | Bukti selesai |
|---|---|---|
| **D1** | Skema + migrasi (§4 butir 1–4) + `extraValues` kartu; penulis tunggal `lib/pilgrim-data/` (katalog + saklar); `pilgrimFieldsFor` menggantikan 12 pembaca "visa atau core" — perilaku SAMA dengan hari ini (rekam-bandingkan kolom per jamaah booking sebelum/sesudah) | uji DB sekali pakai: migrasi + penolakan bentrok; perbandingan kolom per jamaah |
| **D2** | Menu **Produk → Data Jamaah**: daftar `CatalogList` (kolom: Kolom · Kode · Tipe · Sifat · Diminta untuk · Status · aksi), halaman `new` (`CreatePage`) dan `[id]` (`EditPage`), hapus aman — persis pola Jenis Dokumen | uji browser + penjaga `test-admin-editor`/`test-admin-create`/`test-table-consistency` |
| **D3** | Saklar `PilgrimDataToggle` di semua halaman edit produk + API; kolom jamaah mengikuti §3.3 (mati = tak ada kewajiban) | uji: produk nyala/mati mengubah kolom jamaah; route menolak non-staf |
| **D4** | Front-end: kartu Jamaah Saya + profil menampilkan kolom `person` buatan admin; snapshot kartu ikut mengisinya; `POST /bookings` & checkout memvalidasi kolom di server (menutup gap manifest §9) | uji browser /id /en, 375 px; penjaga i18n |
| **D5** | Kontraksi §4 butir 5 + hapus isian non-kartu pemesan (`extraFields`) + dokumentasi akhir (`CLAUDE.md`, `arsitektur-manifest.md`, `arsitektur-jamaah.md`, `arsitektur-visa.md`) | migrasi fail-closed diuji; build; grep tak ada pembaca lama |

## 6. Lampiran

### 6.1 Pembaca "visa atau core" yang diganti di D1

`app/[locale]/admin/(protected)/bookings/[id]/pilgrims/[pilgrimId]/page.tsx`, `app/[locale]/admin/(protected)/visa/page.tsx`,
`app/api/v1/admin/bookings/[id]/documents/zip/route.ts`, `app/api/v1/admin/bookings/[id]/pilgrims/[pilgrimId]/route.ts`,
`app/api/v1/manifest/requirements/route.ts`, `components/booking/ManifestFieldsForm.tsx`, `lib/pdf/invoiceData.ts`,
`lib/pilgrims/{bookingLink,extraFields,slots}.ts`, `lib/validators/booking.ts`, `lib/admin/productDelete.ts`/`lib/haji/delete.ts` (pembersihan).

## 7. Keputusan pemilik (2026-11-24)

- **K1 — kolom per perjalanan visa (Nomor HP Host, Short Address): dihapus.** Pemilik: data yang dikumpulkan hanya yang direncanakan sesuai
  kebutuhan; komunikasi perkembangan visa ke pemesan memakai data akun pemesan. Akibatnya semua kolom katalog = data milik jamaah (di kartu).
- **K2 — saklar mati = tidak ada kewajiban data jamaah sama sekali.** Contoh pemilik: sewa bus 30 kursi cukup dipesan; manifest penumpang
  kewajiban pelanggan; data pemesan tetap dipegang.
- **K3 — editor kolom per produk Visa dihapus di D5** setelah katalog berjalan.

## 8. As-built D1 (2026-11-24)

**Skema** (`prisma/schema.prisma`, migrasi `20261212090000_pilgrim_data_catalog`):
- `PilgrimField` → `pilgrim_fields`: `key` unik (CHECK `^[a-z][A-Za-z0-9]{0,63}$`, tak pernah berubah), `label` 1–100, `fieldType`
  (CHECK = `MANIFEST_FIELD_TYPES`), `options` hanya dan wajib untuk `select`, `role` unik (CHECK = `MANIFEST_ROLES`),
  `("role" IS NOT NULL) = "isSystem"`, nama (`display_name`) selalu aktif + wajib (CHECK). Isi awal 13 kolom bawaan; AKTIF: nama, jenis
  kelamin (wajib), email, HP, WhatsApp, nomor & kadaluarsa paspor, kewarganegaraan, tanggal lahir; NONAKTIF: NIK, tempat lahir, terbit
  paspor, alamat (bisa dinyalakan pemilik di D2). Pemeriksaan fail-closed: kolom berperan lama dengan kunci non-standar → migrasi gagal
  (lolos di DB dev).
- `ProductPilgrimData` → `product_pilgrim_data` (`productType` CHECK = `PILGRIM_DATA_OWNERS`, `productId`, `enabled`). **Tak ada baris =
  bawaan pemilik** (Visa/Paket Umroh/Haji nyala, lainnya mati) — §4 butir 4 tidak perlu baris: visa nyala lewat bawaan.
- `SavedPilgrim.extraValues Json` (CHECK objek) — wadah kolom buatan admin di kartu (penulis di D4). Penghapusan akun: kartu dihapus
  utuh (`eraseSavedPilgrimsOf`), kolom ini ikut hilang.

**Kode** (`lib/pilgrim-data/`): `owners.ts` (registry murni), `catalog.ts` (`pilgrimCatalog`, `activeFields`, `displayFields`,
`valueByRole`), `products.ts` (`enabledProducts` — pembaca saklar; penulis di D3), `forPilgrims.ts` (`pilgrimFieldSets`/`pilgrimFieldSet`
= aturan §3.3). Nama fungsi di rencana (`pilgrimFieldsFor`) menjadi `pilgrimFieldSets`.

**Pembaca yang diganti** (§6.1): kelengkapan & "Ajukan" (`lib/pilgrims/review.ts`), tabel jamaah (`slots.ts`), isian tambahan
(`extraFields.ts`), Kelola jamaah admin (halaman + route), nama jamaah di daftar visa / ZIP dokumen / invoice (`valueByRole` atas katalog),
snapshot kartu dan penyegel jamaah baru (`bookingLink.ts`: `linkCard` + `sealNewPilgrim(tx, values)` memakai katalog aktif),
`GET /api/v1/manifest/requirements` (kolom aktif bila saklar produk nyala, selain itu `[]`; `productType` divalidasi registry).
`lib/manifest/getRequirements.ts` dan blok validasi mati di `lib/validators/booking.ts` dihapus. Pembersih saklar saat produk dihapus:
`dropPolymorphic` (+ trip transport), `lib/haji/delete.ts`, DELETE jadwal pesawat dan katering.

**Penyimpangan dari rencana (sadar):**
- Baris rencana D1 "perilaku SAMA dengan hari ini" tidak berlaku lagi sesudah K2: jamaah tanpa produk ber-saklar nyala kini **tidak diminta
  apa pun** (dulu set `core` 5 kolom), dan jamaah ber-visa diminta kolom aktif KATALOG (dulu kolom visa-nya). Kolom visa lama di dev sama
  dengan kolom bawaan kecuali dua kolom bebas yang dihapus K1 — nilai lamanya tetap di snapshot dan tetap TAMPIL (`displayFields`).
- §3.3 "produk tingkat booking → semua jamaah": dipersempit ke **rombongan item** (item tanpa rombongan = semua jamaah), sejalan
  rombongan booking §10.8.
- Selama D2/D3 belum ada, katalog dan saklar hanya bisa diubah lewat migrasi; perilaku bawaan sudah aktif.

**Bukti:** `scripts/test-pilgrim-data.ts` (baru: CHECK = daftar kode, katalog bawaan, CHECK menolak 11 bentuk rusak, aturan diminta per
jamaah termasuk saklar & rombongan, penulis tunggal), `test-booking-link`/`test-pilgrim-extra-fields`/`test-pilgrim-review` (katalog uji
lewat `scripts/lib/pilgrimCatalog.ts`), `test-admin-delete`/`test-haji-pricing` (saklar ikut terhapus; penyidik tabel polimorfik) — semua
di DB sekali pakai; `bun run test` penuh.
