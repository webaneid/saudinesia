# Arsitektur — Vendor (satu alur, satu sumber data)

> **Status: RENCANA (2026-10-26) — belum ada kode yang diubah.** Memuat audit as-built hasil recheck langsung ke kode dan data lokal (SOP langkah 1), rancangan target, dan fase eksekusi. Keputusan arsitekturnya dikunci di **ADR-0003** (`docs/decisions/adr-0003-satu-alur-vendor-kategori-terkelola.md`). Setelah fase-fasenya dieksekusi, §8 menjadi as-built dan dokumen ini menjadi source of truth vendor; **menggantikan** `docs/arsitektur-harga.md` §3.1 dan §18 (kategori vendor teks bebas per modul).

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

### 3.4 Migrasi data (satu migrasi Prisma, fail-closed)

1. Buat `vendor_categories` + seed kategori sistem; buat kolom baru di `vendors`; tabel pivot m2m.
2. Pemetaan kategori lama → baru: `syarikah→visa`, `maskapai→airline`, `hotel→hotel`, `transport→transport`, `internal→internal`; `package`/`tour_package`/`haji`/`null`/lain → `other` (admin meninjau; UI menandai vendor yang hanya `other`). Kategori lama bernilai teks lain yang tidak dikenal juga → `other` (nilai aslinya disimpan di `notes` agar tidak hilang).
3. `country` teks → `countryCode` lewat tabel pemetaan nama→ISO yang ditulis eksplisit di migrasi (nilai nyata: `Saudi Arabia→SA`, `Indonesia→ID`); **nilai tak dikenal membuat migrasi GAGAL** (fail-closed, bukan tebakan).
4. `contactInfo` → `notes` (tanpa kehilangan; admin memecahnya ke kolom terstruktur lewat UI).
5. `nameKey` diisi; bila dua vendor bertabrakan `(nameKey, countryCode)` migrasi **gagal** dengan daftar tabrakan (tidak menggabung diam-diam).
6. Tambah FK `PreferredVendor.vendorId` → `Vendor` (Restrict); pastikan tak ada yatim sebelum FK (migrasi gagal bila ada).
7. Buat vendor sistem `saudinesia`: bila baris `internal` lama bernama "Saudinesia" ada, **ditandai** `systemKey` (bukan dibuat ganda).
8. Hapus kolom lama. **Bukti**: jumlah vendor/biaya/vendor pilihan sebelum = sesudah, id tak berubah, hasil `computeSellPrice` identik pada data lokal (rekam-bandingkan).

### 3.5 Frontend

- **Menu Sistem → Vendor** (`/admin/system/vendors`, `lib/admin/navigation.ts`): daftar (cari, filter kategori/negara/status, paginasi, lencana kategori, tanda "perlu ditinjau" bagi vendor yang hanya `other`), halaman detail/edit `/admin/system/vendors/[id]` (formulir penuh + panel **Pemakaian** + zona hapus/nonaktif), dan tab/halaman **Kategori** (CRUD). Tab vendor di Pengaturan **dihapus**.
- **`components/admin/vendor/VendorForm.tsx`** — formulir tunggal (nama, negara [autocomplete ISO], kategori [multi-pilih], PIC, telepon/WhatsApp/email memakai pola `ContactPicker`, website, alamat via `AddressPicker`, catatan).
- **`components/admin/vendor/VendorPicker.tsx`** — satu-satunya cara memilih vendor di seluruh admin: dropdown dengan pencarian, penyaring konteks kategori (+ "tampilkan semua"), lencana kategori/negara, dan "Vendor Baru" → modal `VendorForm` (kategori konteks terisi otomatis); superadmin saja yang melihat tombol itu. Menggantikan `VendorCurrencyField` (bagian vendor), mini quick-add di Pesawat/Hotel/Transport, `VendorField` di Visa, dan `lib/admin/vendorQuickAdd.ts`.

## 4. Fase eksekusi (satu fase satu waktu; tiap fase: recheck → kode → tsc → `bun run build` terisolasi → uji nyata termasuk penolakan → security check → dokumentasi → PR → CI hijau → merge atas persetujuan)

| Fase | Isi | Bukti utama |
|---|---|---|
| **F1** | Skema + migrasi data (§3.4) + kategori/vendor sistem + konstanta + validator Zod `.strict()` + fungsi `assertVendorUsable`/pemakaian | Rekam-bandingkan pada **salinan** DB lokal (jumlah, id, hasil harga identik); uji migrasi gagal-tertutup (negara tak dikenal, tabrakan nama); tes DB |
| **F2** | API vendor + kategori (§3.3), semantik hapus, keunikan, pemakaian; route lama `…/settings/vendors` dihapus; kelima route biaya + handler bersama memakai `assertVendorUsable`; Muthowif membaca vendor sistem | HTTP nyata semua kasus (403/400/404/409, hapus vs nonaktif, vendor ngawur → 400 bukan 500); mutasi pengaman |
| **F3** | Menu Sistem → Vendor (daftar, detail/edit, kategori), `VendorForm`; tab Pengaturan dihapus | Chrome asli (CDP): CRUD lengkap vendor dan kategori sebagai superadmin; manager hanya baca |
| **F4** | `VendorPicker` + modal; migrasi 6 situs (Pesawat, Hotel, Trip Transport, Visa, `VendorCurrencyField`/panel biaya, + Muthowif read-only); hapus kode quick-add lama | Chrome asli di tiap editor: filter konteks, buat via modal, simpan; penjaga CI "tidak ada pembuatan vendor di luar `VendorForm`" (dimutasi) |
| **F5** | Penutup: hapus sisa jalur lama, dokumen ini → as-built, `docs/arsitektur-harga.md` §3.1/§18 ditandai digantikan, `CLAUDE.md`, register, memori | `grep` bukti tak ada lagi `Vendor.category`/`contactInfo`/`country`; semua suite |

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

_Belum ada — diisi per fase._
