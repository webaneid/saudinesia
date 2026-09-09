#!/bin/bash
# .claude/hooks/post-edit-lint.sh
# PostToolUse (Edit/Write) — auto-fix lint issue tiap file TS/TSX diedit,
# supaya ketauan & kefix SEGERA, bukan numpuk sampai ketauan pas CI.
# WARNING (exit 1), bukan hard-block — lint gagal bukan alasan block kerja
# di tengah jalan.
#
# CATATAN: sebelumnya ini cuma CONTOH kode di hooks/README.md (dan versi
# contoh itu ada bug: `cd "$(dirname "$FILE_PATH")"` lalu run eslint pakai
# $FILE_PATH yang SAMA — path jadi salah/dobel kalau bukan dijalankan dari
# root). Versi ini jalan dari root repo tanpa `cd`, ke file relatif apa adanya.

FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')
[[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]] && exit 0
[ -f "$FILE_PATH" ] || exit 0
command -v bunx >/dev/null 2>&1 || exit 0

# Skip diam-diam kalau belum ada config eslint (mis. masih awal Fase 00,
# eslint belum di-setup) — jangan spam warning untuk kondisi yang wajar.
ls eslint.config.* .eslintrc* >/dev/null 2>&1 || exit 0

LINT_OUTPUT=$(bunx eslint "$FILE_PATH" --fix 2>&1)
if [ $? -ne 0 ]; then
  echo "⚠️  Lint issue di $FILE_PATH (auto-fix sudah dicoba, sisanya manual):" >&2
  echo "$LINT_OUTPUT" | tail -15 >&2
  exit 1
fi
exit 0
