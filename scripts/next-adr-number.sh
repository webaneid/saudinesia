#!/bin/bash
# scripts/next-adr-number.sh
# Cari nomor ADR berikutnya yang belum dipakai di docs/decisions/.
# Dipakai skill project-init & phase-workflow saat mau bikin ADR baru —
# supaya tidak perlu hitung manual (rawan salah, apalagi kalau nomor kecil
# sudah ter-reserve seperti adr-0002/0003 di template ini).
#
# Jalankan: bash scripts/next-adr-number.sh
# Output: nomor 4-digit berikutnya, mis. "0006"

cd "$(dirname "$0")/.." || exit 1

LAST=$(ls docs/decisions/adr-*.md 2>/dev/null | grep -oE 'adr-[0-9]{4}' | sed 's/adr-//' | sort -n | tail -1)

if [ -z "$LAST" ]; then
  echo "0001"
  exit 0
fi

NEXT=$((10#$LAST + 1))
printf "%04d\n" "$NEXT"
