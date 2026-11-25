# Arsitektur — Katalog Data Jamaah + Saklar per Produk

> **Status: SELESAI — rencana D1–D5 TUNTAS (2026-11-24; keputusan K1–K3 di §7, as-built §8–§12). SOURCE OF TRUTH data jamaah.** Menggantikan
> pengatur kolom per produk di `docs/arsitektur-manifest.md` §9 (tabel, kode, dan editornya sudah dihapus di D5). §1–§6 = rencana awal; bila
> berbeda, as-built §8–§12 yang berlaku. Dirilis ke produksi 2026-11-25 (D1–D5). §13 = kolom kartu dan Profil mengikuti katalog.

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
| **D5** | Kontraksi §4 butir 5 (isian non-kartu pemesan sudah dihapus di D4, §11) + dokumentasi akhir (`CLAUDE.md`, `arsitektur-manifest.md`, `arsitektur-jamaah.md`, `arsitektur-visa.md`) | migrasi fail-closed diuji; build; grep tak ada pembaca lama |

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
  dengan kolom bawaan kecuali dua kolom bebas yang dihapus K1 — nilai lamanya tetap di snapshot (tidak ditampilkan; `displayFields` hanya menampilkan
  kolom yang ada di katalog — kalimat lama di sini menyebut "tetap TAMPIL", keliru).
- §3.3 "produk tingkat booking → semua jamaah": dipersempit ke **rombongan item** (item tanpa rombongan = semua jamaah), sejalan
  rombongan booking §10.8.
- Selama D2/D3 belum ada, katalog dan saklar hanya bisa diubah lewat migrasi; perilaku bawaan sudah aktif.

**Bukti:** `scripts/test-pilgrim-data.ts` (baru: CHECK = daftar kode, katalog bawaan, CHECK menolak 11 bentuk rusak, aturan diminta per
jamaah termasuk saklar & rombongan, penulis tunggal), `test-booking-link`/`test-pilgrim-extra-fields`/`test-pilgrim-review` (katalog uji
lewat `scripts/lib/pilgrimCatalog.ts`), `test-admin-delete`/`test-haji-pricing` (saklar ikut terhapus; penyidik tabel polimorfik) — semua
di DB sekali pakai; `bun run test` penuh.

## 9. As-built D2 (2026-11-24) — menu Produk → Data Jamaah

- **Menu** `lib/admin/navigation.ts`: "Data Jamaah" tepat di bawah "Jenis Dokumen". Halaman `products/pilgrim-fields` (daftar `CatalogList`:
  Kolom · Kode · Tipe · Sifat · Status · aksi), `new` (`CreatePage`), `[id]` (`EditPage`, tanpa foto) — pola sama Jenis Dokumen. Isian =
  satu komponen `components/admin/pilgrim-data/PilgrimFieldFields.tsx` + modul murni `pilgrimFieldForm.ts`. Kolom "Diminta untuk" di
  rencana tidak dibuat: sebelum D3 semua kolom aktif berlaku untuk setiap produk ber-saklar nyala (tak ada yang berbeda untuk ditampilkan).
- **Route** `api/v1/admin/products/pilgrim-fields` (GET berpaginasi opt-in, POST) dan `[id]` (GET + pemakaian, PUT, DELETE) — `requireManager`.
- **Penulis tunggal** `lib/pilgrim-data/fields.ts` (`createPilgrimField`/`updatePilgrimField`/`deletePilgrimField`, baris dikunci `FOR UPDATE`);
  masukan `lib/validators/pilgrimFields.ts` (`.strict()`):
  - kode = camelCase `^[a-z][A-Za-z0-9]{1,39}$`, diusulkan dari label, tak pernah berubah; bukan nama properti bawaan objek; kembar → 409;
  - kolom admin: tipe tanpa `address`; label NIK/KTP/paspor ditolak (`looksLikeSealedData` — nilainya tak disegel); Pilihan ≥ 2 unik;
    tipe hanya bisa diganti selama kuncinya belum berisi data (`fieldUsage`: `jsonb_exists` atas `booking_pilgrims.fieldValues` dan
    `saved_pilgrims.extraValues`);
  - kolom bawaan: label, wajib, urutan, aktif boleh; tipe/pilihan ditolak; Nama Lengkap tak bisa dinonaktifkan, dibuat opsional, atau dihapus;
  - hapus aman: bawaan atau berisi data → nonaktif, selain itu dihapus.
- **Bukti:** `scripts/test-pilgrim-data.ts` (+6 uji D2: validator, buat, ubah bawaan/admin, hapus aman, sumber route/menu) di DB sekali pakai;
  penjaga `test-admin-create`/`test-admin-editor` (halaman didaftarkan), `test-table-consistency`, `test-routes`, `test-combobox`; browser
  (server dev terpisah): daftar 13 kolom, buat "Golongan Darah" (Pilihan) → halaman edit, hapus sungguhan, penolakan API (Nama Lengkap,
  tipe bawaan, kunci, label KTP, kode kembar, id asing), tanpa sesi 403, 375 px tanpa gulir samping; `bun run build` hijau.
- **Gap yang diketahui:** mengubah wajib/aktif di katalog tidak membuka ulang jamaah yang sudah diajukan/terverifikasi (sama dengan keputusan
  syarat dokumen); nilai kolom admin di kartu belum bisa diisi pelanggan (D4).

## 10. As-built D3 (2026-11-24) — saklar "Minta data jamaah" di setiap editor produk

- **Penulis tunggal saklar** `setPilgrimDataEnabled(ref, enabled)` di `lib/pilgrim-data/products.ts` (pembaca `enabledProducts` tetap di
  berkas yang sama): di dalam transaksi produk dikunci `FOR SHARE` (tabel dari peta tetap `OWNER_TABLE`, id sebagai parameter), lalu
  `upsert` satu baris `product_pilgrim_data`; produk tak ada → `null` (tak ada baris ditulis). Keadaan untuk editor =
  `pilgrimDataState(ref)` → `{ enabled, defaultEnabled, stored }` (tanpa baris = bawaan pemilik). Kunci `FOR SHARE` menjamin saklar tak
  pernah tertulis untuk produk yang sudah dihapus. Balapan sempit yang diterima: penghapus produk sudah membersihkan saklarnya lalu menunggu
  kunci ini → tersisa satu baris yatim berkunci uuid yang tak pernah dibaca lagi.
- **Route** `api/v1/admin/products/pilgrim-data`: GET `?productType&productId` dan PUT `{ productType, productId, enabled }` — `requireManager`,
  Zod `.strict()`, `productType` = registry `PILGRIM_DATA_OWNER_TYPES`, `productId` uuid; produk tak ada / id tipe lain → 404.
- **Komponen** `components/admin/pilgrim-data/PilgrimDataToggle.tsx` — `MetaBox` "Data Jamaah" (lencana "Bawaan" bila belum disimpan),
  tersimpan sendiri saat diubah (seperti foto, tak ikut tombol Simpan), galat server ditampilkan, tautan ke Produk → Data Jamaah. Dipasang
  di 9 editor: Visa, Haji, Paket Umroh, Paket Ziarah, Hotel, Katering, Pesawat, Transport (trip), Muthowif (layanan).
- **Bukti:** `scripts/test-pilgrim-data.ts` (+2 uji D3: penulis/keadaan — produk hantu, bawaan, mati → tak ada kolom diminta, nyala → kolom
  aktif, upsert tanpa duplikat; penjaga sumber — setiap tipe pemilik punya `<PilgrimDataToggle productType=…>` di editornya, route
  `requireManager` + `.strict()` + uuid) di DB sekali pakai; penjaga statis lulus; browser (server dev terpisah): trip Transport menampilkan
  "Bawaan", nyala tersimpan lalu dikembalikan, Visa menampilkan saklar; API menolak tipe asing (400), uuid hantu (404), bukan uuid (400),
  kunci tambahan (400), id tipe lain (404), tanpa sesi (403); `bun run build` hijau.
- **Untuk D4:** halaman booking pelanggan masih menampilkan bagian jamaah walau tak ada kewajiban — disembunyikan/ditandai di D4.

## 11. As-built D4 (2026-11-24) — kartu = satu-satunya sumber data jamaah pelanggan

- **Kartu menyimpan kolom buatan admin.** `savedPilgrimInputSchema.extra` (`boundedKeys` 60, kunci ≤ 64) → `lib/pilgrims/service.ts`
  (`nextExtraValues`, di transaksi tulis kartu): hanya kunci kolom buatan admin di katalog (kolom nonaktif tetap diterima supaya formulir bisa
  mengirim balik nilai lamanya; kolom bawaan/berperan seperti `nik` dan kunci asing → 400 `field: extra.<kunci>`), bentuk dinilai
  `validateFieldValues`, nilai kosong menghapus kunci, `extra` tidak dikirim = tetap. DTO kartu membawa `extra` (data pemilik sendiri).
- **Formulir kartu** (`SavedPilgrimFields`, dipakai Jamaah Saya, dialog kartu di booking, dan admin atas nama pelanggan) menampilkan bagian
  "Data tambahan" = kolom buatan admin AKTIF (`cardExtraFields`) dimuat lewat `useCardExtraFields` → `GET /api/v1/pilgrim-fields` (butuh sesi,
  hanya definisi kolom). Wajib/tidaknya tidak ditegakkan di kartu — gerbangnya tetap "Ajukan" per booking (`completeness`). `ManifestFieldsForm`
  kini menautkan label ke isian (`idPrefix`, sebelumnya isian tanpa nama aksesibel).
- **Snapshot:** `snapshotFromCard` mengisi kolom tanpa peran dari `card.extra` (kartu kosong → dikosongkan; hanya properti milik sendiri);
  `linkCard` membaca `extraValues` kartu. `cardBoundKeys` = semua kolom katalog (K1: semua data jamaah milik kartu).
- **Jalur isian non-kartu pemesan DIHAPUS di fase ini (dimajukan dari D5):** route `PUT /api/v1/bookings/[id]/pilgrims/[pilgrimId]`,
  `lib/pilgrims/extraFields.ts`, `PilgrimExtraFields`, `scripts/test-pilgrim-extra-fields.ts`, teks `pilgrimArea.extra` dan kode galat
  `fieldFromCard`. Alasannya: begitu kolom buatan admin tersimpan di kartu, isian itu menjadi jalur kedua untuk data yang sama (dan sudah tak
  punya kolom untuk diisi). `DELETE` (kosongkan slot) tetap. Petugas tetap bisa mengisi manual jamaah tanpa kartu di Kelola jamaah.
- **Validasi isian booking baru (menutup gap `docs/arsitektur-manifest.md` §9):** `sealNewPilgrim` menilai `fieldValues` jamaah baru dengan
  `validateFieldValues` atas katalog aktif (kunci asing / bentuk salah → `ItemNotBookableError` 422) sebelum alamat dibekukan dan NIK/paspor
  disegel. Hari ini checkout pelanggan dan draf admin mengirim isian kosong, jadi ini lapis pertahanan untuk jalur mana pun yang kelak mengirim isian.
- **Halaman booking pelanggan:** slot membawa `needed` (produk meminta kolom ATAU dokumen dari jamaah itu). Bila tak satu pun slot `needed`,
  tabel jamaah diganti catatan `booking.pilgrimsNotNeeded` dan langkah "Isi data jamaah" pada kotak baru-dipesan disembunyikan; slot campuran
  menampilkan "—" di kolom Data untuk jamaah tanpa kewajiban (juga di admin).
- **Bukti:** `scripts/test-pilgrims.ts` (+1: simpan/tetap/hapus/kolom nonaktif/penolakan, kartu tak berubah saat ditolak, batas kunci),
  `scripts/test-pilgrim-data.ts` (+4 D4: snapshot & `cardExtraFields`, validasi `sealNewPilgrim`, `needed`, penjaga sumber),
  `scripts/test-booking-link.ts` (tautan mengisi kolom admin dari kartu; kartu dikosongkan → ikut kosong), suite penuh di DB sekali pakai baru;
  browser (server dev terpisah): buat kolom "Catatan Kesehatan" lewat Produk → Data Jamaah, isi di kartu pelanggan (admin), tersimpan sesudah
  muat ulang; API menolak kunci asing, `nik` lewat `extra`, nilai > batas (400); `GET /api/v1/pilgrim-fields` tanpa sesi 401; kolom uji
  dihapus lewat UI (hapus sungguhan karena tak berisi data). Halaman pelanggan /id /en dan 375 px TIDAK diuji di browser (tak ada akun
  pelanggan uji di seed) — dijaga `test-i18n-coverage` dan uji slot; `bun run build` hijau.
- **Temuan sambil lalu:** SEC-312 (Low, pre-existing) — PUT kartu tanpa `birthPlace`/`gender` mengosongkannya.



## 12. As-built D5 (2026-11-24) — kontraksi kolom per produk lama

- **Migrasi** `20261213090000_manifest_field_contraction`: `DROP TABLE manifest_field_requirements` (termasuk baris sentinel `core`), tabel dikunci
  dulu, FAIL-CLOSED. Isian jamaah (`booking_pilgrims.fieldValues`) tidak disentuh; yang hilang hanya definisi (label/tipe) per produk. BERHENTI
  (tabel utuh, transaksi batal) bila:
  1. ada kolom berperan dengan kunci bukan kunci katalog (diperiksa ulang sejak D1);
  2. ada kolom yang SUDAH BERISI data jamaah tanpa padanan berkunci dan bertipe sama di `pilgrim_fields`. Kosong = tak ada/null/`""`/telepon tanpa
     nomor. Pengecualian hanya dua kolom K1 (`nomorHpHost`, `shortAddressUnwanWathoni`, boleh bersufiks acak `_xxxxxx`).
  Pra-cek sebelum rilis + cara menangani bila berhenti: `docs/deployment.md` "Catatan operasional: kontraksi kolom data jamaah".
- **Kode yang dihapus:** model `ManifestFieldRequirement`, `lib/manifest/{fields,constants}.ts`, `lib/validators/manifest.ts`,
  `components/admin/manifest/*` (K3), `manifestFields`/`manifestFieldsUsed` di `admin/products/visa[/id]` (kini 400 karena `.strict()`), pengisi
  kolom bawaan produk visa baru, pembersih di `dropPolymorphic`/`lib/haji/delete.ts`, seed `core`, `scripts/test-manifest-fields.ts`. Ikut dihapus
  karena tak punya pemanggil: rute publik `GET /api/v1/manifest/requirements` dan `isPilgrimDataOwner`, serta `STANDARD_FIELDS`/`allowedTypesForRole`/
  `uniqueFieldKey` (kolom bawaan = baris katalog dari migrasi D1, bukan daftar di kode). `lib/manifest/` yang tersisa: `fieldDefs` (tipe kolom, larangan
  label rahasia, usulan kode), `roles`, `values`, `display`, `address*`.
- **Bukti:** `scripts/test-manifest-contraction-migration.ts` (8 skenario: kosong, keadaan dev, 4 penolakan, 2 kontrol) di DB sementara; salinan DB
  dev (25 baris kolom) dimigrasi — hash seluruh `fieldValues` sama sebelum/sesudah; `prisma migrate diff` tanpa selisih; penjaga D5 di
  `test-pilgrim-data` (berkas, sebutan di app/lib/components/schema/seed, dan tabel tak ada); suite penuh 1688 PASS di DB sekali pakai; browser + API pada server dev terpisah di atas
  salinan dev TERMIGRASI (editor visa, buat + hapus produk visa, saklar, Kelola jamaah, Manajemen Visa; `manifestFields` → 400; rute lama → 404);
  `bun run build` hijau.
- **Diketahui:** isian lama dua kolom K1 (bila ada) tersimpan tanpa label dan tidak tampil di mana pun. Rollback ke image sebelum D5 sesudah migrasi
  ini tidak bisa (editor/pembuatan produk visa dan penghapus produk versi lama membaca tabel itu) — pulihkan dari cadangan.

## 13. As-built (2026-11-25) — kartu jamaah dan Profil mengikuti katalog (`docs/rencana-profil-jamaah.md`, ADR-0006)

- `GET /api/v1/pilgrim-fields` mengembalikan SEMUA kolom aktif (bukan hanya kolom buatan admin). Klien: `usePilgrimFields` (dimuat sekali per
  formulir) → `cardLayout`/`orderedRoles` (`components/shared/pilgrims/cardFields.ts`, murni) → `SavedPilgrimFields`. Kolom bawaan nonaktif tidak
  tampil; nama dan tanggal lahir selalu tampil (`ALWAYS_SHOWN`); label = label katalog (diterjemahkan `useFieldLabel` bila masih label bawaan);
  katalog gagal dimuat → semua kolom. Dipakai Jamaah Saya, Profil, popup booking, dan admin atas nama pelanggan.
- Server: kewajiban NIK/paspor = `piiDemand` (`lib/pilgrims/service.ts`), ADR-0006. Kolom tersembunyi tak pernah dikosongkan (SEC-312 ditutup:
  `gender`/`birthPlace` tak dikirim = tetap, `null` = dikosongkan).
- Profil: satu formulir → kartu "Saya sendiri" + akun + kontak. Wajib hanya nama dan alamat (`profileSchema.address`); tanpa data jamaah, kartu tidak
  dibuat. Saran "yang belum diisi" di atas formulir, tanpa memblokir.
- Booking: "Jadikan saya jamaah" membuka popup kelengkapan bila kartu belum ada atau `cardIncomplete` (`lib/pilgrims/bookingLink.ts`); popup
  mewajibkan kolom wajib katalog + alamat, dan menampilkan pengingat bila WhatsApp belum terverifikasi (tidak memblokir, ADR-0002).
- Uji: `test-pilgrims` (ADR-0006, SEC-312), `test-pilgrim-data`, `test-pilgrim-form`; browser di DB sekali pakai (desktop + 375px, id + en).

## 14. As-built (2026-11-25) — data dan dokumen sinkron dari produk sampai jamaah

Audit alur produk → halaman jamaah menemukan delapan ketidaksinkronan; semuanya diperbaiki dalam satu PR (arahan pemilik "Ya, perbaiki semua").

| # | Sebelumnya | Sekarang |
|---|---|---|
| 1 | Jenis dokumen nonaktif tetap ditagih tetapi tak bisa diunggah | Nonaktif = tidak diminta: `requirementsOfMany`/`pilgrimRequirements` hanya jenis aktif; editor admin (`requirementsOf`) tetap menampilkan baris "Jenis nonaktif — tidak diminta" |
| 2 | Tombol Unggah tiket/reservasi hotel tak membuka formulir jenis itu | `openFormFor` (`documentRows.ts`): jenis `allowMultiple` membuka formulir tambah berisi jenis itu |
| 3 | Kartu diubah → booking tertinggal | `lib/pilgrims/bookingSync.ts` `syncLinkedPilgrims`, dipanggil `service.write()` di transaksi yang sama |
| 4 | NIK wajib menahan WNA dan bayi | `nikOptional` (`forPilgrims.ts`): tidak wajib untuk WNA dan < 2 tahun; `isBaby` pindah ke `lib/pilgrims/age.ts` |
| 5 | Petunjuk/label syarat produk hilang di halaman jamaah | `description` di checklist; `typeInfo` di `DocumentRepeater` (jamaah dan admin) |
| 6 | Halaman Paket hanya menampilkan syarat paket | `packageCatalogRequirements`: + syarat visa yang termasuk paket; visa pilihan pemesan = catatan |
| 7 | Syarat wajib ditambah, jamaah tetap terverifikasi | `saveRequirements` (`lib/pilgrims/review.ts`) dan pengaktifan kembali jenis dokumen membuka ulang ke `submitted` |
| 8 | Isian petugas di booking terhapus oleh kartu kosong | Kolom kosong di kartu yang sama tidak menghapus; popup "Ubah data jamaah" tak lagi menyalin ulang |

### 14.1 Kartu → booking (menggantikan "snapshot beku sejak ditautkan", §3.4)

- Yang ikut: jamaah booking tertaut, booking `active`, status `draft`/`needs_revision`. `submitted`/`verified`, booking selesai/batal/hangus tetap beku.
- Per kolom (`mergeCardChange`, murni): **berubah** di kartu → menimpa (termasuk dikosongkan); **tak berubah** → hanya mengisi kolom booking yang kosong.
- NIK/paspor: kartu punya → segel disalin apa adanya (tanpa membuka); dihapus di kartu → dihapus; tak pernah ada di kartu → segel booking dibiarkan.
- `identityId` ikut kartu, sebelum identitas lama dirapikan. Transaksi kartu dibungkus `retryConflict` (tautan mengunci jamaah booking → kartu, kartu sebaliknya); bentrok tersisa → 409.
- `cardSnapshot.ts` = satu bentuk kartu untuk tautan dan penyelarasan. Penulis kolom tersegel `booking_pilgrims`: `bookingLink.ts` dan `bookingSync.ts` (SEAL_OK di `scripts/test-booking-link.ts`).

### 14.2 Syarat bertambah → buka ulang

- `reopenAfterRequirementChange(tx, produk, actorId, change)` membandingkan gabungan syarat WAJIB per jamaah sebelum/sesudah. Yang sudah diwajibkan produk lain tidak membuka ulang; syarat berkurang atau opsional juga tidak.
- Tidak menyentuh booking tak aktif dan visa `submitted_to_syarikah`/`in_review`/`issued`. Jamaah `submitted` ikut dikunci supaya keputusan serentak memakai syarat baru.
- Jamaah melihat peringatan berisi dokumen yang kurang (`pilgrimArea.trip.missingDocs`). Belum ada email untuk kejadian ini.

### 14.3 Batas yang diketahui

- Booking yang sudah tertinggal sebelum rilis ini ikut pada perubahan kartu berikutnya (hanya kolom yang berubah atau kosong); untuk memaksa: "Lepas" lalu pilih ulang.
- Jamaah yang sudah terverifikasi sebelum rilis ini tidak dinilai ulang mundur.
- Halaman checkout tidak menampilkan daftar dokumen (hanya halaman produk).
- Pengaturan yang menunggu pemilik: kolom Alamat aktif/tidak, nomor + masa berlaku paspor wajib/tidak, KTP hanya untuk WNI ≥ 17 tahun.

Bukti: `test-booking-link` (edit kartu nyata terhadap lima booking berstatus beda, segel dibuka), `test-pilgrim-requirements` (buka ulang, kunci deterministik, jenis nonaktif, katalog paket, penjaga rute), `test-pilgrim-data` (`nikOptional`), `test-pilgrim-documents` (formulir unggah); browser di DB sekali pakai untuk alur jamaah dan halaman paket.
