#!/bin/bash
# Run the placement stress families (placement/placement.js) against one build: set "placement".
# Usage: run-placement.sh <core-geometry.js> <out dir>      (env N = configurations per family, default 120, JOBS default 8)
set -u
D=$(cd "$(dirname "$0")" && pwd)
LIB=$1; O=$2
mkdir -p "$O"
J=${JOBS:-8}
run() { while [ "$(jobs -rp | wc -l)" -ge "$J" ]; do sleep 1; done; ( eval "$1" ) & }
for f in ${FAMS:-scale farshift coarc shortedge multi twin chain slicerout arcslicer}; do
  run "node $D/placement/placement.js $LIB $f $O/$f.txt > $O/$f.log 2>&1"
done
wait
echo done > "$O/DONE"
