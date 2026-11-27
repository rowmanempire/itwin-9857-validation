# Numbers cited in the article

Master = iTwin/itwinjs-core 8ce43acc16 (the master commit last merged into the branch of pull request #10011, the
merge base of its fix commit). Fix = bce2c35940, the fix commit of the pull request. Later heads of the pull request
only merge master, without changes to `core/geometry/src`.

How the numbers were obtained on bce2c35940:

- All 13 groups of sets, the later generators (section 2), the last check (section 3) and `run/regressions.sh` were
  run on master 8ce43acc16 and on bce2c35940. Every failure list, on both sides, is byte for byte the same as the
  stored one (`data/failure-lists.tar.gz`), and so are the tables, the fuzz statistics (apart from run times), the two
  `.jsonl` files of the last check and `regressions.txt`. The group `issue` was rerun on this pair last (27 November
  2026): all 30 lists of each side and `sets/cmp-issue.txt` came out identical, and `scripts/issue/intersections.js`
  (20,000 random arc pairs and 12 offset circle pairs) found no difference between the pairwise intersections of the
  two builds.
- The stored lists were first made on earlier pairs: master 1ff6482d63 with 907a8f88d3, the same fix on top of it (a
  local commit, never pushed), and for `issue` master 1ff6482d63 with b44ca65810. The maintainers then merged master
  8ce43acc16 into the branch, and the fix commit was applied again on top of that merge (bce2c35940). Between
  1ff6482d63 and 8ce43acc16 `core/geometry` only adds checks that reject invalid B-spline knots and orders (B-spline
  constructors from knot arrays, `KnotVector.isValid`, IModelJson reading). All B-splines in the sets and saved inputs
  are valid, so the checks reject none of them.
- Compared with the earlier fix commit 9cf43485c0 (before the maintainers' review of the pull request), only the results
  of the six `loops-*` families of set `cusp` changed. They check `RegionOps.constructAllXYRegionLoops` instead of the
  booleans (see the end of section 1).
- The geometry tests of the library pass on bce2c35940: 2,175 tests in 127 files (`vitest run`, rerun 27 November 2026).

## 1. Thirteen groups of generated sets (Results, first two sentences)

Configurations ("cases"): one arrangement of shapes in one placement, with all 5 operations, both operand orders and
`simplifyUnion` true and false. Repaired = some operation wrong on master, none wrong with the fix. Broken = everything
right on master, something wrong with the fix. Source: `sets/cmp-<set>.txt`, table by `run/summary.js`.

| set | fail on master | repaired by the fix | broken by the fix |
|---|---|---|---|
| issue | 181113 | 115565 | 24 |
| cusp | 5235 | 1811 | 0 |
| placement | 2422 | 467 | 0 |
| sweep | 1804 | 594 | 0 |
| tangent | 2202 | 1030 | 0 |
| tangent-fixed | 4372 | 2066 | 0 |
| corner | 1708 | 362 | 1 |
| corner-cusp | 277 | 93 | 0 |
| nested | 831 | 178 | 0 |
| ellipse-fillet | 3156 | 1493 | 0 |
| ellipse-chord | 1123 | 865 | 0 |
| chain2 | 475 | 70 | 0 |
| vertex | 2049 | 359 | 0 |
| total | 206767 | 124953 | 25 |

- The 24 broken configurations of `issue` are all in list `sweep-limited` and come from the 5,000 failure limit of
  `scripts/issue/sweep-limited.js` (master failures past the limit are not recorded). The same script without the limit
  is set `sweep`, with 0 broken.
- The one broken configuration of `corner` is `multi id=140`, a chain of two booleans. Inputs: `regressions/corner/multi-140-*.json`.
  With the step 0 result frozen (the same input for step 1 on both builds) master and fix give the same result
  (`results/regressions.txt`).
- The six `loops-*` families of set `cusp` check `RegionOps.constructAllXYRegionLoops`, which neither moves
  intersections nor reports wrapped arc overlaps on bce2c35940. There the fix repairs 30 configurations, all in
  `loops-mixed` (1,411 in the six families on 9cf43485c0, where the public function still moved intersections), and
  breaks none. On dbce3b684e (and 2a5ffc3f72) it broke one, `loops-split id=146` with the placement
  `rot=193.7 shift=18288`: the public function no longer moved intersections but still reported a wrapped arc overlap,
  which ended 3e-4 from a near-tangent crossing, and the circle of radius 18.288 was lost (area 1276.79 instead of
  2327.50, both operand orders). bce2c35940 gives the same failure list as master for `loops-split`. Input:
  `regressions/loops/loops-split-146.json`. The boolean families of the same configurations are unchanged.
- Real regressions of the fix: 1 configuration, `multi id=140` of `regionBooleanXY`.

## 2. Families written later with different generators (Results, third sentence)

Source: `fuzz/run*.summary.json`, totals by `run/fuzz-summary.js`. One operation is wrong when its relative area error
exceeds the threshold. The article cites the threshold 1e-5.

| run | ops repaired (1e-4 / 1e-5 / 1e-6) | ops broken (1e-4 / 1e-5 / 1e-6) | cases with a repaired op (1e-5) | cases with a broken op (1e-5) |
|---|---|---|---|---|
| run1 | 5738 / 5748 / 5762 | 0 / 0 / 0 | 1456 | 0 |
| run2 | 4345 / 4451 / 4487 | 0 / 0 / 0 | 1136 | 0 |
| run3 | 2135 / 2217 / 2240 | 0 / 0 / 0 | 589 | 0 |
| run4 | 4699 / 4703 / 4584 | 0 / 0 / 3 | 1175 | 0 |
| total | 16917 / 17119 / 17073 | 0 / 0 / 3 | 4356 | 0 |

Note: 17,119 counts boolean operations, not configurations. In these runs 4,356 cases (inputs) have at least one repaired operation at 1e-5, and no case has a broken one. fuzz.js does not count cases that become fully correct, so the number of repaired configurations in the sense of section 1 is not available from these runs. The three
operations at 1e-6 in run4 are area differences at the level of 1e-6 (run4 uses tolerance 1e-4).

## 3. Last check (Results, fourth sentence)

Source: `final-check/gap04.jsonl` and `final-check/gap3.jsonl` (one line per operation), totals by
`scripts/final-check/sum.js` (threshold 1e-4): 22,076 operations, 3,816 wrong on master, 455 wrong with the fix,
3,361 repaired, 0 broken.

## 4. Issue #9857

`run/regressions.sh`, first lines of `results/regressions.txt`: on master the union is `undefined` with
`simplifyUnion` true and a loop of area 585.229 without it. With the fix both give 1635.938.

## 5. Timing (Results, last sentences)

`scripts/perf/perf.js` (union of a circle split into 2n arcs with n issue-like shapes), master 8ce43acc16 and fix
bce2c35940, n = 60, 150 and 300, six runs each, alternating builds, on one laptop (Apple M5 Pro, Node.js 24, `nice -n
10`, other work running). Raw times: `timing.txt`.

| n | master median (ms) | fix median (ms) | ratio |
|---|---|---|---|
| 60 | 224.5 | 312 | 1.39 |
| 150 | 855.5 | 1062.5 | 1.24 |
| 300 | 2905.5 | 3929 | 1.35 |

At n = 300 the adjusted graph of this test is not consistent, so the fallback assembles the graph a second time from
a copy of the intersections. With more than about a dozen shapes the result of this test is wrong on master and on the
fix (bridge segments between loops), so it measures time only.

