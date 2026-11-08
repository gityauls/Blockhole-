#!/usr/bin/env bash
# Converts single pages of a PDF, exports them through Word, and pairs each with the source page for a visual check.
# Run from the app folder. Usage: bash scripts/fidelity/hwp-look.sh <in.pdf> <outDir> <page> [page...]
set -euo pipefail
PDF="$1"; OUT="$2"; shift 2
rm -rf "$OUT/ours" "$OUT/png"; mkdir -p "$OUT/ours" "$OUT/png/original" "$OUT/png/ours" "$OUT/pairs"
for n in "$@"; do
  node --no-warnings --import ./scripts/fidelity/hooks.mjs scripts/fidelity/convert.mjs "$PDF" "$OUT/ours/p$n.docx" "$n-$n" > /dev/null
done
powershell -NoProfile -File scripts/fidelity/word-look.ps1 "$OUT/ours" > /dev/null
for n in "$@"; do
  node --no-warnings --import ./scripts/fidelity/hooks.mjs scripts/fidelity/render.mjs "$PDF" "$OUT/png/original" "$n" --scale=1 > /dev/null
  node --no-warnings --import ./scripts/fidelity/hooks.mjs scripts/fidelity/render.mjs "$OUT/ours/p$n.pdf" "$OUT/png/ours" --scale=1 > /dev/null
  node scripts/fidelity/pair.mjs "$(ls "$OUT"/png/original/*-p$n.png)" "$OUT/png/ours/p$n-p1.png" "$OUT/pairs/p$n.png"
  echo "page $n -> $(ls "$OUT"/png/ours/p$n-p*.png | wc -l) Word page(s)"
done
