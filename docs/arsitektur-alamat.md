# Arsitektur — Komponen Alamat Standar Indonesia

> **Status: SELESAI & TERVERIFIKASI (2026-07-23), termasuk wiring ke form nyata.** Komponen universal ke-4 (sejajar harga, dokumen, manifest) — cascading selector Provinsi → Kabupaten/Kota → Kecamatan → Desa/Kelurahan berdasarkan data resmi Kemendagri, supaya orang tidak perlu ketik alamat administratif secara manual. Schema, impor data, API, dan komponen frontend (`AddressPicker`) sudah dieksekusi dan diverifikasi — lihat §8. **Sudah diwire ke 3 entity nyata** (`User`/profil pilgrim, `Vendor`/settings, `Hotel`/detail produk) — lihat §9, termasuk bug Zod `.optional()` vs `null` yang ditemukan & ditutup saat verifikasi browser end-to-end. `BookingPilgrim`/Manifest (`docs/arsitektur-manifest.md`) masih belum dieksekusi — akan pakai `Address`/`AddressPicker` yang sama lewat `fieldType='address'` saat itu terjadi.

---

## 1. Konteks Bisnis

Field "Alamat" di manifest (`docs/arsitektur-manifest.md` §3.1) awalnya direncanakan `fieldType='textarea'` (teks bebas). User minta distandardisasi: alamat administratif (Provinsi/Kab-Kota/Kecamatan/Desa) dipilih dari **data resmi**, bukan diketik manual — mengurangi kesalahan ketik, menstandardkan penulisan nama wilayah, dan membuka kemungkinan pemakaian yang sama di tempat lain (mis. alamat Vendor, alamat Hotel) nanti.

---

## 2. Riset Sumber Data (2026-07-23)

Dibandingkan beberapa repo GitHub data wilayah Indonesia (`wilayah-indonesia` npm, `geografis`, `wilayah-administratif-indonesia`, `cahyadsn/wilayah`, dll.) — **`cahyadsn/wilayah`** dipilih sebagai sumber:

- **Paling aktif dipelihara** — data mengikuti **Kepmendagri No 300.2.2-2430 Tahun 2025** (revisi terbaru per Juni 2025), bukan data lama yang berhenti di 34 provinsi.
- **Lisensi MIT** — bebas dipakai komersial.
- **Terverifikasi langsung dari README repo** (bukan asumsi), jumlah per 2025:

| Level | Jumlah |
|---|---|
| Provinsi | **38** (34 lama + Papua Selatan, Papua Tengah, Papua Pegunungan, Papua Barat Daya) |
| Kabupaten/Kota | **514** (416 kabupaten + 98 kota) |
| Kecamatan | **7.285** |
| Desa/Kelurahan | **83.762** (75.266 desa + 8.496 kelurahan) |

- **Format sumber:** SQL dump MySQL (`db/wilayah.sql`) — bukan Postgres native, bukan JSON/CSV siap pakai, bukan npm package. Perlu dikonversi.
- Repo terkait yang TIDAK dipakai sekarang (potensi masa depan): `wilayah_kodepos` (kode pos), `wilayah_boundaries` (polygon/GIS) — di luar scope, cuma butuh nama+kode wilayah untuk form alamat.

**Struktur baris asli (VERIFIKASI LANGSUNG 2026-07-23 — file `db/wilayah.sql` diunduh & diperiksa isinya, bukan diasumsikan dari README):**

Sumbernya **satu tabel flat** `wilayah(kode VARCHAR(13), nama VARCHAR(100))` — BUKAN 4 tabel terpisah seperti rencana awal. `kode` adalah string berjenjang dipisah titik, jumlah segmen menentukan level:

```
'11'                → Provinsi (1 segmen, 2 digit)              — Aceh
'11.01'             → Kab/Kota (2 segmen)                        — Kabupaten Aceh Selatan
'11.01.01'          → Kecamatan (3 segmen)                       — Bakongan
'11.01.01.2001'     → Desa/Kelurahan (4 segmen, 4 digit terakhir) — Keude Bakongan
```

Jumlah baris per level dikonfirmasi PERSIS cocok dengan README: 38 (provinsi) / 514 (kab-kota) / 7.285 (kecamatan) / 83.762 (desa-kelurahan).

**2 temuan yang MENGOREKSI rencana skema §3 (versi sebelumnya):**
1. **`type` kabupaten/kota BISA diturunkan dari `nama`** — dicek: seluruh 514 baris level kab/kota, 100% diawali `"Kabupaten "` atau `"Kota "` (0 pengecualian) — jadi field `type` tetap bisa diisi otomatis saat impor, aman.
2. **`type` desa/kelurahan TIDAK BISA diturunkan** — dicek: dari 83.762 baris level desa, cuma **21 baris** yang eksplisit diawali `"Desa "`/`"Kelurahan "` — sisanya (>99.9%) cuma nama tempat polos ("Keude Bakongan", "Ujong Mangki", dst.), TIDAK ada penanda desa/kelurahan yang bisa diandalkan di data ini. **Field `type` di `AddressVillage` DIHAPUS dari rencana** — dipaksakan mengisi dari data yang tidak mendukungnya cuma akan menghasilkan `null`/tebakan salah untuk >99.9% baris, lebih baik tidak ada field itu sama sekali daripada isinya bohong.

---

## 3. Skema Baru (rencana)

Struktur cascading 1:1 dengan hierarki resmi — 4 tabel referensi (bukan tabel transaksional), prefix `address_` supaya jelas ini data referensi, bukan entity bisnis:

```prisma
model AddressProvince {
  id   String @id // kode wilayah resmi Kemendagri (format PERSIS dikonfirmasi saat baca db/wilayah.sql)
  name String

  regencies AddressRegency[]
  @@map("address_provinces")
}

model AddressRegency { // kabupaten & kota — level administratif SAMA (paralel), dibedakan `type`
  id         String @id
  provinceId String
  name       String
  type       String // 'kabupaten' | 'kota'

  province  AddressProvince  @relation(fields: [provinceId], references: [id])
  districts AddressDistrict[]

  @@index([provinceId])
  @@map("address_regencies")
}

model AddressDistrict { // kecamatan
  id        String @id
  regencyId String
  name      String

  regency  AddressRegency  @relation(fields: [regencyId], references: [id])
  villages AddressVillage[]

  @@index([regencyId])
  @@map("address_districts")
}

model AddressVillage { // desa & kelurahan — TIDAK ADA field `type`, lihat catatan §2: data sumber
                        // tidak reliably membedakan keduanya (cuma 21/83.762 baris ada penanda eksplisit)
  id         String @id
  districtId String
  name       String

  district AddressDistrict @relation(fields: [districtId], references: [id])

  @@index([districtId])
  @@map("address_villages")
}
```

**Kenapa 4 tabel terpisah (bukan 1 tabel flat "wilayah" mirip sumbernya):** cascading select butuh query "semua Regency di bawah Province X" dengan cepat — 4 tabel + index per level jauh lebih alami untuk pola akses itu dibanding satu tabel besar dengan banyak kolom kode bertingkat. ~83.762 baris di level desa/kelurahan bukan masalah untuk Postgres dengan index yang benar (jauh dari beban berat).

### 3.1 `Address` — entitas nilai yang dipakai lintas modul (jawaban "join table atau bagaimana")

4 tabel di atas (`AddressProvince`/`Regency`/`District`/`Village`) adalah **data referensi murni** (master data wilayah, tidak pernah diedit aplikasi, cuma dibaca) — BUKAN tempat menyimpan alamat SESEORANG. Untuk itu ada satu model baru **`Address`**, dan modul lain (Manifest, dan nanti kalau dibutuhkan: Vendor, Hotel, profil User, dst.) **cukup punya kolom `addressId` yang menunjuk ke satu baris `Address`** — pola foreign-key biasa, bukan tabel pivot many-to-many.

```prisma
model Address {
  id          String      @id @default(uuid())
  type        AddressType // 'domestic' (Indonesia) | 'international' — tab mana yang dipakai
  fullAddress String      // "Alamat Lengkap" — jalan, nomor rumah, RT/RW, patokan: TEKS BEBAS, dipakai KEDUA tipe
  postalCode  String?     // kode pos — dipakai kedua tipe, diisi manual untuk sekarang (integrasi wilayah_kodepos otomatis di luar scope, §6)

  // Domestik (tab "Alamat Indonesia") — diisi HANYA kalau type='domestic'
  provinceId String?
  regencyId  String?
  districtId String?
  villageId  String?

  // Internasional (tab "Alamat Luar Negeri") — diisi HANYA kalau type='international'
  countryCode String? // ISO 3166-1 alpha-2 ('SA', 'MY', 'US', dst.) — lihat §3.2
  city        String? // teks bebas — tidak ada data wilayah terstruktur per negara di luar Indonesia
  stateRegion String? // teks bebas — negara punya bermacam istilah (state/province/region/emirate)

  province AddressProvince? @relation(fields: [provinceId], references: [id])
  regency  AddressRegency?  @relation(fields: [regencyId], references: [id])
  district AddressDistrict? @relation(fields: [districtId], references: [id])
  village  AddressVillage?  @relation(fields: [villageId], references: [id])

  @@map("addresses")
}

enum AddressType {
  domestic
  international

  @@map("address_type")
}
```

**Kenapa BUKAN dibagi/di-share antar orang (bukan many-to-many):** meski dua orang tinggal serumah, masing-masing tetap dapat baris `Address` sendiri (biar tidak ada ambiguitas "siapa yang berhak edit alamat ini kalau dipakai bersama") — sederhana lebih penting daripada dedup penyimpanan yang murah. Jadi relasinya selalu **1 pemilik → 1 `Address`** (FK nullable di sisi pemilik), bukan tabel pivot.

**Cara modul lain memakainya:**
- **Manifest** (`docs/arsitektur-manifest.md`) — karena `BookingPilgrim.fieldValues` itu `Json` dinamis (bukan kolom Prisma tetap), field `alamat` di situ isinya cukup **string `addressId`** yang menunjuk ke baris `Address` (polimorfik, tidak di-enforce FK di level DB — pola sama seperti `ProductCost.productId`/`PackageItem.productId` yang sudah ada di proyek ini).
- **Modul masa depan** yang BUKAN dynamic-fields (mis. `Vendor`, `Hotel`, profil `User`) — cukup tambah kolom `addressId String?` + `@relation` FK biasa ke `Address`, di-enforce penuh di level DB (karena model-model itu py skema tetap, beda dari Manifest yang dinamis).

**UI: autocomplete, bukan `<select>` polos.** Tiap level (Provinsi/Kab-Kota/Kecamatan/Desa) dirender sebagai **combobox pencarian** (ketik untuk cari, bukan scroll dropdown panjang) — meski jumlah per-level per-induk sebenarnya kecil (rata-rata cuma puluhan), autocomplete tetap dipakai sesuai permintaan user, konsisten juga untuk pengalaman yang sama di level Provinsi (38 opsi — masih nyaman di-scroll, tapi tetap combobox biar seragam semua level).

### 3.2 Dua Tab — Domestik vs Internasional

User eksplisit: alamat ini publik (dipakai jamaah WNI yang tinggal di Indonesia MAUPUN yang tinggal di luar negeri, atau alamat vendor/kontak luar negeri nanti) — jadi form-nya **2 tab terpisah**, bukan satu form bercabang otomatis dari pilihan negara:

- **Tab "Alamat Indonesia"** (`type='domestic'`) — 4 combobox berjenjang (§3.1) + Alamat Lengkap + Kode Pos. Field internasional (`countryCode`/`city`/`stateRegion`) dikosongkan.
- **Tab "Alamat Luar Negeri"** (`type='international'`) — combobox **Negara** (daftar statis ISO 3166-1, ~195 negara, lihat catatan di bawah) + **Kota** (teks bebas) + **State/Province/Region** (teks bebas — sengaja bebas karena istilah & granularitas berbeda per negara, tidak mungkin distandardkan seperti Indonesia) + Alamat Lengkap + Kode Pos. Field domestik (`provinceId` dkk.) dikosongkan.

**Kenapa daftar negara TIDAK diriset dari GitHub seperti data wilayah Indonesia:** ISO 3166-1 (kode+nama negara) adalah standar internasional yang sangat stabil (jarang berubah, beda dari data kecamatan/desa Indonesia yang direvisi Kemendagri tiap beberapa tahun) — cukup **daftar statis** (`lib/constants/countries.ts`, ~195 negara kode+nama Bahasa Indonesia) dibundel langsung di kode, TIDAK perlu tabel database terpisah atau CRUD admin (negara tidak pernah berubah drastis, tidak butuh dikelola seperti data bisnis). Ini beda perlakuan yang disengaja dari 4 tabel wilayah Indonesia (yang memang perlu jadi tabel DB karena volumenya besar dan query-nya butuh cascading/index).

**Validasi:** server pastikan field yang relevan cuma diisi sesuai `type` yang dipilih (kalau `type='domestic'`, field internasional harus null, dan sebaliknya) — bukan cuma dijaga di UI.

---

## 4. Strategi Seed (BUKAN migrasi biasa)

~83.762 baris di level desa/kelurahan **tidak ditulis sebagai `migration.sql` manual** (konvensi migrasi di `CLAUDE.md` untuk perubahan skema kecil) — datanya terlalu besar untuk ditulis tangan atau ditinjau baris demi baris. Alurnya:

1. Migrasi SKEMA (4 tabel kosong) — lewat workflow shadow-DB non-interaktif seperti biasa (`bun prisma migrate deploy`, ukuran migrasi kecil, cuma `CREATE TABLE`).
2. **Skrip konversi terpisah** (`scripts/import-wilayah.ts`, one-off, bukan bagian `prisma/seed.ts` yang jalan tiap `db seed` — data referensi ini tidak berubah tiap seed): baca `db/wilayah.sql` (diunduh manual dari repo sumber ke `scripts/data/wilayah.sql`, TIDAK di-fetch otomatis saat runtime aplikasi — sumbernya cuma dipakai SEKALI saat build data awal). Logic parsing (dikonfirmasi dari struktur asli, §2):
   - Baca tiap baris `INSERT INTO wilayah (kode, nama) VALUES (...)`, split `kode` by `.` — jumlah segmen menentukan level (1=provinsi, 2=kab/kota, 3=kecamatan, 4=desa/kelurahan).
   - `parentId` tiap baris = `kode` dikurangi segmen terakhir (mis. induk `'11.01.01.2001'` adalah `'11.01.01'`).
   - `AddressRegency.type` diisi otomatis dari prefix `nama` (`"Kabupaten "` → `kabupaten`, `"Kota "` → `kota` — 100% reliable, lihat §2).
   - `AddressVillage` TIDAK punya field `type` (§3, tidak reliable dari sumber ini).
   - Insert bertingkat (Province dulu, baru Regency, dst. — supaya FK parent selalu sudah ada) via `createMany` batch (bukan satu-per-satu, hindari 83rb round-trip DB terpisah).
3. Setelah data masuk, skrip konversi TIDAK perlu dijalankan lagi kecuali ada revisi Kepmendagri baru di masa depan (jarang — beberapa tahun sekali) — dijalankan manual saat memang perlu, bukan bagian pipeline rutin.

---

## 5. Integrasi ke Manifest (`docs/arsitektur-manifest.md`)

Field `alamat` di manifest berubah dari `fieldType='textarea'` jadi **`fieldType='address'` (BARU, ditambahkan ke katalog §3.1)**:

- Widget: 2 tab — "Alamat Indonesia" (4 combobox autocomplete berjenjang: Provinsi → aktif setelah pilih, Kab/Kota → Kecamatan → Desa/Kelurahan) dan "Alamat Luar Negeri" (combobox Negara + Kota/State teks bebas) — lihat §3.2. Kedua tab sama-sama punya input **"Alamat Lengkap"** (teks bebas, jalan/nomor rumah/RT-RW/patokan) + Kode Pos.
- Saat disimpan: server membuat/meng-update **satu baris `Address`** (§3.1) dari input itu, lalu `BookingPilgrim.fieldValues[fieldKey]` (`docs/arsitektur-manifest.md` §3) cukup menyimpan **string `addressId`**-nya — bukan objek alamat lengkap dobel-disimpan di dua tempat. Baca-ulang alamat (tampilan admin, invoice, dst.) selalu lewat join ke `Address` + relasinya, bukan parsing `fieldValues` mentah.
- Validasi: `districtId` harus benar-benar anak dari `regencyId` yang dipilih, dst. (validasi hierarki berjenjang) — dicek server-side saat submit, bukan cuma percaya urutan klik di UI.
- **Reusable ke luar Manifest** (sesuai permintaan user): modul lain yang butuh alamat nanti (Vendor, Hotel, profil User, dst.) tinggal tambah kolom `addressId` FK biasa (§3.1) — TIDAK perlu bikin ulang 4 tabel wilayah atau logic autocomplete-nya, cukup pakai `Address` + komponen combobox yang sama.

---

## 6. Yang TIDAK Termasuk Rencana Ini

- Kode pos otomatis (`wilayah_kodepos`, repo terpisah) — bisa ditambah nanti kalau memang dibutuhkan, bukan sekarang.
- Koordinat/boundary GIS (`wilayah_boundaries`) — tidak relevan untuk form alamat manifest.
- Pembaruan data wilayah otomatis/berkala — data referensi ini di-refresh manual kalau ada revisi Kepmendagri baru, tidak ada cron/job.
- Pemakaian di tempat LAIN selain Manifest (alamat Vendor, Hotel, dst.) — komponennya reusable secara desain, tapi integrasi konkret ke modul lain menyusul kalau memang dibutuhkan, bukan dikerjakan sekaligus sekarang.

---

## 8. Verifikasi (2026-07-23)

Semua fase dieksekusi berurutan, `bun run build` 0 error di tiap fase (dev server direstart setelah tiap build production untuk menghindari korupsi manifest `.next`, masalah lingkungan yang berulang di sesi ini):

- **Fase 1 (Schema)**: 4 tabel wilayah + `Address` + enum `AddressType`, migrasi diverifikasi via shadow database terpisah (`saudinesia_shadow_addr`, dibuat & di-drop eksplisit).
- **Fase 2 (Impor data)**: `scripts/import-wilayah.ts` — percobaan pertama gagal (regex tidak menangani eskape `''` gaya SQL standar, FK violation) → diperbaiki, data dibersihkan (`TRUNCATE ... CASCADE`), diimpor ulang. Hasil akhir dikonfirmasi PERSIS cocok dengan README sumber: 38 provinsi / 514 kab-kota (416 kabupaten + 98 kota, 100% derivasi `type` benar) / 7.285 kecamatan / 83.762 desa-kelurahan. Idempoten dikonfirmasi (`skipDuplicates`, re-run kedua = 0 baris baru).
- **Fase 3 (Daftar negara)**: `lib/constants/countries.ts`, 195 negara ISO 3166-1 + nama Bahasa Indonesia.
- **Fase 4 (API)**: endpoint publik `wilayah/provinces|regencies|districts|villages` + `POST`/`GET`/`PUT /api/v1/address` (requireSession). Diuji langsung via curl: create alamat domestik berhasil, validasi hierarki BENAR menolak `regencyId` yang tidak sesuai `provinceId`, GET mengembalikan nama-nama hasil join dengan benar.
- **Fase 5 (Komponen frontend)**: `AddressPicker` + `AutocompleteSelect` (`components/shared/`), pakai token shadcn standar (bukan token khusus admin) supaya konsisten dipakai admin maupun pilgrim. Diverifikasi via halaman uji sementara (dihapus setelah verifikasi) — cascading Provinsi→Kab/Kota→Kecamatan berfungsi benar (Jawa Barat → Kota Bandung → Bandung Kidul), filter pencarian berfungsi, switch tab domestik/internasional berfungsi (Arab Saudi terpilih dengan benar, field domestik ter-clear).
- **Perluasan 2026-07-23 (`AutocompleteSelect` jadi genuinely reusable, bukan cuma khusus alamat)**: user eksplisit minta konfirmasi komponen combobox-nya bisa dipakai di form lain juga, bukan cuma di sini. `AutocompleteSelect` sudah generik dari awal (terima `options: {id,label}[]` apa pun, tidak tahu apa-apa soal alamat/wilayah), tapi ditambah 2 kemampuan supaya benar-benar siap dipakai lintas kasus: (1) **navigasi keyboard** (panah atas/bawah menggeser highlight, Enter memilih, Escape menutup) — diverifikasi highlight bergerak benar via panah bawah (screenshot: "Jawa Tengah" ter-highlight); (2) **mode pencarian server-side opsional** (`onSearch` callback + `loading` prop) — dipakai konkret di combobox Desa/Kelurahan (kecamatan tertentu bisa punya banyak desa), diverifikasi: ketik "tinjo" pada kecamatan Banyumanik → request `GET .../villages?districtId=33.74.11&q=tinjo` terkirim (debounce 300ms) → hasil "Tinjomoyo" tampil benar. Mode default (filter lokal atas `options` yang sudah dimuat) tetap dipakai apa adanya untuk Provinsi/Kab-Kota/Kecamatan/Negara (jumlah kecil, tidak perlu round-trip server per huruf).
  - Catatan pengujian: mencoba verifikasi pemilihan via tombol Enter otomatis (bukan klik) memicu artefak navigasi-ke-homepage yang sama seperti yang tercatat di sesi-sesi sebelumnya (alat automation browser, bukan bug kode) — dikonfirmasi bukan masalah nyata karena state highlight sudah terbukti benar via panah bawah, dan pemilihan via klik pada item yang di-highlight tetap berhasil sempurna.
- Ditemukan & diperbaiki 1 bug tipe (`import.meta.dir` bukan API TypeScript standar, Next.js build gagal) — diganti `fileURLToPath(new URL(...))`, portable ESM.

---

## 9. Wiring ke Entity Nyata (2026-07-23)

User: "semua yang membutuhkan alamat ... pakai komponen tersebut" — dikonfirmasi via audit (`grep` schema): **tidak ada satu pun entity yang punya field alamat hari ini** (`User`, `Vendor`, `Hotel`, `BookingPilgrim` — semua belum ada). Dipilih 3 entity dengan kebutuhan bisnis nyata untuk pasang `addressId` sekarang:

| Entity | Kebutuhan | Halaman yang sudah ada (titik pasang) |
|---|---|---|
| `User` | Alamat rumah jamaah (KYC/kontak) | `(pilgrim)/profile/ProfileForm.tsx` — form profil sudah ada, shadcn styling, cocok langsung tanpa mismatch |
| `Vendor` | Alamat bisnis vendor/syarikah | `admin/system/settings/page.tsx` — form create sudah ada, admin-inp styling |
| `Hotel` | Alamat fisik hotel (tampil ke jamaah) | `admin/products/hotels/[id]/page.tsx` panel "Informasi Dasar" — sudah ada form edit lengkap |

**`BookingPilgrim` SENGAJA TIDAK disentuh** — kolom bakunya akan dihapus total begitu `docs/arsitektur-manifest.md` dieksekusi (diganti `fieldValues: Json`), jadi menambah `addressId` di sana sekarang cuma akan perlu dibongkar lagi tak lama kemudian. Field alamat di Manifest nanti tetap akan pakai `Address`/`AddressPicker` yang sama, cuma lewat mekanisme `fieldType='address'` (§3.1 `docs/arsitektur-manifest.md`), bukan kolom FK langsung.

**Skema:** `addressId String? @unique` + relasi `address Address?` di ketiga model (unik supaya benar-benar 1:1, bukan bisa di-share) — `Address` dapat back-relation `user User?`, `vendor Vendor?`, `hotel Hotel?`.

**Pola API — nested, bukan API terpisah:** ketiga entity menerima `address: addressSchema.optional()` di payload create/update-nya sendiri — route handler memvalidasi (`prepareAddressData()`, sudah ada) lalu `create`/`update` baris `Address` DALAM request yang sama (bukan pilgrim/admin harus panggil `/api/v1/address` dulu secara terpisah). Ini menghindari race condition/`Address` yatim kalau langkah kedua gagal, dan tetap satu submit form dari sisi UI.

**Keputusan tambahan — Vendor dapat kemampuan edit lengkap (bukan cuma create):** halaman Settings sebelumnya cuma bisa toggle `isActive` untuk vendor existing (field lain write-once saat create). Supaya alamat vendor (dan field lain) tetap bisa dikoreksi setelah dibuat — bukan field sekali-isi — form create diubah rangkap jadi form create+edit (pola `openXxx(existing?)` yang sudah dipakai berulang di modul lain sesi ini).

**Bug ditemukan & DITUTUP saat verifikasi browser end-to-end:** `addressSchema` memakai `.optional()` polos di semua field turunan — hanya menerima `undefined`, padahal `AddressPicker` (form terkontrol) selalu mengirim `null` untuk field yang belum dipilih. Akibatnya PUT vendor/hotel/profile manapun dengan alamat SELALU gagal 400 sampai perbaikan ini — bug ada sejak awal wiring di ketiga entity, baru ketahuan begitu benar-benar dicoba simpan lewat form React (verifikasi Fase Alamat sebelumnya cuma lewat curl dengan payload manual yang menghilangkan field kosong, bukan `null` eksplisit). Diperbaiki: semua field opsional di `addressSchema` diganti `.nullish()`. Diverifikasi ulang: simpan alamat vendor "Ahmad Guide" (Jawa Barat, alamat lengkap) berhasil 200, dikonfirmasi tersimpan benar lewat query DB langsung, data test dibersihkan. Detail lengkap di `docs/decisions.md` 2026-07-23.

**Verifikasi:** `bun run build` 0 error. Vendor: edit form terbuka prefilled, ganti provinsi → kab/kota cascading benar, simpan → 200 → data persisten (dikonfirmasi query DB). Fix schema berlaku otomatis ke Hotel dan Profile (satu `addressSchema` dipakai bertiga).

**Lokasi Google Maps (2026-11-02, `docs/arsitektur-hotel.md` §12.5):** `Address` mendapat `mapsUrl`/`latitude`/`longitude` opsional, diterima HANYA lewat `addressWithMapSchema` (dipakai Hotel) dan `AddressPicker withMap`. `User`/`Vendor`/Pengaturan Invoice tetap `addressSchema` (kolom itu dibuang) — lokasi rumah jamaah tak pernah disimpan.

---

## 10. Referensi Silang

- Sumber data: [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) (MIT, Kepmendagri No 300.2.2-2430 Tahun 2025)
- Prasyarat/pasangan: `docs/arsitektur-manifest.md` §3.1 (katalog `fieldType`, akan ditambah `'address'` saat Manifest dieksekusi)
- Pola desain: tabel referensi murni (mirip `RoomType`/`TransportVehicle` — master data, bukan entity transaksional)
