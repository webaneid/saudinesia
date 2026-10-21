#!/bin/bash
# Backup harian dokumen jamaah di MinIO (bucket `saudinesia-docs`, paspor/
# KTP/KK) ke Google Drive via rclone — pasangan MinIO dari backup-db.sh.
# Ditambahkan 2026-09-15 (docs/RETROFIT-GAPS.md #1) — sebelumnya HANYA
# Postgres yang punya backup, dokumen di MinIO tidak sama sekali.
#
# Beda dari backup-db.sh: tiap run dibuat FOLDER BERTANGGAL baru di remote
# (bukan overwrite satu file), supaya restore bisa pilih titik waktu
# tertentu — cocok untuk banyak file kecil (scan dokumen), bukan satu dump.
#
# Dijadwalkan lewat crontab OS-level di VPS (bukan lib/cron/ aplikasi),
# sama alasannya seperti backup-db.sh — backup tetap jalan walau
# aplikasi/container crash.
#
# Setup SEKALI sebelum dipakai:
#   1. Remote rclone baru untuk MinIO (S3-compatible, TIDAK butuh OAuth
#      browser — beda dari remote `gdrive`, bisa langsung di VPS headless):
#        rclone config create miniolocal s3 \
#          provider=Minio \
#          endpoint="http://${MINIO_ENDPOINT}:${MINIO_PORT}" \
#          access_key_id="<MINIO_ACCESS_KEY dari .env>" \
#          secret_access_key="<MINIO_SECRET_KEY dari .env>"
#   2. Remote `gdrive` untuk tujuan backup harus sudah ada (dikonfigurasi
#      sekali di komputer lokal lalu di-scp ke VPS — lihat backup-db.sh).
#   3. Jadwalkan cron (jam 3 pagi, setelah backup DB jam 2 pagi):
#        crontab -e
#        0 3 * * * /path/ke/scripts/backup-minio.sh >> /path/ke/backup-minio.log 2>&1

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-saudinesia}"
MINIO_REMOTE="${MINIO_REMOTE:-miniolocal}"
MINIO_BUCKET="${MINIO_BUCKET:-saudinesia-docs}"
REMOTE="${RCLONE_REMOTE:-gdrive:backup-app/${PROJECT_NAME}}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

TIMESTAMP=$(date +%Y-%m-%d_%H%M)
DEST="${REMOTE}/minio/${TIMESTAMP}"

echo "[$(date)] Mulai backup MinIO bucket ${MINIO_BUCKET} -> ${DEST}"
rclone sync "${MINIO_REMOTE}:${MINIO_BUCKET}" "${DEST}"
echo "[$(date)] Sync selesai ke ${DEST}"

echo "[$(date)] Bersihkan folder backup remote yang lebih tua dari ${RETENTION_DAYS} hari"
CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-"${RETENTION_DAYS}"d +%Y-%m-%d)
rclone lsf "${REMOTE}/minio/" --dirs-only | while read -r FOLDER; do
  FOLDER_DATE="${FOLDER%%_*}"
  if [[ "$FOLDER_DATE" < "$CUTOFF" ]]; then
    echo "[$(date)] Hapus folder lama: ${FOLDER}"
    rclone purge "${REMOTE}/minio/${FOLDER}" || true
  fi
done

echo "[$(date)] Backup MinIO selesai: ${TIMESTAMP}"
