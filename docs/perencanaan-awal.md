Rencana Arsitektur Strategis: Platform Layanan Umrah Terpadu (Enhanced)
Dokumen ini menyajikan analisis mendalam terhadap benchmark Nusuk dan rencana pengembangan aplikasi Umrah yang komprehensif, mencakup alur pengguna, fitur utama, hingga infrastruktur teknis berdasarkan standar Comprehensive Packages.
Target Pasar:
WNI yang berada di Saudi
WNI yang akan berkunjung ke Saudi
1. Analisis Benchmarking & Standar Layanan (Nusuk & Global)
A. Konten & Layanan Utama (Sesuai Gambar Referensi)
Platform ini harus mencakup 7 pilar layanan utama:
Visa Issuance: Integrasi e-Visa otomatis.
Jenis Visa
Umroh
Others:
Visit (Ziarah)
Bisnis
Kerja
Administrasi layanan visa di KBSA Jakarta
Alurnya:
upload
e-tiket pesawat PP
passport
KTP 
KK
E-Vaksin
Booking Hotel (opsional)
Iqomah muqim Saudi (pejamin)
Tracking
Fase penerimaan dokumen
Input ke Sistem
Proses Validasi data di Syarikah
Proses agreement number hotel
Validasi pembayaran
Issued Visa
Upload visa di sistem
Accommodations: Pemesanan hotel di Makkah dan Madinah. (ini bisa jadi add-on wajib untuk pemesanan Visa Umroh)
Pilihan dan harga hotel
Mekah
madinah
nama hotel
harga permalam
jarak ke haram
Transportation: Bus antar kota (Makkah-Madinah-Jeddah) dan transportasi bandara.(ini bisa jadi add-on wajib untuk pemesanan Visa Umroh)
Mekah
Madinah
Full Trip (5 trip)
Based on rute
Jenis
Bus (49)
Coaster (20)
Hiace (10)
Staria/H1 (7)
GMC/Suburban (6)
Inova/Traverse (5)
Sedan Ford Taurus/Camry (3)
Muthowif
harian
tanggal umroh/dan kedatangan
Hotel apa
Rawdah Noble Sanctuary Booking: Manajemen permit (izin) masuk Raudah sesuai jadwal yang tersedia. → ini sebagai informasi aja, bisa dibantu secara free.
Visit Heritage Sites: Paket tur ke tempat-tempat bersejarah (Ziyarah).
Flights: Integrasi sistem reservasi tiket pesawat internasional dan domestik.
Catering: Pengaturan konsumsi (full board/half board) selama perjalanan.
B. Alur Pengguna (User Flow)
Identifikasi & Flight: Menentukan asal negara dan memilih jadwal penerbangan.
Customization (The Builder): Memilih kombinasi hotel, jenis katering, dan tipe transportasi.
Permit Management: Memilih slot waktu untuk kunjungan ke Raudah dan Umrah.
Secure Checkout: Pembayaran terpadu untuk seluruh komponen paket.
Digital Document Delivery: Menerima E-Visa, tiket pesawat, voucher hotel, dan QR Code Permit dalam satu dashboard.
2. Fitur Utama Aplikasi (Proposed Improvements)
A. Modul Identitas & Dokumen (Digital Vault)
OCR Passport Scanner: Ekstraksi data paspor otomatis menggunakan AI.
E-Visa Sync: Sinkronisasi status visa langsung dengan sistem MoFA (Ministry of Foreign Affairs).
B. Marketplace & Transaksi (The "Umrah Store")
Catering Selection: Pilihan menu (Asian, Arabic, Western) sesuai selera jemaah.
Heritage Tour Booking: Integrasi dengan pemandu lokal (Mutawwif) untuk kunjungan situs bersejarah.
Escrow System: Sistem pembayaran aman yang menjamin dana jemaah.
C. Fitur Pendamping Ibadah (Smart Companion)
Permit QR Center: Satu tempat untuk semua akses (Raudah, Umrah, dan transportasi).
Interactive Ritual Guide: Panduan audio/visual yang aktif berdasarkan lokasi GPS (Miqat, Tawaf, Sai).
Haramain Live Status: Pantauan kepadatan area ibadah secara real-time.
SOS Emergency: Jalur cepat bantuan medis dan petugas lapangan.
3. Rencana Arsitektur Sistem
A. High-Level Architecture (Microservices)
Identity & Auth Service: Keamanan data jemaah dan biometrik.
GDS Integration Service: Menghubungkan aplikasi ke sistem maskapai (Flight) dan sistem global Saudi (Hotel & Transport).
Permit Engine: API khusus untuk sinkronisasi jadwal Raudah dan izin Umrah.
Booking & Inventory: Mengelola stok kamar, kursi bus, dan slot katering.
Payment Gateway: Pemrosesan transaksi multi-negara.
B. Tech Stack (Rekomendasi)
Frontend: Flutter (Mobile) & React (Admin/Web).
Backend: Go (Golang) untuk menangani transaksi tinggi selama musim puncak.
Database: PostgreSQL (Core Transaction) & Redis (Caching jadwal permit).
Infrastructure: GCP/AWS dengan sistem Auto-scaling untuk menghadapi lonjakan trafik saat pembukaan musim Umrah.
4. Mekanisme Operasional
Pengiriman Dokumen & Izin:
Validasi otomatis dokumen yang diunggah menggunakan AI untuk meminimalisir penolakan visa.
Penerbitan Single QR Code yang merangkum semua izin (Permit Raudah, Voucher Hotel, dan Bus).
Manajemen Paket Komprehensif:
Bundling Logic: Sistem secara otomatis menghitung asuransi wajib saat penerbangan dan akomodasi dipilih.
Dynamic Pricing: Harga yang menyesuaikan secara real-time berdasarkan ketersediaan slot di sistem Saudi.
5. Roadmap Pengembangan
Fase 1: Integrasi API GDS (Visa, Flight, Hotel).
Fase 2: Pengembangan modul Permit Raudah dan Manajemen Katering.
Fase 3: Fitur Smart Companion (GPS & Audio Guide) dan Ziyarah.
Fase 4: Ekspansi ke layanan tambahan seperti kargo air zam-zam dan loyalitas pelanggan.

