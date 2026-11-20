#!/usr/bin/env bash
# Dijalankan DI SERVER (dipanggil .github/workflows/deploy.yml lewat SSH, atau manual):
#   DEPLOY_REPO=webaneid/saudinesia DEPLOY_TAG=sha-1a2b3c4d5e6f bash /opt/app/scripts/deploy-server.sh
# GHCR_USER/GHCR_TOKEN opsional (workflow mengirim token job; manual = sudah `docker login ghcr.io` sendiri).
# Urutan aman: tarik image versi baru DULU (gagal = tidak ada yang berubah) → cadangan DB pra-deploy (migrasi hanya maju) →
# ganti versi → up (migrate jalan sebelum web) → reload Caddy → cek kesehatan. Gagal = log + petunjuk rollback; versi lama TIDAK
# dipulihkan otomatis (migrasi mungkin sudah jalan). Tidak pernah mencetak rahasia. Dijaga scripts/test-deploy-workflow.ts.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/app}"
cd "$APP_DIR"

: "${DEPLOY_REPO:?DEPLOY_REPO kosong}"
: "${DEPLOY_TAG:?DEPLOY_TAG kosong}"
[[ "$DEPLOY_REPO" =~ ^[a-z0-9._-]+/[a-z0-9._-]+$ ]] || { echo "DEPLOY_REPO tidak sah"; exit 1; }
[[ "$DEPLOY_TAG" =~ ^sha-[0-9a-f]{12}$ ]] || { echo "DEPLOY_TAG harus sha-<12 hex>"; exit 1; }

if [ ! -f .env.production ]; then
  echo "GAGAL: $APP_DIR/.env.production belum ada. Buat sekali di server:"
  echo "  bash scripts/buat-env-production.sh <APP_DOMAIN> <ADMIN_DOMAIN> <FILES_DOMAIN> $APP_DIR"
  exit 1
fi
[ "$(stat -c '%a' .env.production 2>/dev/null || stat -f '%Lp' .env.production)" = "600" ] || { echo "GAGAL: izin .env.production harus 600 (chmod 600 .env.production)"; exit 1; }

if [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:?GHCR_USER kosong}" --password-stdin >/dev/null
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi

compose() { docker compose -f docker-compose.prod.yml --env-file .env.production --env-file "$1" "${@:2}"; }

# 1. Tarik image versi baru tanpa menyentuh yang sedang berjalan.
printf 'GITHUB_REPO=%s\nIMAGE_TAG=%s\n' "$DEPLOY_REPO" "$DEPLOY_TAG" > .env.deploy.next
compose .env.deploy.next pull --quiet

# 2. Cadangan DB pra-deploy (bila sudah ada database berjalan) — simpan 5 terbaru, hanya bisa dibaca user ini.
if [ -f .env.deploy ] && [ -n "$(compose .env.deploy ps -q postgres 2>/dev/null)" ]; then
  mkdir -p backups && chmod 700 backups
  OUT="backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$DEPLOY_TAG.dump"
  ( umask 077; compose .env.deploy exec -T postgres pg_dump -U saudinesia -d saudinesia --format=custom > "$OUT" )
  [ -s "$OUT" ] || { echo "GAGAL: cadangan pra-deploy kosong — deploy dibatalkan"; rm -f "$OUT"; exit 1; }
  echo "Cadangan pra-deploy: $OUT ($(du -h "$OUT" | cut -f1))"
  ls -1t backups/pre-deploy-*.dump | tail -n +6 | xargs -r rm -f
fi

# 3. Ganti versi; versi sebelumnya disimpan untuk rollback.
[ -f .env.deploy ] && cp .env.deploy .env.deploy.prev
mv .env.deploy.next .env.deploy

gagal() {
  echo "=== DEPLOY GAGAL ($1) — log terakhir ==="
  compose .env.deploy ps || true
  compose .env.deploy logs --tail 60 migrate web || true
  if [ -f .env.deploy.prev ]; then
    echo "Rollback: Actions → Deploy → image_tag = $(sed -n 's/^IMAGE_TAG=//p' .env.deploy.prev)"
    echo "(migrasi DB hanya maju; cadangan pra-deploy ada di $APP_DIR/backups)"
  fi
  exit 1
}

compose .env.deploy up -d --remove-orphans || gagal "compose up / migrate"
# Caddyfile di-bind-mount: perubahan isinya tidak membuat ulang kontainer, jadi dimuat ulang eksplisit.
compose .env.deploy exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || gagal "caddy reload"

# 4. Kesehatan dari dalam jaringan (web + database).
for i in $(seq 1 "${HEALTH_TRIES:-30}"); do
  if compose .env.deploy exec -T web bun -e "fetch('http://localhost:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
    echo "web sehat ($DEPLOY_TAG)"
    docker image prune -f >/dev/null
    compose .env.deploy ps
    exit 0
  fi
  sleep 2
done
gagal "health check"
