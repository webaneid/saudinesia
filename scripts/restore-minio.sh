#!/bin/bash
# Restore dokumen jamaah MinIO dari backup — OPERASI DESTRUKTIF.
# Pasangan MinIO dari restore-db.sh (docs/RETROFIT-GAPS.md #1, 2026-09-15).
# Tidak pernah dijalankan otomatis/cron — selalu manual, dengan konfirmasi.
#
# Pemakaian:
#   ./restore-minio.sh                    # pakai folder bertanggal TERBARU di remote
#   ./restore-minio.sh 2026-09-14_0300     # pilih folder spesifik (nama TIMESTAMP dari backup-minio.sh)

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-saudinesia}"
MINIO_REMOTE="${MINIO_REMOTE:-miniolocal}"
MINIO_BUCKET="${MINIO_BUCKET:-saudinesia-docs}"
REMOTE="${RCLONE_REMOTE:-gdrive:backup-app/${PROJECT_NAME}}"

if [[ -n "${1:-}" ]]; then
  FOLDER="${1}"
else
  echo "Mencari folder backup terbaru di ${REMOTE}/minio/..."
  FOLDER=$(rclone lsf "${REMOTE}/minio/" --dirs-only | sort | tail -1)
fi

if [[ -z "${FOLDER:-}" ]]; then
  echo "Tidak ada folder backup ditemukan di ${REMOTE}/minio/." >&2
  exit 1
fi

SOURCE="${REMOTE}/minio/${FOLDER}"

echo "=========================================="
echo "  PERINGATAN: Ini akan MENIMPA seluruh isi"
echo "  bucket \"${MINIO_BUCKET}\" (${MINIO_REMOTE})"
echo "  dengan isi dari: ${SOURCE}"
echo "  File yang tidak ada di backup akan DIHAPUS dari bucket."
echo "=========================================="
read -r -p "Ketik ulang nama bucket (\"${MINIO_BUCKET}\") untuk konfirmasi: " CONFIRM
if [[ "$CONFIRM" != "$MINIO_BUCKET" ]]; then
  echo "Konfirmasi tidak cocok. Restore dibatalkan."
  exit 1
fi

echo "[$(date)] Restore dari ${SOURCE}..."
rclone sync "${SOURCE}" "${MINIO_REMOTE}:${MINIO_BUCKET}"
echo "[$(date)] Restore selesai."
