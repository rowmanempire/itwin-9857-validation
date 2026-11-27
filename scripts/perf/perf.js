// Timing of RegionOps.regionBooleanXY on many near-tangent cusps at once (to see the cost of the snap step).
// Usage: node perf.js <core-geometry.js> [n shapes, default 60]
// A = circle R = 100 split into 2n arcs, B = union of n issue-like shapes (cusp fillets overlapping C by 1e-7 at both
// ends of a shared arc). Prints the time of Union and the area of the result.
const lib = process.argv[2], n = Number(process.argv[3] ?? 60);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, UnionRegion, RegionOps, RegionBinaryOpType: Op } = require(lib);
const R = 100, g = 1e-7, r = 5, TWO_PI = 2 * Math.PI;
const arcs = [];
for (let i = 0; i < 2 * n; i++) arcs.push(Arc3d.createXY(Point3d.create(0, 0), R, AngleSweep.createStartEndRadians(i * Math.PI / n, (i + 1) * Math.PI / n)));
const A = Loop.create(...arcs);
const shapes = [];
for (let i = 0; i < n; i++) {
  const t1 = (i + 0.25) * TWO_PI / n, t2 = (i + 0.75) * TWO_PI / n;
  const S = Arc3d.createXY(Point3d.create(0, 0), R, AngleSweep.createStartEndRadians(t1, t2));
  const c1 = Point3d.create((R + r - g) * Math.cos(t1), (R + r - g) * Math.sin(t1));
  const c2 = Point3d.create((R + r - g) * Math.cos(t2), (R + r - g) * Math.sin(t2));
  // fillet 1 ends at the start of S coming from the S side (cusp), fillet 2 starts at the end of S going back
  const F1 = Arc3d.createXY(c1, r, AngleSweep.createStartEndRadians(t1 + Math.PI - 0.5, t1 + Math.PI));
  const F2 = Arc3d.createXY(c2, r, AngleSweep.createStartEndRadians(t2 + Math.PI, t2 + Math.PI + 0.5));
  const q1 = F2.endPoint(), q0 = F1.startPoint();
  const out = Point3d.create(1.3 * R * Math.cos(0.5 * (t1 + t2)), 1.3 * R * Math.sin(0.5 * (t1 + t2)));
  shapes.push(Loop.create(F1, S, F2, LineSegment3d.create(q1, out), LineSegment3d.create(out, q0)));
}
const B = UnionRegion.create(...shapes);
const t0 = process.hrtime.bigint();
const res = RegionOps.regionBooleanXY(A, B, Op.Union);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`n=${n} union ${ms.toFixed(0)} ms, result ${res ? res.constructor.name : "undefined"}`);
