FROM oven/bun:1-slim AS base
WORKDIR /app

# ── Install dependencies ────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bunx prisma generate
RUN bun run build

# ── Production runtime ──────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "server.js"]
