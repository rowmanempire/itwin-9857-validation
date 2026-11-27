#!/bin/bash
# Compare the master run with the run of the fix, set by set, and print the summary table.
# Usage: run/compare-all.sh <master out dir> <fix out dir> <result dir>
# Writes <result dir>/cmp-<set>.txt (output of scripts/compare.js) and <result dir>/summary.md.
set -u
D=$(cd "$(dirname "$0")/.." && pwd)
M=$1; F=$2; R=$3
mkdir -p "$R"
for s in ${SETS:-issue cusp placement sweep tangent tangent-fixed corner corner-cusp nested ellipse-fillet ellipse-chord chain2 vertex}; do
  [ -d "$M/$s" ] && [ -d "$F/$s" ] || continue
  node "$D/scripts/compare.js" "$M/$s" "$F/$s" > "$R/cmp-$s.txt" 2>&1
done
node "$D/run/summary.js" "$R" | tee "$R/summary.md"
