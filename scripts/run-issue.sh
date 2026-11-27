#!/bin/bash
# Run the generators around the issue geometry (scripts/issue/ and scripts/fillets/) against one build: set "issue".
# Usage: run-issue.sh <core-geometry.js> <base core-geometry.js for the pairwise check> <out dir>
# Writes one failure list per list name (<name>.txt, one line per wrong operation) plus logs.
set -u
D=$(cd "$(dirname "$0")" && pwd)
LIB=$1; BASE=$2; O=$3
mkdir -p "$O"
S=$D/issue/sweep.js
GARC=0,1e-10,-1e-10,1e-9,1e-8,-1e-8,3e-8,1e-7,-1e-7,3e-7,1e-6,-1e-6
GEDGE=7e-7,7.2e-7,7.4e-7,7.45e-7,7.49e-7,7.5e-7,7.51e-7,7.55e-7,7.6e-7,7.8e-7,8e-7
GB1=0,1e-10,-1e-10,1e-9,-1e-9,1e-8,-1e-8,1e-7,-1e-7,3e-7,5e-7,7e-7,9e-7,1e-6,-3e-7,-5e-7,-9e-7,-1e-6
J=${JOBS:-8}
run() { while [ "$(jobs -rp | wc -l)" -ge "$J" ]; do sleep 1; done; ( eval "$1" ) & }
# sweeps without the failure limit: arc, line, threshold (edge), fillet+linecusp, raw pairs
run "GAPS=$GARC node $S $LIB arc > $O/sweep-arc.log 2>&1; grep '^  fail' $O/sweep-arc.log | sort > $O/sweep-arc.txt"
run "GAPS=$GARC node $S $LIB line > $O/sweep-line.log 2>&1; grep '^  fail' $O/sweep-line.log | sort > $O/sweep-line.txt"
run "GAPS=$GEDGE node $S $LIB fillet > $O/sweep-edge.log 2>&1; grep '^  fail' $O/sweep-edge.log | sort > $O/sweep-edge.txt"
run "GAPS=$GB1 node $S $LIB fillet,linecusp > $O/sweep-fillet-cusp.log 2>&1; grep '^  fail' $O/sweep-fillet-cusp.log | sort > $O/sweep-fillet-cusp.txt"
run "GAPS=0 node $S $LIB fillet raw > $O/sweep-raw.log 2>&1"
# the same sweeps with the limit of 5,000 recorded failures per family, default gaps
run "node $D/issue/sweep-limited.js $LIB > $O/sweep-limited.log 2>&1; grep '^  fail' $O/sweep-limited.log | sort > $O/sweep-limited.txt"
# generic issue geometry, offset circular segments, pairwise intersections
run "node $D/issue/variants.js $LIB $O/variants.txt > $O/variants.log 2>&1"
run "node $D/issue/offset-segment.js $LIB 10 $O/offset-small.txt > $O/offset-small.log 2>&1"
run "node $D/issue/offset-segment.js $LIB 1000 $O/offset-large.txt > $O/offset-large.log 2>&1"
run "node $D/issue/intersections.js $BASE $LIB > $O/intersections.log 2>&1"
# arcs crossing at a small angle, perturbations and rotations of the arc family
run "node $D/issue/crossing-arcs.js $LIB $O/crossing-arcs.txt > $O/crossing-arcs.log 2>&1"
run "node $D/issue/perturb-arc.js $LIB > $O/perturb-arc.log 2>&1"
run "node $D/issue/rotation-sweep.js $LIB 1e-8 > $O/rotation-1e-8.log 2>&1"
run "node $D/issue/rotation-sweep.js $LIB 1e-7 > $O/rotation-1e-7.log 2>&1"
# fillet families
for f in inner outer three short ellip split-inner split-outer split-short; do
  run "node $D/fillets/fillets.js $LIB $f $O/fillet-$f.txt > $O/fillet-$f.log 2>&1"
done
for f in innersmall innercusp reverse reversenb outersmall outsmooth innernb outernb shortfil ellipx scale mtol gdense; do
  run "node $D/fillets/fillets-more.js $LIB $f $O/fillet-$f.txt > $O/fillet-$f.log 2>&1"
done
# issue script
run "node $D/issue-repro.js $LIB > $O/issue.log 2>&1"
wait
echo done > "$O/DONE"
