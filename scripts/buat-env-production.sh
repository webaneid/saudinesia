#!/usr/bin/env bash
# Jalankan DI SERVER BARU, sekali:  bash scripts/buat-env-production.sh <APP_DOMAIN> <FILES_DOMAIN> [DIR]
#   mis. bash scripts/buat-env-production.sh saudinesia.com berkas.saudinesia.com /opt/app
# Membuat DIR/.env.production dari .env.production.example dengan rahasia acak (password Postgres, kunci MinIO,
# JWT_SECRET). Rahasia TIDAK ditampilkan. Nilai yang harus diisi manual (WhatsApp, Resend) dibiarkan kosong dan
# dilaporkan di akhir. Tidak pernah menimpa .env.production yang sudah ada.
# Pola mengikuti smart-ai (scripts/buat-env-production.sh).
set -euo pipefail

APP_DOMAIN="${1:?pemakaian: $0 <APP_DOMAIN> <FILES_DOMAIN> [DIR]}"
FILES_DOMAIN="${2:?pemakaian: $0 <APP_DOMAIN> <FILES_DOMAIN> [DIR]}"
DIR="${3:-/opt/app}"

# Hanya karakter domain yang sah — nilai ini masuk ke sed & ke file env.
domain_ok() { [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; }
domain_ok "$APP_DOMAIN"   || { echo "APP_DOMAIN tidak valid: $APP_DOMAIN"; exit 1; }
domain_ok "$FILES_DOMAIN" || { echo "FILES_DOMAIN tidak valid: $FILES_DOMAIN"; exit 1; }

cd "$DIR"
[ -f .env.production.example ] || { echo "GAGAL: $DIR/.env.production.example tidak ada"; exit 1; }
[ -f .env.production ] && { echo ".env.production sudah ada — tidak ditimpa."; exit 1; }

acak() { openssl rand -hex "$1"; }
PW_DB="$(acak 24)"
PW_REDIS="$(acak 24)"

# umask di subshell supaya file tidak sempat terbaca user lain sebelum chmod.
( umask 077
  sed \
    -e "s#^APP_DOMAIN=\$#APP_DOMAIN=$APP_DOMAIN#" \
    -e "s#^FILES_DOMAIN=\$#FILES_DOMAIN=$FILES_DOMAIN#" \
    -e "s#^APP_URL=\$#APP_URL=https://$APP_DOMAIN#" \
    -e "s#^MINIO_PUBLIC_URL=\$#MINIO_PUBLIC_URL=https://$FILES_DOMAIN#" \
    -e "s#^POSTGRES_PASSWORD=\$#POSTGRES_PASSWORD=$PW_DB#" \
    -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://saudinesia:$PW_DB@postgres:5432/saudinesia#" \
    -e "s#^REDIS_PASSWORD=\$#REDIS_PASSWORD=$PW_REDIS#" \
    -e "s#^REDIS_URL=.*#REDIS_URL=redis://:$PW_REDIS@redis:6379#" \
    -e "s#^MINIO_ACCESS_KEY=\$#MINIO_ACCESS_KEY=saudinesia$(acak 4)#" \
    -e "s#^MINIO_SECRET_KEY=\$#MINIO_SECRET_KEY=$(acak 24)#" \
    -e "s#^JWT_SECRET=\$#JWT_SECRET=$(acak 32)#" \
    -e "s#^WHATSAPP_WEBHOOK_SECRET=\$#WHATSAPP_WEBHOOK_SECRET=$(acak 32)#" \
    .env.production.example > .env.production )
chmod 600 .env.production

echo "OK: $DIR/.env.production dibuat (hanya bisa dibaca user ini)."
KOSONG="$(grep -E '^[A-Z_]+=$' .env.production | cut -d= -f1 | tr '\n' ' ')"
[ -z "$KOSONG" ] || echo "Isi MANUAL (masih kosong): $KOSONG"
echo "Simpan cadangan JWT_SECRET & POSTGRES_PASSWORD di password manager."
echo "WHATSAPP_WEBHOOK_SECRET dibuat otomatis — salin NILAI YANG SAMA ke GOWA (WHATSAPP_WEBHOOK_SECRET) dan atur WHATSAPP_WEBHOOK=https://$APP_DOMAIN/api/v1/webhooks/whatsapp, WHATSAPP_WEBHOOK_EVENTS=message."
