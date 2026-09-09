# MinIO — Setup Guide & Lessons Learned

> Dokumen ini dibuat berdasarkan pengalaman setup dev lokal 2026-05-21.
> Baca sebelum menyentuh fitur upload file apapun.

---

## Arsitektur MinIO di Saudinesia

```
Browser  →  Next.js Server  →  MinIO (object storage)
                   ↑                     ↑
            validasi MIME+size     simpan file binary
            generate presigned URL
                   ↓
                Database
             (simpan object key,
              bukan file/URL)
```

**Satu bucket:** `saudinesia-docs` (private — tidak pernah dibuat public)

**Object key format:**
```
{entity}/{entityId}/{category}/{timestampMs}-{sanitizedFilename}

Contoh:
  hotels/uuid/images/1716288000000-exterior.jpg
  pilgrims/uuid/passport/1716288000000-scan.pdf
```

**Yang disimpan di DB:** object key (string) — bukan URL, bukan blob.
**URL untuk preview:** presigned URL di-generate saat read (TTL 15 menit user, 60 menit admin).

---

## Dev Lokal — Setup dari Nol

### 1. Install MinIO via Homebrew

```bash
brew install minio/stable/minio
brew install minio/stable/mc   # CLI client untuk management
```

### 2. Jalankan MinIO server

```bash
# Buat direktori data dulu jika belum ada
mkdir -p ~/minio-data

# Jalankan dengan credentials custom
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin123 \
  minio server ~/minio-data --console-address :9001
```

> **Penting:** Simpan credentials ini. MinIO menyimpannya ke dalam data directory
> sehingga tidak bisa diubah tanpa reset data.

Untuk autostart saat login:
```bash
brew services start minio/stable/minio
```

> **Catatan:** `brew services start` akan menggunakan credentials default (`minioadmin/minioadmin`).
> Jika sudah pernah dijalankan dengan credentials berbeda, data directory sudah
> terkunci ke credentials lama. Periksa dulu credentials yang aktif (lihat langkah verifikasi).

### 3. Buat bucket

```bash
# Sambungkan mc ke MinIO lokal
mc alias set local http://localhost:9000 minioadmin minioadmin123 --api s3v4

# Verifikasi koneksi
mc ls local

# Buat bucket (jika belum ada)
mc mb local/saudinesia-docs

# Konfirmasi bucket muncul
mc ls local
```

### 4. Isi `.env.local`

```env
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123   # ← sesuaikan dengan credentials saat minio dijalankan
MINIO_BUCKET=saudinesia-docs
NEXT_PUBLIC_MINIO_PUBLIC_URL=http://localhost:9000/saudinesia-docs
```

> **Jangan lupa restart dev server** setelah mengubah `.env.local`.

---

## Verifikasi Koneksi (Troubleshooting Pertama)

Sebelum debug kode, jalankan 3 langkah ini secara berurutan:

```bash
# 1. Apakah MinIO process berjalan?
lsof -i:9000 | grep minio
# Output yang diharapkan: baris dengan LISTEN

# 2. Apakah MinIO menerima request?
curl -s http://localhost:9000/minio/health/live && echo "OK"
# Output yang diharapkan: OK

# 3. Apakah credentials benar?
mc alias set local http://localhost:9000 $MINIO_ACCESS_KEY $MINIO_SECRET_KEY --api s3v4 \
  && mc ls local
# Output yang diharapkan: daftar bucket termasuk saudinesia-docs
```

Jika langkah 3 gagal dengan `request signature... does not match` → credentials di `.env.local` tidak cocok dengan yang digunakan saat MinIO dijalankan.

---

## Pelajaran dari Insiden 2026-05-21

### Masalah
Upload foto hotel mengembalikan `Storage error. Please try again.` (HTTP 500).

### Root Cause
Dua masalah bersamaan:

| # | Masalah | Dampak |
|---|---------|--------|
| 1 | `MINIO_SECRET_KEY=minioadmin` di `.env.local`, tapi MinIO lokal berjalan dengan `minioadmin123` | SDK MinIO gagal autentikasi → semua operasi storage error |
| 2 | Bucket `saudinesia-docs` belum pernah dibuat | Bahkan jika auth benar, `putObject` akan error "bucket not found" |

### Cara Debug
1. Cek health → MinIO berjalan ✓
2. Coba `mc alias set` dengan berbagai kombinasi credentials → `minioadmin123` berhasil
3. Cek bucket list → `saudinesia-docs` tidak ada
4. Buat bucket, fix credentials, restart server → resolved

### Pencegahan
- Selalu dokumentasikan credentials MinIO yang digunakan saat pertama setup di `.env.local` **dan** di catatan tim (jangan hanya di kepala).
- Jalankan 3-langkah verifikasi di atas setelah install MinIO di mesin baru.
- Di production: gunakan `.env` terpisah yang tidak di-commit, credentials berbeda dari dev.

---

## Manajemen Bucket

```bash
# Lihat semua bucket
mc ls local

# Lihat isi bucket
mc ls local/saudinesia-docs
mc ls local/saudinesia-docs/hotels/

# Hapus file tertentu
mc rm local/saudinesia-docs/hotels/uuid/images/timestamp-foto.jpg

# Hapus semua file dalam folder (hati-hati!)
mc rm --recursive --force local/saudinesia-docs/hotels/uuid/

# Info bucket
mc stat local/saudinesia-docs
```

---

## MinIO Console (UI)

Buka di browser: **http://localhost:9001**
Login dengan `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`.

Dari console bisa: browse file, upload manual, set policy, lihat usage.

---

## Production (Hostinger VPS)

Di production, MinIO berjalan via Docker Compose (lihat `docker-compose.yml`).
Credentials diambil dari environment variable `${MINIO_ACCESS_KEY}` dan `${MINIO_SECRET_KEY}`.

**Perbedaan dari dev:**
- Port 9000 tidak di-expose ke publik (internal Docker network saja)
- Next.js app berkomunikasi ke `minio:9000` (nama service Docker)
- Console di port 9001 harus diakses via SSH tunnel atau Nginx proxy

Setup bucket production:
```bash
# SSH ke VPS, lalu:
docker exec -it saudinesia_minio_1 mc alias set local http://localhost:9000 $MINIO_ACCESS_KEY $MINIO_SECRET_KEY
docker exec -it saudinesia_minio_1 mc mb local/saudinesia-docs
```

---

## File yang Relevan

| File | Fungsi |
|------|--------|
| `lib/storage/minio.ts` | Satu-satunya tempat MinIO SDK dipanggil |
| `lib/storage/minio-loader.ts` | Next.js image loader untuk URL MinIO |
| `app/api/v1/admin/products/hotels/[id]/images/route.ts` | API upload foto hotel |
| `app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts` | API upload dokumen jamaah |
| `app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/[docId]/route.ts` | Presigned URL + delete |
| `app/api/v1/admin/bookings/[id]/documents/zip/route.ts` | ZIP download semua dokumen |
| `components/admin/media/ProductMediaGallery.tsx` | Gallery foto produk |
| `components/admin/media/ImageUploadModal.tsx` | Modal upload foto |
| `components/shared/media/DocumentGrid.tsx` | Grid dokumen jamaah |
| `components/shared/media/UploadModal.tsx` | Modal upload dokumen |
