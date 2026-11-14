# Evaluasi Sistem Menyeluruh — 2026-11-14

> Evaluasi langsung di aplikasi yang berjalan (server uji DB audit, `main` @ `85878f3`), dari dua sisi: **pelanggan** (katalog → checkout → booking → data jamaah) dan **admin** (overview → booking → verifikasi pembayaran → draf booking → editor produk → pengaturan). Semua temuan berdasarkan apa yang dilihat dan dicoba, bukan dugaan; tiap temuan diberi bukti dan saran.
>
> **Belum diuji di sesi ini:** unggah dokumen dan bukti transfer (browser uji tidak bisa memilih berkas — sudah diuji di fase sebelumnya), email/WhatsApp sungguhan, tampilan PDF invoice, login Google, pendaftaran akun baru, checkout Haji/Ziarah/Transport/Muthowif sampai terbit, pembatalan/refund, isi laporan untung.

---

## 1. Jawaban singkat: siap diuji coba lokal?

**Ya, untuk uji coba internal terbatas** (tim operator + beberapa pelanggan uji yang dikenal). Mesinnya sudah utuh dan aman:
- katalog → checkout → invoice → data jamaah → verifikasi pembayaran berjalan ujung ke ujung;
- harga selalu dihitung server;
- tampilan HP rapi;
- dwibahasa id/en;
- peringatan admin bekerja (mis. "belum ada rekening").

**Belum untuk dibuka ke publik (go-live).** Ada tiga celah bisnis yang akan langsung terasa oleh pelanggan nyata umroh (§3: K1–K3), satu temuan keamanan yang memang ditunda sampai sebelum go-live (SEC-221), dan beberapa item pengerasan server.

### Wajib dikerjakan sebelum uji coba lokal (konfigurasi, ±1 hari, tanpa kode)

| # | Yang perlu diisi | Kenapa |
|---|---|---|
| P1 | **Rekening bank** di Sistem → Pengaturan Invoice | Saat ini pelanggan melihat "Nomor rekening belum tersedia" di halaman bayar, tapi tetap bisa mengunggah bukti. |
| P2 | **Data produk nyata**: paket umroh (isi komponen, foto, harga), hotel dengan periode harga berjalan, transport dengan harga per kendaraan, visa | Di data uji hanya 1 dari 5 hotel yang berharga; banyak rute transport tanpa harga. |
| P3 | **Konten Situs**: judul hero katalog Paket masih "Judul baru" | Teks uji yang tersimpan tampil ke publik. |
| P4 | **Hapus/rapikan data uji** (Haji Furoda Rp 4,2 jt, "Hotel Bintang 8", "Haji furoda ini boss") | Tampil di katalog publik. |
| P5 | **Email (Resend) dan WhatsApp (GOWA)** aktif di lingkungan uji | Tautan invoice, verifikasi akun, dan pengingat bayar dikirim lewat sini. |

---

## 2. Yang sudah baik (pertahankan)

- **Harga satu sumber, dihitung server.** Angka katalog = pratinjau checkout = invoice (dibuktikan lagi: hotel Rp 88 jt di katalog = Rp 88 jt di checkout).
- **Checkout pendek dan jelas**: satu halaman, ringkasan di kanan, "Pesan & terbitkan invoice" atau "Tambah ke keranjang"; kotak cari Pesawat/Hotel mengisi checkout otomatis dan isiannya bertahan melewati login.
- **Halaman booking pelanggan memandu**: "Pesanan diterbitkan — selesaikan dua langkah", tenggat bayar dalam tanggal dan jam, progres "0/1 jamaah lengkap".
- **Data jamaah bisa dipakai ulang** (Jamaah Saya, "Jadikan saya jamaah"); NIK terenkripsi dan tidak pernah ditampilkan lagi.
- **Admin waspada**: peringatan "belum ada rekening aktif" muncul di detail booking dan di draf; konfirmasi pembayaran satu klik; nominal kurang langsung diberi pesan.
- **Konsisten secara visual**: tabel, filter, dan kartu memakai satu kit; HP 375 px tanpa geser horizontal.

---

## 3. Temuan

Skala: **Kritis** = menghalangi transaksi nyata atau berisiko uang/kuota · **Tinggi** = pelanggan/admin mudah keliru · **Sedang** = mengurangi kejelasan · **Rendah** = poles.

### Kritis — selesaikan sebelum go-live

**K1. Paket Umroh tidak punya jadwal keberangkatan, durasi, kursi, dan halaman detail.**
- *Bukti:*
  - Di checkout paket, pelanggan memilih **tanggal berangkat bebas** ("Pilih tanggal mulai hari ini").
  - Ringkasan dan halaman booking menulis "15-12-2026 – 15-12-2026", dan "Kembali: 15 Desember 2026" sama dengan berangkat.
  - Kartu katalog hanya berisi nama, syarat dokumen, dan harga. Tidak ada itinerary, hotel, maskapai, atau durasi.
  - Editor paket admin tidak punya isian tanggal/durasi/kuota. Tombol kartu langsung ke checkout, tanpa halaman detail.
- *Dampak:* produk termahal (Rp 31 jt+) dibeli tanpa informasi yang biasa dicari jamaah. Satu paket berisi "Tiket Pesawat" pun dapat dipesan untuk tanggal apa saja.
- *Saran:*
  - Tambah **keberangkatan paket**: tanggal, durasi (hari), kursi, dan harga per keberangkatan bila beda. Pelanggan memilih dari daftar keberangkatan, bukan kalender bebas.
  - Buat **halaman detail paket**: ringkasan, itinerary, hotel (nama, bintang, jarak), maskapai, yang termasuk dan yang tidak, syarat dokumen.
  - Tanggal pulang dihitung dari durasi.

**K2. Pembayaran bertahap (DP → pelunasan) belum ada.**
- *Bukti:*
  - Di verifikasi pembayaran admin, nominal Rp 3.000.000 untuk tagihan Rp 6.550.000 ditolak: "Kurang dari total pesanan — tidak dapat dikonfirmasi. Tolak pembayaran dan minta pelunasan."
  - Setelan **"Pembayaran pertama minimum (%)"** di Pengaturan Invoice tersimpan, tapi **tidak dipakai kode mana pun** (`minimumFirstPaymentPercent` hanya dibaca `lib/invoice/settings.ts`).
- *Dampak:*
  - Praktik umroh hampir selalu DP lalu pelunasan.
  - Sekarang admin terpaksa menolak uang yang sudah masuk.
  - Admin bisa mengira setelan DP sudah berlaku.
- *Saran:* jadikan fase pembayaran bertahap (sudah direncanakan di `docs/arsitektur-booking-engine-v2.md`: ledger, nominal diisi pelanggan) prioritas sebelum go-live. Sampai saat itu, **sembunyikan setelan yang belum berfungsi** (minimum DP, biaya iPaymu/Xendit).

**K3. Invoice bisa terbit dan bukti bisa diunggah tanpa rekening tujuan.** — **SELESAI 2026-11-14**: checkout & keranjang ditolak (409 `checkoutNoBank`, diperiksa di transaksi penerbitan) dengan pemberitahuan + tombol pesan mati; unggah bukti ditolak (409 `paymentNoDestination`) dan formulirnya disembunyikan bila booking tak punya rekening tujuan.
- *Bukti:* pelanggan melihat "Nomor rekening belum tersedia. Mohon hubungi tim…", tapi formulir "Kirim Bukti Transfer" tetap aktif. Peringatan hanya ada di sisi admin.
- *Dampak:* pelanggan bisa transfer ke rekening yang salah (mis. dari invoice lama atau info dari pihak lain).
- *Saran:*
  - Tolak checkout pelanggan (dengan pesan ramah) selama belum ada rekening aktif.
  - Atau minimal matikan unggah bukti dan tampilkan tombol kontak.
  - Jadikan P1 syarat menyalakan situs.

**K4. SEC-221: kuota bisa ditahan tanpa bayar dalam jumlah besar** (tercatat di `docs/lessons-learned.md`, sengaja ditunda pemilik).
- Satu akun bisa menahan banyak kursi/kamar sampai booking hangus, sehingga produk langka tampak habis bagi pelanggan lain.
- Angka batas (booking aktif belum dibayar per akun, atau jatuh tempo checkout lebih pendek) adalah keputusan bisnis.

### Tinggi

**T1. Verifikasi pembayaran hanya dari gambar.**
- *Bukti:* panel admin berisi "Lihat Bukti Transfer" + "Jumlah diterima" saja.
- *Masalah:* pelanggan tidak diminta nama pengirim, bank asal, tanggal, atau nominal yang ditransfer, sehingga admin sulit mencocokkan dengan mutasi rekening.
- *Saran:*
  - Formulir unggah bukti minta nominal, bank/nama pengirim, dan tanggal.
  - Admin melihatnya di samping gambar; nominal pelanggan mengisi bawaan "Jumlah diterima".

**T2. Checkout paket membuka struktur harga internal.**
- *Bukti:* ringkasan checkout paket berisi lima baris komponen biaya dengan label buatan admin: "Tiket Pesawat Rp 24.000.000", "Muthowif", "Visa", "Pengurusan Dokumen", dan "biaya pengurusan dokumen" (dua label mirip, huruf kecil). Sesudah terbit, halaman booking hanya menampilkan **satu baris** "Paket Umroh — Umroh Mandiri".
- *Dampak:*
  - Pelanggan melihat harga per komponen; mudah dibandingkan atau ditawar per komponen.
  - Label yang tidak rapi tampil apa adanya.
  - Checkout dan booking tidak konsisten.
- *Saran:* untuk pelanggan, tampilkan **satu baris per paket** (+ add-on pilihannya). Rincian komponen tetap di admin (dan invoice bila memang diinginkan).

**T3. Dua cara memasukkan tiket/visa ke paket, dan satu di antaranya tanpa kontrol kuota.**
- *Bukti:* paket "Umroh Mandiri" memakai mode **Tiket Pesawat = Tidak dipakai (NONE)**, tapi punya **Komponen Biaya "Tiket Pesawat"** (vendor "Saudinesia Air", Rp 20 jt).
- *Masalah:*
  - Komponen biaya tidak menahan kursi jadwal pesawat mana pun, sehingga paket bisa terjual melebihi kursi.
  - Data pesawat ganda: modul Pesawat dan teks bebas.
- *Saran:*
  - Beri panduan dan peringatan di editor: komponen bernama/berjenis pesawat, hotel, atau visa → arahkan ke mode terstruktur.
  - Atau batasi Komponen Biaya untuk biaya non-inventori (dokumen, admin, perlengkapan).

**T4. Katering tidak muncul di menu atas maupun beranda.** — **SELESAI 2026-11-14**: katering masuk `PUBLIC_NAV` (header, menu HP, footer, ubin beranda — tetap lewat `availableCatalogs()`).
- *Bukti:* katalog `/id/catering` aktif dengan 4 produk, tapi `components/shared/publicNav.ts` (`PUBLIC_NAV`) tidak memuat katering. Akibatnya katering hanya ada di footer.
- *Saran:* tambahkan katering ke `PUBLIC_NAV` (tetap tunduk pada `availableCatalogs()`).

**T5. Syarat dokumen jamaah tidak cocok dengan isian data.**
- *Bukti:* di formulir "Data Anda sebagai jamaah", **nomor paspor "opsional"**, padahal paket mewajibkan "Foto Paspor" dan visa umroh butuh paspor.
- *Saran:* bila produk dalam booking mewajibkan paspor, jadikan nomor paspor dan masa berlaku wajib di formulir jamaah booking itu (kartu Jamaah Saya tetap boleh opsional).

### Sedang

| # | Temuan | Bukti | Saran |
|---|---|---|---|
| S1 | Format tanggal tidak konsisten | "15-12-2026" (checkout), "15/12/2026" (booking/admin), "15 Desember 2026", "15 Des 2026" | Satu format pelanggan, mis. "15 Des 2026", lewat `formatCalendarDate`. |
| S2 | "Musim: Reguler/Regular" tampil ke pelanggan dan admin, ejaannya beda | Detail booking pelanggan "Reguler", admin "Regular" | Harga kini per periode. Sembunyikan "Musim" dari pelanggan; tinjau apakah menu Produk → Musim masih perlu. |
| S3 | Daftar "Booking Saya" dan Dashboard hanya menampilkan kode | Kolom: kode, berangkat, jamaah, total, status | Tambah nama produk utama (mis. "Umroh Mandiri" / "Visa + Ziarah"). |
| S4 | Area jamaah tanpa logo/tautan ke situs dan keranjang; "Buat Booking" menuju beranda | Header area jamaah: Dashboard, Buat Booking (→ `/id`), Booking Saya, Jamaah Saya, Profil | Pakai header publik yang sama (logo + keranjang) dengan menu akun. Ganti label jadi "Pesan Layanan". |
| S5 | Urutan halaman booking pelanggan berlawanan dengan panduannya | Panduan: "1. isi data jamaah, 2. transfer", tapi kotak bayar ada di atas, data jamaah di bawah | Samakan urutan, atau beri tab/langkah bernomor. |
| S6 | "Jadikan saya jamaah" tidak mengisi kontak dari akun; tanggal lahir lewat kalender bawaan browser (harus menggulir puluhan tahun) | Nama terisi, HP/email kosong | Isi HP/WA/email dari akun. Tanggal lahir: tiga isian (tgl/bln/thn) atau ketik langsung. |
| S7 | Syarat dokumen tidak bisa bersyarat | Visa Istidhofah mewajibkan "Iqamah Host", padahal S&K-nya "hotel Nusuk **atau** rumah pemilik iqamah" | Dukung dokumen "salah satu dari" / bersyarat, atau jadikan opsional dengan petunjuk. |
| S8 | Katalog Transport membingungkan soal harga | Kartu rute menampilkan semua kendaraan, tapi harga hanya pada yang berharga; rute tanpa harga tampil tanpa tombol | Sembunyikan kendaraan/rute tanpa harga dari publik, atau tulis "Hubungi kami". Pertimbangkan kotak cari hero seperti Pesawat/Hotel. |
| S9 | Menu admin 30 butir, istilah campur | "Overview", "Quota", "Visa Status", "Paket Bundle" (dashboard) vs "Paket" (menu) | Bahasa Indonesia penuh. Kelompokkan ulang (lihat §4). |
| S10 | Teks admin berisi rujukan developer, dan satu halaman punya dua cara simpan | Editor paket: "lihat docs/arsitektur-paket-umroh.md §3", "TIDAK DIPAKAI (NONE)". "Simpan perubahan" hanya untuk sebagian kotak; Komponen Biaya tersimpan langsung | Hapus rujukan dokumen dari UI. Beri tanda jelas per kotak ("tersimpan otomatis") atau satukan penyimpanan. |
| S11 | Menu Pembayaran hanya antrean | "Antrean Verifikasi Pembayaran" — tak ada riwayat pembayaran dikonfirmasi/ditolak, tak ada "catat pembayaran manual" (pelanggan transfer lalu kirim bukti lewat WA) | Tab Antrean / Riwayat, dan tombol catat pembayaran dari detail booking. |
| S12 | Setelan yang belum berfungsi tampil | Minimum DP, biaya iPaymu/Xendit (gateway belum ada) | Sembunyikan sampai fiturnya dibangun (lihat K2). |

### Rendah

| # | Temuan | Saran |
|---|---|---|
| R1 | Semua tab browser admin berjudul "Saudinesia" | Judul per halaman ("Booking SND-2026-00016 — Admin"). |
| R2 | Booking Baru admin: "Tidak ada pelanggan yang cocok" sebelum mengetik apa pun | Tampilkan pelanggan terbaru saat kotak kosong. |
| R3 | Nomor telepon admin tanpa format ("6281234567801") | Tampilkan "+62 812-3456-7801". |
| R4 | Kode booking (SND-…-00017) sudah terpakai sejak draf dibuat | Bila draf dihapus, nomor melompat; boleh dibiarkan (nomor invoice tetap tanpa lompat), cukup diketahui. |
| R5 | Beranda menampilkan hotel tanpa harga periode berjalan | Utamakan hotel berharga di beranda. |
| R6 | Label tombol berbeda antar katalog ("Ajukan Visa", "Pesan Paket Ini", "Pesan sekarang", "Pilih") | Pilih satu kata kerja per jenis aksi. |
| R7 | Konten Situs bisa menyimpan teks percobaan tanpa pratinjau ("Judul baru") | Tombol pratinjau halaman sebelum simpan. |

---

## 4. Yang bisa disederhanakan

1. **Menu admin** dari 30 butir menjadi 5 kelompok:
   - **Operasional:** Booking, Pembayaran, Jamaah (gabungan Verifikasi + Identitas).
   - **Keuangan:** Laporan Untung, Kesehatan Margin, Selisih HPP — satu halaman bertab.
   - **Produk:** Paket, Haji, Visa, Pesawat, Hotel, Transport, Muthowif, Katering, Ziarah. Situs Wisata dan Jenis Dokumen masuk sebagai sub-menu.
   - **Pelanggan.**
   - **Sistem.**
   
   "Musim" ditinjau ulang (S2).
2. **Satu cara memasukkan komponen paket** (T3): mode terstruktur untuk inventori (pesawat, hotel, transport, visa), Komponen Biaya hanya untuk biaya non-inventori.
3. **Satu baris per produk di mata pelanggan** (T2): rincian komponen hanya untuk staf.
4. **Satu header untuk pelanggan** (S4): area publik dan area akun memakai header yang sama, sehingga logo, katalog, dan keranjang selalu ada.
5. **Sembunyikan yang belum hidup** (S12): pengaturan dan istilah untuk fitur yang belum dibangun membuat admin ragu.

---

## 5. Urutan kerja yang disarankan

| Tahap | Isi | Tujuan |
|---|---|---|
| **A — Siap uji coba** (konfigurasi) | P1–P5 | Uji coba lokal dengan tim + pelanggan uji |
| **B — Sebelum go-live** (kode) | K1 keberangkatan + detail paket · K2 pembayaran bertahap · K3 blokir tanpa rekening · K4/SEC-221 batas kuota · T1 data transfer · T3 kontrol komponen paket · pengerasan kontainer yang tersisa | Aman untuk pelanggan umum |
| **C — Poles** | T2, T4, T5, S1–S12, R1–R7 | Lebih mudah dan rapi |

Saran urutan di tahap B: **K3 → T4 → K1 → K2 → T1 → T3 → SEC-221**. K3 dan T4 kecil dan cepat; K1 dan K2 terbesar dan paling berdampak.
