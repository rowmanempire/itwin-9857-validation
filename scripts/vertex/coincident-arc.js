// Counterexample search: an extra arc D coincident with the circle (center shifted along the tangent at the vertex by
// delta, so its tangent at the vertex is rotated by about delta / R), passing through the snap vertex.
const libs = { master: process.argv[2], branch: process.argv[3] };
const verbose = process.argv[4] === "v";
const out = {};
for (const [name, lib] of Object.entries(libs)) {
  const G = require(lib);
  const { Arc3d, AngleSweep, Point3d, Loop, LineSegment3d, RegionOps, RegionBinaryOpType, UnionRegion, Transform, Matrix3d, Angle } = G;
  const R = 18.288, rf = 6.096;
  const deg = (d) => d * Math.PI / 180;
  const make = (overlap, delta, rot, placeInB, reverseD, dFrom, dTo) => {
    const fc = (d) => Point3d.create((R + rf - overlap) * Math.cos(deg(d)), (R + rf - overlap) * Math.sin(deg(d)));
    const upper = Arc3d.createXY(fc(150), rf, AngleSweep.createStartEndDegrees(240, 330));
    const lower = Arc3d.createXY(fc(210), rf, AngleSweep.createStartEndDegrees(30, 120));
    const shared = Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(150, 210));
    const ul = Point3d.create(-60, upper.startPoint().y), ll = Point3d.create(-60, lower.endPoint().y);
    const circle = Loop.create(Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(0, 360)));
    const boundary = Loop.create(upper, shared, lower, LineSegment3d.create(lower.endPoint(), ll), LineSegment3d.create(ll, ul), LineSegment3d.create(ul, upper.startPoint()));
    // tangent direction at 150 deg is (-sin, cos)
    const dc = Point3d.create(-Math.sin(deg(150)) * delta, Math.cos(deg(150)) * delta);
    const D = Arc3d.createXY(dc, R, reverseD ? AngleSweep.createStartEndDegrees(dTo, dFrom) : AngleSweep.createStartEndDegrees(dFrom, dTo));
    const inner = Point3d.create(0.5 * R * Math.cos(deg(150)), 0.5 * R * Math.sin(deg(150)));
    const l2 = Loop.create(D, LineSegment3d.create(D.endPoint(), inner), LineSegment3d.create(inner, D.startPoint()));
    const rt = Transform.createOriginAndMatrix(undefined, Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(rot)));
    for (const loop of [circle, boundary, l2]) {
      loop.tryTransformInPlace(rt);
      if (RegionOps.computeXYArea(loop) < 0) loop.reverseInPlace();
    }
    const aC = RegionOps.computeXYArea(circle), aB = RegionOps.computeXYArea(boundary), aL = RegionOps.computeXYArea(l2);
    if (placeInB) {
      return { A: circle, B: UnionRegion.create(boundary, l2), exp: [aC + aB, aC + aB, aL, aC - aL, aB, aC - aL + aB] };
    }
    return { A: UnionRegion.create(circle, l2), B: boundary, exp: [aC + aB, aC + aB, 0, aC, aB, aC + aB] };
  };
  const resultArea = (r) => r instanceof UnionRegion ? r.children.reduce((s, c) => s + resultArea(c), 0) : Math.abs(RegionOps.computeXYArea(r));
  const ops = [[RegionBinaryOpType.Union, false], [RegionBinaryOpType.Union, true], [RegionBinaryOpType.Intersection, false],
  [RegionBinaryOpType.AMinusB, false], [RegionBinaryOpType.BMinusA, false], [RegionBinaryOpType.Parity, false]];
  for (const overlap of [1e-9, 1e-8, 1e-7, 5e-7])
    for (const delta of [-9e-7, -5e-7, -1e-7, 0, 1e-7, 5e-7, 9e-7])
      for (const rot of [0, 30, 113])
        for (const placeInB of [false, true])
          for (const reverseD of [false, true])
            for (const [dFrom, dTo] of [[140, 160], [100, 175]]) {
              const key = [overlap, delta, rot, placeInB, reverseD, dFrom].join(" ");
              const { A, B, exp } = make(overlap, delta, rot, placeInB, reverseD, dFrom, dTo);
              let bad = 0;
              const detail = [];
              for (let j = 0; j < ops.length; j++) {
                let r;
                try { r = RegionOps.regionBooleanXY(A, B, ops[j][0], { simplifyUnion: ops[j][1] }); } catch (e) { r = undefined; }
                const a = r ? resultArea(r) : 0;
                if (Math.abs(a - exp[j]) > 1e-3) { bad++; detail.push(`${j}:${a.toFixed(3)}/${exp[j].toFixed(3)}`); }
              }
              out[key] = out[key] || {};
              out[key][name] = { bad, detail: detail.join(",") };
            }
}
let nCases = 0, regress = 0, fixed = 0, bothBad = 0;
for (const [k, v] of Object.entries(out)) {
  nCases++;
  if (v.master.bad === 0 && v.branch.bad > 0) { regress++; console.log("REGRESSION", k, v.branch.detail); }
  else if (v.master.bad > 0 && v.branch.bad === 0) { fixed++; if (verbose) console.log("fixed", k, v.master.detail); }
  else if (v.master.bad > 0) { bothBad++; if (verbose || v.branch.bad > v.master.bad) console.log("both", k, "m", v.master.bad, "b", v.branch.bad); }
}
console.log({ nCases, regress, fixed, bothBad });
const agg = {};
for (const [k, v] of Object.entries(out)) { const g = k.split(" ").slice(0, 3).join(" "); agg[g] = agg[g] || [0, 0, 0]; agg[g][0] += v.master.bad; agg[g][1] += v.branch.bad; agg[g][2]++; }
for (const [g, a] of Object.entries(agg)) console.log("AGG", g, "master", a[0], "branch", a[1], "of", a[2] * 6);
