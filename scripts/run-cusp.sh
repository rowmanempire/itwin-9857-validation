#!/bin/bash
# Run the cusp stress families (cusp/cusp.js) against one build: set "cusp".
# Usage: run-cusp.sh <core-geometry.js> <out dir>      (env N = configurations per family, default 160, JOBS default 8)
set -u
D=$(cd "$(dirname "$0")" && pwd)
LIB=$1; O=$2
mkdir -p "$O"
J=${JOBS:-8}
run() { while [ "$(jobs -rp | wc -l)" -ge "$J" ]; do sleep 1; done; ( eval "$1" ) & }
for f in ${FAMS:-radii ellipse mixed slicer touch selfop smalltol split}; do
  run "node $D/cusp/cusp.js $LIB $f $O/$f.txt > $O/$f.log 2>&1"
done
wait
echo done > "$O/DONE"
