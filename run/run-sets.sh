#!/bin/bash
# Run the 13 comparison sets of the article against one build of @itwin/core-geometry.
# Usage: run/run-sets.sh <core-geometry.js under test> <core-geometry.js of master> <out dir>
#   For the master run itself pass the master library twice.
#   The master library is used by two sets only: "issue" (pairwise intersection check) and "chain2" (step 0 of a
#   chain of two booleans is computed by master, so both builds get the same input for step 1).
# Env: PAR = parallel jobs (default 3). SETS = subset of sets to run (default: all 13).
# Every output file <set>/<family>.txt has one line per wrong boolean operation (wrong area or undefined).
set -u
unset N   # configurations per family come from the script defaults or from N=... below
D=$(cd "$(dirname "$0")/.." && pwd)
LF=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
LM=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
mkdir -p "$3"; O=$(cd "$3" && pwd)
S=$D/scripts
TAN=$S/tangent/tangent.js
TANFIX=$S/tangent/tangent-fixed.js
CORNER=$S/corner/corner.js
VERTEX=$S/vertex/vertex.js
FAMS_CUSP="radii ellipse mixed slicer touch selfop smalltol split affine loops-radii loops-ellipse loops-mixed loops-smalltol loops-split loops-affine"
SETS=${SETS:-issue cusp placement sweep tangent tangent-fixed corner corner-cusp nested ellipse-fillet ellipse-chord chain2 vertex}
export S LF LM O TAN TANFIX CORNER VERTEX FAMS_CUSP
JOBFILE=$O/jobs.txt; : > "$JOBFILE"
for s in $SETS; do
  mkdir -p "$O/$s"
  case $s in
    issue)          echo 'JOBS=1 $S/run-issue.sh $LF $LM $O/issue' ;;
    cusp)           echo 'JOBS=1 FAMS="$FAMS_CUSP" $S/run-cusp.sh $LF $O/cusp' ;;
    placement)      echo 'JOBS=1 $S/run-placement.sh $LF $O/placement; N=200 node $S/placement/placement.js $LF meet $O/placement/meet.txt > $O/placement/meet.log 2>&1' ;;
    sweep)          echo 'for fam in fillet linecusp arc line; do node $S/issue/sweep.js $LF $fam > $O/sweep/$fam.log 2>&1; grep "^  fail" $O/sweep/$fam.log | sort > $O/sweep/$fam.txt; done' ;;
    tangent)        echo 'for fam in tanpoly lens tanend; do N=300 node $TAN $LF $fam $O/tangent/$fam.txt > $O/tangent/$fam.log 2>&1; done; N=800 node $TAN $LF dshape $O/tangent/dshape.txt > $O/tangent/dshape.log 2>&1' ;;
    tangent-fixed)  echo 'for v in ccw cw; do for fam in tanpoly lens tanend dshape; do n=300; [ $fam = dshape ] && n=800; NOPL=$v N=$n node $TANFIX $LF $fam $O/tangent-fixed/$fam-$v.txt > $O/tangent-fixed/$fam-$v.log 2>&1; done; done' ;;
    corner)         echo 'for fam in cornerang multi nested parity splitunion; do N=300 node $CORNER $LF $fam $O/corner/$fam.txt > $O/corner/$fam.log 2>&1; done' ;;
    corner-cusp)    echo 'N=600 node $CORNER $LF cornercusp $O/corner-cusp/cornercusp.txt > $O/corner-cusp/cornercusp.log 2>&1' ;;
    nested)         echo 'N=600 node $CORNER $LF nested2 $O/nested/nested2.txt > $O/nested/nested2.log 2>&1' ;;
    ellipse-fillet) echo 'N=1500 node $CORNER $LF ellfil $O/ellipse-fillet/ellfil.txt > $O/ellipse-fillet/ellfil.log 2>&1' ;;
    ellipse-chord)  echo 'N=1500 node $CORNER $LF ellchord $O/ellipse-chord/ellchord.txt > $O/ellipse-chord/ellchord.log 2>&1' ;;
    chain2)         echo 'XLIB=$LM N=600 node $CORNER $LF multi2 $O/chain2/multi2.txt > $O/chain2/multi2.log 2>&1' ;;
    vertex)         echo 'for fam in ecc pert bez msnap dist; do N=300 node $VERTEX $LF $fam $O/vertex/$fam.txt > $O/vertex/$fam.log 2>&1; done' ;;
    *) echo "unknown set $s" >&2; exit 2 ;;
  esac >> "$JOBFILE"
done
tr '\n' '\0' < "$JOBFILE" | xargs -0 -P "${PAR:-3}" -n 1 bash -c
echo done > "$O/DONE"
