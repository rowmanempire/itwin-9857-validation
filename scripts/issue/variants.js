// Independent stress test for the iTwin/itwinjs-core #9857 fix: generic versions of the issue geometry.
// Usage: node variants.js <core-geometry.js>
const lib = process.argv[2];
const G = require(lib);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, Transform, Matrix3d, RegionOps, RegionBinaryOpType, Angle } = G;

function round(x, digits) { if (digits === undefined) return x; const f = Math.pow(10, digits); return Math.round(x * f) / f; }

// Generic version of the issue geometry: circle radius R at origin, boundary on the left that shares an arc with the
// circle and has two external fillets of radius r tangent to the circle and to horizontal lines y=y1 and y=y2.
// delta changes the center distance of the fillets (negative = overlap with circle). digits rounds fillet centers.
function build(R, r, y1, y2, xLeft, delta, digits) {
  const d = R + r + delta;
  const lcY = y1 - r, ucY = y2 + r;
  const lc = Point3d.create(round(-Math.sqrt(d * d - lcY * lcY), digits), round(lcY, digits));
  const uc = Point3d.create(round(-Math.sqrt(d * d - ucY * ucY), digits), round(ucY, digits));
  const lowerToCircleDeg = Math.atan2(-lc.y, -lc.x) * 180 / Math.PI;
  const upperToCircleDeg = Math.atan2(-uc.y, -uc.x) * 180 / Math.PI;
  const lower = Arc3d.createXY(lc, r, AngleSweep.createStartEndDegrees(90, lowerToCircleDeg));
  const upper = Arc3d.createXY(uc, r, AngleSweep.createStartEndDegrees(upperToCircleDeg, -90));
  const lowT = Math.atan2(lc.y, lc.x) * 180 / Math.PI; // about -172
  let upT = Math.atan2(uc.y, uc.x) * 180 / Math.PI; // about 125
  upT -= 360;
  const shared = Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(lowT, upT));
  const bottom = Point3d.create(xLeft, y1), top = Point3d.create(xLeft, y2);
  const circle = Loop.create(Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(0, 360)));
  const boundary = Loop.create(
    LineSegment3d.create(bottom, lower.startPoint()), lower, shared, upper,
    LineSegment3d.create(upper.endPoint(), top), LineSegment3d.create(top, bottom));
  return { circle, boundary };
}

function prep(loops, transform) {
  for (const l of loops) {
    if (transform) l.tryTransformInPlace(transform);
    if (RegionOps.computeXYArea(l) < 0) l.reverseInPlace();
  }
}

const stats = {};
const failures = [];
function record(group, ok, info) {
  const s = stats[group] ??= { total: 0, bad: 0, examples: [] };
  s.total++;
  if (!ok) { s.bad++; s.examples.push(info); failures.push(info.key + " expected=" + info.expected + " got=" + info.got + " type=" + info.type); }
}

// area error allowed from distance tolerance 1e-6 along a perimeter of about 15 R
const absTol = (R) => 20 * 1e-6 * 15 * R;
let caseKey = "";
function runCase(group, R, r, y1, y2, xLeft, delta, digits, transform, relTol, label) {
  caseKey = `${group} delta=${delta} ${label ?? ""}`;
  const { circle, boundary } = build(R, r, y1, y2, xLeft, delta, digits);
  prep([circle, boundary], transform);
  const a = RegionOps.computeXYArea(circle), b = RegionOps.computeXYArea(boundary);
  for (const swap of [false, true]) {
    const [A, B] = swap ? [boundary, circle] : [circle, boundary];
    for (const simplifyUnion of [true, false]) {
      let res, area;
      try {
        res = RegionOps.regionBooleanXY(A, B, RegionBinaryOpType.Union, { simplifyUnion });
        area = res ? RegionOps.computeXYArea(res) : undefined;
      } catch (e) { area = "throw " + e.message; }
      const expected = a + b;
      const ok = typeof area === "number" && Math.abs(area - expected) <= relTol * expected + absTol(R);
      record(group, ok, { R, delta, digits, swap, simplifyUnion, expected, got: area, type: res?.constructor.name, key: `${caseKey} swap=${swap} su=${simplifyUnion} Union` });
    }
    // AMinusB and BMinusA without simplify
    for (const [op, exp] of [[RegionBinaryOpType.AMinusB, swap ? b : a], [RegionBinaryOpType.BMinusA, swap ? a : b]]) {
      let area;
      try { const res = RegionOps.regionBooleanXY(A, B, op); area = res ? RegionOps.computeXYArea(res) : undefined; } catch (e) { area = "throw"; }
      const ok = typeof area === "number" && Math.abs(area - exp) <= relTol * (a + b) + absTol(R);
      record(group + " minus", ok, { R, delta, op: RegionBinaryOpType[op], swap, expected: exp, got: area, key: `${caseKey} swap=${swap} ${RegionBinaryOpType[op]}` });
    }
  }
}

const rot = (deg, sx = 1, sy = 1, shift = [0, 0]) => Transform.createOriginAndMatrix(Point3d.create(shift[0], shift[1]),
  Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(deg)).multiplyMatrixMatrix(Matrix3d.createScale(sx, sy, 1)));

// 1. Issue geometry, exact (digits 8 like the issue), scaled 1e-3..1e6, shifted, rotated.
const baseR = 18.288, baseRr = 6.096, baseY1 = 3.048, baseY2 = 13.716, baseX = -70;
for (const scale of [1e-3, 1e-2, 0.1, 1, 10, 100, 1e3, 1e4, 1e6]) {
  for (const shift of [[0, 0], [1000, -500], [1e5, 2e5]]) {
    for (const deg of [0, 17, 90, 133, 250]) {
      const t = rot(deg, 1, 1, [shift[0] * scale, shift[1] * scale]);
      runCase(`issue-shape scale=${scale} shift=${shift[0] ? "yes" : "no"}`, baseR * scale, baseRr * scale, baseY1 * scale, baseY2 * scale, baseX * scale, 0, scale >= 1 ? 8 : 12, t, 1e-6, `shift=${shift} deg=${deg}`);
    }
  }
}
// 2. Perturbed tangency: delta = overlap or gap near tolerance, various radii.
for (const R of [1e-3, 1, 18.288, 1000, 1e6]) {
  for (const delta of [-5e-7, -1e-7, -1e-8, -4e-9, -1e-10, 0, 1e-10, 4e-9, 1e-8, 1e-7, 5e-7]) {
    for (const deg of [0, 41, 199]) {
      runCase(`perturbed R=${R}`, R, R / 3, R / 6, R * 0.75, -4 * R, delta, undefined, rot(deg), 1e-6, `deg=${deg}`);
    }
  }
}
// 3. Elliptic arcs: nonuniform scale/skew of the whole configuration (tangency kept), with overlap delta.
for (const [sx, sy] of [[1.5, 1], [1, 0.4], [3, 1.2]]) {
  for (const delta of [-1e-7, -4e-9, 0, 4e-9]) {
    for (const deg of [0, 33, 160]) {
      const t = Transform.createOriginAndMatrix(undefined,
        Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(deg)).multiplyMatrixMatrix(Matrix3d.createScale(sx, sy, 1)).multiplyMatrixMatrix(Matrix3d.createRowValues(1, 0.3, 0, 0, 1, 0, 0, 0, 1)));
      runCase(`ellipse sx=${sx} sy=${sy}`, 18.288, 6.096, 3.048, 13.716, -70, delta, 8, t, 1e-6, `deg=${deg}`);
    }
  }
}

for (const [k, v] of Object.entries(stats))
  console.log(`${v.bad === 0 ? "ok " : "BAD"} ${k}: ${v.bad}/${v.total} wrong`);
if (process.argv[3]) require("fs").writeFileSync(process.argv[3], failures.join("\n") + "\n");
