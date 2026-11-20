#!/usr/bin/env bash
# Backup harian Saudinesia production → Google Drive TERENKRIPSI (docs/deployment.md "Backup"). Pola smart-ai
# (scripts/backup-produksi.sh) + facport: folder `gdrive:backup-app/<project>`, rclone lewat image Docker (tak dipasang di host), config
# Google Drive = ~/.config/rclone/rclone.conf (remote "gdrive", dibuat di Mac lalu disalin), dead-man's switch healthchecks.io.
# Tambahan Saudinesia: lapisan rclone crypt (bucket berisi scan paspor/KTP jamaah — akun Google bocor ≠ dokumen bocor), kata sandinya di
# .env.backup (BACKUP_CRYPT_PASSWORD/2 + BACKUP_PING_URL, dibuat scripts/setup-backup.sh; berkas TERPISAH — tak dimuat kontainer mana pun,
# web tak memegang kunci backup). Rahasia ke kontainer rclone lewat `-e NAMA` (tanpa nilai) —
# tak tampil di daftar proses host.
#   1. Postgres: pg_dump (format custom) DI DALAM kontainer → backups/daily/, dibuktikan terbaca (pg_restore --list) → <crypt>/db/
#   2. MinIO: rclone sync bucket (user aplikasi, jaringan internal) → <crypt>/minio/current; versi lama/terhapus → <crypt>/minio/history/<waktu>
#   3. Retensi Drive BACKUP_KEEP_DAYS (30) hari, lokal BACKUP_LOCAL_KEEP (7) dump.
# Disalin otomatis tiap deploy ke /opt/app/scripts/. Jadwal (crontab -e):
#   0 19 * * * /opt/app/scripts/backup-produksi.sh >> /opt/app/backups/backup.log 2>&1   (server UTC: 19.00 UTC = 02.00 WIB)
# Uji pulih: scripts/uji-restore.sh. Diuji scripts/test-backup-produksi.ts.
set -euo pipefail
umask 077         # semua yang dibuat skrip ini (dump, log status) hanya untuk pemilik

APP_DIR="${APP_DIR:-/opt/app}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
DRIVE_PATH="${DRIVE_PATH:-gdrive:backup-app/saudinesia}" # pola facport/smart-ai (backup-app/<project>)
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
LOCAL_KEEP="${BACKUP_LOCAL_KEEP:-7}"
RCLONE_IMAGE="rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5" # dipin digest (multi-arsitektur)
[[ "$KEEP_DAYS" =~ ^[1-9][0-9]*$ && "$LOCAL_KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_KEEP_DAYS/BACKUP_LOCAL_KEEP harus angka ≥ 1"; exit 1; }
[[ "$DRIVE_PATH" =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9/._-]+$ ]] || { echo "DRIVE_PATH tidak sah"; exit 1; }

cd "$APP_DIR"
# Ambil variabel yang dipakai saja (pelajaran facport: JANGAN `source` .env — satu baris janggal mematikan skrip).
ambil() { { grep -hE "^$1=" .env.production .env.backup 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d '"'; } # tak ada = kosong (bukan galat)
PING_URL="$(ambil BACKUP_PING_URL)"
ping() { [ -z "$PING_URL" ] || curl -fsS -m 10 --retry 3 "$PING_URL$1" > /dev/null || true; }
LANGKAH="persiapan"
# Trap EXIT + penanda BERHASIL (bukan trap ERR / `$?`): pada sebagian versi bash (3.2) ERR tak terpicu dan `$?` di trap = 0 untuk galat
# di dalam fungsi — penanda yang hanya diset di baris terakhir tak bisa salah.
BERHASIL=0
selesai() { [ "$BERHASIL" = 1 ] && return 0; echo "[$(date -u +%FT%TZ)] BACKUP GAGAL pada langkah: $LANGKAH"; ping /fail; exit 1; }
trap selesai EXIT

mkdir -p "$BACKUP_DIR/daily" && chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/daily"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "[$(date -u +%FT%TZ)] backup lain masih berjalan — dilewati"; BERHASIL=1; exit 0; }
ping /start

LANGKAH="konfigurasi"
[ -f .env.production ] && [ -f .env.deploy ] && [ -f .env.backup ] && [ -f "$HOME/.config/rclone/rclone.conf" ]
export RCLONE_CONFIG_MINIO_ACCESS_KEY_ID RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY RCLONE_CONFIG_CRYPT_PASSWORD RCLONE_CONFIG_CRYPT_PASSWORD2
RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="$(ambil MINIO_ACCESS_KEY)"
RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="$(ambil MINIO_SECRET_KEY)"
RCLONE_CONFIG_CRYPT_PASSWORD="$(ambil BACKUP_CRYPT_PASSWORD)"
RCLONE_CONFIG_CRYPT_PASSWORD2="$(ambil BACKUP_CRYPT_PASSWORD2)"
BUCKET="$(ambil MINIO_BUCKET)"; BUCKET="${BUCKET:-saudinesia-docs}"
[ -n "$RCLONE_CONFIG_CRYPT_PASSWORD" ] && [ -n "$RCLONE_CONFIG_CRYPT_PASSWORD2" ] || { LANGKAH="konfigurasi (BACKUP_CRYPT_PASSWORD kosong — jalankan scripts/setup-backup.sh)"; false; }
[ -n "$RCLONE_CONFIG_MINIO_ACCESS_KEY_ID" ] && [[ "$BUCKET" =~ ^[a-z0-9.-]+$ ]]

C() { docker compose -f docker-compose.prod.yml --env-file .env.production --env-file .env.deploy "$@"; }
# Jaringan internal compose (project "app" = nama folder /opt/app) — agar rclone menjangkau minio:9000.
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

TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="db-$TS.dump"
LANGKAH="dump database"
echo "[$(date -u +%FT%TZ)] Dump database → $FILE"
# `|| exit 1` eksplisit: di bash 3.2 fungsi ber-redirect yang gagal di bawah set -e keluar TANPA menjalankan trap EXIT.
C exec -T postgres pg_dump -U saudinesia -d saudinesia --format=custom > "$BACKUP_DIR/daily/$FILE" || exit 1
[ -s "$BACKUP_DIR/daily/$FILE" ]
LANGKAH="verifikasi dump"
C exec -T postgres pg_restore --list < "$BACKUP_DIR/daily/$FILE" > /dev/null || exit 1 # dump rusak = backup tidak berguna
echo "[$(date -u +%FT%TZ)] Dump selesai ($(du -h "$BACKUP_DIR/daily/$FILE" | cut -f1)), unggah ke $DRIVE_PATH/db (terenkripsi)"
LANGKAH="unggah database"
rclone copy "/backup/daily/$FILE" crypt:db/

LANGKAH="sinkron MinIO"
echo "[$(date -u +%FT%TZ)] Sinkron berkas MinIO → $DRIVE_PATH/minio (terenkripsi)"
rclone sync "minio:$BUCKET" crypt:minio/current --backup-dir "crypt:minio/history/$TS"

LANGKAH="retensi"
echo "[$(date -u +%FT%TZ)] Hapus cadangan lebih tua dari $KEEP_DAYS hari (Drive) dan sisakan $LOCAL_KEEP dump lokal"
rclone delete --min-age "${KEEP_DAYS}d" crypt:db/
# Riwayat MinIO dipangkas menurut NAMA folder (waktu backup), bukan modtime: berkas yang dipindah ke riwayat membawa modtime aslinya.
CUTOFF="$(date -u -d "-$KEEP_DAYS days" +%Y%m%d 2>/dev/null || date -u -v-"$KEEP_DAYS"d +%Y%m%d)"
while IFS= read -r DIR; do
  DIR="${DIR%/}"
  [[ "$DIR" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  if [[ "${DIR:0:8}" < "$CUTOFF" ]]; then echo "  hapus riwayat MinIO $DIR"; rclone purge "crypt:minio/history/$DIR"; fi
done < <(rclone lsf --dirs-only crypt:minio/history/ 2>/dev/null || true)
ls -1t "$BACKUP_DIR"/daily/db-*.dump | tail -n +"$((LOCAL_KEEP + 1))" | xargs -r rm -f

echo "$TS $FILE" > "$BACKUP_DIR/last-success"
echo "[$(date -u +%FT%TZ)] Backup selesai: $TS"
BERHASIL=1
ping ""
