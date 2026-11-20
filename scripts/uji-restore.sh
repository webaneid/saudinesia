#!/usr/bin/env bash
# Uji pulih backup produksi — TIDAK menyentuh database produksi (docs/deployment.md "Backup"). Jalankan di server, mis. sebulan sekali:
#   bash /opt/app/scripts/uji-restore.sh
#   1. unduh dump TERBARU dari Google Drive (lewat dekripsi — membuktikan kata sandi crypt benar);
#   2. pulihkan ke database sementara `saudinesia_uji_restore` di kontainer postgres, bandingkan jumlah migrasi & tabel dengan produksi;
#   3. `rclone cryptcheck` bucket MinIO vs salinan di Drive (checksum tiap berkas, tanpa mengunduh semuanya);
#   4. hapus database sementara dan berkas unduhan.
# Pemulihan SUNGGUHAN (menimpa produksi) sengaja tidak diotomasi — langkahnya di docs/deployment.md. Diuji scripts/test-backup-produksi.ts.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/app}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
DRIVE_PATH="${DRIVE_PATH:-gdrive:backup-app/saudinesia}"
RCLONE_IMAGE="rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5" # dipin digest (multi-arsitektur)
UJI_DB=saudinesia_uji_restore
cd "$APP_DIR"

ambil() { { grep -hE "^$1=" .env.production .env.backup 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d '"'; } # tak ada = kosong (bukan galat)
export RCLONE_CONFIG_MINIO_ACCESS_KEY_ID RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY RCLONE_CONFIG_CRYPT_PASSWORD RCLONE_CONFIG_CRYPT_PASSWORD2
RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="$(ambil MINIO_ACCESS_KEY)"
RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="$(ambil MINIO_SECRET_KEY)"
RCLONE_CONFIG_CRYPT_PASSWORD="$(ambil BACKUP_CRYPT_PASSWORD)"
RCLONE_CONFIG_CRYPT_PASSWORD2="$(ambil BACKUP_CRYPT_PASSWORD2)"
BUCKET="$(ambil MINIO_BUCKET)"; BUCKET="${BUCKET:-saudinesia-docs}"
[ -n "$RCLONE_CONFIG_CRYPT_PASSWORD" ] || { echo "GAGAL: BACKUP_CRYPT_PASSWORD kosong — jalankan scripts/setup-backup.sh"; exit 1; }
[[ "$BUCKET" =~ ^[a-z0-9.-]+$ ]] || { echo "MINIO_BUCKET tidak sah"; exit 1; }

C() { docker compose -f docker-compose.prod.yml --env-file .env.production --env-file .env.deploy "$@"; }
NET="$(basename "$APP_DIR")_internal"
rclone() {
  docker run --rm --user "$(id -u):$(id -g)" --network "$NET" \
    -v "$HOME/.config/rclone:/config/rclone" -v "$BACKUP_DIR:/backup" \
    -e RCLONE_CONFIG_MINIO_TYPE=s3 -e RCLONE_CONFIG_MINIO_PROVIDER=Minio -e RCLONE_CONFIG_MINIO_ENDPOINT=http://minio:9000 \
    -e RCLONE_CONFIG_MINIO_REGION=ap-southeast-1 -e RCLONE_CONFIG_MINIO_ACCESS_KEY_ID -e RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_CRYPT_TYPE=crypt -e "RCLONE_CONFIG_CRYPT_REMOTE=$DRIVE_PATH" \
    -e RCLONE_CONFIG_CRYPT_PASSWORD -e RCLONE_CONFIG_CRYPT_PASSWORD2 \
    "$RCLONE_IMAGE" "$@"
}
sql() { C exec -T postgres psql -U saudinesia -d "$1" -Atqc "$2"; }

UNDUH="$BACKUP_DIR/uji-restore"
bersih() { sql postgres "DROP DATABASE IF EXISTS $UJI_DB" >/dev/null 2>&1 || true; rm -rf "$UNDUH"; }
trap bersih EXIT

FILE="$({ rclone lsf --files-only --include 'db-*.dump' crypt:db/ 2>/dev/null || true; } | sort | tail -1)"
[[ "$FILE" =~ ^db-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || { echo "GAGAL: tidak ada dump di $DRIVE_PATH/db"; exit 1; }
echo "Dump terbaru di Drive: $FILE"
rm -rf "$UNDUH" && mkdir -p "$UNDUH"
rclone copy "crypt:db/$FILE" /backup/uji-restore/
[ -s "$UNDUH/$FILE" ] || { echo "GAGAL: unduhan kosong"; exit 1; }

sql postgres "DROP DATABASE IF EXISTS $UJI_DB" >/dev/null || exit 1
sql postgres "CREATE DATABASE $UJI_DB" >/dev/null || exit 1
C exec -T postgres pg_restore -U saudinesia -d "$UJI_DB" --no-owner --exit-on-error < "$UNDUH/$FILE" || exit 1

Q_MIG="SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
Q_TAB="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
M1="$(sql saudinesia "$Q_MIG")"; M2="$(sql "$UJI_DB" "$Q_MIG")"
T1="$(sql saudinesia "$Q_TAB")"; T2="$(sql "$UJI_DB" "$Q_TAB")"
U2="$(sql "$UJI_DB" "SELECT count(*) FROM users")"
echo "Migrasi: produksi $M1, hasil pulih $M2 · Tabel: produksi $T1, hasil pulih $T2 · Akun di backup: $U2"
[ "$M1" = "$M2" ] && [ "$T1" = "$T2" ] || echo "PERINGATAN: berbeda dari produksi — wajar hanya bila ada deploy bermigrasi sesudah backup terakhir."

echo "Memeriksa dokumen MinIO vs salinan terenkripsi di Drive..."
# --one-way: setiap berkas di MinIO harus ada & identik di Drive. Berkas yang diunggah SESUDAH backup terakhir tercatat beda — wajar;
# jalankan scripts/backup-produksi.sh dulu bila ingin hasil bersih.
rclone cryptcheck "minio:$BUCKET" crypt:minio/current --one-way || { echo "GAGAL/BEDA: dokumen MinIO tak cocok dengan Drive (lihat di atas; berkas baru sesudah backup terakhir = wajar)"; exit 1; }
echo "OK: backup bisa dipulihkan ($FILE)."
