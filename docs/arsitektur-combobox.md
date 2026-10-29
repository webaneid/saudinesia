# Arsitektur — Combobox (dropdown pencarian) seragam

> **Status: Fase 1, 2, dan 3 SELESAI (2026-10-30) — tak ada lagi `<select>` polos di aplikasi.** Pemicu: pemilik menunjukkan daftar kode negara di formulir Tambah Pelanggan yang "buruk sekali" dan meminta komponen sejenis dicek dan dibuat bagus dan elegan.

## 1. Temuan audit (kode aktual, 2026-10-30)

Komponen `AutocompleteSelect` (`components/shared/`) dipakai di 4 tempat: `ContactPicker` (2×), kolom telepon `ManifestFieldsForm`, `AddressPicker` (Provinsi/Kab-Kota/Kecamatan/Desa/Negara), `VendorForm` (negara), `VendorPicker`. Bentuk lamanya bermasalah:

| # | Masalah | Penyebab |
|---|---------|----------|
| 1 | Daftar **transparan** — teks tumpang tindih dengan isi halaman di belakangnya | kelas `bg-popover`: token `popover` **tidak ada** di `tailwind.config.ts`/`globals.css`, kelas diam-diam tidak menghasilkan CSS |
| 2 | Daftar sesempit kotaknya (kode negara: ±144 px) → nama negara terpotong/terlipat dua baris | `absolute w-full` |
| 3 | Kotak terpilih sesak: "+62 Indonesia", tombol hapus, dan panah berdesakan; kode negara bisa "dihapus" padahal wajib | label panjang dipaksa masuk kotak sempit; `clearable` tak bisa dimatikan |
| 4 | Bendera, kode panggilan, dan nama digabung dalam satu string `label` — tak bisa ditata, pencarian "62"/"+62" bergantung kebetulan | `label: "🇮🇩 +62 Indonesia"` |
| 5 | Pencarian hanya `includes` — "+966" tak mencocokkan "966", urutan hasil tak peduli kecocokan | filter lokal `toLowerCase().includes` |
| 6 | Tak ada kotak cari di dalam daftar, tak ada penanda terpilih, sorotan keyboard tak ikut tergulir, tak ada Esc-kembali-fokus/Tab/Home/End, tak ada pola ARIA | — |
| 7 | Daftar bisa terpotong layar di dasar (tak pernah membuka ke atas) atau meluap di kanan HP | posisi tetap ke bawah |
| 8 | Opsi kode negara didefinisikan **dua kali** (`ContactPicker`, `ManifestFieldsForm`); opsi negara dua kali lagi (`AddressPicker`, `VendorForm`) | salin-tempel |

## 2. Hasil Fase 1 (as-built)

- **`components/shared/AutocompleteSelect.tsx`** (ditulis ulang, API lama kompatibel): kotak terpilih = tombol setinggi `Input` (`role="combobox"`), ikon penanda di depan, teks ringkas (`short`), hapus-pilihan opsional (`clearable`). Daftar = popover **berlatar padat** (`bg-background`, bayangan, sudut membulat) berisi kotak cari (ikon kaca pembesar) + pilihan: penanda (bendera) · label · teks pendamping kanan (`hint`) · centang pada yang terpilih. Selebar isi (min selebar kotak, maks `26rem`/lebar layar), **membuka ke atas** bila ruang bawah sempit, **rata kanan** bila meluap layar. Keyboard: panah/Home/End/Enter/Esc (kembali fokus ke kotak)/Tab; sorotan ikut tergulir; ARIA combobox + listbox + `aria-activedescendant`. Dua mode tetap: filter lokal atau `onSearch` (server-side, mis. desa/kelurahan, vendor).
- **`lib/ui/combobox.ts`** (murni, ber-tes): `ComboOption` (`id`, `label`, `hint`, `prefix`, `short`, `keywords`), `normalizeSearch` (huruf kecil, tanpa diakritik, "+" depan dibuang), `matchOptions` (urutan: diawali label › awal kata › kode panggilan › di mana saja; urutan asal stabil). "+966", "966", "arab", "us" (kode ISO) semuanya menemukan yang benar.
- **`components/shared/CountryCodeSelect.tsx`**: SATU definisi kode negara telepon — kotak ringkas "🇮🇩 +62", daftar "bendera · nama · +kode", Indonesia paling atas, tak bisa dikosongkan. Dipakai `ContactPicker` (HP + WhatsApp) dan kolom telepon manifest.
- **`lib/ui/countryOptions.ts`**: SATU definisi pilihan "Negara" (bendera + nama + ISO) untuk `AddressPicker` dan `VendorForm`.
- **Bukti:** `scripts/test-combobox.ts` (masuk `bun run test`): tabel nilai pencarian dihitung tangan, daftar negara nyata, penjaga sumber (latar padat; tak ada kelas `popover` di mana pun; ARIA/keyboard; satu definisi kode negara). 10 mutasi tertangkap (termasuk `bg-popover`, Esc, `clearable`, urutan Indonesia, urutan skor, "+" depan, opsi buatan sendiri, ISO; satu yang sempat lolos — hanya satu dari dua `CountryCodeSelect` di ContactPicker — diperketat). Tes menemukan 1 bug nyata saat ditulis: `normalizeSearch("  +966 ")` tak membuang "+" bila ada spasi depan. Browser (Chrome pane, peran Admin/Superadmin sungguhan): daftar kode negara terbaca jelas, "+96" → Arab Saudi (+966), Irak, Yordania…, Provinsi "jawa" → 3 hasil, keadaan kosong "Tidak ada hasil", HP 375 px tanpa gulir horizontal (daftar 33–359 px), pemilih Vendor di Komponen Biaya.

## 3. Cara memakai (aturan)

Dropdown pencarian di formulir WAJIB lewat `AutocompleteSelect` (atau pembungkus bersama seperti `CountryCodeSelect`/`VendorPicker`); jangan membuat daftar sendiri atau kelas `bg-popover`. Opsi yang punya bendera/kode/harga memakai `prefix`/`hint`/`short`, bukan menempel semuanya ke `label`. Daftar yang tak mungkin dimuat penuh memakai `onSearch`. Filter tabel tetap `FilterSelect` (`docs/arsitektur-tabel.md` §2.3).

## 4. Keterbatasan yang diketahui

- (Bendera emoji dihapus — lihat §4d.)
- Baris `VendorPicker` di panel Komponen Biaya sempit (tombol "Vendor Baru" + mata uang berbagi baris) sehingga kotak vendor terpotong ("Pilih ve…"); daftarnya sendiri sudah baik.

## 4b. Fase 2 (as-built, 2026-10-30)

- **Portal.** Fase 1 memasang daftar `absolute` di dalam kotak; di editor Paket (kotak `MetaBox` ber-`overflow-hidden`) daftar terpotong tepi kartu — ditemukan saat verifikasi browser. Daftar kini dipasang lewat `createPortal` ke `document.body` dengan `position: fixed`, dihitung dari kotak terpilih (`reposition`: buka ke atas bila ruang bawah sempit, tinggi daftar menyesuaikan sisa ruang, bergeser ke kiri bila meluap, ikut saat gulir/ubah ukuran). Warna merek admin ikut lewat kelas `brand-scope` (variabel `--primary`/`--ring` dipisah dari `.admin-canvas`). Fokus ke kotak cari menunggu daftar terpasang (sebelum diposisikan ia `visibility: hidden` dan tak bisa difokuskan — Enter sempat menutup daftar tanpa memilih).
- **`components/shared/ChoiceSelect.tsx`**: pengganti `<select>` untuk daftar data — nilai string ('' = kosong) seperti `<select>`, jadi state halaman tak berubah; `AutocompleteSelect` mendapat `ariaLabel`.
- **22 `<select>` dimigrasi**: Paket Umroh (hotel Makkah/Madinah included + opsi, kendaraan, trip, visa included + opsi, penerbangan, rute tiket, katering included + opsi — 12), Paket Ziarah (situs, kendaraan, trip, hotel included + opsi — 5), kendaraan di trip transport, rute jadwal penerbangan (baru + edit), roster muthowif, baris rencana pengeluaran. Harga/kota/kapasitas pindah ke `hint` di kanan dan ikut dicari. Perilaku `onChange` tak berubah (mis. pilihan visa kini terkendali dari `includedVisaProductId` — dulu `defaultValue=""` sehingga tak menampilkan yang terkunci).
- **Penjaga:** `test-combobox` menemukan sendiri `<select>` polos berpilihan kosong ("— pilih —", `value=""`) di seluruh `app/`+`components/` (satu pengecualian tercatat: filter publik `TransportSearch`, Fase 3).
- **Bukti browser:** pemilih rute penerbangan (daftar terbaca, Enter memilih, fokus di kotak cari), pilihan hotel di kotak Paket tak lagi terpotong, daftar provinsi pada viewport 420 px tinggi membuka ke atas dengan tinggi menyesuaikan. Dev DB tak punya jadwal hotel/kendaraan, sehingga daftar itu hanya dibuktikan "Tidak ada hasil"; format opsi dibuktikan tipe + tes sumber.

## 4c. Fase 3 (as-built, 2026-10-30)

- **`AutocompleteSelect`**: `searchable` (bawaan: kotak cari hanya bila pilihan > 7 atau memakai `onSearch`) dan `size` (`sm` = setinggi baris tabel). Daftar tanpa kotak cari memusatkan fokus pada daftarnya sendiri (panah/Home/End/Enter/Esc/Tab bekerja sama), dan sorotan awal jatuh pada pilihan yang sedang terpilih (bukan selalu teratas).
- **`components/shared/CurrencySelect.tsx`**: satu pemilih mata uang (kotak "IDR", daftar kode · nama; urutan bawaan tiap modul lewat `currencies`) menggantikan 6 `<select>` serupa (hotel, penerbangan, trip transport, muthowif, tier visa, `VendorCurrencyField`).
- **Enum pendek → `ChoiceSelect` (`clearable={false}`):** tipe kendaraan, kota (hotel, situs wisata), musim, board type, menu katering, jenis haji, role pengguna baru, role pada baris tabel Pengguna (`size="sm"`), jenis dokumen di `UploadModal`; sisi jamaah/publik: rute di `TransportCheckoutForm`, filter Dari/Ke di `TransportSearch` (kotak beralas dalam-kartu dibuang, label di atas; tombol tukar dirapikan).
- **Baris Vendor + Mata uang** (`VendorCurrencyField`, `VendorField` di tier visa) kini bertumpuk: vendor satu baris penuh (tombol "Vendor Baru" tak lagi menyempitkan kotak sampai "Pilih ve…"), mata uang di bawahnya.
- **Aturan keras:** `scripts/test-combobox.ts` menolak `<select>` apa pun di `app/` dan `components/` (kecuali implementasi combobox). Kelas CSS `admin-select`/`admin-select-xs` yang tak lagi dipakai dihapus.
- **Bukti browser:** filter publik Dari (daftar tanpa kotak cari, fokus di daftar, ↓+Enter memilih), kolom Role di tabel Pengguna (muat di baris, sorotan awal = Admin yang terpilih; tidak diubah), kotak Komponen Biaya (vendor satu baris penuh, mata uang membuka ke atas dengan IDR/SAR/USD/EUR + nama).

## 4d. Bendera SVG (as-built, 2026-10-30)

- **Masalah:** Windows (Segoe UI Emoji) tidak punya glyph bendera — emoji 🇮🇩 tampil sebagai dua huruf "ID". Keputusan pemilik: pakai gambar.
- **Aset:** 195 SVG rasio 3:2 (±1–3 KB masing-masing) di `public/flags/<ISO>.svg` + `LICENSE` (MIT, `country-flag-icons` karya catamphetamine). Disalin oleh `bun scripts/sync-flags.ts` dari paket yang dipasang sebagai **devDependency** — produksi tidak bergantung pada paket (hanya berkas statis; `Dockerfile` sudah menyalin `public/`, matcher middleware melewatkan jalur bertitik). Script gagal keras bila ada negara tanpa bendera; jalankan ulang bila `COUNTRIES` berubah.
- **Komponen:** `components/shared/Flag.tsx` (`<img>` dekoratif `alt=""`, `loading="lazy"`, 20×14 px bersudut tipis + garis tipis agar bendera putih tetap terlihat). `ComboOption.prefix` (string emoji) diganti `flag` (kode ISO); `AutocompleteSelect` merender `Flag` di kotak terpilih dan di tiap pilihan. `lib/utils/flag.ts` dihapus.
- **Penjaga (`test-combobox`):** tiap negara punya berkas; SVG aman (tanpa `<script>`, `<foreignObject>`, `on*=`, `<image>`/`<use>` ke luar, `<style>`) dan < 20 KB; identik dengan paket sumber (tanpa drift); `LICENSE` ada; `Flag` dirender sebagai `<img … alt="" aria-hidden … loading="lazy">`; tak ada emoji bendera di `app/`, `components/`, `lib/`.
- **Bukti:** `/flags/ID.svg` → 200 `image/svg+xml` di dev; daftar kode negara di formulir Tambah Pelanggan menampilkan bendera sebagai gambar (macOS — pada Windows hasilnya sama karena bukan font). Belum diuji di mesin Windows sungguhan.

## 5. Audit modul lain — hasil

(Dipertahankan sebagai catatan temuan awal; seluruhnya sudah dikerjakan di Fase 2 dan 3.)

`<select>` polos: **49 pemakaian di 27 berkas**, dua jenis:

- **Daftar data yang bertumbuh (±25) — SELESAI Fase 2 (§4b)** — hotel+tipe kamar (×6 di `packages/[id]`, `tour-packages/[id]`), trip/kendaraan, situs wisata, produk visa, jadwal penerbangan/rute, menu katering, roster muthowif (`MuthowifAssignPanel`), baris rencana (`CostActualsPanel`). Daftar panjang tanpa pencarian, label gabungan ("Hotel — Tipe (Kota) — Rp/mlm"). → **Fase 2:** `AutocompleteSelect` dengan `hint` (harga/kota di kanan).
- **Enum pendek (±24)** — kota, musim, role, board type, menu, jenis haji, tipe kendaraan, mata uang (7 tempat), serta `TransportSearch`/`TransportCheckoutForm`/`UploadModal` di sisi publik/jamaah. Native `<select>` wajar untuk ≤ 7 pilihan, tetapi tampilannya beda dari combobox. → **Fase 3:** mode tanpa kotak cari (`searchable` otomatis mati bila ≤ 7 pilihan) supaya tampilan seragam; termasuk merapikan baris `VendorPicker`/`VendorCurrencyField`.

Fase 2 dan 3 mengubah ±27 halaman editor produk; dikerjakan terpisah dan bertahap (tiap fase: tsc, build, tes, browser, PR), sesuai arahan pemilik "step by step".
