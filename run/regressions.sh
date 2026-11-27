#!/bin/bash
# Saved inputs of regressions found on intermediate versions of the fix (classes of Table 1) and the issue itself,
# run on master and on the fix. For regressions/corner and regressions/vertex each line gives "<k> of 12" wrong
# operations for master, then for the fix (12 = 5 operations x 2 operand orders + union with simplifyUnion true and
# false), checked against the oracle.
# Usage: run/regressions.sh <master core-geometry.js> <fix core-geometry.js>
set -u
D=$(cd "$(dirname "$0")/.." && pwd)
LM=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
LF=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
S=$D/scripts
echo "== issue #9857 (fix)"; node "$S/issue-repro.js" "$LF"
echo "== issue #9857 (master)"; node "$S/issue-repro.js" "$LM"
wrong() { grep -o '[0-9]* of 12 wrong\|[0-9]* of 12' | sed 's/ wrong//' | tr '\n' ' '; }
# cusp, placement: regressions of early versions, saved without expected areas. saved-repro.js prints master and fix
# side by side. On these inputs master is right, so the count of operations whose result differs from master should be 0.
for dir in cusp placement; do
  echo "== regressions/$dir (operations whose result differs from master, of 12)"
  for f in "$D/regressions/$dir"/*.json; do
    printf '%s  ' "$(basename "$f")"
    node "$S/saved-repro.js" "$f" "$LM" "$LF" 2>&1 | grep ' | ' | awk -F'[|]' '{gsub(/^ +| +$/,"",$1); gsub(/^ +| +$/,"",$2); if ($1 != $2) n++} END {print n+0}'
  done
done
echo "== regressions/corner (master, fix)"
for f in "$D/regressions/corner"/*.json; do printf '%s  ' "$(basename "$f")"; node "$S/corner/corner-repro.js" "$f" "$LM" "$LF" 2>&1 | wrong; echo; done
echo "== regressions/vertex (master, fix)"
for f in "$D/regressions/vertex"/*.json; do printf '%s  ' "$(basename "$f")"; node "$S/vertex/vertex-repro.js" "$f" "$LM" "$LF" 2>&1 | wrong; echo; done
echo "== regressions/loops (RegionOps.constructAllXYRegionLoops, both operand orders: master | fix)"
for f in "$D/regressions/loops"/*.json; do printf '%s  ' "$(basename "$f")"; node "$S/loops-repro.js" "$f" "$LM" "$LF"; done
echo "== third arc coincident with the circle, class 8 (regress = configurations broken by the fix)"; node "$S/vertex/coincident-arc.js" "$LM" "$LF" | head -1
