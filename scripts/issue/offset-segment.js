// Circle A and circular segment B (same radius, center offset d along a random direction), many sweeps. Counts wrong ops per build.
const G = require(process.argv[2]);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, RegionOps, RegionBinaryOpType } = G;
const R = Number(process.argv[3] ?? 10);
const res = {}; const ex = [];
for (const d of [2e-6, 5e-6, 1e-5, 3e-5, 1e-4]) for (let s = -170; s < 180; s += 25) for (const sw of [20, 45, 70, -40]) {
  const A = Loop.create(Arc3d.createXY(Point3d.create(0, 0), R, AngleSweep.createStartEndDegrees(0, 360)));
  const arc = Arc3d.createXY(Point3d.create(d * R / 10, 0), R, AngleSweep.createStartSweepDegrees(s, sw));
  const B = Loop.create(arc, LineSegment3d.create(arc.endPoint(), arc.startPoint()));
  for (const l of [A, B]) if (RegionOps.computeXYArea(l) < 0) l.reverseInPlace();
  const a = RegionOps.computeXYArea(A), b = RegionOps.computeXYArea(B);
  for (const [name, op, exp] of [["A-B", RegionBinaryOpType.AMinusB, a - b], ["I", RegionBinaryOpType.Intersection, b], ["U", RegionBinaryOpType.Union, a]]) {
    const r = RegionOps.regionBooleanXY(A, B, op); const area = r ? RegionOps.computeXYArea(r) : NaN;
    const k = `d=${d}`; res[k] ??= [0, 0]; res[k][1]++;
    if (!(Math.abs(area - exp) < 1e-4 * R * R)) { res[k][0]++; ex.push(`d=${d} start=${s} sweep=${sw} ${name}`); }
  }
}
console.log(Object.entries(res).map(([k, v]) => `${k}: ${v[0]}/${v[1]} wrong`).join("  "));
if (process.argv[4]) require("fs").writeFileSync(process.argv[4], ex.join("\n") + "\n");
