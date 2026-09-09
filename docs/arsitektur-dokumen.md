# Arsitektur — Komponen Dokumen Universal (SELESAI & TERVERIFIKASI untuk Visa)

> **Status: SELESAI & TERVERIFIKASI (2026-07-24)** — skema `DocumentRequirement` + `getDocumentRequirements()` dieksekusi, semua 9 file konsumen (`documents/route.ts`, admin builder Visa, booking detail admin+pilgrim, katalog publik) dipindah dari `parseRequirements(visaProduct.requirements)` ke sumber baru. `VisaProduct.requirements` TETAP ada di schema (deprecated, ditulis berdampingan lewat dual-write dari input yang sama — tidak ada risiko drift) sesuai rencana migrasi bertahap §5. Mengikuti arahan user: dokumen (syarat upload KTP/Paspor/KK/dst.) harus jadi **komponen universal reusable**, dipakai lintas produk (Visa, Paket Umroh, Tiket Pesawat, Haji, dst.) — pola yang sama seperti infrastruktur harga universal (`docs/arsitektur-harga.md`, `ProductCost` polimorfik). **Baru Visa yang benar-benar pakai** — produk lain (Paket Umroh, Tiket Pesawat, Haji) belum punya baris `DocumentRequirement` sama sekali, menyusul begitu masing-masing terintegrasi ke booking engine (di luar scope putaran ini). Dokumen ini adalah prasyarat untuk `docs/arsitektur-booking.md` (booking engine total rewrite) — keduanya harus dibaca bersama, karena kapan dokumen wajib diupload ditentukan oleh item apa yang benar-benar dipilih di keranjang booking, bukan lagi otomatis untuk semua orang di satu booking.

---

## 1. Konteks Bisnis

Persyaratan dokumen saat ini **hanya ada untuk Visa** (`VisaProduct.requirements: Json`), dan berlaku otomatis untuk **setiap** orang di satu booking (karena `VisaApplication` wajib 1:1 per `BookingPilgrim`, lihat §2). Padahal produk lain (Paket Umroh, Tiket Pesawat, Haji) realistisnya juga punya syarat dokumen sendiri (mis. Haji butuh dokumen tambahan dari pemerintah), dan sifatnya seharusnya **per-orang per-produk yang benar-benar dipilih orang itu** — bukan blanket ke semua orang di booking begitu saja.

---

## 2. Audit As-Built (kondisi sebelum refactor, 2026-07-22)

- **`VisaProduct.requirements: Json`** (`VisaRequirement[]`, `lib/types/visa.ts`) — definisi syarat dokumen tertanam **di dalam** `VisaProduct`, tidak bisa dipakai ulang oleh produk lain manapun.
- **`Document`** (`prisma/schema.prisma:789`) — modelnya **sebenarnya sudah cukup generik**: `bookingPilgrimId` + `docType` + `fileName`/`filePath`/`fileSizeBytes`, tidak terikat struktural ke `VisaApplication`. Masalahnya bukan di model ini.
- **Jalur validasi upload** (`app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts`) selalu membaca daftar syarat dari `visaApp.visaProduct.requirements` — jadi **secara praktik** cuma berfungsi kalau pilgrim itu punya `VisaApplication`. Kalau visa jadi opsional (§3 `docs/arsitektur-booking.md`), pilgrim yang tidak beli visa jadi tidak punya sumber syarat dokumen sama sekali, padahal produk lain yang dia beli (Paket Umroh, dst.) mungkin tetap butuh dokumen.
- **`VisaApplication` wajib 1:1 per `BookingPilgrim`** — `bookings/route.ts` membuat `VisaApplication` untuk **SETIAP** pilgrim tanpa syarat, dan `visaProductId` di `createBookingSchema` **wajib diisi** (bukan opsional). Ini akar masalah kenapa visa hari ini tidak bisa jadi produk opsional yang cuma dipilih sebagian orang.

---

## 3. Skema Baru (rencana)

```prisma
// Definisi syarat dokumen per produk — polimorfik, pola sama ProductCost/PreferredVendor
// (docs/arsitektur-harga.md §3.3) — MENGGANTIKAN VisaProduct.requirements: Json.
model DocumentRequirement {
  id          String  @id @default(uuid())
  productType String  // 'visa' | 'package' | 'flight' | 'haji' | dst — bebas teks, tidak hardcode daftar
  productId   String  // FK ke produk spesifik, TIDAK di-enforce di DB (pola sama PackageItem/ProductCost)
  docType     String  // key mesin: 'ktp' | 'paspor' | 'kk' | 'foto' | dst — bebas admin isi
  label       String  // nama tampilan: "Paspor Asli (scan semua halaman)"
  description String  @default("")
  required    Boolean @default(true)
  order       Int     @default(0)

  @@map("document_requirements")
}
```

`Document` (model existing) **tidak berubah strukturnya** — sudah cukup generik. Yang berubah cuma **sumber kebenaran** untuk "dokumen apa yang wajib": bukan lagi baca `visaApp.visaProduct.requirements`, tapi query `DocumentRequirement` berdasarkan `productType`+`productId` dari item apa pun yang benar-benar dipilih pilgrim itu di booking-nya (visa, atau paket umroh, atau nanti tiket pesawat/haji).

---

## 4. Fungsi Bantu (rencana)

`lib/documents/getRequirements.ts`:
```typescript
export async function getDocumentRequirements(productType: string, productId: string): Promise<DocumentRequirement[]>
```
Dipakai di:
- **Admin builder produk** (Visa, Paket Umroh, dst.) — CRUD syarat dokumen langsung di halaman produk terkait, styling ikut pola editor yang sudah ada (bukan bikin UI baru).
- **Endpoint upload dokumen pilgrim** — validasi `docType` yang diupload cocok salah satu requirement dari **produk yang relevan untuk pilgrim itu** (dikumpulkan dari semua item booking yang menyertakan pilgrim tsb — lihat "Manifest & Traveler-Linkage" di `docs/arsitektur-booking.md`).
- **Dashboard pilgrim** — checklist dokumen yang masih kurang, dikelompokkan per produk yang dia beli (bukan satu daftar flat tercampur seperti asumsi lama "pasti visa").

---

## 5. Migrasi Data

1. Baca semua `VisaProduct.requirements` (Json) yang ada, insert jadi baris `DocumentRequirement` dengan `productType='visa'`, `productId=visaProduct.id`.
2. `VisaProduct.requirements` **tetap ada di schema untuk sementara** (deprecated, tidak langsung dihapus) sampai semua kode yang memanggil `parseRequirements(visaProduct.requirements)` dipindah ke `getDocumentRequirements('visa', visaProduct.id)` — baru field lama dihapus di fase terpisah setelah dikonfirmasi tidak ada lagi pemanggil. Menghindari breaking change di tengah migrasi (pola yang sama dipakai saat migrasi harga lama → `ProductCost`, `docs/arsitektur-harga.md`).

---

## 6. Yang TIDAK Termasuk Rencana Ini

- UI konkret builder syarat dokumen untuk Paket Umroh/Tiket Pesawat/Haji — menyusul begitu masing-masing produk itu benar-benar diintegrasikan ke booking engine baru (`docs/arsitektur-booking.md`), bukan pekerjaan paralel sekarang.
- Perubahan struktur `Document` itu sendiri — sudah cukup generik, tidak perlu disentuh.
- Validasi format/ukuran file — sudah ada (`lib/storage/minio.ts`, MIME whitelist + max 5MB per `CLAUDE.md`), tidak berubah.

---

## 7. Referensi Silang

- Prasyarat untuk `docs/arsitektur-booking.md` (Manifest & keputusan "keranjang total rewrite" 2026-07-22)
- Pola desain polimorfik: `ProductCost`/`PreferredVendor` (`docs/arsitektur-harga.md` §3.3)
- Model existing yang terdampak: `VisaProduct.requirements`, `VisaApplication`, `Document`, `BookingPilgrim` — semua di `prisma/schema.prisma`

## 8. Verifikasi (2026-07-24)

Migrasi `20260724110000_document_requirement` diterapkan (additive, `document_requirements` tabel baru). Data existing dimigrasi: 2 `VisaProduct` di DB, hanya "Visa Reguler" punya requirements (3 baris: passport/ktp/kartu_keluarga) — semua 3 berhasil pindah ke `DocumentRequirement` 1:1.

**9 file konsumen dipindah** dari `parseRequirements(visaProduct.requirements)` ke `getDocumentRequirements('visa', productId)`: `app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts` (GET + POST validasi + auto-advance, 3 titik), `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` (2 titik, dihitung sekali via `Map` sebelum render — server component, tidak bisa panggil async di dalam `.map()`), `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/[locale]/(public)/visa/page.tsx` (pola `Map` yang sama). Admin builder Visa (`app/api/v1/admin/products/visa/route.ts` create, `[id]/route.ts` update) sekarang **dual-write**: `VisaProduct.requirements` (Json lama) DAN `DocumentRequirement` (replace-all pattern di update) ditulis dari input array yang sama dalam satu request — tidak ada risiko drift karena satu sumber. GET `[id]/route.ts` mengembalikan `documentRequirements` berdampingan `requirements` lama supaya builder UI bisa pindah baca tanpa breaking. `parseRequirements()` (fungsi, bukan tipe `VisaRequirement`) dihapus dari `lib/types/visa.ts` — sudah tidak ada pemanggil setelah migrasi ini.

**Verifikasi end-to-end via curl + query DB langsung** (server dev nyata): (1) `GET /api/v1/admin/products/visa/[id]` mengembalikan `documentRequirements` persis cocok data DB; (2) `PUT` dengan requirements baru (+1 field opsional) → `DocumentRequirement` di-replace-all dengan benar (dikonfirmasi query DB), lalu direvert ke 3 baris semula; (3) booking test dibuat dengan visa "Visa Reguler" (yang punya requirements) → `GET /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents` mengembalikan `missing: ["passport","ktp","kartu_keluarga"]` dan `requirements` persis dari `DocumentRequirement`, bukan lagi dari `VisaProduct.requirements` — data test dibersihkan; (4) katalog publik `/id/visa` dikonfirmasi tetap merender "Passport Aktif"/"Scan KTP Asli" dengan benar. `bun run build` 0 error di setiap fase.

**Belum dikerjakan** (di luar scope, sesuai §6): `DocumentRequirement` untuk produk lain (Paket Umroh, Tiket Pesawat, Haji) — belum ada baris sama sekali untuk productType selain 'visa', menyusul begitu masing-masing modul diintegrasikan ke booking engine baru. `VisaProduct.requirements` belum dihapus dari schema (tetap deprecated, dual-write) sampai dikonfirmasi tidak ada lagi pemanggil lain di masa depan.
