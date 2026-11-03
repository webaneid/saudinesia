# Rencana — Visa sebagai produk utama di booking

> Status: **DISETUJUI (2026-11-03); V1 SELESAI 2026-11-03; V2 SELESAI 2026-11-04** (keputusan §4 masih menunggu pemilik). Koreksi pemilik: *"KITA JUALAN VISA"* — visa adalah produk,
> sejajar tiket/hotel/transport, bukan tambahan per jamaah. Dasar: audit kode 2026-11-03 (fakta di §1). Bila disetujui, isi
> dokumen ini dipindah ke `docs/arsitektur-booking-engine-v2.md` (bagian baru) dan `docs/arsitektur-visa.md` (§ diperbarui).

## 0. Model bisnis (kata pemilik)

1. **Visa adalah produk yang kita jual.** Di form booking ia dipilih dari dropdown produk yang sama dengan produk lain.
2. **Setiap produk visa punya jenis**, diatur saat membuat produk visa:
   - **Visa only** — tidak wajib membeli apa pun dari kita; cukup melengkapi dokumen (bukti booking hotel, tiket, dll. dari luar).
   - **Visa plus …** — wajib membeli komponen tertentu dari kita di booking yang sama (tiket pesawat, hotel, transport).
3. **Dokumen yang harus dilengkapi** = syarat dokumen yang dibuat di produk visa itu (katalog Jenis Dokumen).
4. Visa tetap **1 per orang** (paspor/data orang itu), tetapi admin memilihnya sebagai **baris produk**, bukan di kotak Jamaah.

## 1. Kondisi kode sekarang (audit 2026-11-03)

| Hal | Sekarang | Sumber |
|---|---|---|
| Visa di form booking | **Tidak ada** di dropdown produk (`ROW_MODULES`); dipilih per jamaah di kotak "Jamaah" (pilih visa + hari) | `bookings/drafts/[id]/ItemRows.tsx:27,130`; `drafts/[id]/page.tsx:172-185`; `bookings/[id]/edit/page.tsx:143-155` |
| Penyimpanan | `pilgrims[].visaProductId` + `selectedDurationDays` → satu `VisaApplication` per jamaah + satu baris snapshot `visa` | `lib/validators/booking.ts:113-119,221-224`; `lib/booking/lineItems.ts:211-246` |
| Jenis visa ("only/plus") | Tersirat: `VisaProduct.requiredComponents` kosong = visa only; berisi tiket/hotel/transport = visa plus. Editor: tab "Aturan" terpisah | `prisma/schema.prisma:473`; `lib/validators/visa.ts:5-16`; `products/visa/[id]/page.tsx:172` |
| Penilaian aturan | `evaluateVisaRules` — komponen wajib terpenuhi oleh item booking yang sama atau paket; pelonggaran per pelanggan `allowVisaWithoutBundle` | `lib/booking/rules.ts:48-71`; `ruleContext.ts` |
| Syarat dokumen | `DocumentRequirement` milik produk visa, dinilai **per jamaah** booking; jenis per-perjalanan sudah ada: `flight_ticket`, `hotel_reservation`, `transport_reservation` | `lib/documents/requirements.ts`; `lib/pilgrims/bookingLink.ts:249-279` |
| Kaitan dokumen ↔ komponen | **Tidak ada** — jamaah visa plus yang sudah membeli hotel dari kita tetap diminta bukti booking hotel bila syarat itu dipasang | — |

Kesimpulan: **mesin harga, aturan, dan dokumen sudah benar arahnya**; yang terbalik adalah **antarmuka booking** (visa disembunyikan
di kotak Jamaah seolah tambahan) dan **editor produk visa** (jenis visa tidak tampil sebagai pilihan yang jelas).

## 2. Rancangan

### 2.1 Editor produk visa — "Model penjualan" jadi pilihan eksplisit
- Dinamai **Model penjualan** (bukan "Jenis visa": kolom `VisaProduct.visaType` — Umroh/Turis — sudah memakai nama itu).
- Tab "Aturan" diganti satu pilihan **Model penjualan**: `Visa only` | `Visa plus` (+ centang komponen wajib: Tiket pesawat, Hotel,
  Transport, dengan filter kategori/trip transport yang sudah ada). Disimpan tetap di `requiredComponents` (tanpa kolom baru):
  `Visa only` = `[]`. Memilih "Visa plus" langsung mewajibkan tiket + hotel; mematikan semua komponen = kembali "Visa only" (model selalu turunan, tanpa state terpisah — `visaSalesModel`).
- Ringkasan di daftar produk visa: lencana "Visa only" / "Visa plus tiket + hotel".

### 2.2 Form booking admin — Visa sebagai baris produk
- `ROW_MODULES` mendapat **Visa**. Baris visa: pilih produk visa (petunjuk: jenis + harga mulai dari), **lama tinggal (hari)** bila
  bertier, dan **jumlah orang**.
- Penyimpanan TIDAK berubah: baris visa × N orang = N slot jamaah dengan `visaProductId` yang sama (draf: `pilgrims[]`; terbit:
  `VisaApplication` per jamaah). Baris visa adalah **tampilan kelompok** atas slot jamaah — satu sumber kebenaran tetap per orang.
  `rowFromItem`/`rowToItem` untuk visa mengelompokkan/mengurai slot per (produk, hari).
- Kotak "Jamaah" tidak lagi memuat pemilih visa; ia menampilkan siapa memegang visa apa (dan untuk revisi: memindahkan visa ke
  jamaah lain tetap lewat aturan kunci R3 yang ada).
- Saat baris visa "plus" dipilih dan komponen wajib belum ada: panel aturan yang sudah ada menampilkan "Visa X mewajibkan tiket
  pesawat + hotel" dengan tombol tambah baris (sudah ada — dipertahankan).
- Pratinjau: baris visa tampil seperti produk lain (subtotal per baris dari server), bukan ringkasan "Visa (n jamaah)" terpisah.
- Halaman edit setelah terbit (`bookings/[id]/edit`) mengikuti pola yang sama lewat `ItemRows`.

### 2.3 Dokumen — bukti dari luar hanya bila tidak dibeli dari kita
- `DocumentType` per-perjalanan bukti booking dikaitkan ke komponen: `flight_ticket` ↔ tiket, `hotel_reservation` ↔ hotel,
  `transport_reservation` ↔ transport (kolom `coversComponent` pada `DocumentType`, atau peta tetap di kode — diputuskan saat fase).
- `evaluateCompleteness` menganggap syarat bukti itu **terpenuhi otomatis** bila booking yang sama memuat komponen itu dari kita
  (atau paket yang memuatnya). Jadi satu produk visa bisa memasang syarat "bukti booking hotel" dan pelanggan yang membeli hotel
  dari kita tidak diminta mengunggahnya.

### 2.4 Yang TIDAK berubah
- Skema `VisaApplication`, snapshot harga `visa` per orang, invoice (baris visa per jamaah), checkout jamaah `/bookings/checkout/visa`.
- Pelonggaran per pelanggan `allowVisaWithoutBundle` tetap (menunggu keputusan pemilik — §4).

## 3. Fase (satu PR per fase)

| Fase | Isi | Selesai bila |
|---|---|---|
| V1 ✔ | Editor produk visa: pilihan "Model penjualan" (only/plus + komponen), lencana di daftar — **selesai 2026-11-03** | uji `parseRequiredComponents` tetap; browser: simpan only/plus, muat ulang konsisten |
| V2 ✔ | Form booking (draf + revisi): baris Visa di `ItemRows`, kelompok ↔ slot jamaah, kotak Jamaah tanpa pemilih visa, pratinjau per baris — **selesai 2026-11-04** | uji pemetaan baris ↔ slot (campur dua produk/tier, kurangi/tambah orang, visa paket tak tersentuh); booking draf → terbit → invoice identik dengan alur lama; browser |
| V3 | Bukti booking otomatis terpenuhi bila komponen dibeli dari kita | uji tabel `evaluateCompleteness` (dibeli / tidak / lewat paket); halaman jamaah & panel pemeriksaan |
| V4 | Dokumentasi: `arsitektur-booking-engine-v2.md`, `arsitektur-visa.md` (sekaligus membereskan drift §5) | — |

## 4. Keputusan yang menunggu pemilik
1. **Pelonggaran per pelanggan** (`allowVisaWithoutBundle`: pelanggan tertentu boleh membeli visa plus tanpa komponennya) — tetap
   dipakai, atau dihapus karena kini ada produk "Visa only"?
2. **V3** (bukti booking otomatis terpenuhi bila komponen dibeli dari kita) — diinginkan?

## 5. Drift dokumen lama yang ditemukan audit (dibereskan di V4)
- `arsitektur-booking-engine-v2.md` D5: "visa saja hanya lewat pelonggaran" — kode: visa dengan aturan kosong lolos untuk siapa pun
  (sesuai model pemilik sekarang). §4.1/§10.2 menyebut `evaluateBookingRules`; kode `evaluateVisaRules`/`visaRuleViolations`.
- `arsitektur-visa.md`: masih menyebut `price`, `durationFeeRules`, `BookingVisa`, editor 3 tab, fallback `VisaProduct.price`
  (§9.3; kode menolak 422), syarat dari `visaProduct.requirements` (kini tabel `DocumentRequirement`).
- Komentar basi: `prisma/schema.prisma:1189-1191` (`selectedDurationDays` "belum diisi" — sudah diisi `lineItems.ts:242`),
  `lib/validators/booking.ts:116-117` (`durationFeeRules`).
