// Regression example for an early version of the fix: crescent inside a circle, cusp at the end of the shared arc (fillet inside the circle
// going back along the shared arc). Usage: node inner-cusp-repro.js <core-geometry.js> [rotDeg] [g] [r]
const G = require(process.argv[2]);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, Transform, Matrix3d, RegionOps, RegionBinaryOpType: Op, Angle, Vector3d, ParityRegion, UnionRegion } = G;
const rot = +(process.argv[3] ?? 113), g = +(process.argv[4] ?? 1e-7), r = +(process.argv[5] ?? 6.096);
const R = 18.288, O = Point3d.createZero(), deg = Math.PI / 180;
const at = (c, rr, a) => c.plusScaled(Vector3d.create(Math.cos(a * deg), Math.sin(a * deg)), rr);
const t = Transform.createOriginAndMatrix(undefined, Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(rot)));
const C = Loop.create(Arc3d.createXY(O, R, AngleSweep.createStartEndDegrees(0, 360))).cloneTransformed(t);
const S = Arc3d.createXY(O, R, AngleSweep.createStartEndDegrees(150, 210));
const F = Arc3d.createXY(at(O, R - r + g, 210), r, AngleSweep.createStartEndDegrees(210, 170));
const B = Loop.create(S, F, LineSegment3d.create(F.endPoint(), S.startPoint())).cloneTransformed(t);
const area = (x) => !x ? "undefined" : x instanceof Loop ? Math.abs(RegionOps.computeXYArea(x)).toFixed(4)
  : x instanceof ParityRegion ? (() => { const a = x.children.map((c) => Math.abs(RegionOps.computeXYArea(c))).sort((p, q) => q - p); return (a[0] - a.slice(1).reduce((s, v) => s + v, 0)).toFixed(4); })()
  : x instanceof UnionRegion ? x.children.map(area).join("+") : "?";
console.log(`rot=${rot} g=${g} r=${r} areas: circle ${area(C)} crescent ${area(B)}`);
for (const [n, op] of [["Union", Op.Union], ["Intersection", Op.Intersection], ["AMinusB", Op.AMinusB], ["Parity", Op.Parity]])
  console.log(` ${n}: ${area(RegionOps.regionBooleanXY(C, B, op))}`);
