# Arsitektur — Modul Visa

> **Status: SOURCE OF TRUTH untuk modul Visa.** Dokumen ini menggantikan bagian Visa di `docs/architecture.md` (yang berisi desain awal/skema lama dan sudah tidak sesuai kode). Ditulis berdasarkan audit langsung ke kode aktual per **2026-07-08**. Update dokumen ini setiap kali struktur/alur visa berubah — jangan biarkan basi seperti pendahulunya.
>
> Riwayat rencana yang melahirkan struktur saat ini ada di `docs/decisions.md` entri **2026-05-22 — Visa Product v2**. Dokumen lama `docs/visa-architecture.md` (rencana v2) sudah diserap ke sini dan dihapus.
>
> **§1-8 adalah audit as-built, per audit terakhir 2026-07-18 — semua Gap #1-#6 di §7 DITUTUP.** §9 SEBAGIAN sudah diimplementasikan — pengembangan varian Visa Umroh (Reguler vs Non-Hotel), ditambahkan per diskusi 2026-07-08. Struktur `durationFeeRules` (§9.3) sudah dikonfirmasi user, dan **Step 1, 2, 4, 5, 6 di §9.6 sudah dieksekusi & diverifikasi** (2026-07-17 dan 2026-07-18) — lihat status per-step di §9.6. **Hanya Step 3** (fitur varian: `requiredComponents` kondisional wizard + input durasi) **masih DITUNDA** — menyentuh wizard booking lintas-modul, lihat catatan di Step 3 §9.6. **`docs/arsitektur-harga.md` sekarang jadi rujukan resmi untuk harga Visa** — `VisaProduct.price`/`durationFeeRules` bukan lagi diisi manual, tapi cache hasil hitungan HPP+kurs+margin, lihat §9.3.

---

## 1. Konteks Bisnis

Visa adalah **produk berbayar independen** yang dijual Saudinesia — bukan sekadar proses administrasi. Setiap jenis visa (`VisaProduct`) punya harga, estimasi waktu proses, dan daftar dokumen wajib sendiri. Arsitektur mendukung multi-negara (field `country`) untuk ekspansi Saudinesia di luar Arab Saudi di masa depan.

Alur bisnis: jamaah booking → visa jadi salah satu komponen booking → jamaah upload dokumen dari dashboard (bukan di wizard) → admin (`syarikah` liaison) proses dokumen → status visa berubah manual oleh admin → notifikasi WA ke jamaah tiap perubahan status.

---

## 2. Skema Data Aktual (Prisma)

> **Diperbarui 2026-07-18** — `requiredComponents`/`durationFeeRules` di `VisaProduct` dan 5 field snapshot di `VisaApplication` yang sebelumnya ditulis di §9.2/§9.5 sebagai "BARU/diusulkan" **sudah benar-benar ada di schema** (ditambahkan Fase 1 & 7 `docs/arsitektur-harga.md`) dan **sudah diisi kode** (`durationFeeRules`/snapshot fields — lihat §7 Gap #1 status DITUTUP). `requiredComponents` sendiri masih ada di schema tapi **belum dibaca wizard manapun** — itu bagian yang masih pending, lihat Step 3 di §9.6.

Sumber: `prisma/schema.prisma` (`VisaProduct`, `VisaApplication` + `VisaStatus`, `Document`, `BookingVisa`).

```prisma
model VisaProduct {
  id            String   @id @default(uuid())
  name          String
  country       String   @default("Saudi Arabia")
  visaType      String   // free text — admin bisa isi jenis apa saja
  description   String?
  requirements  Json     @default("[]")  // VisaRequirement[] — lihat lib/types/visa.ts
  price         Decimal  @db.Decimal(12, 2)  // cache = harga TERMURAH di antara durationFeeRules, docs/arsitektur-harga.md §17.3 — TIDAK bisa diisi manual lagi (Gap #5 arsitektur-harga.md §13, DITUTUP)
  priceLabel    String?
  processDays   Int      @default(14)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  requiredComponents Json @default("[]")  // ["hotel","transport"] dst — SCHEMA ADA, belum dibaca wizard (Step 3 §9.6, masih pending)
  durationFeeRules   Json @default("[]")  // cache hasil computeSellPrice() per rentang hari, diisi refreshVisaProductCache() — docs/arsitektur-harga.md §6.2

  bookingVisa      BookingVisa[]
  visaApplications VisaApplication[]

  @@map("visa_products")
}

model VisaApplication {
  id               String     @id @default(uuid())
  bookingPilgrimId String     @unique
  visaProductId    String?    // nullable FK — DIISI sejak Visa Step 1 (2026-07-17), lihat Gap #1 di bawah (DITUTUP)
  visaType         String     // fallback/display, diisi dari VisaProduct.visaType saat booking
  status           VisaStatus @default(pending_documents)
  submittedAt      DateTime?
  issuedAt         DateTime?
  rejectionReason  String?
  isForceMajeure   Boolean    @default(false)
  notes            String?

  // Snapshot harga saat booking dibuat (docs/arsitektur-harga.md §7) — DIISI sejak Visa Step 1
  selectedDurationDays Int?
  hppSnapshotRupiah    Decimal? @db.Decimal(14, 2)
  sellPriceSnapshot    Decimal? @db.Decimal(14, 2)
  exchangeRateIdsUsed  Json?    // string[] — ExchangeRate.id per komponen HPP yang dipakai
  vendorIdsUsed        Json?    // string[] — Vendor.id per komponen HPP yang dipakai

  pilgrim     BookingPilgrim @relation(fields: [bookingPilgrimId], references: [id], onDelete: Cascade)
  visaProduct VisaProduct?   @relation(fields: [visaProductId], references: [id])

  @@map("visa_applications")
}

enum VisaStatus {
  pending_documents
  documents_complete
  submitted_to_syarikah
  in_review
  issued
  rejected
}

model Document {
  id               String   @id @default(uuid())
  bookingPilgrimId String
  docType          String   // free text — tidak terikat enum, divalidasi di API terhadap requirements
  fileName         String
  filePath         String   // MinIO object key, bukan URL
  fileSizeBytes    Int?
  uploadedAt       DateTime @default(now())

  pilgrim BookingPilgrim @relation(fields: [bookingPilgrimId], references: [id], onDelete: Cascade)

  @@map("documents")
}

model BookingVisa {
  id            String  @id @default(uuid())
  bookingId     String
  visaProductId String  // NOT NULL di sini — beda dengan VisaApplication.visaProductId yang nullable
  numPersons    Int     @default(1)
  totalPrice    Decimal @db.Decimal(14, 2)
}
```

**Catatan:** `BookingVisa` (item line-item pembelian produk visa di booking) punya `visaProductId` wajib, `VisaApplication` (proses dokumen per-jamaah) punya `visaProductId` nullable — tapi sejak Visa Step 1 (2026-07-17, Gap #1 §7 DITUTUP) field itu **sudah diisi** oleh `POST /api/v1/bookings` setiap kali booking dibuat.

---

## 3. Tipe & Validasi

**`lib/types/visa.ts`** — kontrak `requirements`:
```typescript
export type VisaRequirement = {
  docType:     string
  label:       string
  description: string
  required:    boolean
}
export function parseRequirements(raw: unknown): VisaRequirement[] { /* filter aman dari Json */ }
```

**Validator admin CRUD** (`app/api/v1/admin/products/visa/route.ts`) — **diperbarui 2026-07-18**, `price` dihapus total dari schema (`docs/arsitektur-harga.md` §17, Gap #5 DITUTUP):
```typescript
const requirementSchema = z.object({
  docType: z.string().min(1), label: z.string().min(1),
  description: z.string().default(''), required: z.boolean().default(true),
})
const createSchema = z.object({
  name: z.string().min(1), country: z.string().default('Saudi Arabia'),
  visaType: z.string().min(1), description: z.string().optional(),
  requirements: z.array(requirementSchema).default([]),
  priceLabel: z.string().optional(),  // price TIDAK ada — VisaProduct dibuat dengan price:0, terisi otomatis via refreshVisaProductCache()
  processDays: z.coerce.number().int().positive().default(14), isActive: z.boolean().default(true),
})
```

**Validator booking wizard** (`lib/validators/booking.ts`) — **diperbaiki 2026-07-17 (Visa Step 1), Gap #3 DITUTUP** — enum lama sudah dihapus total, diganti validasi terhadap `VisaProduct` aktif di database:
```typescript
visaProductId: z.string().uuid('Pilih jenis visa yang valid'),
// .superRefine() query VisaProduct aktif, tolak kalau id tidak ditemukan/nonaktif
```

---

## 4. API Routes (aktual, terverifikasi per file)

| Method | Path | Auth guard | File | Catatan |
|---|---|---|---|---|
| GET, POST | `/api/v1/admin/products/visa` | `requireManager()` | `app/api/v1/admin/products/visa/route.ts` | CRUD produk visa |
| GET, PUT, DELETE | `/api/v1/admin/products/visa/[id]` | `requireManager()` | `.../[id]/route.ts` | Update partial via Zod `.optional()` |
| GET | `/api/v1/catalog/visa` | publik | `app/api/v1/catalog/visa/route.ts` | Hanya `isActive: true`, sort by country → visaType |
| PUT | `/api/v1/admin/visa/[pilgrimId]/status` | `requireAdmin()` | `.../status/route.ts` | Update `VisaApplication.status`, set `submittedAt`/`issuedAt` otomatis, kirim WA (best-effort). **Tidak ada validasi transisi status di sini** — lihat Gap #5 |
| GET, POST | `/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents` | session (pemilik atau admin) | `.../documents/route.ts` | Return `requirements` + `missing`; validasi `docType` terhadap requirements; auto-advance status |
| GET, DELETE | `/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/[docId]` | session (pemilik atau admin) | `.../[docId]/route.ts` | Presigned URL TTL: admin 3600s, pilgrim 900s; DELETE revert status |
| GET | `/api/v1/admin/bookings/[id]/documents/zip` | `requireAdmin()` | `.../documents/zip/route.ts` | Stream ZIP via `JSZip`, bukan presigned URL |

**Tidak ada** `GET /api/v1/admin/visa` (list semua visa application) sebagai Route Handler — halaman admin `app/[locale]/admin/(protected)/visa/page.tsx` adalah **Server Component** yang query Prisma langsung (`prisma.visaApplication.findMany` dengan filter `status` dari `searchParams`), sesuai konvensi CLAUDE.md "fetch di Server Component". `docs/architecture.md` lama menyebut route ini sebagai REST endpoint — itu keliru/basi.

---

## 5. Komponen Frontend

| Komponen | File | Prop `requirements?: VisaRequirement[]` |
|---|---|---|
| `DocumentGrid` | `components/shared/media/DocumentGrid.tsx` | Diterima; fallback ke `REQUIRED_DOCUMENTS` (`lib/constants/booking.ts`) jika `undefined` |
| `UploadModal` | `components/shared/media/UploadModal.tsx` | Diterima; membangun dropdown docType dari `requirements` atau fallback |
| `DocumentCard` | `components/shared/media/DocumentCard.tsx` | Terima `label`/`required`; badge "Opsional" saat `required === false` |
| `PilgrimDocuments` (admin, readonly + ZIP) | `components/admin/PilgrimDocuments.tsx` | Diterima; fallback sama |
| `VisaActions` (admin, kontrol status) | `app/[locale]/admin/(protected)/bookings/[id]/VisaActions.tsx` | N/A — lihat Gap #5, komponen ini yang memegang satu-satunya state machine transisi status yang ada di seluruh sistem |

Halaman edit admin `app/[locale]/admin/(protected)/products/visa/[id]/` **dirombak 2026-10-23** (docs/arsitektur-editor-teks.md §7): `page.tsx` (orkestrasi, tiga tab Informasi / Persyaratan dokumen / Harga dan HPP, bilah simpan saat ada perubahan, tile ringkasan) + `ProductInfoTab.tsx` (informasi dasar, **deskripsi memakai `RichTextEditor`**, publikasi, zona berbahaya dengan konfirmasi inline) + `RequirementsTab.tsx` (builder syarat dokumen: tambah cepat dari 12 preset `docType`, tombol urut naik/turun yang sungguhan — `GripVertical` lama yang kosmetik dihapus, `Switch` wajib/opsional) + `CostTiersTab.tsx` (HPP per rentang hari; logika preview live/simpan dipindah apa adanya, `VendorPicker` yang dulu didefinisikan di dalam komponen — membuat input nama vendor kehilangan fokus tiap ketikan — kini komponen tingkat atas) + `types.ts`. Simpan info + persyaratan = satu `PUT` (`.strict()`, galat server kini ditampilkan, dulu diabaikan); tarif HPP tetap `PUT .../cost-tiers` sendiri.

`VisaProduct.description` kini **teks kaya**: JSON dokumen Tiptap dalam kolom `String?` yang sama (tanpa migrasi; teks polos lama tetap sah). `POST/PUT /admin/products/visa` memvalidasi lewat `richTextField()` (daftar putih + salinan bersih, `'' → null`); katalog publik dan konsumen lain memakai `RichTextView`/`plainText()`, **bukan** menampilkan string mentah (respons `GET /catalog/visa` mengembalikan string JSON itu apa adanya).

Public catalog `app/[locale]/(public)/visa/page.tsx` — group by `country`, badge visaType, seksi requirements wajib vs opsional dengan ikon `ShieldCheck`/`Info`, fallback render untuk data lama berbentuk `string[]`.

---

## 6. Alur Data End-to-End

> **Diperbarui 2026-07-18** — diagram lama menunjukkan kondisi SEBELUM Visa Step 1 (2026-07-17). Gap #1/#2/#3 (di bawah) sudah ditutup — diagram ini sekarang mencerminkan kondisi aktual. Gap #4 (requirements passthrough) **masih terbuka**.

```
Admin buat VisaProduct (country, visaType bebas, requirements[]) + isi HPP & Komponen Biaya
        │   harga (price/durationFeeRules) dihitung otomatis dari HPP+kurs+margin — docs/arsitektur-harga.md §17
        ▼
Public catalog /visa menampilkan produk per country (label "Mulai dari" kalau >1 harga)
        │
        ▼
Booking wizard step "Jamaah" — fetch GET /api/v1/catalog/visa, pilih VisaProduct dinamis
        │   (Gap #2 DITUTUP 2026-07-17 — bukan lagi toggle 4 tombol hardcode)
        ▼
POST /api/v1/bookings — validasi visaProductId terhadap VisaProduct aktif (Gap #3 DITUTUP),
        │   buat BookingPilgrim + VisaApplication
        │   visaApplication.visaProductId = [terisi]  ← Gap #1 DITUTUP 2026-07-17
        │   computeSellPrice() dipanggil, snapshot HPP/kurs/vendor/sellPrice terisi
        ▼
Dashboard jamaah / admin booking detail — DocumentGrid / PilgrimDocuments
        │   requirements prop MASIH TIDAK dikirim dari kedua halaman (Gap #4, MASIH TERBUKA)
        │   → selalu fallback ke REQUIRED_DOCUMENTS hardcoded, walau backend siap dinamis
        ▼
Upload dokumen → auto-advance pending_documents → documents_complete
        (logic auto-advance SUDAH dinamis & benar — hanya inputnya yang belum sampai)
        ▼
Admin ubah status via VisaActions → PUT .../status → WA notification (best-effort)
        │   (validasi transisi status server-side MASIH TIDAK ADA — Gap #5, MASIH TERBUKA)
        ▼
Admin download ZIP semua dokumen booking
```

---

## 7. Gap / Ketidaksesuaian Aktif (per audit 2026-07-08, direvisi 2026-07-17 dan 2026-07-18)

> **Update 2026-07-18:** Semua 6 gap **DITUTUP**. Gap #1/#2/#3 dieksekusi sebagai "Visa Step 1" pada 2026-07-17. Gap #4/#5/#6 dieksekusi pada 2026-07-18 sebagai Step 2/5/6 di §9.6 — Step 3 (fitur varian) **DITUNDA**, lihat catatan di §9.6.

| # | Gap | Status | Lokasi | Dampak |
|---|-----|--------|--------|--------|
| 1 | ~~`POST /api/v1/bookings` tidak set `visaApplication.visaProductId`~~ | **DITUTUP 2026-07-17** | `app/api/v1/bookings/route.ts` | — |
| 2 | ~~Wizard tidak punya step pilih produk visa dari katalog~~ | **DITUTUP 2026-07-17** | `app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx` | — |
| 3 | ~~`visaType` di validator booking masih `z.enum([...])`, bukan free text~~ | **DITUTUP 2026-07-17** | `lib/validators/booking.ts` | — |
| 4 | ~~`DocumentGrid` (pilgrim) & `PilgrimDocuments` (admin) dipanggil tanpa prop `requirements`~~ | **DITUTUP 2026-07-18** | `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` | — |
| 5 | ~~Validasi transisi status visa hanya ada di client~~ | **DITUTUP 2026-07-18** | `lib/validators/visaStatus.ts` (baru), `app/api/v1/admin/visa/[pilgrimId]/status/route.ts` | — |
| 6 | ~~5 handler CRUD produk visa pakai `catch{...403}` polos~~ | **DITUTUP 2026-07-18** | `app/api/v1/admin/products/visa/route.ts`, `.../[id]/route.ts` | — |

**Gap #4 ditutup:** `requirements` (dari `visaApplication.visaProduct.requirements` via `parseRequirements`) sekarang dipass ke `DocumentGrid`/`PilgrimDocuments`. Diverifikasi: booking uji dengan produk berisi 3 requirements nyata (Passport/KTP/KK) → halaman admin tampil "0/3 dok" (bukan "0/5" fallback), `GET .../documents` API mengembalikan 3 requirements yang sama. Detail di `docs/progress.md`.

**Gap #5 ditutup:** `TRANSITIONS` map dipindah ke `lib/validators/visaStatus.ts` (`VISA_STATUS_TRANSITIONS` + `isValidVisaStatusTransition()`), dipakai baik client (`VisaActions.tsx`) maupun server (`.../status/route.ts` validasi sebelum update, 422 kalau tidak valid). Diverifikasi: transisi `pending_documents → issued` (melompati 3 tahap) ditolak 422; transisi valid `pending_documents → documents_complete` berhasil 200.

**Gap #6 ditutup:** `catch{...403}` polos di kelima handler diganti pola bedakan `Unauthorized`/`Forbidden` (403) dari error lain (500 + `console.error`, tanpa bocorkan detail Prisma). Diverifikasi: `DELETE` produk visa yang tidak ada (Prisma P2025, error non-auth asli) sekarang benar mengembalikan 500 — sebelumnya salah dilaporkan sebagai 403 "Forbidden".

---

## 9. Varian Visa Umroh: Reguler vs Non-Hotel — SEBAGIAN SELESAI

> **Status per 2026-07-18:** Bagian §1-7 di atas adalah audit as-built (apa yang ADA). Bagian ini awalnya rencana murni (ditulis 2026-07-08) untuk fitur yang belum ada — sekarang **Step 1, 2, 4, 5, 6 di §9.6 sudah dieksekusi & diverifikasi** (Gap #1-#6 §7 semuanya DITUTUP). **Hanya Step 3** (fitur varian: `requiredComponents` kondisional + input durasi) yang **DITUNDA** — menyentuh wizard booking lintas-modul, lihat catatan di Step 3 §9.6.

### 9.1 Kebutuhan Bisnis

`visaType: "Umroh"` bukan satu produk homogen — ada (setidaknya) dua entitas yang benar-benar berbeda perilakunya, bukan sekadar beda nama/harga/dokumen:

| | **Visa Reguler Umroh** | **Visa Non-Hotel** |
|---|---|---|
| Komponen booking lain | **Wajib**: hotel, transport, (mungkin tiket pesawat — lihat `docs/arsitektur-tiket-pesawat.md`, modul ini belum ada) | **Tidak wajib** — hotel/transport/tiket opsional |
| Struktur biaya | Harga tetap per `VisaProduct` (seperti sekarang) | `VisaProduct.price` = harga durasi default (mis. 7 hari); durasi lain punya **harga sendiri yang menggantikan** (bukan ditambahkan) — persis seperti varian ukuran produk (S/M/L/XL beda harga, bukan harga dasar + surcharge) |
| Sifat | Terikat ke trip penuh (bundled) | Bisa berdiri sendiri (standalone) |

Poin penting dari diskusi: kedua ini **"entitas sendiri-sendiri"** — bukan satu `VisaProduct` dengan toggle, tapi dua baris/produk berbeda yang perilakunya juga berbeda di luar sekadar data (mempengaruhi wizard, validasi, dan kalkulasi harga).

Ini juga **konkretisasi pertama** dari pertanyaan terbuka di `docs/arsitektur-booking.md` §1.5 ("Visa-only" purchase flow) — Visa Non-Hotel adalah kandidat kuat untuk alur pembelian standalone yang dibahas di sana, sementara Visa Reguler Umroh tetap masuk pola wizard Umroh penuh yang sudah ada.

### 9.1.1 Prinsip Wajib: Nama & Jumlah Varian TIDAK Boleh Hardcode

**"Visa Reguler Umroh" dan "Visa Non-Hotel" di §9.1 adalah CONTOH bisnis untuk menjelaskan kebutuhan — bukan dua nilai tetap yang boleh muncul sebagai string literal di kode manapun.** Ini penegasan eksplisit dari arahan user: minimalkan hardcode sebisa mungkin. Konsekuensi konkret untuk desain ini:

- **Tidak ada enum/union type untuk nama varian** di Prisma, Zod, TypeScript, atau kondisional apa pun (`if (visaType === 'Reguler Umroh')` dilarang). `VisaProduct.visaType` sudah free text — itu benar, tetap dipertahankan.
- **Admin bisa membuat berapa pun varian Umroh yang mereka mau**, dengan nama apa pun (bukan cuma persis 2), masing-masing dikonfigurasi independen lewat field `requiredComponents`/`durationFeeRules` di §9.2. Sistem tidak boleh berasumsi "hanya ada 2 jenis Umroh".
- **Semua logika (wizard, validator, kalkulasi harga) harus dituntun oleh DATA di baris `VisaProduct` yang dipilih, bukan oleh nama/id produk yang di-hardcode.** Contoh benar: `if (visaProduct.requiredComponents.includes('hotel')) { wajibkan step hotel }`. Contoh salah yang harus dihindari: `if (visaProduct.name === 'Visa Reguler Umroh') { wajibkan step hotel }`.
- **Dropdown/datalist di admin UI** (mis. suggestion `visaType` yang sudah ada: Umroh/Visitor/Bisnis/Kerja/Transit/Haji di `/products/visa/page.tsx`) tetap boleh ada sebagai *saran* (datalist, bukan `<select>` tertutup) — ini sudah benar sekarang, jangan diubah jadi enum tertutup.
- Ini juga jadi **penguat langsung untuk Gap #3** di §7: `visaType: z.enum(['umroh','visit','business','work'])` di `lib/validators/booking.ts:64` harus benar-benar hilang, diganti validasi terhadap `VisaProduct` yang benar-benar aktif di database (query, bukan daftar tertulis di kode) — bukan sekadar diganti jadi `z.string()` bebas tanpa validasi sama sekali (itu juga salah, karena tidak mengecek produk itu benar ada dan aktif).

### 9.2 Perubahan Skema yang Diusulkan

Tetap satu tabel `VisaProduct` (tidak perlu tabel terpisah per varian — beda perilaku direpresentasikan lewat field, bukan lewat model terpisah, konsisten dengan cara `TransportPricing`/`VisaRequirement` sudah menyimpan variasi lewat kolom/JSON, bukan sub-tabel per kasus):

```prisma
model VisaProduct {
  // ...field yang sudah ada (name, country, visaType, requirements, price, priceLabel, processDays, isActive)...

  requiredComponents Json    @default("[]")  // BARU — mis. ["hotel", "transport"] untuk Reguler, [] untuk Non-Hotel
  durationFeeRules   Json?   // BARU — daftar aturan biaya per durasi, lihat §9.3. null/[] untuk varian yang tidak day-based
}
```

**Kenapa `requiredComponents: Json` (array string), bukan `requiresHotel: Boolean` + `requiresTransport: Boolean` terpisah:** supaya kalau nanti ada komponen wajib baru (mis. tiket pesawat kalau modul itu akhirnya dibangun), tidak perlu migrasi kolom baru lagi — tinggal tambah string ke array. Pola ini meniru `PackageItem.productType` yang sudah ada di codebase (lihat `docs/arsitektur-booking.md` §2).

### 9.3 Struktur Biaya per Durasi — DIKONFIRMASI (model "varian produk", bukan biaya tambahan)

> **Direvisi 2026-07-08: `docs/arsitektur-harga.md` sekarang jadi RUJUKAN RESMI harga Visa.** `VisaProduct.price` dan `durationFeeRules` di bawah ini **bukan lagi diisi manual oleh admin** — keduanya jadi **cache hasil hitungan otomatis** dari `computeSellPrice()` (`docs/arsitektur-harga.md` §5), berdasarkan HPP (`ProductCost`) + kurs (`ExchangeRate`) + margin (`PricingRule`). Admin cukup atur data di sisi HPP (vendor, komponen biaya, kurs otomatis dari cron) — harga jual per durasi **muncul sendiri**, tidak diketik manual. Detail mekanisme cache & kapan di-refresh: `docs/arsitektur-harga.md` §6 (baru).

Klarifikasi final dari user: ini **bukan** "harga dasar + biaya tambahan yang dijumlahkan". Analoginya persis varian ukuran produk e-commerce (S/M/L/XL) — tiap varian punya harga sendiri yang **menggantikan**, bukan menambah. Diterapkan ke visa:

- **`VisaProduct.price`** (field yang sudah ada, tidak berubah) = harga untuk durasi **default** (mis. 7 hari — durasi "standar" produk ini).
- **`durationFeeRules`** = daftar durasi **lain** yang berbeda dari default, masing-masing dengan harga totalnya sendiri yang **menggantikan sepenuhnya** `VisaProduct.price` kalau durasi itu yang dipilih — bukan ditambahkan ke atasnya.

Durasi tinggal bisa **spesifik** (mis. "8 hari" — satu angka, harga sendiri) atau **rentang** (mis. "20-30 hari" — satu harga flat untuk seluruh rentang, bukan dikali per hari). Kedua bentuk disatukan jadi satu struktur:

```json
"durationFeeRules": [
  { "minDays": 8,  "maxDays": 8,  "fee": 600000 },
  { "minDays": 20, "maxDays": 30, "fee": 1500000 }
]
```
*(Durasi 7 hari TIDAK perlu jadi baris di sini — itu sudah otomatis terwakili oleh `VisaProduct.price` sebagai default/fallback, lihat aturan pencocokan di bawah.)*

**Aturan pencocokan harga (dipakai saat create booking, bukan hanya tampilan):**
1. Cek `durationFeeRules` — kalau jumlah hari yang dipilih jamaah cocok salah satu baris (`minDays <= jumlahHari <= maxDays`), **pakai `fee` baris itu sebagai harga total, penuh menggantikan `VisaProduct.price`**.
2. Kalau tidak cocok baris manapun di `durationFeeRules`, **jatuh ke `VisaProduct.price`** sebagai harga default.
3. `minDays === maxDays` pada satu baris berarti durasi spesifik (satu angka); `minDays < maxDays` berarti rentang. Tidak ada perbedaan penanganan lain di antara keduanya — sama-sama sekadar baris lookup.

**Kenapa tidak ada penolakan "durasi tidak valid":** karena default (`VisaProduct.price`) selalu jadi fallback, tidak ada kondisi "tidak ada harga" — admin cukup mendefinisikan pengecualian dari default lewat `durationFeeRules`, tidak perlu mendaftar SEMUA kemungkinan durasi. Ini juga menghindari hardcode angka "7" di kode manapun — mana yang "default" murni ditentukan oleh data yang admin isi (kalau admin tidak isi `durationFeeRules` untuk suatu durasi, durasi itu otomatis pakai harga default, siapa pun angkanya).

**Field `minDays`/`maxDays` terpisah di level `VisaProduct` (usulan draf pertama) tetap dihapus** — rentang keseluruhan yang diperbolehkan (untuk validasi input) cukup diturunkan dari union `durationFeeRules` ditambah asumsi bahwa durasi default juga valid.

Pola ini tetap JSON (sama seperti `VisaRequirement[]`) — bedanya sekarang **tidak ada UI input manual untuk isi `fee`-nya**. Baris-baris `durationFeeRules` (dan boundary hari yang dipakai) diturunkan otomatis dari union semua `minDays`/`maxDays` yang ada di `ProductCost.costTiers` milik produk itu (lintas semua komponen aktifnya) — admin isi HPP per komponen (§3.3 `docs/arsitektur-harga.md`), sistem yang menghitung & menyimpan `fee` hasil `computeSellPrice()` untuk tiap boundary itu ke `durationFeeRules`.

### 9.4 Dampak ke Wizard & Validator (belum dikerjakan, hanya rencana)

- **Booking wizard** (`app/[locale]/(pilgrim)/bookings/new/`): begitu Gap #2 di §7 dikerjakan (tambah step pilih `VisaProduct` dari katalog), step picker ini harus **fetch semua `VisaProduct` aktif dengan `visaType` yang sesuai dari database** (mis. `GET /api/v1/catalog/visa`, sudah ada) dan render sebagai daftar dinamis — **bukan** toggle 2 tombol tetap ("Reguler"/"Non-Hotel"). Kalau admin menambah varian ketiga, wizard harus otomatis menampilkannya tanpa perubahan kode. Step hotel (step 2) dan transport (step 3) yang **saat ini selalu opsional** perlu jadi **kondisional wajib** kalau `VisaProduct.requiredComponents` menyebutkan `"hotel"`/`"transport"` — dicek dari data produk yang dipilih, bukan dari nama produknya. Untuk varian day-based (mis. Non-Hotel), tambahkan input baru: jumlah hari. Harga dihitung dengan cek `durationFeeRules` produk yang dipilih dulu (kalau cocok salah satu baris `minDays <= x <= maxDays`, pakai `fee` baris itu sebagai harga total), kalau tidak cocok baris manapun maka jatuh ke `VisaProduct.price` sebagai default — tidak pernah ditolak sebagai input invalid (lihat §9.3).
- **`createBookingSchema`** (`lib/validators/booking.ts`) perlu validasi silang: kalau `visaProductId` yang dipilih punya `requiredComponents` berisi `"hotel"`, request tanpa `hotelMakkah`/`hotelMadinah` harus ditolak (400), bukan cuma mengandalkan UI wizard.
- **Total harga**: `VisaApplication`/`BookingVisa` perlu field baru untuk menyimpan snapshot jumlah hari yang dipilih + `fee` yang dihitung (mirip pola snapshot harga di `BookingTransport.unitPrice`) — bukan langsung dari `VisaProduct.price` saja. Karena `fee` sekarang hasil komputasi (bukan input manual), snapshot ini juga sebaiknya menyimpan referensi HPP/kurs/vendor yang dipakai saat itu (lihat `docs/arsitektur-harga.md` §6 — sama field-nya dengan snapshot booking pada umumnya).

### 9.5 Status Terkini (diperbarui 2026-07-18)

- Field snapshot harga di `VisaApplication` untuk kasus Non-Hotel — **SUDAH ADA di schema** sejak Fase 7 `docs/arsitektur-harga.md` (`selectedDurationDays`, `hppSnapshotRupiah`, `sellPriceSnapshot`, `exchangeRateIdsUsed`, `vendorIdsUsed`), dan **sudah diisi** oleh `POST /api/v1/bookings` sejak Step 1 §9.6 (2026-07-17).
- Admin UI untuk mengelola HPP per komponen Visa — **SUDAH DIBANGUN** dan sudah melalui beberapa iterasi redesain (Fase 4 → tabel tier gabungan `docs/arsitektur-harga.md` §14 → override manual §15 → live preview §16). Field harga manual lama di section "Informasi Dasar" **SUDAH DIBERSIHKAN** (Step 4 di §9.6, dieksekusi via `docs/arsitektur-harga.md` §17 pada 2026-07-18, bukan lewat urutan §9.6 aslinya — lihat catatan di Step 4 di bawah).
- Gap #1/#2/#3 (§7) — **DITUTUP** (Step 1 §9.6). Gap #4/#5/#6 (§7) — **masih terbuka**, sama dengan Step 2/3/5/6 §9.6 di bawah yang belum dieksekusi.

### 9.6 Urutan Implementasi (RENCANA — belum dieksekusi)

> Ditulis 2026-07-17 sesuai Fase Eksekusi SOP `CLAUDE.md` poin 1 — rencana dulu, sebelum kode apa pun. Menggabungkan perbaikan Gap #1-#6 (§7) + fitur varian Reguler/Non-Hotel (§9.1-9.4) + pembersihan legacy (`docs/arsitektur-harga.md` §13 Gap #5), karena saling bergantung — urutan di bawah memperhitungkan dependency itu, bukan sekadar urutan penemuan gap.

```
Step 1 — Validator + Wizard + Booking Creation, SATU UNIT (menutup Gap #1, #2, #3 sekaligus) ✓ SELESAI 2026-07-17
  > Direvisi 2026-07-17 saat eksekusi: draf awal memisahkan ini jadi 3 step (validator saja,
  > lalu wizard, lalu booking creation), TAPI ditemukan `PilgrimData` (lib/booking/draft.ts),
  > wizard step (pilgrims/page.tsx), dan payment page (payment/page.tsx) semua reference
  > langsung ke shape `visaType: enum` — mengubah shape validator SENDIRIAN akan bikin
  > build merah di 3 file itu. Digabung jadi satu unit yang bisa di-build utuh, bukan
  > menambah step baru — cakupannya sama, cuma tidak dipecah palsu.
  - lib/validators/booking.ts:64 — ganti visaType: z.enum([...]) jadi visaProductId:
    z.string().uuid(), validasi async terhadap VisaProduct aktif di database
  - lib/booking/draft.ts — PilgrimData.visaType → visaProductId (+ field display kalau perlu)
  - app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx — ganti toggle 4 tombol hardcode
    jadi fetch GET /api/v1/catalog/visa, render daftar dinamis, simpan visaProductId
  - app/[locale]/(pilgrim)/bookings/new/payment/page.tsx — payload pilgrims kirim
    visaProductId, bukan visaType
  - app/api/v1/bookings/route.ts:146-156 — set visaApplication.visaProductId, isi
    visaApplication.visaType dari VisaProduct.visaType (fallback/display, field lama
    tetap ada sesuai desain awal), panggil computeSellPrice() & isi field snapshot
    (selectedDurationDays/hppSnapshotRupiah/sellPriceSnapshot/exchangeRateIdsUsed/vendorIdsUsed)
  - createBookingSchema — validasi silang: requiredComponents produk vs hotel/transport di payload

Step 2 — Requirements dinamis (menutup Gap #4) ✓ SELESAI 2026-07-18
  - app/[locale]/(pilgrim)/bookings/[id]/page.tsx — pass requirements ke DocumentGrid
  - app/[locale]/admin/(protected)/bookings/[id]/page.tsx — pass requirements ke PilgrimDocuments,
    plus badge counter "X/Y dok" diperbaiki dari REQUIRED_DOCUMENTS.length hardcode
  - Ambil dari visaApplication.visaProduct.requirements via parseRequirements()

Step 3 — Fitur varian: requiredComponents & input durasi (§9.1-9.4) — DITUNDA 2026-07-18
  > User minta fokus perbaikan Visa dulu, dan apa pun yang menyentuh modul lain dicatat dulu
  > untuk perbaikan berikutnya (Haji "nanti"). Step 3 menyentuh step hotel/transport di wizard
  > booking yang SAMA dipakai alur Umroh penuh (bukan cuma milik Visa) — kondisional wajib/tidak
  > berdasar requiredComponents berarti mengubah gating wizard yang lintas-modul, dan berkaitan
  > langsung dengan pertanyaan terbuka di docs/arsitektur-booking.md §1.5 (alur pembelian
  > multi-bentuk: visa-only, transport-only, Umroh penuh, Haji) yang sendiri sudah ditandai
  > "PENDING — scope perlu dirombak, jangan eksekusi dulu". Mengerjakan Step 3 sekarang berisiko
  > membangun di atas asumsi wizard lama yang mungkin berubah bentuk total saat booking engine
  > universal itu dirombak. DITUNDA sampai ada keputusan eksplisit soal booking engine, atau
  > user minta dikerjakan terpisah dengan pemahaman risiko itu.
  - Wizard: step hotel/transport jadi kondisional wajib kalau requiredComponents produk
    terpilih menyebutkan "hotel"/"transport"
  - Wizard: tambah input jumlah hari untuk produk day-based, validasi & hitung harga
    dari durationFeeRules produk (fallback ke price kalau tidak ada tier yang cocok)

Step 4 — Pembersihan legacy (menutup docs/arsitektur-harga.md §13 Gap #5) ✓ SELESAI 2026-07-18
  > Dieksekusi via docs/arsitektur-harga.md §17 (dipicu diskusi terpisah soal "komponen harga
  > jadi satu-satunya sumber kebenaran"), bukan lewat urutan §9.6 ini secara langsung — dicatat
  > di sini juga supaya Step 4 tidak terlihat seperti masih pending padahal sudah tertutup.
  - app/[locale]/admin/(protected)/products/visa/[id]/page.tsx — form "Harga (Rp)" manual
    di Informasi Dasar dihapus total, diganti kartu read-only (harga murni dari cache HPP)
  - app/[locale]/admin/(protected)/products/visa/page.tsx (buat produk baru) — input harga
    manual juga dihapus, produk baru dibuat dengan price:0
  - price dihapus dari updateSchema/createSchema kedua route (PUT/POST) — bukan cuma
    disembunyikan di UI, request yang tetap kirim price diabaikan server

Step 5 — Validasi transisi status server-side (menutup Gap #5 §7) ✓ SELESAI 2026-07-18
  - lib/validators/visaStatus.ts (baru) — TRANSITIONS map dipindah dari VisaActions.tsx jadi
    VISA_STATUS_TRANSITIONS + isValidVisaStatusTransition(), satu sumber untuk client & server
  - app/api/v1/admin/visa/[pilgrimId]/status/route.ts — validasi currentStatus → newStatus,
    422 kalau tidak valid

Step 6 — Perbaikan error handling (menutup Gap #6 §7) ✓ SELESAI 2026-07-18
  - Ganti catch { ... 403 } polos di 5 handler CRUD produk visa dengan pola yang benar
    (403 untuk Unauthorized/Forbidden, 500 untuk error lain, tanpa bocorkan detail Prisma)

Step 7 — Build + dokumentasi ✓ SELESAI 2026-07-18 (untuk Step 1,2,4,5,6 — Step 3 ditunda)
```

**Independensi antar-step:** Step 1 satu unit utuh (validator+wizard+creation), harus selesai sebelum apa pun lain karena semuanya bergantung padanya. Step 2 butuh Step 1 selesai (perlu `visaProduct` ter-link). Step 3 butuh Step 1 selesai (wizard sudah tahu produk mana yang dipilih). Step 4 sebaiknya setelah Step 1-3 (supaya jelas cache HPP sudah dipakai end-to-end sebelum form manual dihapus). Step 5 dan 6 independen, bisa disisipkan kapan saja termasuk lebih awal kalau mau "quick win" duluan.

**Deviasi tercatat (2026-07-18):** Step 4 pada praktiknya dieksekusi SEBELUM Step 2/3 — bukan pelanggaran urutan yang direncanakan di atas, tapi dipicu diskusi terpisah (di luar urutan §9.6 ini) soal menjadikan komponen harga satu-satunya sumber kebenaran, yang secara alami mencakup pembersihan field harga manual. Step 3 **DITUNDA** (lihat catatan di Step 3 di atas). **Step 2 → Step 5 → Step 6 dieksekusi berurutan pada 2026-07-18**, semuanya murni scoped ke modul Visa tanpa menyentuh wizard/booking lintas-modul — semua Gap #1-#6 di §7 sekarang DITUTUP, hanya Step 3 (fitur varian) yang tersisa sebagai RENCANA.

---

## 10. Referensi Silang

- Keputusan arsitektur: `docs/decisions.md` → **2026-05-22 — Visa Product v2: VisaRequirement JSON + Dynamic Documents**
- Status milestone: `docs/progress.md` → **M7 — Visa Documentation Module** dan entri **Visa Product CRUD v2**
- `docs/architecture.md` bagian Visa (skema lama, endpoint `/api/admin/visa`) **sudah tidak akurat** — dipertahankan hanya sebagai arsip desain awal, jangan dijadikan rujukan implementasi.
- Rencana varian Umroh (§9): terhubung ke `docs/arsitektur-booking.md` §1.5 (pertanyaan terbuka alur pembelian multi-bentuk) dan `docs/arsitektur-umroh.md` (dampak ke wizard step hotel/transport).
