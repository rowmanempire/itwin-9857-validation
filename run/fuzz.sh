#!/bin/bash
# Independent generators written later (scripts/fuzz/fuzz.js), four runs as cited in the article.
# Usage: run/fuzz.sh <master core-geometry.js> <fix core-geometry.js> <out dir> [<core-geometry.js of 2943f20c8e>]
#   run3 takes the result of a union computed by commit 2943f20c8e (an intermediate version of the fix, on the
#   pull request branch) as input for a second boolean. Without the fourth argument run3 is skipped.
# Env: N1 N2 N3 N4 = cases per family for run1..run4 (defaults 1500 2500 2500 600, as in the article).
# Each run writes <run>.summary.json; run/fuzz-summary.js prints the totals.
set -u
LM=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
LF=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
mkdir -p "$3"; O=$(cd "$3" && pwd)
FZ=$(cd "$(dirname "$0")/.." && pwd)/scripts/fuzz/fuzz.js
cd "$O"
node "$FZ" "$LM" "$LF" disks,edgeTouch,nested,coincident,multi,hole,ellipse,offsetCopy "${N1:-1500}" 1 run1 > run1.log 2>&1
FUZZ_BASELIB=$LM node "$FZ" "$LM" "$LF" corner,sharedArc,spandrel,tinyFillet,ellCorner,reuse "${N2:-2500}" 1 run2 > run2.log 2>&1
if [ $# -ge 4 ]; then
  LB=$(cd "$(dirname "$4")" && pwd)/$(basename "$4")
  FUZZ_BASELIB=$LB node "$FZ" "$LM" "$LF" reuse "${N3:-2500}" 5001 run3 > run3.log 2>&1
fi
FUZZ_TOL=1e-4 FUZZ_BASELIB=$LM node "$FZ" "$LM" "$LF" disks,edgeTouch,nested,multi,hole,ellipse,corner,sharedArc,ellCorner "${N4:-600}" 20001 run4 > run4.log 2>&1
node "$(dirname "$FZ")/../../run/fuzz-summary.js" "$O"
