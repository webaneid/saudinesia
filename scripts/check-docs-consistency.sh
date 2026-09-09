#!/bin/bash
# scripts/check-docs-consistency.sh
# Cek referensi silang dokumentasi: file yang direferensikan di CLAUDE.md /
# skill files / architecture docs beneran ada, dan nomor ADR tidak
# bentrok/berlubang aneh.
#
# Jalankan manual: bash scripts/check-docs-consistency.sh
# BUKAN gate CI/hook — ini alat bantu audit manual. Banyak referensi memang
# OPSIONAL (boleh tidak ada kalau checklist project-init = Tidak), jadi
# hasil "MISSING" di bawah butuh judgment manusia/Claude buat filter mana
# yang genuinely broken vs memang sengaja dihapus.

cd "$(dirname "$0")/.." || exit 1

MISSING=0

echo "== Cek referensi file docs/*.md & CLAUDE*.md di seluruh markdown =="
REFS=$(grep -rhoE '`docs/[A-Za-z0-9/_.-]+\.md`|`CLAUDE(-sample)?\.md`' \
  --include='*.md' . 2>/dev/null | tr -d '`' | sort -u)

while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  # Skip placeholder/pola generik (bukan path file sungguhan)
  case "$ref" in
    *"{"*|*"["*|*XXXX*|*"*"*|*nama-fitur*) continue ;;
  esac
  if [ ! -f "$ref" ]; then
    echo "  ❌ MISSING: $ref"
    MISSING=$((MISSING + 1))
  fi
done <<< "$REFS"

if [ "$MISSING" -eq 0 ]; then
  echo "  ✅ Semua referensi file ketemu."
fi

echo
echo "== Cek nomor ADR (harus urut 0001, 0002, ... tanpa gap/duplikat) =="
ADR_NUMS=$(ls docs/decisions/adr-*.md 2>/dev/null | grep -oE 'adr-[0-9]{4}' | sed 's/adr-//' | sort -u)
EXPECTED=1
GAP=0
for n in $ADR_NUMS; do
  N=$((10#$n))
  if [ "$N" -ne "$EXPECTED" ]; then
    echo "  ⚠️  Urutan aneh: diharapkan $(printf '%04d' "$EXPECTED"), ketemu adr-$n"
    GAP=1
  fi
  EXPECTED=$((N + 1))
done
if [ "$GAP" -eq 0 ] && [ -n "$ADR_NUMS" ]; then
  echo "  ✅ Nomor ADR urut, tidak ada gap/duplikat. Total: $((EXPECTED - 1))"
fi

echo
echo "== Selesai =="
echo "MISSING di atas belum tentu bug — cek dulu apa itu OPSIONAL (dihapus"
echo "sengaja lewat checklist project-init) sebelum dianggap masalah nyata."
exit 0
