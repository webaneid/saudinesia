#!/bin/bash
# .claude/hooks/security-review-reminder.sh
# Jalan lewat PostToolUse (Edit/Write) — mengingatkan (BUKAN block) supaya
# skill `security-review` tidak "lupa" dipanggil kalau editnya terjadi di
# luar alur fase eksekusi resmi (mis. fix kecil ad-hoc).
#
# Diperluas 2026-10-21: file infra/pipeline + auth/OTP/session/storage (lihat docs/lessons-learned.md SEC-02/04).
# Diadaptasi dari template master-typescript: pola path disesuaikan ke
# struktur Next.js App Router project ini (`app/api/v1/**/route.ts`),
# bukan `apps/api/src/routes/*.ts` (Elysia monorepo).

FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

# Infra/pipeline = permukaan serangan juga (CLAUDE.md § Security): Dockerfile, compose, Caddyfile, workflow CI,
# skrip operasional, contoh env, konfigurasi Next/instrumentation. Dicek SEBELUM filter ekstensi di bawah.
case "$FILE_PATH" in
  */Dockerfile*|*/docker-compose*.yml|*/Caddyfile*|*/.github/workflows/*.yml|*/.github/dependabot.yml|*/scripts/*.sh|*/scripts/*.ts|*/.env*.example|*/next.config.ts|*/instrumentation*.ts|*/.dockerignore)
    echo "🔒 File infra/pipeline diedit: $FILE_PATH" >&2
    echo "Sebelum task ini dianggap selesai, jalankan skill 'security-review' (blok \"file infra\") —" >&2
    echo "CLAUDE.md § Fase Eksekusi SOP langkah 5. Perubahan instrumentation/next.config hanya terbukti oleh" >&2
    echo "'bun run build'. Fase besar → subagent 'security-auditor'." >&2
    exit 1
    ;;
esac

# Selebihnya: cuma relevan untuk kode TypeScript, bukan config/doc
[[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]] && exit 0
# Skip test/type-declaration file — bukan target security-review
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.d.ts) exit 0 ;;
esac

# Pola file security-sensitive: Route Handler, auth/OTP/session, upload/storage, webhook, payment, middleware
case "$FILE_PATH" in
  */route.ts|*[Aa]uth*|*[Oo]tp*|*[Ss]ession*|*[Uu]pload*|*/lib/storage/*|*[Ww]ebhook*|*[Pp]ayment*|*middleware.ts) ;;
  *) exit 0 ;;
esac

echo "🔒 File security-sensitive diedit: $FILE_PATH" >&2
echo "Sebelum task ini dianggap selesai, jalankan skill 'security-review'" >&2
echo "(.claude/skills/security-review/SKILL.md) — checklist lengkap ada di" >&2
echo "docs/architecture/architecture-security.md. Kalau file yang diubah" >&2
echo "banyak/lintas modul, delegasikan ke subagent 'security-auditor'." >&2
exit 1
