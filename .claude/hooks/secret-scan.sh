#!/bin/bash
# .claude/hooks/secret-scan.sh
# Jalan lewat PostToolUse (setelah file ditulis/diedit) — mendeteksi secret
# yang ter-hardcode dan memberi tahu Claude untuk membenarkan SEBELUM lanjut
# ke langkah berikutnya (termasuk sebelum sempat di-commit ke git).
# CATATAN JUJUR: ini bukan blok "sebelum file ditulis" (itu butuh PreToolUse
# yang parse tool_input.content, beda mekanisme, lebih kompleks). Untuk
# proteksi lapis kedua yang independen dari Claude, tambahkan juga git
# pre-commit hook (gitleaks/trufflehog) — lihat README.md di folder ini.

FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

# Cakupan: kode, config, env, DAN file deploy (docker-compose, Caddyfile, CI yml)
# — secret paling sering kebocor lewat file deploy yang "kelihatan cuma config".
case "$FILE_PATH" in
  *.ts|*.tsx|*.env*|*.json|*.yml|*.yaml|*Caddyfile*) ;;
  *) exit 0 ;;
esac

# Jangan scan file example/template (memang boleh berisi placeholder)
[[ "$FILE_PATH" == *.example ]] && exit 0

if [ -f "$FILE_PATH" ]; then
  PATTERNS='(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk_live_[0-9a-zA-Z]{20,}|password\s*=\s*["\047][^"\047]{6,}["\047]|secret\s*=\s*["\047][^"\047]{10,}["\047])'

  if grep -Ei "$PATTERNS" "$FILE_PATH" > /dev/null; then
    echo "⚠️  Terdeteksi kemungkinan secret ter-hardcode di $FILE_PATH" >&2
    echo "Pindahkan ke .env dan akses via process.env, bukan hardcode." >&2
    exit 2   # exit code 2 = Claude diberi tahu ada masalah, harus benerin dulu
  fi
fi

exit 0
