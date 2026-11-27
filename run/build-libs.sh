#!/bin/bash
# Build @itwin/core-geometry (CommonJS) for master and for the fix, each in its own git worktree.
# Usage: run/build-libs.sh <itwinjs-core clone> <work dir> [<commit name>=<sha> ...]
#   The clone must have the pull request commit (git fetch origin pull/10011/head) and must have run
#   "rush install" once, so that core/geometry/node_modules exists. Worktrees reuse that node_modules.
#   Default commits: master=8ce43acc16 (the master commit last merged into the pull request branch, its merge base)
#   and fix=bce2c35940 (head of the pull request).
#   Add mid=2943f20c8e to build the intermediate version used as input source by fuzz run3.
# Result: <work dir>/wt-<name>/core/geometry/lib/cjs/core-geometry.js for each name.
# The library must stay inside its worktree, so that @itwin/core-bentley resolves.
set -eu
CLONE=$(cd "$1" && pwd); mkdir -p "$2"; W=$(cd "$2" && pwd); shift 2
[ $# -gt 0 ] || set -- master=8ce43acc16 fix=bce2c35940
for spec in "$@"; do
  n=${spec%%=*}; sha=${spec#*=}
  if [ ! -d "$W/wt-$n" ]; then
    git -C "$CLONE" worktree add --detach "$W/wt-$n" "$sha"
    ln -s "$CLONE/core/geometry/node_modules" "$W/wt-$n/core/geometry/node_modules"
  fi
  (cd "$W/wt-$n/core/geometry" && ./node_modules/.bin/tsc --outDir lib/cjs)
  echo "$n: $W/wt-$n/core/geometry/lib/cjs/core-geometry.js"
done
# Remove later with: git -C <clone> worktree remove --force <work dir>/wt-<name>
