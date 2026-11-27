# Validation of the iTwin.js #9857 fix

Scripts and data behind the numbers in the article "Below the Tolerance, Above the
Threshold: Testing a Robustness Fix in an Open Source Geometry Library".

## In short

- **What is tested:** `RegionOps.regionBooleanXY` of `@itwin/core-geometry` on master `8ce43acc16` and on the fix
  `bce2c35940`, the fix commit of pull request [#10011](https://github.com/iTwin/itwinjs-core/pull/10011) for issue
  [#9857](https://github.com/iTwin/itwinjs-core/issues/9857). Later heads of the pull request only merge master, without
  changes to `core/geometry/src`.
- **How:** generated shapes with a known right answer (closed-form areas or a separate scanline oracle, never the
  library itself). Fixed seeds, so every run gives the same results.
- **Result:** 206,767 configurations fail on master. The fix repairs 124,953 (60%) and breaks 25. Of those, 24 only
  look broken because of a failure limit in one script, and 1 is a real regression (a chain of two booleans).
  Details: [`results/summary.md`](results/summary.md).

## Check the numbers in a minute

The raw failure lists of both builds are stored in `data/failure-lists.tar.gz` (12 MB, about 390 MB unpacked, one
line per wrong operation). They give the table without rerunning anything:

```
tar xzf data/failure-lists.tar.gz
run/compare-all.sh failure-lists/master failure-lists/fix out/cmp
```

`out/cmp/cmp-<set>.txt` should match `results/sets/cmp-<set>.txt`.

## Rerun from scratch

Needs Node.js 20-24 and a clone of iTwin/itwinjs-core with `rush install` done once
(`git fetch origin pull/10011/head` for the fix).

```
run/build-libs.sh <clone> <work dir>
M=<work dir>/wt-master/core/geometry/lib/cjs/core-geometry.js
F=<work dir>/wt-fix/core/geometry/lib/cjs/core-geometry.js

run/regressions.sh $M $F                 # saved regression inputs, about a minute
run/run-sets.sh $M $M out/master         # 13 groups of sets, several hours
run/run-sets.sh $F $M out/fix
run/compare-all.sh out/master out/fix out/cmp
run/fuzz.sh $M $F out/fuzz               # later generators
run/final-check.sh $M $F out/final       # last check
```

Expected outputs are in `results/`. `SETS="corner-cusp nested"` runs a subset, `PAR` sets parallel jobs (default 3).

## Layout

| path | content |
|---|---|
| `results/` | numbers cited in the article, Table 1, per-set comparisons, fuzz and last-check results |
| `data/` | raw failure lists |
| `scripts/` | generators and oracles, one folder per family of inputs, each script describes itself in its header |
| `regressions/` | saved inputs of regressions found on intermediate versions of the fix, one folder per generator |
| `run/` | build, run and summary scripts |

A configuration is one arrangement of shapes with all boolean operations in both operand orders. Repaired: wrong on
master, right with the fix. Broken: right on master, wrong with the fix.

The 13 groups of sets and their generators:

| set | generator | shapes |
|---|---|---|
| `issue` | `scripts/issue/`, `scripts/fillets/` | the issue's shape: sweeps of overlap, seam and orientation, generic and offset versions, arcs crossing at a small angle, fillet families |
| `cusp` | `scripts/cusp/cusp.js` | random issue-like cusps with a scanline oracle: radii, ellipses, mixed ends, slicers, touching, affine maps, loop construction |
| `placement` | `scripts/placement/placement.js` | scale, far translation, nearly coincident arcs, short edges, several shapes on one circle, chains of booleans |
| `sweep` | `scripts/issue/sweep.js` | the sweeps of `issue` without the 5,000 failure limit |
| `tangent` | `scripts/tangent/tangent.js` | polygons, lenses and D shapes nearly tangent to a circle |
| `tangent-fixed` | `scripts/tangent/tangent-fixed.js` | the same without random placement, both orientations |
| `corner` | `scripts/corner/corner.js` | corners of the other region, several shapes, nested, parity, split unions |
| `corner-cusp` | `scripts/corner/corner.js` | a corner curve that leaves nearly backwards, so the corner looks tangent |
| `nested` | `scripts/corner/corner.js` | the corner region is itself a boolean result, and all operations with it are checked |
| `ellipse-fillet` | `scripts/corner/corner.js` | elliptic fillets on a circle or ellipse |
| `ellipse-chord` | `scripts/corner/corner.js` | one fillet, a shared arc and a chord back, on a circle or ellipse |
| `chain2` | `scripts/corner/corner.js` | a chain of two booleans, step 0 computed by master for both builds |
| `vertex` | `scripts/vertex/vertex.js` | the side check at the graph vertex: ellipses, perturbed arcs, B-splines, several fillets at one vertex, move distance |

## Note on AI use

Claude (Anthropic) helped write these scripts and generators. The author ran and checked all results.

## License

MIT, see `LICENSE`. iTwin.js itself is not included and has its own MIT license.
