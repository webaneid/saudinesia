#!/bin/bash
# .claude/hooks/security-review-reminder.sh
# Jalan lewat PostToolUse (Edit/Write) — mengingatkan (BUKAN block) supaya
# skill `security-review` tidak "lupa" dipanggil kalau editnya terjadi di
# luar alur fase eksekusi resmi (mis. fix kecil ad-hoc).
#
# Diadaptasi dari template master-typescript: pola path disesuaikan ke
# struktur Next.js App Router project ini (`app/api/v1/**/route.ts`),
# bukan `apps/api/src/routes/*.ts` (Elysia monorepo).

FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

# Cuma relevan untuk kode TypeScript, bukan config/doc
[[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]] && exit 0
# Skip test/type-declaration file — bukan target security-review
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.d.ts) exit 0 ;;
esac

# Pola file security-sensitive: Route Handler, auth, upload, webhook, payment, middleware
case "$FILE_PATH" in
  */route.ts|*[Aa]uth*|*[Uu]pload*|*[Ww]ebhook*|*[Pp]ayment*|*middleware.ts) ;;
  *) exit 0 ;;
esac

echo "🔒 File security-sensitive diedit: $FILE_PATH" >&2
echo "Sebelum task ini dianggap selesai, jalankan skill 'security-review'" >&2
echo "(.claude/skills/security-review/SKILL.md) — checklist lengkap ada di" >&2
echo "docs/architecture/architecture-security.md. Kalau file yang diubah" >&2
echo "banyak/lintas modul, delegasikan ke subagent 'security-auditor'." >&2
exit 1
