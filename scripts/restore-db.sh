#!/bin/bash
# Restore database PostgreSQL dari backup — OPERASI DESTRUKTIF.
# Diadopsi dari template master-typescript (2026-09-10), default di-set ke
# nilai project Saudinesia — pakai variabel yang sama seperti backup-db.sh.
# Tidak pernah dijalankan otomatis/cron — selalu manual, dengan konfirmasi.
#
# Pemakaian:
#   ./restore-db.sh                              # pakai backup lokal TERBARU
#   ./restore-db.sh saudinesia_2026-09-10_0200.sql.gz   # pilih file spesifik
#   ./restore-db.sh --from-remote                # download dulu dari gdrive, lalu restore terbaru

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-saudinesia}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/saudinesia/backups}"
REMOTE="${RCLONE_REMOTE:-gdrive:backup-app/${PROJECT_NAME}}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-saudinesia}"
DB_USER="${DB_USER:-saudinesia}"

if [[ "${1:-}" == "--from-remote" ]]; then
  echo "Mengambil backup terbaru dari ${REMOTE}..."
  mkdir -p "$BACKUP_DIR"
  LATEST_REMOTE=$(rclone lsf "${REMOTE}/" --files-only | sort | tail -1)
  if [[ -z "$LATEST_REMOTE" ]]; then
    echo "Tidak ada backup di remote." >&2
    exit 1
  fi
  rclone copy "${REMOTE}/${LATEST_REMOTE}" "$BACKUP_DIR/"
  TARGET_FILE="${BACKUP_DIR}/${LATEST_REMOTE}"
elif [[ -n "${1:-}" ]]; then
  TARGET_FILE="${BACKUP_DIR}/${1}"
else
  TARGET_FILE=$(ls -t "${BACKUP_DIR}/${DB_NAME}"_*.sql.gz 2>/dev/null | head -1)
fi

if [[ -z "${TARGET_FILE:-}" || ! -f "$TARGET_FILE" ]]; then
  echo "File backup tidak ditemukan: ${TARGET_FILE:-<kosong>}" >&2
  echo "Cek isi ${BACKUP_DIR} atau jalankan dengan --from-remote" >&2
  exit 1
fi

echo "=========================================="
echo "  PERINGATAN: Ini akan MENIMPA database"
echo "  \"${DB_NAME}\" di ${DB_HOST}:${DB_PORT}"
echo "  dengan isi dari: ${TARGET_FILE}"
echo "=========================================="
read -r -p "Ketik ulang nama database (\"${DB_NAME}\") untuk konfirmasi: " CONFIRM
if [[ "$CONFIRM" != "$DB_NAME" ]]; then
  echo "Konfirmasi tidak cocok. Restore dibatalkan."
  exit 1
fi

echo "[$(date)] Restore dari ${TARGET_FILE}..."
gunzip -c "$TARGET_FILE" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
echo "[$(date)] Restore selesai."
