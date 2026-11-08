#!/usr/bin/env bash
# Exports the converted samples through Word and pairs each page with the original for a visual check.
# Run after word-run.sh, from the app folder. Usage: bash scripts/fidelity/word-look.sh <outDir used by word-run.sh>
set -euo pipefail
OUT="${1:?outDir}"
SAMPLES=docs/research/fidelity/samples/word
powershell -NoProfile -File scripts/fidelity/word-look.ps1 "$OUT/ours"
mkdir -p "$OUT/png/original" "$OUT/png/ours" "$OUT/pairs"
for pdf in "$SAMPLES"/*.pdf; do
  name=$(basename "$pdf" .pdf)
  node --no-warnings --import ./scripts/fidelity/hooks.mjs scripts/fidelity/render.mjs "$pdf" "$OUT/png/original" --scale=1 > /dev/null
  node --no-warnings --import ./scripts/fidelity/hooks.mjs scripts/fidelity/render.mjs "$OUT/ours/$name.pdf" "$OUT/png/ours" --scale=1 > /dev/null
done
for page in "$OUT"/png/original/*.png; do
  base=$(basename "$page")
  [ -f "$OUT/png/ours/$base" ] && node scripts/fidelity/pair.mjs "$page" "$OUT/png/ours/$base" "$OUT/pairs/$base"
done
# Page counts differ when Word breaks pages elsewhere.
echo "original pages: $(ls "$OUT/png/original" | wc -l), ours: $(ls "$OUT/png/ours" | wc -l)"
ls "$OUT/pairs"
