# Arsitektur — Komponen Manifest (Form Orang) Universal (SELESAI & TERVERIFIKASI untuk Visa)

> **Status: SELESAI & TERVERIFIKASI (2026-07-24)** — `ManifestFieldRequirement` dieksekusi, `BookingPilgrim` kolom baku (fullName/gender/email/phone.../passportNumber/dst.) DIHAPUS diganti `fieldValues: Json`, seluruh 11 file konsumen dipindah, komponen frontend `<ManifestFieldsForm>` (render dinamis) dibangun dan diwire ke wizard menggantikan form hardcode. Lihat §8 untuk bukti verifikasi end-to-end. **Baru Visa yang benar-benar punya baris `ManifestFieldRequirement`** — produk lain (Paket Umroh, Transport, Haji) belum, menyusul begitu masing-masing diintegrasikan ke booking engine baru (di luar scope putaran ini). Perluasan dari `docs/arsitektur-booking.md` §1.6.2 (Manifest tak terbatas jumlah) — user menegaskan lebih lanjut: **field form per-orang (Nama, Paspor, dst.) juga harus 100% bisa diatur admin (custom, bisa diedit & ditambah), termasuk field paling dasar seperti nama/kontak** — bukan cuma field spesifik-produk. Dokumen ini, `docs/arsitektur-dokumen.md` (syarat file), dan `docs/arsitektur-booking.md` (booking engine) adalah **tiga komponen universal yang saling melengkapi**, mengikuti pola yang sama seperti infrastruktur harga (`docs/arsitektur-harga.md`) — baca ketiganya berdampingan.

---

## 1. Konteks Bisnis

UI manifest dirender sebagai **repeater** (tombol "+ Tambah Orang", tiap baris = satu form orang, bisa dihapus) — pola frontend yang sudah disepakati. Yang perlu didesain di sini adalah **apa isi form itu**: bukan kolom baku hardcode (`fullName`, `gender`, `passportNumber`, dst. seperti `BookingPilgrim` hari ini), tapi **daftar field yang admin definisikan sendiri per produk** — Visa mungkin butuh Nomor Paspor + Tanggal Lahir, Transport-only mungkin cukup Nama + No. HP, Haji mungkin butuh field tambahan yang diatur pemerintah. Admin bisa menambah/mengedit field kapan saja tanpa perlu perubahan kode.

---

## 2. Audit As-Built (kondisi sebelum refactor)

`BookingPilgrim` (`prisma/schema.prisma:729`) — kolom **baku, hardcode**: `fullName`, `gender`, `email`, `phone`, `passportNumber`, `passportExpiry`, `nationality`, `dateOfBirth`, `isLeader`. Semua booking (apa pun produknya) pakai bentuk form yang sama persis — tidak ada cara admin menambah/mengurangi field tanpa migrasi schema + perubahan kode di banyak tempat (wizard, admin dashboard, dst.).

---

## 3. Skema Baru (rencana)

```prisma
// Definisi field manifest per produk — polimorfik, pola SAMA PERSIS DocumentRequirement
// (docs/arsitektur-dokumen.md §3) dan ProductCost (docs/arsitektur-harga.md §3.3).
model ManifestFieldRequirement {
  id          String   @id @default(uuid())
  productType String   // 'visa' | 'package' | 'transport' | 'haji' | dst — bebas teks
  productId   String   // FK ke produk spesifik, TIDAK di-enforce di DB
  fieldKey    String   // key mesin: 'fullName' | 'passportNumber' | 'bloodType' | dst — bebas admin
  label       String   // nama tampilan: "Nomor Paspor"
  fieldType   String   // 'text' | 'textarea' | 'phone' | 'email' | 'date' | 'select' | 'number' — lihat katalog §3.1
  options     Json?    // untuk fieldType='select' — daftar pilihan
  required    Boolean  @default(true)
  order       Int      @default(0)

  // Field "peran sistem" — OPSIONAL. Beberapa fitur sistem (notifikasi WA, tampilan nama di
  // dashboard admin, pencocokan dokumen) tetap butuh tahu "yang mana field nomor HP" atau
  // "yang mana field nama" TANPA hardcode fieldKey-nya (karena fieldKey itu sendiri bebas
  // diatur admin). role menandai field admin yang mana yang mengisi peran itu — lihat §4.
  // 'whatsapp' dipisah dari 'phone' generik karena notifikasi sistem (GOWA, CLAUDE.md) SPESIFIK
  // butuh nomor yang WA-aktif — kalau admin cuma buat satu field telepon, tandai itu 'whatsapp'.
  role String? // 'display_name' | 'whatsapp' | 'phone' | 'email' | 'passport_number' | null

  @@map("manifest_field_requirements")
}
```

`BookingPilgrim` **disederhanakan drastis** — kolom baku (`fullName`, `gender`, `passportNumber`, dst.) **dihapus**, diganti satu kolom fleksibel:

```prisma
model BookingPilgrim {
  id        String   @id @default(uuid())
  bookingId String
  userId    String?  // tetap ada — link ke akun kalau orangnya adalah si pembeli sendiri
  isLeader  Boolean  @default(false) // tetap flag struktural, bukan "form field" yang diedit admin

  fieldValues Json @default("{}") // { [fieldKey]: value } — bentuk & isinya mengikuti
                                    // ManifestFieldRequirement produk yang relevan untuk orang ini

  booking   Booking          @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  visaApplication VisaApplication?
  documents Document[]

  @@index([bookingId])
  @@map("booking_pilgrims")
}
```

**Yang TETAP kolom struktural (bukan form field admin), dan alasannya:**
- `id`, `bookingId` — anchor relasi, bukan data yang diisi manusia.
- `userId` — link opsional ke akun pembeli (dipakai kalau orang #1 di manifest adalah si pembeli sendiri, biar bisa auto-prefill dari data akun) — ini metadata sistem, bukan "form field" yang perlu admin atur.
- `isLeader` — flag peran dalam grup (siapa ketua rombongan), dipakai logic sistem (grup booking), bukan sekadar data tampilan.

---

### 3.1 Katalog `fieldType`

`fieldType` menentukan **widget input yang dirender** + **validasi format** — bukan makna/label field itu (itu urusan `label` bebas admin). Daftar berikut cukup untuk semua kasus manifest, termasuk contoh yang diminta user (nomor telepon, nomor HP, nomor WhatsApp, alamat):

| `fieldType` | Widget | Validasi | Contoh pemakaian |
|---|---|---|---|
| `text` | Input teks satu baris | Bebas, panjang wajar | Nama Lengkap, Nomor Paspor, Nomor KTP |
| `textarea` | Textarea multi-baris | Bebas | Alamat, Catatan Tambahan |
| `phone` | Input nomor (format Indonesia, `+62`/`08xx`) | Regex nomor telepon | **Nomor Telepon, Nomor HP, Nomor WhatsApp** — ketiganya pakai `fieldType` YANG SAMA (`phone`), beda cuma di `label` dan (kalau relevan) `role` — lihat catatan di bawah |
| `email` | Input email | Format email valid | Alamat Email |
| `date` | Date picker | Tanggal valid | Tanggal Lahir, Tanggal Kadaluarsa Paspor |
| `select` | Dropdown | Harus salah satu dari `options` | Jenis Kelamin, Kewarganegaraan |
| `number` | Input angka | Numerik | (jarang dipakai — cadangan untuk kasus numerik murni di luar teks) |
| `address` | 4 dropdown berjenjang (Provinsi→Kab/Kota→Kecamatan→Desa) + 1 teks bebas (detail jalan/RT/RW) | Hierarki harus valid (kecamatan benar-benar anak dari kab/kota yang dipilih, dst.) | Alamat — **menggantikan `textarea` sebagai default untuk field alamat** (`docs/arsitektur-alamat.md`, komponen data wilayah resmi Kemendagri, 38 provinsi/514 kab-kota/7.285 kecamatan/83.762 desa-kelurahan) |

**Kenapa "Nomor Telepon", "Nomor HP", dan "Nomor WhatsApp" BUKAN 3 `fieldType` terpisah:** ketiganya secara teknis sama persis (nomor telepon, widget & validasi identik) — yang beda cuma **maksud/label**-nya. Admin cukup buat 1-3 baris `ManifestFieldRequirement` dengan `fieldType='phone'` yang sama, `label` beda-beda ("Nomor HP", "Nomor WhatsApp", dst.) kalau memang mau ditanya terpisah, dan tandai yang mana yang WA-aktif dengan `role='whatsapp'` (§4) supaya sistem notifikasi tahu field mana yang dipakai kirim pesan. Menambah `fieldType` baru cuma untuk beda label adalah pemborosan — beda `label`/`role` di baris yang sama sudah cukup.

---

## 4. Kenapa Butuh "Peran Field" (`role`) Meski Semua Field Custom

Beberapa bagian sistem **harus** tahu field mana yang berisi nama, nomor HP, dst. — tanpa itu:
- Notifikasi WhatsApp tidak tahu nomor mana yang dikirimi.
- Dashboard admin tidak tahu apa yang ditampilkan sebagai "nama" di daftar manifest.
- Pencocokan dokumen (`Document`, `docs/arsitektur-dokumen.md`) ke identitas paspor tidak tahu field mana yang jadi acuan.

Solusinya **bukan** kembali ke kolom baku, tapi admin **menandai** salah satu field custom yang dia buat sebagai pemegang peran tertentu (`role: 'display_name'`, dst.) saat mengonfigurasi `ManifestFieldRequirement` — field itu sendiri tetap bebas dia beri `fieldKey`/`label`/`fieldType` apa pun, cuma DITAMBAH satu tag peran opsional. Kalau admin tidak menandai peran apa pun, sistem fallback ke field pertama yang ada (atau tampilan generik "Orang #1", "Orang #2") — tidak error, cuma kurang informatif.

`lib/manifest/getRequirements.ts`:
```typescript
export async function getManifestFieldRequirements(productType: string, productId: string): Promise<ManifestFieldRequirement[]>
export function getFieldByRole(fields: ManifestFieldRequirement[], values: Record<string, unknown>, role: string): unknown | null
```

---

## 5. Repeater UI (rencana, sisi frontend)

Komponen `<ManifestRepeater productType productId onChange>` — pola:
1. `getManifestFieldRequirements(productType, productId)` menentukan field apa yang dirender per baris (label, tipe input, wajib/tidak, urutan).
2. Tombol "+ Tambah Orang" menambah baris baru (form kosong sesuai definisi field), tombol hapus per baris.
3. Kalau produk yang dipilih di keranjang lebih dari satu jenis (mis. Visa + Paket Umroh dalam satu booking, keduanya punya `ManifestFieldRequirement` beda), field yang dirender per orang adalah **gabungan (union)** dari semua produk yang relevan untuk orang itu — field yang sama (mis. `fullName` didefinisikan dua kali oleh 2 produk beda) dirender SEKALI, diambil dari definisi manapun yang `required=true` kalau ada perbedaan.
4. Baris pertama BOLEH di-prefill dari data akun (`User.fullName`/`phone`/`email`) untuk kasus "booking untuk diri sendiri" — kemudahan UX, tetap bisa diedit/dihapus oleh pengguna.

---

## 6. Migrasi Data

`BookingPilgrim` existing (kolom baku lama) — data lama dipindah jadi `fieldValues: Json` dengan `fieldKey` mengikuti nama kolom lama (`fullName`→`fullName`, dst.), supaya kompatibel dengan `ManifestFieldRequirement` default yang di-seed meniru kolom lama (jadi tidak ada perubahan tampilan buat wizard existing sampai admin benar-benar mengubah konfigurasi field).

**Seed default:** setiap productType yang sudah py booking existing (Umroh penuh) di-seed `ManifestFieldRequirement` yang PERSIS meniru kolom `BookingPilgrim` lama (`fullName` label "Nama Lengkap" required, dst., dengan `role` yang sesuai) — supaya transisi tidak breaking, admin baru mulai kustomisasi kalau memang mau.

---

## 7. Yang TIDAK Termasuk Rencana Ini

- UI admin builder untuk mengelola `ManifestFieldRequirement` per produk — menyusul di fase implementasi (`docs/arsitektur-booking.md` §6 Step 5), bukan didesain detail di sini.
- Validasi lintas-field kompleks (mis. "kalau nationality≠Indonesian, passportNumber wajib") — field ini sengaja flat (label/tipe/wajib per field independen), validasi kondisional semacam itu didesain kalau memang dibutuhkan nyata nanti, bukan sekarang.

---

## 8. Verifikasi (2026-07-24)

**Audit blast radius dulu** (Explore agent, read-only) sebelum sentuh schema: 11 file bergantung kolom baku `BookingPilgrim` langsung. Temuan penting yang mengoreksi asumsi §2 lama: `passportNumber`/`passportExpiry`/`nationality`/`dateOfBirth` ternyata **tidak pernah diisi di wizard** — cuma diisi admin belakangan via `PassportForm`/endpoint terpisah; `isLeader` genuinely tidak pernah dibaca kode manapun (murni disiapkan fitur Group yang 0% jalan). Ini tidak mengubah rencana migrasi, cuma menegaskan field mana yang benar-benar aktif dipakai hari ini.

**Migrasi**: `20260724120000_manifest_field_requirement` (model baru, additive) lalu `20260724130000_manifest_collapse_booking_pilgrim` (DROP 11 kolom baku, ADD `fieldValues Json`) — dijalankan aman karena `BookingPilgrim` di DB dev 0 baris saat migrasi (dikonfirmasi count dulu), jadi tidak perlu script backfill data.

**Seed default**: 9 field (`fullName`, `gender`, `email`, `phone`, `whatsapp`, `passportNumber`, `passportExpiry`, `nationality`, `dateOfBirth`) di-seed untuk KEDUA `VisaProduct` yang ada — satu-satunya productType yang benar-benar dipesan hari ini. `phoneCountryCode`/`whatsappCountryCode` (kolom terpisah dari Kontak, docs/arsitektur-komponen-kontak.md) **tidak** jadi field manifest sendiri — digabung ke dalam SATU field `fieldType='phone'` per nomor, disimpan sebagai objek `{countryCode, number}` di `fieldValues[fieldKey]` (bukan string flat) — deviasi kecil dari deskripsi asli §3.1 ("Input nomor format Indonesia") yang ditulis sebelum komponen Kontak ada.

**`<ManifestFieldsForm>`** (`components/booking/ManifestFieldsForm.tsx`, bukan nama `<ManifestRepeater>` seperti draf §5 — repeater/tambah-hapus-orang levelnya sudah ada di `pilgrims/page.tsx`, komponen ini cuma render field DALAM satu baris orang) — render generik per `fieldType` (text/textarea/select/date/email/number/phone/address). **Keputusan sadar**: field `fieldType='phone'` di sini TIDAK memakai `ContactPicker` (widget majemuk khusus pasangan HP+WA dengan checkbox "Sama dengan nomor HP") — tiap field phone berdiri sendiri dengan kode negara + nomor sendiri, TANPA fitur sinkron. Kenyamanan checkbox sinkron dari komponen Kontak SENGAJA tidak dibawa ke sini — mempertahankannya butuh deteksi khusus "field mana yang berperan phone DAN whatsapp" dan render-cabang berbeda, menambah kerumitan pada apa yang seharusnya render benar-benar generik. Trade-off yang diterima, bukan terlewat.

**Wizard** (`app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx`) — direstruktur: pemilihan "Jenis Visa" dipindah ke ATAS (sebelumnya di bawah) karena field manifest yang dirender bergantung produk mana yang dipilih orang itu — begitu dipilih, field di-fetch (`GET /api/v1/manifest/requirements`, endpoint baru, publik) dan di-cache per `productId`. Prefill Jamaah #1 dari akun (email, WhatsApp) sekarang mencari field lewat `role` (`getFieldByRole`), bukan nama kolom hardcode.

**11 file konsumen direwrite**: `bookings/route.ts` (create — `fieldValues` langsung dari payload, sudah divalidasi), `admin/pilgrims/[pilgrimId]/passport/route.ts` (MERGE ke `fieldValues`, bukan replace — field lain tetap utuh), `admin/bookings/[id]/page.tsx` + `PassportForm.tsx` (baca via `getFieldByRole`/`fieldValues` langsung), `admin/visa/page.tsx`, `(pilgrim)/bookings/[id]/page.tsx`, `admin/bookings/[id]/documents/zip/route.ts` (nama folder ZIP), `lib/booking/draft.ts` (`PilgrimData.fieldValues`), `lib/validators/booking.ts` (`pilgrims[].fieldValues: z.record()`, plus validasi required-field dinamis di `superRefine` — query `ManifestFieldRequirement` per `visaProductId`, bukan hardcode zod per field), `payment/page.tsx` (payload).

**Verifikasi end-to-end via curl + query DB langsung** (server dev nyata): (1) `GET /api/v1/manifest/requirements` mengembalikan 9 field lengkap dengan `role`/`options`; (2) booking dibuat dengan `fieldValues` berisi `phone`/`whatsapp` beda kode negara (ID vs SA) → dikonfirmasi tersimpan PERSIS di `BookingPilgrim.fieldValues` sebagai objek bersarang; (3) halaman detail admin & daftar visa admin merender nama jamaah dengan benar via `getFieldByRole(..., 'display_name')`; (4) `PUT` endpoint passport mengonfirmasi MERGE (field lama tetap utuh, field baru ditambahkan) bukan menimpa; (5) endpoint dokumen jamaah dan ZIP download tetap berfungsi normal tanpa field baku. Data test dibersihkan. `bun run build` 0 error di setiap fase (1 bug tipe ditemukan & ditutup saat build: `typeof booking.pilgrims` gagal narrowing null-check di 2 halaman server component — diperbaiki jadi `NonNullable<typeof booking>['pilgrims'][number]`).

**Belum dikerjakan** (sesuai §7 + scope putaran ini): UI admin builder untuk `ManifestFieldRequirement` (admin belum bisa ubah field lewat UI, cuma lewat seed/script — sama seperti `DocumentRequirement` di `docs/arsitektur-dokumen.md`), field manifest untuk produk selain Visa, validasi lintas-field kompleks.

---

## 9. Referensi Silang

- Prasyarat/pasangan: `docs/arsitektur-booking.md` §1.6 (Manifest tak terbatas, keputusan induk), `docs/arsitektur-dokumen.md` (syarat file per orang), `docs/arsitektur-alamat.md` (komponen `fieldType='address'`, data wilayah resmi Kemendagri)
- Pola desain polimorfik: `ProductCost`/`DocumentRequirement` — pola generik `productType`+`productId` yang sama dipakai konsisten lintas 3 dokumen ini
- Model existing yang terdampak: `BookingPilgrim`, `VisaApplication.pilgrim`, `Document.bookingPilgrimId` — semua tetap merujuk `BookingPilgrim.id`, cuma isi kolomnya yang berubah bentuk
