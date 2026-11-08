#!/usr/bin/env bash
# Converts every Word sample PDF with the current code and compares the result with the original .docx.
# Usage: bash scripts/fidelity/word-run.sh [outDir]   (run from the app folder)
set -e
SAMPLES=docs/research/fidelity/samples/word
OUT=${1:-../fidelity-out}
mkdir -p "$OUT/ours"
for pdf in "$SAMPLES"/*.pdf; do
  name=$(basename "$pdf" .pdf)
  node --no-warnings --import ./scripts/fidelity/hooks.mjs scripts/fidelity/convert.mjs "$pdf" "$OUT/ours/$name.docx" > /dev/null
  extra=""
  [ -f "$OUT/reflow/$name.docx" ] && extra="word=$OUT/reflow"
  node scripts/fidelity/docx-compare.mjs "$SAMPLES" "$name" "ours=$OUT/ours" $extra
  echo
done
