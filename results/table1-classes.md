# Table 1 of the article: classes of regressions

Classes of configurations broken by intermediate versions of the fix, and what blocks them in the submitted version
(pull request iTwin/itwinjs-core#10011, fix commit bce2c35940; later heads of the pull request only merge master, without changes to `core/geometry/src`). Counts are configurations with a regression in the family
that exposed the class, on the intermediate version where the class was found. They are not counts against the
submitted version: against bce2c35940 the generated sets break one configuration in total (see `summary.md`).

| # | Geometric relation | What went wrong | Regressions | What blocks it now |
|---|---|---|---|---|
| 1 | Two arcs of equal radius, centers 5e-6 apart, crossing at a small angle | A real crossing was moved by 1.74 units | 14 | Move only if the angle between the curves shrinks toward the endpoint |
| 2 | The shared arc continues smoothly into a smaller arc inside the circle | Internal tangency, the vertex ended up on the wrong side | 5,248 | Move only for external tangency |
| 3 | A cusp inside the circle, and two other internal tangencies | Same as 2 | 2,294 + 1,392 + 144 | Same rule |
| 4 | Another vertex lies between the old crossing and the endpoint | Vertices along the circle changed order | 9 in three families | Mostly: no other intersection between old and new location, by distance in the plane |
| 5 | A thin shape crosses the circle just past the shared arc | One move was blocked, a second move to the same point was not | 5 in three families | All moves to one endpoint happen together or not at all |
| 6 | The endpoint is a corner of the other region | Moving onto the corner changed which face the sliver joined | 6 | No move onto a corner |
| 7 | An elliptic fillet on an ellipse: the crossing, 6.5e-6 before the fillet's end, moved to that end, and the graph vertex lies 2e-8 past the point where the side was checked | Over those 2e-8 the ellipse's tangent turns by 9e-10 radians, so at the vertex the fillet was on the wrong side | 1 test case (10 operations) | Side checked at the graph vertex itself, with the same 1e-12 as the sort |
| 8 | A third arc on the same circle, center shifted by 1e-7 to 9e-7 | Moved along with the others, tangent off by up to 5e-8 radians | 24 of 672 | Rule 7 for every curve that moves |
| 9 | A small fillet tangent to the circle from inside at the other end of the shared arc | The move made a vertex an exact tangency, and the radius tie-break put the fillet on the wrong side | 8 of 12 operations in each of 5 examples | Edges with nearly equal tangents are ordered by where they are a short distance away |
| 10 | Another gap on the same boundary, slightly over the tolerance (12), or an inner fillet sticking out by 1e-7 with no crossing (3) | The adjusted graph left that boundary open | 15 | Consistency check, then rebuild as on the main branch |
| 11 | A closed curve that touches another curve at its own start point | Its face has one edge, and faces with fewer than two edges were dropped | 1 | Keep one-edge faces that have area |
| 12 | Nearly full arcs (359.99999594 degrees) in loops open by 4.7e-6 | The graph was inconsistent, and the rebuild after the check still kept the overlap fix | 1 | The rebuild drops the overlap fix too |

Two more rows of the article belong to the scripts, not to the geometry:

- Results of two families were once merged by key, which reported 32 regressions where there were 128.
- `scripts/issue/sweep-limited.js` keeps only the first 5,000 failures per family. On master the fillet family has more,
  so failures of master past that limit are not recorded and 24 configurations look like regressions (set `issue`,
  list `sweep-limited`). `scripts/issue/sweep.js` is the same script without the limit (set `sweep`): 0 broken.

## Saved inputs

`regressions/` holds the inputs that were saved while the classes were found, and `run/regressions.sh` runs them on
master and on the fix (stored output: `regressions.txt`). Each folder is named after the generator that found its
inputs (`cusp`, `placement`, `corner`, `vertex`, see the README). The two inputs of classes 11 and 12 are in
`regressions/classes-11-12/` (with a description of the expected result in the `note` field). `run/regressions.sh` does
not run them: they are unit tests of the pull request (`ClosedCurveFaceAtVertex`, `NearFullArcsInLoopsOpenBeyondTolerance`, `ClosedBSplineTouchingCircleAtStart`
in `core/geometry/src/test/curve/RegionBoolean.test.ts`).
`regressions/loops/` holds the input of a regression of `RegionOps.constructAllXYRegionLoops` on the earlier head
`dbce3b684e`, fixed in bce2c35940 (not a class of Table 1, see `summary.md`). It is the unit test
`ConstructLoopsWithoutWrappedArcOverlaps`.
