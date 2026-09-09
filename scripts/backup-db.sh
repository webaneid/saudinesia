#!/bin/bash
# Backup harian database PostgreSQL ke Google Drive (via rclone).
# Diadopsi dari template master-typescript (2026-09-10), default di-set ke
# nilai project Saudinesia (lihat DATABASE_URL di .env.example) — override
# lewat env var kalau perlu, jangan edit default di sini langsung (supaya
# gampang di-diff/update kalau ada perbaikan script di masa depan).
#
# Dijadwalkan lewat crontab OS-level di VPS, BUKAN via cron job aplikasi
# (`lib/cron/`) — supaya backup tetap jalan walau aplikasi/container crash.
#
# Setup SEKALI sebelum dipakai:
#   1. rclone remote dikonfigurasi di KOMPUTER LOKAL (butuh OAuth browser,
#      tidak bisa langsung di VPS headless), lalu file config-nya di-copy
#      ke VPS: scp ~/.config/rclone/rclone.conf user@host:~/.config/rclone/
#   2. Password DB disimpan di ~/.pgpass di VPS (BUKAN di script ini):
#        echo "host:port:dbname:user:<password>" > ~/.pgpass && chmod 600 ~/.pgpass
#   3. Jadwalkan cron (jam 2 pagi tiap hari):
#        crontab -e
#        0 2 * * * /path/ke/scripts/backup-db.sh >> /path/ke/backup.log 2>&1
#
# CATATAN: script ini HANYA backup Postgres. Dokumen jamaah (paspor/KTP/KK)
# disimpan di MinIO (bucket `saudinesia-docs`), BELUM ada backup untuk itu —
# lihat docs/RETROFIT-GAPS.md #1.

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-saudinesia}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/saudinesia/backups}"
REMOTE="${RCLONE_REMOTE:-gdrive:backup-app/${PROJECT_NAME}}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-saudinesia}"
DB_USER="${DB_USER:-saudinesia}"

TIMESTAMP=$(date +%Y-%m-%d_%H%M)
FILENAME="${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Mulai backup database ${DB_NAME} -> ${BACKUP_DIR}/${FILENAME}"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" | gzip > "${BACKUP_DIR}/${FILENAME}"
echo "[$(date)] Dump lokal selesai ($(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1))"

echo "[$(date)] Upload ke ${REMOTE}"
rclone copy "${BACKUP_DIR}/${FILENAME}" "${REMOTE}/"

echo "[$(date)] Bersihkan backup lokal & remote yang lebih tua dari ${RETENTION_DAYS} hari"
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
rclone delete --min-age "${RETENTION_DAYS}d" "${REMOTE}/" || true

echo "[$(date)] Backup selesai: ${FILENAME}"
