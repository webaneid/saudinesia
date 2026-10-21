# syntax=docker/dockerfile:1
#
# Dua image dibangun dari file ini (workflow deploy memakai --target):
#   --target runner   → aplikasi Next.js (standalone). Ini target BAWAAN (stage terakhir).
#   --target migrate  → sekali-jalan `prisma migrate deploy` (CLI Prisma TIDAK ada di image runner).

FROM oven/bun:1-slim AS base
WORKDIR /app
# Prisma butuh openssl & ca-certificates. Image slim tidak membawanya: tanpa ini Prisma salah mendeteksi versi
# libssl saat `prisma generate`, dan binary engine yang dihasilkan tidak cocok dengan runtime.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ── Install dependencies ────────────────────────────────────────
FROM base AS deps
# bun.lock (teks, Bun ≥1.2) — pola lama `bun.lockb*` tidak pernah menyalin lockfile ini sehingga
# `--frozen-lockfile` tidak punya acuan.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* di-INLINE Next.js saat build (di bundle klien DAN server) — mengubahnya di .env.production server
# tidak berpengaruh. Nilai dikirim sebagai --build-arg oleh workflow build (dari GitHub Variables, bukan Secrets:
# semuanya informasi yang memang tampil ke pengguna — nama bisnis, rekening tujuan transfer, dst).
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_MINIO_PUBLIC_URL=""
ARG NEXT_PUBLIC_BUSINESS_NAME=""
ARG NEXT_PUBLIC_BUSINESS_WA=""
ARG NEXT_PUBLIC_BUSINESS_ADDRESS=""
ARG NEXT_PUBLIC_BANK_1_NAME=""
ARG NEXT_PUBLIC_BANK_1_NUMBER=""
ARG NEXT_PUBLIC_BANK_2_NAME=""
ARG NEXT_PUBLIC_BANK_2_NUMBER=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_MINIO_PUBLIC_URL=$NEXT_PUBLIC_MINIO_PUBLIC_URL \
    NEXT_PUBLIC_BUSINESS_NAME=$NEXT_PUBLIC_BUSINESS_NAME \
    NEXT_PUBLIC_BUSINESS_WA=$NEXT_PUBLIC_BUSINESS_WA \
    NEXT_PUBLIC_BUSINESS_ADDRESS=$NEXT_PUBLIC_BUSINESS_ADDRESS \
    NEXT_PUBLIC_BANK_1_NAME=$NEXT_PUBLIC_BANK_1_NAME \
    NEXT_PUBLIC_BANK_1_NUMBER=$NEXT_PUBLIC_BANK_1_NUMBER \
    NEXT_PUBLIC_BANK_2_NAME=$NEXT_PUBLIC_BANK_2_NAME \
    NEXT_PUBLIC_BANK_2_NUMBER=$NEXT_PUBLIC_BANK_2_NUMBER \
    NEXT_TELEMETRY_DISABLED=1

RUN bunx prisma generate
RUN bun run build

# ── Migrasi (sekali jalan, dipanggil compose sebelum web) ────────
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
USER bun
CMD ["bunx", "prisma", "migrate", "deploy"]

# ── Production runtime ──────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
# Dijalankan di server: docker compose exec web bun scripts/create-superadmin.ts (lihat docs/deployment.md §6).
# Hanya bergantung pada @prisma/client + Bun — bcryptjs/zod di-bundle Next.js dan TIDAK ada di node_modules image ini.
COPY --from=builder --chown=bun:bun /app/scripts/create-superadmin.ts ./scripts/create-superadmin.ts

# Non-root (user `bun` sudah ada di image resmi).
USER bun
EXPOSE 3000
CMD ["bun", "server.js"]
