#!/usr/bin/env bash
# Melengkapi .env.production yang SUDAH ADA dengan variabel baru yang nilainya bisa dibuat mesin (rahasia acak / nilai tetap) —
# untuk server yang .env.production-nya dibuat sebelum variabel itu ada. Dipanggil otomatis scripts/deploy-server.sh sebelum `pull`
# (compose menolak jalan bila variabel wajib kosong); aman dijalankan manual:  bash /opt/app/scripts/lengkapi-env-production.sh
# Aturan: hanya MENAMBAH baris yang tidak ada atau mengisi baris yang KOSONG; nilai yang sudah terisi tidak pernah diubah. Rahasia tidak
# dicetak — hanya nama variabel yang ditambahkan. Diuji scripts/test-lengkapi-env.ts.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/app}"
cd "$APP_DIR"
F=.env.production
[ -f "$F" ] || { echo "GAGAL: $APP_DIR/$F belum ada — buat dulu dengan scripts/buat-env-production.sh"; exit 1; }
[ "$(stat -c '%a' "$F" 2>/dev/null || stat -f '%Lp' "$F")" = "600" ] || { echo "GAGAL: izin $F harus 600"; exit 1; }

acak() { openssl rand -hex "$1"; }
nilai() { { grep -E "^$1=" "$F" || true; } | head -1 | cut -d= -f2-; }
ada() { grep -qE "^$1=" "$F"; }

DITAMBAH=()
TMP="$F.lengkapi.tmp"
cp "$F" "$TMP"
# isi NAMA NILAI: baris kosong `NAMA=` diisi; baris tidak ada → ditambah di akhir.
isi() {
  local name="$1" value="$2"
  if ada "$name"; then
    [ -z "$(nilai "$name")" ] || return 0
    # Nilai = hex/teks tetap tanpa karakter khusus sed (#, &, \) — dijamin pemanggil.
    sed -i.bak -e "s#^$name=\$#$name=$value#" "$TMP" && rm -f "$TMP.bak"
  else
    printf '%s=%s\n' "$name" "$value" >> "$TMP"
  fi
  DITAMBAH+=("$name")
}

# WhatsApp self-host (docs/rencana-gowa-self-host.md). URL lama selain gateway internal (mis. Sumopod) TIDAK ditimpa — dilaporkan.
URL="$(nilai WA_GATEWAY_URL)"
if [ -n "$URL" ] && [ "$URL" != "http://gowa:3000" ]; then
  echo "PERINGATAN: WA_GATEWAY_URL berisi gateway lain — tidak diubah. Untuk memakai GOWA di server ini, ganti menjadi http://gowa:3000"
fi
isi WA_GATEWAY_URL "http://gowa:3000"
isi WA_GATEWAY_USER "saudinesia"
isi WA_GATEWAY_PASSWORD "$(acak 24)"
isi WHATSAPP_WEBHOOK_SECRET "$(acak 32)"
# Token Bearer lama (GOWA v9 memakai Basic auth) — dibuang hanya bila kosong.
if ada WA_GATEWAY_TOKEN && [ -z "$(nilai WA_GATEWAY_TOKEN)" ]; then
  grep -vE '^WA_GATEWAY_TOKEN=$' "$TMP" > "$TMP.2" && mv "$TMP.2" "$TMP"
  DITAMBAH+=("(hapus WA_GATEWAY_TOKEN kosong)")
fi

if [ "${#DITAMBAH[@]}" -eq 0 ]; then
  rm -f "$TMP"
  echo "lengkapi-env: tidak ada yang perlu ditambah."
  exit 0
fi
chmod 600 "$TMP"
mv "$TMP" "$F"
echo "lengkapi-env: ${DITAMBAH[*]}"
