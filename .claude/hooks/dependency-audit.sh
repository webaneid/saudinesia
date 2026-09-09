#!/bin/bash
# .claude/hooks/dependency-audit.sh
# Dipanggil setelah Claude menjalankan `bun add <package>` — cek known
# vulnerabilities sebelum dependency baru dianggap "terpasang aman".
# Tidak block otomatis (audit tool bisa false-positive/noisy), tapi WAJIB
# tampil ke user sebagai warning, bukan silently diabaikan.

COMMAND=$(cat | jq -r '.tool_input.command // empty')

if [[ "$COMMAND" == *"bun add"* ]]; then
  echo "📦 Dependency baru terdeteksi, menjalankan audit..." >&2
  bun audit 2>&1 | tee /tmp/bun-audit-result.txt

  if grep -qi "vulnerabilit" /tmp/bun-audit-result.txt; then
    echo "⚠️  Ditemukan potensi vulnerability. Review sebelum lanjut." >&2
    # exit 1 = warning tampil ke user, tidak hard-block (beda dari secret-scan)
    exit 1
  fi
fi

exit 0
