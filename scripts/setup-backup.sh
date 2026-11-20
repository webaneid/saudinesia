#!/usr/bin/env bash
# Penyiapan SEKALI backup produksi (docs/deployment.md "Backup"). Dijalankan DI SERVER sesudah rclone.conf dari Mac disalin:
#   (Mac)    ssh saudinesia 'mkdir -p ~/.config/rclone && chmod 700 ~/.config/rclone'
#            scp ~/.config/rclone/rclone.conf saudinesia:~/.config/rclone/rclone.conf
#   (server) ssh -t saudinesia 'bash /opt/app/scripts/setup-backup.sh'
# Yang dilakukan:
#   1. memeriksa remote "gdrive" ada (pola facport/smart-ai) dan izin rclone.conf 600;
#   2. membuat DUA kata sandi enkripsi acak (rclone crypt), menulis bentuk tersamarnya ke .env.backup (600; BUKAN .env.production —
#      berkas itu dimuat kontainer web) — kata sandi ASLI dicetak SEKALI untuk disimpan di password manager;
#   3. uji tulis–baca–hapus lewat lapisan enkripsi ke gdrive:backup-app/saudinesia.
# Tidak pernah menimpa kata sandi yang sudah ada (mengganti = backup lama tak terbaca). Diuji scripts/test-backup-produksi.ts.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/app}"
DRIVE_PATH="${DRIVE_PATH:-gdrive:backup-app/saudinesia}"
RCLONE_IMAGE="rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5" # dipin digest (multi-arsitektur)
CONF="$HOME/.config/rclone/rclone.conf"
cd "$APP_DIR"

[ -f "$CONF" ] || { echo "GAGAL: $CONF belum ada. Salin dari Mac: scp ~/.config/rclone/rclone.conf saudinesia:~/.config/rclone/rclone.conf"; exit 1; }
grep -qE '^\[gdrive\]$' "$CONF" || { echo "GAGAL: remote [gdrive] tidak ada di $CONF"; exit 1; }
chmod 600 "$CONF"
[ ! -f .env.backup ] || [ "$(stat -c '%a' .env.backup 2>/dev/null || stat -f '%Lp' .env.backup)" = "600" ] || { echo "GAGAL: izin .env.backup harus 600"; exit 1; }

rc() { docker run --rm -i --user "$(id -u):$(id -g)" -v "$HOME/.config/rclone:/config/rclone" "$RCLONE_IMAGE" "$@"; }

if [ -f .env.backup ] && grep -qE '^BACKUP_CRYPT_PASSWORD=.+' .env.backup; then
  echo "BACKUP_CRYPT_PASSWORD sudah ada — tidak ditimpa (mengganti = backup lama tak bisa dibuka). Lanjut uji koneksi."
  BARU=0
else
  PW1="$(openssl rand -hex 32)"
  PW2="$(openssl rand -hex 32)"
  # `rclone obscure -` membaca dari stdin — kata sandi tidak lewat argumen.
  OB1="$(printf '%s\n' "$PW1" | rc obscure -)"
  OB2="$(printf '%s\n' "$PW2" | rc obscure -)"
  [ -n "$OB1" ] && [ -n "$OB2" ] || { echo "GAGAL: rclone obscure"; exit 1; }
  ( umask 077
    { [ ! -f .env.backup ] || grep -vE '^BACKUP_CRYPT_PASSWORD2?=' .env.backup || true
      printf 'BACKUP_CRYPT_PASSWORD=%s\nBACKUP_CRYPT_PASSWORD2=%s\n' "$OB1" "$OB2"
      grep -qE '^BACKUP_PING_URL=' .env.backup 2>/dev/null || printf '# healthchecks.io (opsional, disarankan): URL ping cek harian, mis. https://hc-ping.com/<uuid>\nBACKUP_PING_URL=\n'
    } > .env.backup.tmp )
  mv .env.backup.tmp .env.backup && chmod 600 .env.backup
  BARU=1
fi

export RCLONE_CONFIG_CRYPT_PASSWORD RCLONE_CONFIG_CRYPT_PASSWORD2
RCLONE_CONFIG_CRYPT_PASSWORD="$(grep -E '^BACKUP_CRYPT_PASSWORD=' .env.backup | head -1 | cut -d= -f2-)"
RCLONE_CONFIG_CRYPT_PASSWORD2="$(grep -E '^BACKUP_CRYPT_PASSWORD2=' .env.backup | head -1 | cut -d= -f2-)"
crypt() {
  docker run --rm -i --user "$(id -u):$(id -g)" -v "$HOME/.config/rclone:/config/rclone" \
    -e RCLONE_CONFIG_CRYPT_TYPE=crypt -e "RCLONE_CONFIG_CRYPT_REMOTE=$DRIVE_PATH" \
    -e RCLONE_CONFIG_CRYPT_PASSWORD -e RCLONE_CONFIG_CRYPT_PASSWORD2 "$RCLONE_IMAGE" "$@"
}

UJI="uji-koneksi-$(date -u +%Y%m%dT%H%M%SZ).txt"
printf 'ok\n' | crypt rcat "crypt:$UJI"
[ "$(crypt cat "crypt:$UJI")" = "ok" ] || { echo "GAGAL: uji baca dari Google Drive"; exit 1; }
crypt deletefile "crypt:$UJI"
echo "OK: Google Drive $DRIVE_PATH bisa ditulis & dibaca lewat enkripsi."

if [ "$BARU" = 1 ]; then
  cat <<EOF

SIMPAN DUA KATA SANDI INI DI PASSWORD MANAGER SEKARANG (catatan "Saudinesia backup rclone crypt").
Tanpa keduanya backup TIDAK BISA dibuka bila server hilang (di server hanya tersimpan tersamar di .env.backup):
  password  = $PW1
  password2 = $PW2
Sesudah disimpan, bersihkan layar: clear
EOF
fi
