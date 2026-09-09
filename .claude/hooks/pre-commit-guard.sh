#!/bin/bash
# .claude/hooks/pre-commit-guard.sh
# PreToolUse (Bash) — cegah `git commit` langsung ke branch main.
# CLAUDE.md § Git: kerja lewat feature branch (`feat/<slug>`, `fix/<slug>`,
# `chore/<slug>`), bukan langsung ke `main`.
#
# Diadaptasi dari template master-typescript — versi asli mengasumsikan
# flow PR ke branch `develop` (docs/SOP.md/conventions.md), yang belum ada
# di project ini. Di sini cuma cegah commit langsung ke `main`, tidak
# memaksakan branch `develop` yang tidak dikonfirmasi dipakai.

COMMAND=$(cat | jq -r '.tool_input.command // empty')

# Cuma cek command git commit yang sungguhan, JANGAN block semua Bash call
# cuma karena sedang di branch main.
echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+commit(\s|$)' || exit 0

BRANCH=$(git branch --show-current 2>/dev/null)
if [ "$BRANCH" = "main" ]; then
  echo "⛔ Jangan commit langsung ke branch 'main'." >&2
  echo "Buat feature branch dulu (feat/..., fix/..., chore/...) sesuai" >&2
  echo "CLAUDE.md § Git, baru merge ke main kalau sudah siap." >&2
  echo "Pengecualian: hotfix urgent production boleh langsung ke main." >&2
  exit 2
fi
exit 0
