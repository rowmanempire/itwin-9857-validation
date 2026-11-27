// Fillet stress families for the iTwin/itwinjs-core #9857 fix. Exact expected areas by construction.
// Usage: node fillets.js <core-geometry.js> <family> [out.txt]
// Families:
//  inner  : region inside circle C, shared arc S on C, smooth G1 joins to fillets internally tangent to C (overlap g)
//  outer  : like the issue (cusp, external fillets), fillet radius r from small to almost straight
//  three  : A = C, B = UnionRegion[B1 (shared arc + radial line), B2 (fillet sector tangent at the end of B1's arc)],
//           so the coincident overlap that ends at P belongs to a different loop than the fillet
//  short  : issue-like cusp with very short shared arc (0.01..1 degree), both fillet ends close together
//  ellip  : outer and inner families after non-uniform scaling (arcs become ellipses)
const lib = process.argv[2];
const fam0 = process.argv[3];
const SPLIT = fam0.startsWith("split-"); // circle made of two half circles, seam near the ends of the shared arc
const fam = SPLIT ? fam0.slice(6) : fam0;
const outFile = process.argv[4];
const G = require(lib);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, UnionRegion, ParityRegion, Transform, Matrix3d, RegionOps, RegionBinaryOpType: Op, Angle, Vector3d } = G;
const fs = require("fs");
const deg = Math.PI / 180;
const dir = (a) => Vector3d.create(Math.cos(a * deg), Math.sin(a * deg));
const R = 18.288;
const O = Point3d.createZero();
const at = (c, r, a) => c.plusScaled(dir(a), r);
const join = (p, q) => p.distanceXY(q) > 1e-5 ? [LineSegment3d.create(p, q)] : []; // close the loop only for large gaps (sanity runs)
const circle = (r, seam, ccw) => SPLIT ? Loop.create(
  Arc3d.createXY(O, r, ccw ? AngleSweep.createStartEndDegrees(seam, seam + 180) : AngleSweep.createStartEndDegrees(seam + 360, seam + 180)),
  Arc3d.createXY(O, r, ccw ? AngleSweep.createStartEndDegrees(seam + 180, seam + 360) : AngleSweep.createStartEndDegrees(seam + 180, seam))) : Loop.create(Arc3d.createXY(O, r, ccw ? AngleSweep.createStartEndDegrees(seam, seam + 360) : AngleSweep.createStartEndDegrees(seam + 360, seam)));

// inner: fillets internally tangent, centers at distance R - r + g (g > 0 pokes outside C by g)
function inner(g, r, half) {
  const a1 = 180 - half, a2 = 180 + half;
  const c1 = at(O, R - r + g, a1), c2 = at(O, R - r + g, a2);
  const S = Arc3d.createXY(O, R, AngleSweep.createStartEndDegrees(a1, a2));
  const F2 = Arc3d.createXY(c2, r, AngleSweep.createStartEndDegrees(a2, a2 + 80));
  const F1 = Arc3d.createXY(c1, r, AngleSweep.createStartEndDegrees(a1 - 80, a1));
  return [Loop.create(S, ...join(S.endPoint(), F2.startPoint()), F2, LineSegment3d.create(F2.endPoint(), F1.startPoint()), F1, ...join(F1.endPoint(), S.startPoint()))];
}
// outer: cusp, external fillets of radius r, centers at distance R + r - g
function outer(g, r, half) {
  const a1 = 180 - half, a2 = 180 + half;
  const c1 = at(O, R + r - g, a1), c2 = at(O, R + r - g, a2);
  const sw = Math.min(60, 8 / r / deg); // fillet length at most 8, so the two fillets do not cross
  const F1 = Arc3d.createXY(c1, r, AngleSweep.createStartEndDegrees(a1 + 180 - sw, a1 + 180));
  const S = Arc3d.createXY(O, R, AngleSweep.createStartEndDegrees(a1, a2));
  const F2 = Arc3d.createXY(c2, r, AngleSweep.createStartEndDegrees(a2 + 180, a2 + 180 + sw));
  const e1 = F1.startPoint(), e2 = F2.endPoint();
  const xl = Math.min(e1.x, e2.x) - 20;
  const l1 = Point3d.create(xl, e2.y), l2 = Point3d.create(xl, e1.y);
  return [Loop.create(F1, ...join(F1.endPoint(), S.startPoint()), S, ...join(S.endPoint(), F2.startPoint()), F2, LineSegment3d.create(e2, l1), LineSegment3d.create(l1, l2), LineSegment3d.create(l2, e1))];
}
// three: B1 = S(150..180) + radial lines, B2 = sector of external fillet tangent at P = R*dir(180), on the 180..210 side
function three(g, r) {
  const P = at(O, R, 180);
  const S = Arc3d.createXY(O, R, AngleSweep.createStartEndDegrees(150, 180));
  const Q = at(O, 1.5 * R + r, 180), Q1 = at(O, 1.5 * R + r, 150);
  const B1 = Loop.create(S, LineSegment3d.create(P, Q), LineSegment3d.create(Q, Q1), LineSegment3d.create(Q1, S.startPoint()));
  const c = at(O, R + r - g, 180);
  const F = Arc3d.createXY(c, r, AngleSweep.createStartEndDegrees(-90, 0));
  const B2 = Loop.create(F, LineSegment3d.create(F.endPoint(), c), LineSegment3d.create(c, F.startPoint()));
  return [B1, B2];
}

function loopArea(l) { return Math.abs(RegionOps.computeXYArea(l)); }
// area of a boolean result without running the boolean again
function resultArea(x) {
  if (!x) return 0;
  if (x instanceof Loop) return loopArea(x);
  if (x instanceof ParityRegion) {
    const a = x.children.map(loopArea).sort((p, q) => q - p);
    return a[0] - a.slice(1).reduce((s, v) => s + v, 0);
  }
  if (x instanceof UnionRegion) return x.children.reduce((s, c) => s + resultArea(c), 0);
  return NaN;
}
function tf(rot, mirror, shift, sx) {
  let t = Transform.createOriginAndMatrix(Point3d.create(shift[0], shift[1]), Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(rot)));
  if (sx !== 1) t = t.multiplyTransformTransform(Transform.createOriginAndMatrix(undefined, Matrix3d.createScale(sx, 1, 1)));
  if (mirror) t = t.multiplyTransformTransform(Transform.createOriginAndMatrix(undefined, Matrix3d.createScale(-1, 1, 1)));
  return t;
}
const xf = (l, t, mirror) => { const c = l.cloneTransformed(t); if (mirror) c.reverseInPlace(); return c; };
const orient = (l, rev) => { if (RegionOps.computeXYArea(l) < 0) l.reverseInPlace(); if (rev) l.reverseInPlace(); return l; };

const ops = [Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity];
const opName = ["Union", "Parity", "Intersection", "AMinusB", "BMinusA"];
const GAPS = process.env.GAPS ? process.env.GAPS.split(",").map(Number) : [0, 1e-10, 1e-9, -1e-9, 4e-9, 1e-8, -1e-8, 1e-7, -1e-7, 3e-7, 6e-7, -6e-7];
const fails = []; let total = 0; const stat = {};
function run(key, A, B, exp) {
  for (const op of ops) for (const su of op === Op.Union ? [true, false] : [false]) {
    total++;
    let res, err;
    try { res = RegionOps.regionBooleanXY(A, B, op, { simplifyUnion: su }); } catch (e) { err = e.message; }
    const e = exp[op];
    const got = res ? resultArea(res) : (e < 1e-6 ? 0 : NaN);
    const tolA = 1e-4 * Math.max(1, e);
    if (err || !Number.isFinite(got) || Math.abs(got - e) > tolA) {
      fails.push(`fail ${key} op=${opName[op]} su=${su} got=${err ? "throw" : res ? got.toFixed(4) : "undefined"} exp=${e.toFixed(4)}`);
      stat[key.split(" ")[0]] = (stat[key.split(" ")[0]] || 0) + 1;
    }
  }
}
const families = fam === "ellip" ? ["outer", "inner"] : [fam];
const sxs = fam === "ellip" ? [2, 0.37] : [1];
for (const f of families) {
  const params = f === "inner" ? [[6.096, 30], [0.5 * R, 30], [0.9 * R, 30], [0.99 * R, 20], [0.999 * R, 10]]
    : f === "outer" ? [[6.096, 30], [60, 30], [600, 30], [1e4, 30], [0.5, 30]]
      : f === "three" ? [[6.096], [60], [0.9 * R]]
        : [[6.096, 0.5], [6.096, 0.05], [6.096, 0.005], [60, 0.5]]; // short
  for (const g of GAPS) for (const p of params) for (const sx of sxs)
    for (const seam of SPLIT ? [150, 150.0005, 149.9995, 150.003, 149.997, 30.0005, 29.9995, 210.0005] : [0, 37, 180, 270]) for (const capCcw of [true, false]) for (const revA of [false, true]) for (const revB of [false, true])
      for (const [rot, shift] of [[0, [0, 0]], [30, [0, 0]], [113, [1000, -500]], [251, [-3, 7]]]) for (const mirror of [false, true]) {
        const t = tf(rot, mirror, shift, sx);
        const C = orient(xf(circle(R, seam, capCcw), t, mirror), revA);
        const parts = (f === "inner" ? inner(g, p[0], p[1]) : f === "outer" || f === "short" ? outer(g, p[0], f === "short" ? p[1] : p[1]) : three(g, p[0]))
          .map((l) => orient(xf(l, t, mirror), revB));
        const a = loopArea(C), bs = parts.map(loopArea), b = bs.reduce((s, v) => s + v, 0);
        const key = `${f} g=${g} p=${p.map((v) => +v.toFixed(4)).join("/")} sx=${sx} seam=${seam} ccw=${capCcw} revA=${revA} revB=${revB} rot=${rot} mirror=${mirror}`;
        const exp = {};
        if (f === "inner") { // B inside A
          exp[Op.Union] = a; exp[Op.Intersection] = b; exp[Op.AMinusB] = a - b; exp[Op.BMinusA] = 0; exp[Op.Parity] = a - b;
        } else { // disjoint interiors
          exp[Op.Union] = a + b; exp[Op.Intersection] = 0; exp[Op.AMinusB] = a; exp[Op.BMinusA] = b; exp[Op.Parity] = a + b;
        }
        const B = parts.length === 1 ? parts[0] : UnionRegion.create(...parts);
        run(key + " swap=false", C, B, exp);
        const expS = { [Op.Union]: exp[Op.Union], [Op.Intersection]: exp[Op.Intersection], [Op.AMinusB]: exp[Op.BMinusA], [Op.BMinusA]: exp[Op.AMinusB], [Op.Parity]: exp[Op.Parity] };
        run(key + " swap=true", B, C, expS);
        if (f === "three") { // A = C + B2, B = B1
          const e3 = { [Op.Union]: a + b, [Op.Intersection]: 0, [Op.AMinusB]: a + bs[1], [Op.BMinusA]: bs[0], [Op.Parity]: a + b };
          run(key + " swap=mixed", UnionRegion.create(C, parts[1]), parts[0], e3);
        }
      }
}
console.log(`${fam0}: ${fails.length}/${total} wrong`, JSON.stringify(stat));
if (outFile) fs.writeFileSync(outFile, fails.sort().join("\n") + (fails.length ? "\n" : ""));
