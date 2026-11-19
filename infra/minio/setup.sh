#!/bin/sh
# Penyiapan MinIO sekali jalan tiap deploy (kontainer `minio-setup`, docker-compose.prod.yml) — SEC-305.
# Memakai kredensial ROOT (hanya kontainer ini dan `minio` yang memegangnya) untuk:
#   1. memastikan bucket ada dan PRIVAT,
#   2. membuat/memperbarui policy `saudinesia-app` = hanya bucket itu (Get/Put/Delete objek + List/lokasi bucket),
#   3. membuat/memperbarui user aplikasi (MINIO_ACCESS_KEY/MINIO_SECRET_KEY) dan memasang policy itu.
# Web hanya memegang user aplikasi: bila web dibobol, bucket tak bisa dijadikan publik, dihapus, atau user lain dibuat.
# Idempoten — aman dijalankan ulang (rotasi sandi user aplikasi = ubah MINIO_SECRET_KEY lalu deploy).
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER belum diisi}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD belum diisi}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY belum diisi}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY belum diisi}"
BUCKET="${MINIO_BUCKET:-saudinesia-docs}"
REGION="${MINIO_SITE_REGION:-ap-southeast-1}"
URL="${MINIO_SETUP_URL:-http://minio:9000}"
POLICY=saudinesia-app

# Fail-closed: user aplikasi tidak boleh sama dengan root (konfigurasi lama sebelum SEC-305 memakai root untuk web).
[ "$MINIO_ACCESS_KEY" != "$MINIO_ROOT_USER" ] || { echo "GAGAL: MINIO_ACCESS_KEY sama dengan MINIO_ROOT_USER — buat kunci aplikasi terpisah (docs/deployment.md)"; exit 1; }
# Nilai masuk ke URL alias dan nama bucket — hanya karakter aman.
for v in "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" "$BUCKET"; do
  case "$v" in *[!A-Za-z0-9._-]*) echo "GAGAL: kredensial/bucket MinIO hanya boleh huruf, angka, titik, garis bawah, minus"; exit 1;; esac
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export MC_CONFIG_DIR="$WORK/mc"
# Alias lewat variabel lingkungan, bukan `mc alias set` dengan argumen — rahasia tidak tampil di daftar proses.
export MC_HOST_root="$(printf '%s' "$URL" | sed "s#://#://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@#")"

mc --quiet mb --ignore-existing --region "$REGION" "root/$BUCKET"
mc --quiet anonymous set none "root/$BUCKET"

cat > "$WORK/policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:ListBucket"], "Resource": ["arn:aws:s3:::$BUCKET"] },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::$BUCKET/*"] }
  ]
}
JSON
mc --quiet admin policy create root "$POLICY" "$WORK/policy.json"

# Sandi lewat stdin (mc meminta bila argumen sandi tidak ada) — tidak tampil di daftar proses. Membuat atau memperbarui.
printf '%s\n' "$MINIO_SECRET_KEY" | mc --quiet admin user add root "$MINIO_ACCESS_KEY"
# Pasang policy; sudah terpasang = bukan galat.
mc --quiet admin policy attach root "$POLICY" --user "$MINIO_ACCESS_KEY" 2>"$WORK/attach.err" || grep -qi "already" "$WORK/attach.err" || { cat "$WORK/attach.err"; exit 1; }

echo "OK: bucket $BUCKET privat, user aplikasi berpolicy $POLICY"
