#!/bin/bash
# Last check of the article (scripts/final-check/fz.js): 13 families of touching and self-touching regions,
# 150 seeds each, gaps up to 0.4 tolerance (seeds 7000+) and up to 3 tolerances (seeds 8000+).
# Usage: run/final-check.sh <master core-geometry.js> <fix core-geometry.js> <out dir>
# Env: N = seeds per family and gap setting (default 150).
set -u
D=$(cd "$(dirname "$0")/.." && pwd)
export LIB_master=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
export LIB_head=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
export LIBS=master,head
mkdir -p "$3"; O=$(cd "$3" && pwd)
FAMS=dup,edgeTangent,extTouch,figure8,intTouch,lollipop,multiLoops,nestedHole,nestedUnion,selfTouchPoly,thereBack,tiny,vertexTouch
GAPK=0.4 node "$D/scripts/final-check/fz.js" $FAMS "${N:-150}" 7000 "$O/gap04.jsonl" &
GAPK=3 node "$D/scripts/final-check/fz.js" $FAMS "${N:-150}" 8000 "$O/gap3.jsonl" &
wait
node "$D/scripts/final-check/sum.js" "$O/gap04.jsonl" "$O/gap3.jsonl"
