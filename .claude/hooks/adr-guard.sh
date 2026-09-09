#!/bin/bash
# .claude/hooks/adr-guard.sh
# PreToolUse (Edit/Write) — block edit ke file ADR yang statusnya sudah
# "Accepted". Aturan keras template ini (docs/decisions/adr-template.md):
# "file ADR TIDAK diedit setelah Accepted — kalau keputusan berubah, buat
# ADR baru dan tulis 'Supersedes ADR-XXXX' di file baru itu."
#
# Ini aturan BINER (bukan butuh judgment seperti security-review), jadi pas
# di-hard-block (exit 2) — beda dari hook lain yang cuma warning.

FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  *docs/decisions/adr-*.md) ;;
  *) exit 0 ;;
esac

# Template file itu sendiri (docs/decisions/adr-template.md) boleh diedit.
[[ "$FILE_PATH" == *adr-template.md ]] && exit 0

# File belum ada = ADR baru yang lagi ditulis, bukan edit ADR lama, boleh.
[ -f "$FILE_PATH" ] || exit 0

if grep -q '^\*\*Status:\*\* Accepted' "$FILE_PATH"; then
  echo "⛔ ADR ini statusnya 'Accepted' — TIDAK BOLEH diedit langsung." >&2
  echo "Kalau keputusan berubah: buat ADR BARU dengan nomor urut berikutnya," >&2
  echo "tulis 'Supersedes ADR-XXXX' di file baru itu." >&2
  echo "(lihat docs/decisions/adr-template.md)" >&2
  exit 2
fi
exit 0
