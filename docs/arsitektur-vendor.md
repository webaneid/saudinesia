# Arsitektur — Vendor (satu alur, satu sumber data)

> **Status: SELESAI & TERVERIFIKASI as-built (F1–F5, 2026-10-26) — SOURCE OF TRUTH vendor.** Bagian §1–§5 adalah rancangan asli (berguna untuk alasan keputusan); **§8 adalah keadaan nyata**. Dokumen ini **menggantikan** `docs/arsitektur-harga.md` §3.1 dan §18. Keputusan arsitekturnya dikunci di **ADR-0003** (`docs/decisions/adr-0003-satu-alur-vendor-kategori-terkelola.md`). Satu perbedaan antara rancangan dan hasil: migrasi dibagi ekspansi (F1) + kontraksi (F5) — lihat §3.4 dan §8.1/§8.5.

## 1. Instruksi dan keputusan pemilik (2026-10-26)

Instruksi: (1) menu khusus Vendor di Sistem, termasuk kontak, negara, dan kategorisasi yang benar; (2) semua komponen/halaman yang memanggil vendor merujuk dan menyimpan ke sana lewat satu komponen khusus yang konsisten; (3) cek arsitektur → kode aktual → ADR → jalankan sesuai SOP; (4) **tidak boleh ada dualisme data vendor**, semua jenis/jalur vendor lain dihapus.

Jawaban atas pertanyaan desain: **kategori dikelola admin** (tabel, bukan teks bebas/enum kode); **membuat vendor dari editor lewat modal berisi formulir vendor yang SAMA**; **data lama dimigrasi dengan pemetaan** (tanpa kehilangan relasi biaya); **kontak terstruktur penuh** (PIC, telepon, WhatsApp, email, website, catatan + alamat).

## 2. Audit as-built (kode + data lokal, 2026-10-26)

Data lokal (`saudinesia`): 10 vendor, 18 `ProductCost`, 14 `PreferredVendor`.

| # | Temuan | Bukti |
|---|---|---|
| V1 | **`category` = teks bebas yang mengikuti modul tempat vendor dibuat**, bukan jenis vendor. Nilai nyata: `syarikah`(3), `haji`, `package`, `maskapai`, `tour_package`, `internal`, `transport`, `hotel`. "Ahmad Guide" di `tour_package`, "wasugi" di `package`, "Vendor Haji" di `haji`. Satu perusahaan yang menyuplai dua layanan harus dibuat dua kali (dualisme) | `prisma/schema.prisma:1160`; `psql` data lokal; pemanggil `?category=`/`vendorCategory=` di 7 halaman |
| V2 | **Vendor dibuat di 6 tempat dengan formulir berbeda**: tab Pengaturan, dan "Vendor Baru" mini (hanya nama + kategori tetap) di editor Pesawat, Hotel, Trip Transport, Visa (`CostTiersTab`), dan `VendorCurrencyField` (Paket Umroh/Ziarah/Haji). Hasil: vendor setengah jadi — **9 dari 10 tanpa kontak, 10 dari 10 tanpa alamat, negara selalu default "Saudi Arabia"** | data lokal; `products/{flight,hotels,transport/trips}/[id]/page.tsx`, `visa/[id]/CostTiersTab.tsx`, `components/admin/pricing/VendorCurrencyField.tsx` |
| V3 | **Menu vendor tidak ada** — hanya satu tab "Vendor / Syarikah" di dalam halaman Pengaturan | `system/settings/page.tsx:388` |
| V4 | **Kontak = satu kolom teks bebas** `contactInfo` (tak bisa dipakai untuk WhatsApp/telepon/email); **negara = teks bebas** (`country` default `'Saudi Arabia'`) padahal daftar ISO `COUNTRIES` sudah ada | `schema.prisma:1161-1162` |
| V5 | **Referensi tanpa jaminan**: `PreferredVendor.vendorId` **tanpa FK**; `VisaApplication.vendorIdsUsed` JSON id tanpa FK; 5 route biaya (Visa, Pesawat, Hotel, Transport, Muthowif) **tidak memeriksa vendor ada** → id ngawur = galat FK 500 (pola SEC-64/G3) | `schema.prisma:1231-1239`, `:901`; `*/cost/route.ts`, `visa/[id]/cost-tiers/route.ts`, `hotels/.../prices/route.ts` |
| V6 | **Vendor "Saudinesia" internal** (Muthowif) dibuat diam-diam oleh sebuah route bila belum ada — vendor bukan data resmi, bisa terhapus/berganda | `muthowif/service-price/cost/route.ts:34-37` |
| V7 | **Hapus vendor = selalu nonaktif**, tanpa hapus sungguhan walau tak dipakai; tak ada pesan pemakaian; PUT tanpa `.strict()` → melanggar prinsip CRUD lengkap dan aturan skema ketat | `vendors/[id]/route.ts` |
| V8 | **Tidak ada keunikan**: nama yang sama bisa dibuat berkali-kali (case-insensitive); tidak ada deteksi duplikat | `schema.prisma:1157-1171` |
| V9 | **Tidak ada tampilan pemakaian**: admin tak bisa melihat produk/komponen mana yang memakai satu vendor (perlu untuk keputusan nonaktifkan/hapus/gabung) | — |
| V10 | `GET` vendor untuk manager sudah ramping (SEC-61b) tetapi path/kontrak hidup di `…/system/settings/vendors` (tersimpan di bawah "settings") | `app/api/v1/admin/system/settings/vendors/route.ts` |

**Drift dokumen vs kode** (`docs/arsitektur-harga.md`): §18.1/§18.4 menyebut kategori hanya `syarikah`/`maskapai` dan picker hanya Visa/Flight — kode kini memakai 8 nilai di 7 halaman; §18.5 menyebut Hotel belum terintegrasi — sudah; §3.1/§18.2 skema `Vendor` tidak memuat `addressId`; §18.1 sengaja memilih teks bebas ("anti-hardcode") — keputusan inilah yang digantikan ADR-0003.

## 3. Rancangan target

### 3.1 Skema (Prisma)

```prisma
model Vendor {
  id               String   @id @default(uuid())
  name             String
  nameKey          String   // lower(trim(name)) tanpa spasi ganda — untuk keunikan (lihat unique di bawah)
  countryCode      String   // ISO 3166-1 alpha-2, WAJIB; nilainya dari lib/constants/countries.ts
  contactName      String?  // PIC
  phoneCountryCode String?  // ISO negara kode telepon (pola ContactPicker)
  phone            String?  // nomor lokal
  whatsappCountryCode String?
  whatsapp         String?
  email            String?
  website          String?
  notes            String?
  addressId        String?  @unique   // AddressPicker (docs/arsitektur-alamat.md §9)
  systemKey        String?  @unique   // vendor sistem (mis. 'saudinesia'): tidak dapat dihapus/dinonaktifkan/diganti kunci
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  address     Address?          @relation(fields: [addressId], references: [id])
  categories  VendorCategory[]  // many-to-many implisit; minimal 1 (divalidasi API)
  costs       ProductCost[]
  preferred   PreferredVendor[] // FK BARU (Restrict)

  @@unique([nameKey, countryCode])
  @@map("vendors")
}

model VendorCategory {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique       // stabil; kode memakai slug sistem
  sortOrder Int      @default(0)
  isSystem  Boolean  @default(false) // kategori baku bawaan: slug tak berubah, tak dapat dihapus
  isActive  Boolean  @default(true)
  vendors   Vendor[]
  @@map("vendor_categories")
}
```

Kolom lama `Vendor.category`, `country`, `contactInfo` **dihapus** (isi dimigrasikan, lihat §3.4). Tidak ada kolom/tabel vendor lain.

Kategori sistem (seed migrasi; slug dipakai kode sebagai konteks): `hotel` Hotel · `transport` Transportasi/Bus · `airline` Maskapai · `visa` Visa/Syarikah · `catering` Katering · `guide` Muthowif/Pemandu · `tour-operator` Operator Tur/Ziarah · `internal` Internal · `other` Lainnya. Admin boleh menambah kategori sendiri; keunikan `slug` (turunan nama) mencegah duplikat dan pesan 409 menyebut kategori yang sudah ada.

Vendor sistem: satu baris `systemKey='saudinesia'` (kategori `internal`, negara `ID`) dibuat oleh **migrasi** — route Muthowif hanya membacanya (tidak membuat).

### 3.2 Aturan integritas ("tidak boleh ada dualisme")

1. **Satu entitas**: semua referensi vendor adalah FK ke `Vendor.id` (`ProductCost`, `PreferredVendor` — FK ditambahkan). `VisaApplication.vendorIdsUsed` adalah *snapshot riwayat* harga saat booking (bukan data vendor kedua) dan hanya berisi id; vendor yang pernah dirujuk tidak pernah dihapus keras.
2. **Satu pintu tulis**: hanya `POST/PUT/DELETE /api/v1/admin/system/vendors*` (superadmin) yang menulis tabel vendor; pemeriksaan "vendor ada dan aktif" dipusatkan di satu fungsi (`assertVendorUsable`) yang dipakai semua route biaya (menutup V5).
3. **Satu formulir**: `VendorForm` dipakai halaman menu Vendor *dan* modal "Vendor Baru" di setiap picker — kolom dan validasi sama.
4. **Keunikan**: `(nameKey, countryCode)` unik; duplikat ditolak 409 dengan menyebut vendor yang ada.
5. **Hapus bersemantik aman (aturan CRUD lengkap)**: hapus sungguhan hanya bila tidak dirujuk `ProductCost`/`PreferredVendor`/`VisaApplication.vendorIdsUsed`; selain itu nonaktif + pesan jumlah rujukan; dapat diaktifkan kembali. Vendor sistem tidak dapat dihapus/dinonaktifkan. Kategori: hapus sungguhan bila tak ada vendor tertaut, selain itu nonaktif.
6. **Konteks kategori** dipakai picker hanya untuk menyaring tampilan (Pesawat → `airline`, Hotel → `hotel`, Transport → `transport`, Visa → `visa`, Muthowif → `internal`; komponen biaya Paket/Ziarah/Haji → semua); server tidak memaksa kategori — yang ditegakkan hanya vendor ada dan aktif.

### 3.3 API (path baru; path lama dihapus)

| Route | Method | Peran | Fungsi |
|---|---|---|---|
| `/api/v1/admin/system/vendors` | GET | manager+ (manager: kolom ramping `id,name,countryCode,categories,isActive`; superadmin: penuh) | daftar + filter `q`, `category`, `country`, `status`; terpaginasi |
| | POST | superadmin | buat (negara + ≥1 kategori wajib) |
| `/api/v1/admin/system/vendors/[id]` | GET | superadmin | detail + **pemakaian** (jumlah komponen biaya per `productType`, vendor pilihan, snapshot visa) |
| | PUT | superadmin | ubah (`.strict()`); vendor sistem: kunci/aktif dikunci |
| | DELETE | superadmin | hapus sungguhan atau nonaktif + pesan (§3.2.5) |
| `/api/v1/admin/system/vendor-categories` | GET/POST | manager+ / superadmin | daftar / tambah kategori (duplikat → 409) |
| `/api/v1/admin/system/vendor-categories/[id]` | PUT/DELETE | superadmin | ubah nama/urutan/aktif; hapus atau nonaktif |

### 3.4 Migrasi data (dua migrasi Prisma: ekspansi F1 + kontraksi F5; keduanya fail-closed)

> **Dipertegas saat eksekusi F1 (2026-10-26):** agar setiap PR yang di-merge tetap menghasilkan aplikasi yang berjalan, migrasi dibagi **ekspansi** (F1: struktur baru + migrasi data; kolom lama `category`/`country`/`contactInfo` masih ada dan hanya dibaca) dan **kontraksi** (F5: setelah tidak ada kode yang menyentuh kolom lama — hapus kolom lama dan `nameKey`/`countryCode` jadi NOT NULL, didahului pengisian ulang untuk vendor yang dibuat alur lama pada masa antara F1-F4 dan gagal-tertutup bila ada nilai tak dikenal). Langkah 1-7 di bawah = ekspansi; langkah 8 = kontraksi. Pada masa antara, vendor yang dibuat lewat alur lama belum memiliki kolom baru (null) — masa antara berakhir di F2 (route lama dihapus).


1. Buat `vendor_categories` + seed kategori sistem; buat kolom baru di `vendors`; tabel pivot m2m.
2. Pemetaan kategori lama → baru: `syarikah→visa`, `maskapai→airline`, `hotel→hotel`, `transport→transport`, `internal→internal`; `package`/`tour_package`/`haji`/`null`/lain → `other` (admin meninjau; UI menandai vendor yang hanya `other`). Kategori lama bernilai teks lain yang tidak dikenal juga → `other` (nilai aslinya disimpan di `notes` agar tidak hilang).
3. `country` teks → `countryCode` lewat tabel pemetaan nama→ISO yang ditulis eksplisit di migrasi (nilai nyata: `Saudi Arabia→SA`, `Indonesia→ID`); **nilai tak dikenal membuat migrasi GAGAL** (fail-closed, bukan tebakan).
4. `contactInfo` → `notes` (tanpa kehilangan; admin memecahnya ke kolom terstruktur lewat UI).
5. `nameKey` diisi; bila dua vendor bertabrakan `(nameKey, countryCode)` migrasi **gagal** dengan daftar tabrakan (tidak menggabung diam-diam).
6. Tambah FK `PreferredVendor.vendorId` → `Vendor` (Restrict); pastikan tak ada yatim sebelum FK (migrasi gagal bila ada).
7. Buat vendor sistem `saudinesia`: bila baris `internal` lama bernama "Saudinesia" ada, **ditandai** `systemKey` (bukan dibuat ganda).
8. (F5, migrasi kontraksi) Hapus kolom lama dan jadikan `nameKey`/`countryCode` NOT NULL. **Bukti (F1)**: jumlah vendor/biaya/vendor pilihan sebelum = sesudah, id tak berubah, hasil `computeSellPrice` identik pada data lokal (rekam-bandingkan).

### 3.5 Frontend

- **Menu Sistem → Vendor** (`/admin/system/vendors`, `lib/admin/navigation.ts`): daftar (cari, filter kategori/negara/status, paginasi, lencana kategori, tanda "perlu ditinjau" bagi vendor yang hanya `other`), halaman detail/edit `/admin/system/vendors/[id]` (formulir penuh + panel **Pemakaian** + zona hapus/nonaktif), dan tab/halaman **Kategori** (CRUD). Tab vendor di Pengaturan **dihapus**.
- **`components/admin/vendor/VendorForm.tsx`** — formulir tunggal (nama, negara [autocomplete ISO], kategori [multi-pilih], PIC, telepon/WhatsApp/email memakai pola `ContactPicker`, website, alamat via `AddressPicker`, catatan).
- **`components/admin/vendor/VendorPicker.tsx`** — satu-satunya cara memilih vendor di seluruh admin: dropdown dengan pencarian, penyaring konteks kategori (+ "tampilkan semua"), lencana kategori/negara, dan "Vendor Baru" → modal `VendorForm` (kategori konteks terisi otomatis); superadmin saja yang melihat tombol itu. Menggantikan `VendorCurrencyField` (bagian vendor), mini quick-add di Pesawat/Hotel/Transport, `VendorField` di Visa, dan `lib/admin/vendorQuickAdd.ts`.

## 4. Fase eksekusi (satu fase satu waktu; tiap fase: recheck → kode → tsc → `bun run build` terisolasi → uji nyata termasuk penolakan → security check → dokumentasi → PR → CI hijau → merge atas persetujuan)

| Fase | Isi | Bukti utama |
|---|---|---|
| **F1** | Skema + **migrasi ekspansi** (§3.4) + kategori/vendor sistem + konstanta + validator Zod `.strict()` + fungsi `assertVendorUsable`/pemakaian | Rekam-bandingkan pada **salinan** DB lokal (jumlah, id, hasil harga identik); uji migrasi gagal-tertutup (negara tak dikenal, tabrakan nama); tes DB |
| **F2** | API vendor + kategori (§3.3), semantik hapus, keunikan, pemakaian; route lama `…/settings/vendors` menjadi **jembatan tipis** ke layanan baru (dihapus di F4 bersama UI yang memakainya); kelima route biaya + handler bersama memakai `assertVendorUsable`; Muthowif membaca vendor sistem | HTTP nyata semua kasus (403/400/404/409, hapus vs nonaktif, vendor ngawur → 400 bukan 500); mutasi pengaman |
| **F3** | Menu Sistem → Vendor (daftar, detail/edit, kategori), `VendorForm`; tab Pengaturan dihapus | Chrome asli (CDP): CRUD lengkap vendor dan kategori sebagai superadmin; manager hanya baca |
| **F4** | `VendorPicker` + modal; migrasi 6 situs (Pesawat, Hotel, Trip Transport, Visa, `VendorCurrencyField`/panel biaya, + Muthowif read-only); **hapus jembatan route lama** dan kode quick-add lama | Chrome asli di tiap editor: filter konteks, buat via modal, simpan; penjaga CI "tidak ada pembuatan vendor di luar `VendorForm`" (dimutasi) |
| **F5** | Penutup: **migrasi kontraksi** (hapus kolom lama, NOT NULL), hapus sisa jalur lama, dokumen ini → as-built, `docs/arsitektur-harga.md` §3.1/§18 ditandai digantikan, `CLAUDE.md`, register, memori | `grep` bukti tak ada lagi `Vendor.category`/`contactInfo`/`country`; semua suite |

## 5. Risiko dan mitigasi

- **Migrasi merusak relasi biaya** — satu migrasi fail-closed + rekam-bandingkan pada salinan DB sebelum dijalankan di DB utama; id vendor tidak berubah.
- **Pemetaan `package/tour_package/haji → other` kurang tepat** — disengaja (kategori itu label modul, bukan jenis vendor); UI menandai vendor yang hanya `other` agar admin mengategorikan ulang.
- **Banyak halaman diubah di F4** — satu komponen, satu pola; verifikasi browser per editor, penjaga CI yang melarang jalur pembuatan vendor lain.
- **Kategori admin-kelola bisa kembali ngawur** — slug unik + deteksi duplikat 409 + kategori baku terkunci; konteks picker hanya memakai slug sistem.

## 6. Di luar scope (dicatat)

Data bank/NPWP/termin pembayaran vendor; gabung-vendor otomatis (merge duplikat); impor massal; peringkat/penilaian vendor.

## 7. Referensi

ADR-0003; `docs/arsitektur-alamat.md` §9 (alamat vendor); `docs/arsitektur-komponen-kontak.md` (pola kontak); `docs/arsitektur-harga.md` §3.1/§18 (digantikan); `docs/arsitektur-komponen-biaya.md` (panel biaya yang memakai vendor); `docs/lessons-learned.md` SEC-61(b), SEC-64.

## 8. As-built

### 8.1 Fase 1 — skema, migrasi ekspansi, fondasi (2026-10-26)

**Dibuat:** migrasi `prisma/migrations/20261026120000_vendor_single_flow_expand` (struktur baru, 9 kategori sistem, migrasi data fail-closed, vendor sistem `saudinesia`, indeks unik `(nameKey, countryCode)` dan `systemKey`, **FK `PreferredVendor.vendorId` → `Vendor` (Restrict)**); `VendorCategory` + many-to-many implisit ke `Vendor`; `lib/constants/vendor.ts` (slug kategori sistem, konteks picker, `vendorNameKey`, `slugifyCategoryName`); `lib/validators/vendor.ts` (skema `.strict()`: vendor buat/ubah, kategori buat/ubah); `lib/vendors/integrity.ts` (`assertVendorUsable`, `getVendorUsage` termasuk snapshot visa via `array_contains`); `scripts/test-vendor-model.ts` (11 uji) dan `scripts/test-vendor-migration.ts` (7 skenario; masuk `bun run test`/CI).
**Tidak diubah (sengaja, ekspansi):** semua route/halaman vendor lama dan kolom legacy — alur lama tetap berfungsi (dibuktikan HTTP nyata) sampai F2-F4 menggantikannya.
**Bukti migrasi — rekam-bandingkan pada SALINAN DB lokal (`pg_dump`, DB asli tidak disentuh):** sebelum vs sesudah — hitungan 11 tabel, 10 vendor (id/nama/kategori lama/negara/kontak lama/alamat/aktif), 18 `ProductCost`, 14 `PreferredVendor`, dan **48 kombinasi `computeSellPrice` (produk × hari 1/9/30) identik**; hasil pemetaan: `syarikah→visa` (3), `maskapai→airline`, `hotel→hotel`, `transport→transport`, `internal→internal` (vendor "Saudinesia" ditandai `systemKey`, tidak dibuat ganda), `package`/`tour_package`/`haji → other` dengan catatan "Kategori lama: …" di `notes` (Ahmad Guide, wasugi, Vendor Haji — perlu ditinjau admin), semua negara → `SA`/`ID`. Skema hasil migrasi == `schema.prisma` (tanpa drift).
**Bukti gagal-tertutup + atomik (`scripts/test-vendor-migration.ts`, `prisma migrate deploy` sungguhan pada DB sementara):** negara tak dikenal, vendor ganda (nama sama setelah dinormalisasi di negara sama; negara berbeda diizinkan), vendor pilihan yatim, dan "Saudinesia" bukan-internal → migrasi **dibatalkan** dengan pesan jelas dan struktur baru **tidak ada sama sekali** (atomik). DB kosong (kasus CI) → kategori sistem + vendor sistem dibuat.
**Temuan nyata saat eksekusi:** DB uji berisi **21 `PreferredVendor` yatim** (sisa tes; tanpa FK tidak ada yang mencegah) → migrasi menolaknya persis sesuai desain; dibersihkan, `migrate resolve --rolled-back`, lalu diterapkan ulang. DB lokal pengguna: 0 yatim. FK baru juga mengungkap tes yang menghapus vendor sebelum vendor pilihannya (diperbaiki di `test-haji-pricing.ts`).
**Tes:** 7 mutasi pengaman tertangkap (hapus cek yatim/negara/tabrakan di migrasi, cek nonaktif, snapshot visa, `.strict()`, slug konstanta). `bun run test` 17 suite lulus; build produksi terisolasi 0 error; `bun audit` tidak berubah (5).
**Cadangan:** `pg_dump` DB lokal sebelum migrasi asli disimpan di `/tmp/vendor_backup/saudinesia_pre_vendor_F1.sql`.
**Catatan proses (CI):** run CI pertama gagal karena `scripts/test-vendor-migration.ts` menyuplai SQL setup lewat `prisma db execute --stdin` — di CI stdin tidak sampai (setup diam-diam kosong sehingga jalur "harus gagal" malah sukses), padahal lokal lolos (juga dengan URL berkata sandi). Diperbaiki: SQL lewat `--file` + pemeriksaan bahwa baris setup benar-benar masuk (jumlah vendor) sehingga kegagalan seperti itu keras, bukan senyap. Run CI berikutnya hijau (7 skenario lulus).

### 8.2 Fase 2 — API vendor + kategori, integritas rujukan (2026-10-26)

**Dibuat:** `lib/vendors/service.ts` (**satu-satunya penulis** tabel `vendors`/`vendor_categories`: buat/ubah/hapus-atau-nonaktif vendor dan kategori, keunikan, alamat dalam transaksi), `lib/vendors/handlers.ts` (`createVendorHandlers({ requireRead?, requireWrite? })`, otorisasi dapat disuntik untuk uji), `lib/vendors/http.ts` (`vendorNotUsableResponse`), `lib/vendors/legacyBridge.ts` (jembatan sementara), route `app/api/v1/admin/system/vendors{,/[id]}` dan `vendor-categories{,/[id]}` (masing-masing ≤ 10 baris re-export), `scripts/test-vendor-api.ts` (13 uji; masuk CI).
**Perilaku:** baca = manager+ (manager hanya bentuk ramping `id,name,countryCode,isActive,categories`; superadmin penuh + paginasi + filter `q`/`category`/`country`/`status`); detail dan semua tulis = superadmin; DTO tidak memuat kolom legacy/`nameKey`/`addressId`; keunikan `(nameKey, countryCode)` → 409 yang menyebut vendor yang sudah ada (dan menyarankan mengaktifkan kembali bila nonaktif); kategori: slug dari nama, duplikat → 409 menyebut kategori yang ada, ganti nama tidak mengubah slug, kategori sistem tidak dapat dinonaktifkan/dihapus; **hapus aman**: vendor/kategori tak dirujuk → hapus sungguhan (alamat 1:1 dan tautan ikut), selain itu nonaktif + pesan rincian pemakaian (biaya, vendor pilihan, snapshot visa) dan dapat diaktifkan kembali; vendor sistem tidak dapat dihapus/dinonaktifkan; alamat vendor diperbarui di tempat (tak ada alamat yatim).
**Integritas rujukan (menutup SEC-68):** kelima route biaya (Pesawat, Transport, Hotel, Visa [2 vendor], dan handler biaya bersama Paket/Ziarah/Haji) memanggil `assertVendorUsable` → vendor tak ada atau **nonaktif** = 400 dengan pesan jelas (dulu galat FK 500; sekarang vendor nonaktif juga ditolak). Route Muthowif **membaca** vendor sistem lewat `systemKey` (tidak lagi membuatnya diam-diam).
**Jembatan sementara (`…/settings/vendors*`):** hanya penerjemah ke layanan baru — tak ada logika/penulisan vendor sendiri; mempertahankan bentuk respons lama agar UI lama (tab Pengaturan + picker di 6 editor) tetap hidup sampai F4: kategori lama → slug (label modul `package/tour_package/haji` kini berarti "semua vendor aktif"), negara teks → ISO (negara tak dikenal → 400), `contactInfo` → `notes`, pengiriman kategori yang sudah termasuk tidak menimpa vendor multi-kategori. Masa antara berakhir di F4; vendor yang dibuat lewat jembatan sudah berkolom baru lengkap (tak ada lagi baris setengah jadi).
**Bukti — HTTP nyata (dev server + DB uji, superadmin/manager sungguhan):** kategori (superadmin 200/9 kategori sistem, manager baca 200, tanpa login 403, buat 201 + slug, duplikat 409, manager tulis 403); vendor (buat 201 tanpa kunci bocor, duplikat 409, tanpa kategori 400, kolom liar 400, body rusak 400, manager/anon 403, list penuh vs ramping, detail + pemakaian, ubah, body kosong 400); **route biaya: vendor ngawur 400 (Pesawat dan Visa; dulu 500), vendor aktif 200, vendor nonaktif 400 dengan pesan menu Vendor**; Muthowif membaca vendor sistem (1 baris "Saudinesia" di DB); hapus: vendor dipakai → nonaktif + rincian "1 komponen biaya, 1 vendor pilihan", aktifkan kembali, tak dirujuk → terhapus (0 baris), vendor sistem → 409 (hapus dan nonaktifkan); jembatan lama: GET `?category=hotel` memuat vendor yang dibuat API baru dengan bentuk lama, label modul → semua aktif, POST lama mengisi `nameKey`/`countryCode`/`notes`/kategori, negara aneh 400, PUT lama tidak menimpa multi-kategori (`hotel,transport` tetap) tetapi mengganti bila kategori berbeda, manager GET 200 / POST 403.
**Tes:** `scripts/test-vendor-api.ts` — **10 mutasi pengaman tertangkap** (cek tabrakan nama, hapus mengabaikan pemakaian, vendor sistem boleh dinonaktifkan, PUT tanpa otorisasi, manager mendapat bentuk penuh, deteksi duplikat kategori [lolos pada percobaan pertama karena indeks unik `slug` — tes diperketat agar memeriksa pesan], DTO membocorkan `nameKey`, handler biaya tanpa `assertVendorUsable`, route Pesawat tanpa pemeriksaan vendor, hapus keras tanpa menghapus alamat); penjaga: **hanya `lib/vendors/service.ts` yang menulis tabel vendor/kategori** (`grep` lintas `app/`, `lib/`, `components/`), route tipis, Muthowif tak membuat vendor. Penjaga SEC-61(b) di `test-routes.ts` dipindah ke handler baru + jembatan (dimutasi). `bun run test` 18 suite lulus; build produksi terisolasi 0 error; `bun audit` tidak berubah (5).
**Keterbatasan yang jujur:** route Hotel dan Transport tidak diuji lewat HTTP (fixture hotel/periode/trip berat) — dijaga penjaga sumber yang sama dengan Pesawat; jalur balapan hapus-vs-rujukan baru (P2003 → nonaktif) dan hapus-kategori-vs-penautan baru hanya dijaga kode, tidak disimulasikan.

### 8.3 Fase 3 — menu Sistem → Vendor, `VendorForm` (2026-10-26)

**Dibuat:** `components/admin/vendor/{VendorForm,VendorEditPanel,VendorCreatePanel,CategoryManager}.tsx` + `types.ts` (pemetaan formulir ⇄ body API); halaman `app/[locale]/admin/(protected)/system/vendors/{page,new/page,[id]/page,categories/page}.tsx`; entri sidebar **Sistem → Vendor** (`lib/admin/navigation.ts`, ikon `Handshake`) + label breadcrumb `vendors`/`categories`/`new`; `scripts/test-vendor-ui.ts` (masuk rantai `bun run test`). **Dihapus:** seluruh bagian "Vendor / Syarikah" (state, formulir, tabel, `AddressPicker`) dari halaman Pengaturan (−139 baris) — tidak ada lagi formulir vendor kedua.
**`VendorForm` (satu-satunya formulir vendor):** nama, negara (autocomplete ISO), kategori multi-pilih (kategori nonaktif yang sudah menempel tetap tampil), PIC, `ContactPicker` (telepon/WhatsApp/email), website, `AddressPicker`, catatan. Menyimpan sendiri lewat API F2 (POST/PUT) lalu memanggil `onSaved` — props `initialName`/`initialCategoryIds`/`onCancel`/`submitLabel` sudah disiapkan agar F4 memakainya **apa adanya** di dalam modal. Kode negara telepon/WhatsApp hanya dikirim bila nomornya ada (`ContactPicker` selalu membawa default `ID`; kode tanpa nomor ditolak server).
**Halaman:** daftar (server component; cari nama/PIC/email, filter kategori + status + negara, paginasi, tanda **Perlu ditinjau** untuk vendor tanpa negara/kategori atau yang hanya berkategori "Lainnya" hasil pemetaan migrasi); detail/edit dengan panel **Pemakaian** (biaya per tipe produk, vendor pilihan, riwayat visa), zona **nonaktifkan / aktifkan kembali / hapus** dengan konfirmasi inline (hapus vendor yang dipakai → dinonaktifkan + pesan, vendor sistem tanpa tombol); halaman **Kategori** (tambah, ubah nama/urutan, nonaktifkan/aktifkan, hapus; kategori bawaan tanpa tombol hapus/nonaktif, slug tak pernah berubah). Semua halaman: `requireAdminPage` lalu **alihkan non-superadmin** ke `/admin` (SEC-52 + menu Sistem memang superadmin; API tetap penjaga sebenarnya — manager masih boleh baca ramping untuk dropdown).
**Bukti — Chrome asli (CDP, dev server + DB uji, superadmin/manager sungguhan):** buat vendor lewat formulir (kontak, alamat kosong, 2 kategori) → pindah ke detail; simpan kosong → "Nama vendor wajib diisi"; duplikat (nama berbeda spasi/huruf) → 409 "Vendor … sudah ada di negara ini" tampil di formulir; ubah nama → tersimpan + judul berubah; nonaktifkan (konfirmasi) → aktifkan kembali → hapus (konfirmasi) → kembali ke daftar, vendor hilang; vendor yang dipakai `PreferredVendor` → panel pemakaian terisi, hapus → dinonaktifkan dengan pesan rincian; vendor sistem → tanpa tombol hapus/nonaktif; vendor lama tanpa negara → banner "berasal dari data lama", simpan tanpa negara ditolak; pencarian/filter/parameter ngawur (`status=zzz&page=999`) tidak merusak; kategori: tambah, duplikat ditolak, ubah nama (slug tetap), nonaktif ↔ aktif, hapus (konfirmasi); **manager**: ketiga halaman dialihkan ke `/admin`, `GET` daftar 200 bentuk ramping, `GET` kategori 200, `POST` 403; Pengaturan tetap termuat tanpa bagian vendor; tampilan HP (390px) dicek. Konsol tanpa galat selain catatan di bawah.
**Tes:** `scripts/test-vendor-ui.ts` (6 uji; **4 mutasi pengaman tertangkap**: halaman tanpa `requireAdminPage`, formulir pembuat vendor kedua, teks vendor kembali ke Pengaturan, entri menu dihapus); `bun run test` 357 PASS, 0 FAIL; `bun run build` (salinan terpisah) 0 error; `bun audit --audit-level=critical` bersih.
**Keterbatasan yang jujur:** (1) pada **dev server** halaman daftar vendor kadang (±15–25% muatan) mencetak peringatan hydration yang pulih sendiri lewat render klien; **tidak terjadi pada build produksi** (0 dari 12 muatan, filter menangkap galat React ter-minify), tidak terjadi pada halaman daftar lain (Booking 0/12) dan penyebab pastinya belum ditemukan — dicatat, tidak diblokir; (2) label "Negara" di `VendorForm` tak terhubung ke kontrolnya (`AutocompleteSelect` belum menerima `id`) — perbaikan a11y kecil, ikut F4 bila komponen itu disentuh; (3) alamat vendor tidak bisa dikosongkan kembali setelah terisi (skema alamat belum mendukung hapus) — sama seperti perilaku lama.

### 8.4 Fase 4 — `VendorPicker`, modal "Vendor baru", migrasi 6 situs, jembatan dihapus (2026-10-26)

**Dibuat:** `components/admin/vendor/VendorPicker.tsx` (satu-satunya pemilih vendor: pencarian sisi-server debounce 250 ms lewat `GET /admin/system/vendors`, penyaring kategori konteks `VENDOR_CONTEXT_CATEGORIES` + "Tampilkan semua kategori", hanya vendor aktif yang ditawarkan, vendor terpilih yang sudah nonaktif/lain kategori tetap tampil berlabel "(nonaktif)", tombol **Vendor Baru** hanya bagi superadmin → `VendorForm` yang SAMA di modal dengan kategori konteks terisi + fokus ke nama; manager mendapat pesan "minta superadmin…"), `components/admin/ui/Modal.tsx` (`<dialog>` bawaan + portal; Esc/fokus-terkunci), `components/admin/shell/AdminRole.tsx` (konteks `isSuperAdmin` dari layout — hanya petunjuk tampilan, penjaga tetap API).
**Dimigrasi (6 situs):** Pesawat (`context="flight"`), Hotel per-periode (`hotel`), Trip Transport per-baris harga (`transport`), Visa `CostTiersTab` vendor visa + BRN (`visa`), dan `VendorCurrencyField` yang dipakai `CostComponentsPanel` untuk Paket Umroh/Ziarah/Haji (`costComponent` = semua vendor; prop `vendorCategory` dihapus). Muthowif tetap read-only (vendor sistem). **Dihapus:** `lib/vendors/legacyBridge.ts`, route `…/settings/vendors` + `[id]`, `lib/admin/vendorQuickAdd.ts`, seluruh state/handler quick-add per editor (≈−330 baris), tes jembatan di `test-vendor-api.ts`/`test-routes.ts`. Tidak ada lagi jalur vendor selain API F2 dan satu `VendorForm`.
**Celah yang ditemukan & ditutup di fase ini:** editor Pesawat/Transport/Hotel mengabaikan respons simpan biaya — sejak F2 server menolak vendor nonaktif (400) tetapi UI tetap menampilkan "Tersimpan ✓". Kini respons diperiksa dan pesan server ("Vendor nonaktif — aktifkan dulu di menu Vendor…") tampil (Visa dan panel biaya sudah benar sebelumnya).
**Bukti — Chrome asli (CDP, dev server + SALINAN sementara DB lokal [`pg_dump`, DB asli tak disentuh], superadmin/manager sungguhan):** kelima area render picker dengan filter konteks benar (Pesawat → hanya maskapai; Hotel → hotel; Trip → transport; Visa → visa+BRN [3 vendor visa]; panel Paket/Ziarah/Haji → semua); "Tampilkan semua kategori" memperlebar daftar ke 10 vendor; **Pesawat end-to-end:** Vendor Baru → modal dengan kategori "Maskapai" tercentang → isi nama+negara → simpan → modal tertutup, picker terpilih vendor baru → "Simpan Harga Tiket" → `product_costs` menunjuk vendor baru, vendor tersimpan berkategori `airline`; pencarian sisi-server ("garuda"); vendor terpilih yang dinonaktifkan tetap tampil "(nonaktif)" dan tidak ditawarkan ulang; simpan dengan vendor nonaktif → galat server tampil (Pesawat); **manager:** picker ada, tombol "Vendor Baru" tidak ada. Konsol tanpa galat selain catatan hydration dev §8.3.
**Tes:** `scripts/test-vendor-ui.ts` bertambah 3 uji F4 (tanpa jalur lama/dropdown buatan sendiri/semua 5 berkas memakai `VendorPicker`; tombol + modal dibatasi superadmin; respons simpan diperiksa) — **5 mutasi pengaman tertangkap** (string jalur lama, gerbang superadmin dilepas, `<select>` vendor buatan sendiri, picker dicabut dari editor, `!r.ok` dilumpuhkan); `bun run test` hijau; `bun run build` (salinan terpisah) 0 error; `bun audit --audit-level=critical` bersih.
**Keterbatasan yang jujur:** (1) Trip Transport dan Hotel diuji sampai render picker + filter, tetapi **simpan-dengan-vendor-nonaktif tidak dijalankan di browser** untuk keduanya (tombol terkunci pada data salinan; pola kodenya identik dengan Pesawat dan dijaga uji sumber); (2) "Vendor Baru" dari panel biaya (konteks semua) tidak mengisi kategori — admin memilihnya; (3) picker memuat maksimal 50 hasil per pencarian (selebihnya lewat pencarian) — wajar untuk puluhan vendor; (4) menyatukan tinggi kotak picker dengan `<select>` mata uang di sebelahnya (beda ±2px) tidak dirapikan.

### 8.5 Fase 5 — migrasi kontraksi dan penutup (2026-10-26)

**Dibuat:** migrasi `prisma/migrations/20261026180000_vendor_single_flow_contract`: (1) **pengisian ulang** vendor yang masih ditulis jalur lama pada masa antara (ditandai `countryCode` kosong): negara teks → ISO (pemetaan eksplisit sama dengan F1), `contactInfo` → `notes`, kategori lama → kategori baku/`other` (+ catatan "Kategori lama: …"), `nameKey`; vendor yang sudah memakai kolom baru **tidak disentuh** (catatan/kategori barunya tidak tertimpa); (2) **fail-closed**: negara tak dikenal atau tabrakan `(nameKey, countryCode)` pada nilai yang AKAN terisi (diperiksa sebelum indeks unik menolak, supaya pesannya ramah) membatalkan seluruh migrasi; (3) `nameKey`/`countryCode` **NOT NULL**; (4) `category`, `country`, `contactInfo` **DROP**. `schema.prisma` mengikuti; tipe UI (`VendorRecord.countryCode`, picker) diperketat jadi non-null. Dihapus: `scripts/_vendor-snap.ts` (alat sementara F1 yang ikut ter-commit dan membaca kolom lama).
**Bukti — rehearsal pada SALINAN DB lokal (`pg_dump`):** sebelum vs sesudah migrasi identik pada 10 vendor, 18 `ProductCost`, 14 `PreferredVendor`, 10 tautan kategori, serta checksum md5 (biaya, vendor [id/nama/nameKey/countryCode/catatan/aktif], tautan kategori, harga pesawat+visa); kolom lama = 0. Lalu diterapkan ke DB lokal pengguna setelah `pg_dump` (`/tmp/vendor_backup/saudinesia_pre_vendor_F5.sql`) dan ke DB uji; salinan sementara di-drop.
**Tes:** `scripts/test-vendor-contraction.ts` (`prisma migrate deploy` sungguhan pada DB sementara dari template; 5 uji: pengisian ulang + data baru tak tertimpa + kolom hilang + vendor pilihan utuh; NOT NULL + keunikan; negara tak dikenal → gagal dan kolom lama TETAP ada; vendor ganda lama-vs-baru → gagal, negara berbeda lolos; **tanpa drift** `migrate diff` skema vs hasil semua migrasi) — **5 mutasi SQL tertangkap** (cek negara dilumpuhkan, cek tabrakan dilumpuhkan, catatan vendor baru tertimpa, NOT NULL dilepas, kolom lama dipertahankan). `scripts/test-vendor-migration.ts` (F1) kini membangun DB pra-F1 tanpa migrasi F1 *dan yang lebih baru*, dan tes drift-nya pindah ke tes kontraksi. `scripts/test-vendor-ui.ts` + 1 penjaga F5 (model `Vendor` tanpa kolom lama, `nameKey`/`countryCode` wajib, tak ada kode yang membacanya; dimutasi). Tes lama yang membuat vendor berbentuk lama (`test-haji-pricing`, `test-cost-components`, `test-vendor-model`) disesuaikan.
**Penutup dokumentasi:** `docs/arsitektur-harga.md` §3.1 dan §18 ditandai **DIGANTIKAN**; `CLAUDE.md` memuat aturan vendor (pemilih/formulir/penulis tunggal) dan entri dokumen ini; `docs/progress.md`, `docs/decisions.md`, memori diperbarui.
**Hasil akhir proyek vendor:** satu entitas `Vendor`; kategori terkelola admin (many-to-many); kontak terstruktur + alamat; satu `VendorForm`, satu `VendorPicker`, satu penulis (`lib/vendors/service.ts`), satu rangkaian API (`/admin/system/vendors*`, `/vendor-categories*`); integritas rujukan di DB (FK Restrict) **dan** di route (`assertVendorUsable`); hapus aman; vendor sistem Saudinesia. Tidak ada lagi jalur data vendor ganda.
**Keterbatasan yang jujur:** migrasi kontraksi tidak dapat dibalik tanpa pemulihan dari cadangan (kolom lama dibuang); data yang tak termigrasi diam-diam tidak ada (kasus tak dikenal menggagalkan migrasi), tetapi vendor "Lainnya" hasil pemetaan perlu dikategorikan ulang oleh admin (ditandai "Perlu ditinjau" di daftar). Hal di luar scope tetap dicatat §6 (bank/NPWP/termin, gabung-vendor, impor massal, penilaian vendor).
