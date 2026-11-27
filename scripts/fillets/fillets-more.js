// More fillet stress families for the iTwin/itwinjs-core #9857 fix (written against an early version of the fix). Exact expected areas by construction.
// Usage: node fillets-more.js <core-geometry.js> <family> [out.txt]
// Families (C = circle R = 18.288 at origin, S = shared arc 150..210 of C, g = overlap of fillet into/out of C):
//  innersmall : region inside C, S joins smoothly to internally tangent fillets of SMALL radius (short snap distance)
//  innercusp  : crescent inside C: S, then at its end a fillet inside C going back along S (cusp inside the circle)
//  reverse    : region outside C, S continues smoothly with an inflection into external fillets curving away from C
//  reversenb  : reverse plus pie sectors of C sharing arcs 210..240 and 120..150 (overlap continues beyond the fillet ends)
//  outersmall : outer cusp and reverse with fillet radius 0.01 and 0.05 (short snap distance)
//  outsmooth  : region outside C, S joins smoothly to fillets of radius r > R that contain C (external smooth continuation)
//  innernb    : innersmall/inner geometry plus a neighbor annulus sector outside C sharing arc 210..240 and 120..150
//  outernb    : issue-like cusp (outer) plus a pie sector of C (inside C) sharing arc 210..240
//  shortfil   : issue-like cusp and inner smooth with very short fillets (length 1e-4 .. 1e-3) continued by a line
//  ellipx     : outer, inner, innercusp after strong non-uniform scaling (6 and 0.15)
//  scale      : outer, inner, innercusp scaled uniformly by 0.01, 0.1, 10, 1000 (absolute g)
//  mtol       : outer, inner, innercusp with mergeTolerance 1e-8, 1e-4, 1e-3 and g relative to it
//  gdense     : outer, inner, innercusp with dense g in 1e-9 .. 1.1e-6
const lib = process.argv[2];
const fam = process.argv[3];
const outFile = process.argv[4];
const G = require(lib);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, UnionRegion, ParityRegion, Transform, Matrix3d, RegionOps, RegionBinaryOpType: Op, Angle, Vector3d } = G;
const fs = require("fs");
const deg = Math.PI / 180;
const dir = (a) => Vector3d.create(Math.cos(a * deg), Math.sin(a * deg));
const R = 18.288;
const O = Point3d.createZero();
const at = (c, r, a) => c.plusScaled(dir(a), r);
const sweep = (a, b) => AngleSweep.createStartEndDegrees(a, b);
const circle = (r, seam, ccw) => Loop.create(Arc3d.createXY(O, r, ccw ? sweep(seam, seam + 360) : sweep(seam + 360, seam)));

// inner smooth: fillets internally tangent, centers at distance R - r + g. len = fillet length (default 80 deg)
function inner(g, r, half, len) {
  const a1 = 180 - half, a2 = 180 + half;
  const sw = len ? len / r / deg : 80;
  const c1 = at(O, R - r + g, a1), c2 = at(O, R - r + g, a2);
  const S = Arc3d.createXY(O, R, sweep(a1, a2));
  const F2 = Arc3d.createXY(c2, r, sweep(a2, a2 + sw));
  const F1 = Arc3d.createXY(c1, r, sweep(a1 - sw, a1));
  return [Loop.create(S, F2, LineSegment3d.create(F2.endPoint(), F1.startPoint()), F1)];
}
// outer cusp (issue-like). len = fillet length (default min(60deg, 8))
function outer(g, r, half, len) {
  const a1 = 180 - half, a2 = 180 + half;
  const c1 = at(O, R + r - g, a1), c2 = at(O, R + r - g, a2);
  const sw = len ? len / r / deg : Math.min(60, 8 / r / deg);
  const F1 = Arc3d.createXY(c1, r, sweep(a1 + 180 - sw, a1 + 180));
  const S = Arc3d.createXY(O, R, sweep(a1, a2));
  const F2 = Arc3d.createXY(c2, r, sweep(a2 + 180, a2 + 180 + sw));
  const e1 = F1.startPoint(), e2 = F2.endPoint();
  const xl = Math.min(e1.x, e2.x) - 20;
  const l1 = Point3d.create(xl, e2.y), l2 = Point3d.create(xl, e1.y);
  return [Loop.create(F1, S, F2, LineSegment3d.create(e2, l1), LineSegment3d.create(l1, l2), LineSegment3d.create(l2, e1))];
}
// crescent inside C: S (a1..a2), at P2 a fillet inside C (radius r, internally tangent, overlap g) going back toward a1, line to P1
function innercusp(g, r, half) {
  const a1 = 180 - half, a2 = 180 + half;
  const c2 = at(O, R - r + g, a2);
  const S = Arc3d.createXY(O, R, sweep(a1, a2));
  const F = Arc3d.createXY(c2, r, sweep(a2, a2 - 40));
  return [Loop.create(S, F, LineSegment3d.create(F.endPoint(), S.startPoint()))];
}
// smooth continuation outside: fillets of radius r > R containing C, center at distance r - R + g on the far side
function outsmooth(g, r, half) {
  const a1 = 180 - half, a2 = 180 + half;
  const c1 = at(O, R - r - g, a1), c2 = at(O, R - r - g, a2);
  const sw = Math.min(40, 8 / r / deg);
  const S = Arc3d.createXY(O, R, sweep(a1, a2));
  const F2 = Arc3d.createXY(c2, r, sweep(a2, a2 + sw));
  const F1 = Arc3d.createXY(c1, r, sweep(a1 - sw, a1));
  const e1 = F1.startPoint(), e2 = F2.endPoint();
  const xl = Math.min(e1.x, e2.x) - 20;
  const l1 = Point3d.create(xl, e2.y), l2 = Point3d.create(xl, e1.y);
  return [Loop.create(S, F2, LineSegment3d.create(e2, l1), LineSegment3d.create(l1, l2), LineSegment3d.create(l2, e1), F1)];
}
// reverse curve: region outside C, S continues smoothly (G1, inflection) into external fillets curving away from C
function reverse(g, r, half) {
  const a1 = 180 - half, a2 = 180 + half;
  const c1 = at(O, R + r - g, a1), c2 = at(O, R + r - g, a2);
  const sw = Math.min(40, 8 / r / deg);
  const S = Arc3d.createXY(O, R, sweep(a1, a2));
  const F2 = Arc3d.createXY(c2, r, sweep(a2 + 180, a2 + 180 - sw));
  const F1 = Arc3d.createXY(c1, r, sweep(a1 + 180 + sw, a1 + 180));
  const e1 = F1.startPoint(), e2 = F2.endPoint();
  const xl = Math.min(e1.x, e2.x, -R) - 20;
  const l1 = Point3d.create(xl, e2.y), l2 = Point3d.create(xl, e1.y);
  return [Loop.create(S, F2, LineSegment3d.create(e2, l1), LineSegment3d.create(l1, l2), LineSegment3d.create(l2, e1), F1)];
}
// annulus sector outside C sharing arc a..b of C
function annulus(a, b) {
  const Ci = Arc3d.createXY(O, R, sweep(a, b)), Co = Arc3d.createXY(O, 1.3 * R, sweep(b, a));
  return Loop.create(Ci, LineSegment3d.create(Ci.endPoint(), Co.startPoint()), Co, LineSegment3d.create(Co.endPoint(), Ci.startPoint()));
}
// pie sector of C sharing arc a..b
function pie(a, b) {
  const Ci = Arc3d.createXY(O, R, sweep(a, b));
  return Loop.create(Ci, LineSegment3d.create(Ci.endPoint(), O), LineSegment3d.create(O, Ci.startPoint()));
}

function loopArea(l) { return Math.abs(RegionOps.computeXYArea(l)); }
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
function tf(rot, mirror, shift, sx, sy) {
  let t = Transform.createOriginAndMatrix(Point3d.create(shift[0], shift[1]), Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(rot)));
  if (sx !== 1 || sy !== 1) t = t.multiplyTransformTransform(Transform.createOriginAndMatrix(undefined, Matrix3d.createScale(sx, sy, 1)));
  if (mirror) t = t.multiplyTransformTransform(Transform.createOriginAndMatrix(undefined, Matrix3d.createScale(-1, 1, 1)));
  return t;
}
const xf = (l, t, mirror) => { const c = l.cloneTransformed(t); if (mirror) c.reverseInPlace(); return c; };
const orient = (l, rev) => { if (RegionOps.computeXYArea(l) < 0) l.reverseInPlace(); if (rev) l.reverseInPlace(); return l; };

const ops = [Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity];
const opName = ["Union", "Parity", "Intersection", "AMinusB", "BMinusA"];
const fails = []; let total = 0; const stat = {};
function run(key, A, B, exp, mergeTolerance) {
  for (const op of ops) for (const su of op === Op.Union ? [true, false] : [false]) {
    total++;
    let res, err;
    const opts = { simplifyUnion: su };
    if (mergeTolerance !== undefined) opts.mergeTolerance = mergeTolerance;
    try { res = RegionOps.regionBooleanXY(A, B, op, opts); } catch (e) { err = e.message; }
    const e = exp[op];
    const got = res ? resultArea(res) : (e < 1e-6 * Math.max(1, e) ? 0 : NaN);
    const tolA = 1e-4 * Math.max(1, e) + (mergeTolerance ?? 0) * 100;
    if (err || !Number.isFinite(got) || Math.abs(got - e) > tolA) {
      fails.push(`fail ${key} op=${opName[op]} su=${su} got=${err ? "throw" : res ? got.toPrecision(8) : "undefined"} exp=${e.toPrecision(8)}`);
      stat[key.split(" ")[0]] = (stat[key.split(" ")[0]] || 0) + 1;
    }
  }
}

const GSTD = [0, 1e-10, 1e-9, -1e-9, 4e-9, 1e-8, -1e-8, 1e-7, -1e-7, 3e-7, 6e-7, -6e-7];
// configurations: [subfamily, g, params, sx, sy, mergeTol]
const cfgs = [];
const add = (sub, gs, ps, sx = 1, sy = 1, mt = undefined) => { for (const g of gs) for (const p of ps) cfgs.push([sub, g, p, sx, sy, mt]); };
if (fam === "innersmall") add("inner", [1e-12, 1e-11, 3e-11, 1e-10, 2e-10, 3e-10, 5e-10, 1e-9, 1e-8, 1e-7, 3e-7], [[0.01, 30], [0.05, 30], [0.3, 30], [1.5, 30]]);
if (fam === "innercusp") add("innercusp", GSTD, [[6.096, 30], [0.5 * R, 30], [0.9 * R, 30], [0.3, 30], [6.096, 0.5], [6.096, 0.01]]);
if (fam === "reverse") add("reverse", GSTD, [[6.096, 30], [0.5, 30], [60, 30], [6.096, 3]]);
if (fam === "reversenb") add("reversenb", GSTD, [[6.096, 30], [0.5, 30], [60, 30]]);
if (fam === "outersmall") { add("outer", GSTD, [[0.01, 30], [0.05, 30]]); add("reverse", GSTD, [[0.01, 30], [0.05, 30]]); }
if (fam === "outsmooth") add("outsmooth", GSTD, [[1.5 * R, 30], [3 * R, 30], [30 * R, 30], [1.05 * R, 30]]);
if (fam === "innernb") add("innernb", GSTD, [[6.096, 30], [0.5 * R, 30], [0.9 * R, 30], [0.05, 30]]);
if (fam === "outernb") add("outernb", GSTD, [[6.096, 30], [60, 30], [0.5, 30]]);
if (fam === "shortfil") {
  add("outer", GSTD, [[6.096, 30, 1e-3], [6.096, 30, 4e-4], [6.096, 30, 2.5e-4], [6.096, 30, 1e-4], [60, 30, 1e-3]]);
  add("inner", GSTD, [[6.096, 30, 1e-3], [6.096, 30, 4e-4], [6.096, 30, 1e-4]]);
}
if (fam === "ellipx") for (const [sx, sy] of [[6, 1], [0.15, 1]]) {
  add("outer", GSTD, [[6.096, 30], [60, 30]], sx, sy);
  add("inner", GSTD, [[6.096, 30], [0.9 * R, 30]], sx, sy);
  add("innercusp", GSTD, [[6.096, 30]], sx, sy);
}
if (fam === "scale") for (const s of [0.01, 0.1, 10, 1000]) {
  add("outer", GSTD, [[6.096, 30]], s, s);
  add("inner", GSTD, [[6.096, 30], [0.9 * R, 30]], s, s);
  add("innercusp", GSTD, [[6.096, 30]], s, s);
}
if (fam === "mtol") for (const T of [1e-8, 1e-4, 1e-3]) {
  const gs = [0, 0.01, 0.1, 0.3, 0.5, 0.7, 0.74, 0.76, 0.9, -0.3].map((v) => v * T);
  add("outer", gs, [[6.096, 30]], 1, 1, T);
  add("inner", gs, [[6.096, 30], [0.9 * R, 30]], 1, 1, T);
  add("innercusp", gs, [[6.096, 30]], 1, 1, T);
}
if (fam === "gdense") {
  const gs = [1e-9, 2e-9, 5e-9, 1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 7e-7, 7.5e-7, 8e-7, 9e-7, 1e-6, 1.1e-6];
  add("outer", gs, [[6.096, 30], [60, 30]]);
  add("inner", gs, [[6.096, 30], [0.9 * R, 30]]);
  add("innercusp", gs, [[6.096, 30]]);
}
if (cfgs.length === 0) throw new Error("unknown family " + fam);

for (const [sub, g, p, sx, sy, mt] of cfgs)
  for (const seam of [0, 180]) for (const capCcw of [true, false]) for (const revA of [false, true]) for (const revB of [false, true])
    for (const [rot, shift] of [[0, [0, 0]], [30, [0, 0]], [113, [1000, -500]], [251, [-3, 7]]]) for (const mirror of [false, true]) {
      const t = tf(rot, mirror, shift, sx, sy);
      const C = orient(xf(circle(R, seam, capCcw), t, mirror), revA);
      let main, extra = [], extraInside = false;
      if (sub === "inner") main = inner(g, p[0], p[1], p[2]);
      else if (sub === "outer") main = outer(g, p[0], p[1], p[2]);
      else if (sub === "innercusp") main = innercusp(g, p[0], p[1]);
      else if (sub === "outsmooth") main = outsmooth(g, p[0], p[1]);
      else if (sub === "reverse") main = reverse(g, p[0], p[1]);
      else if (sub === "reversenb") { main = reverse(g, p[0], p[1]); extra = [pie(210, 240), pie(120, 150)]; extraInside = true; }
      else if (sub === "innernb") { main = inner(g, p[0], p[1]); extra = [annulus(210, 240), annulus(120, 150)]; }
      else if (sub === "outernb") { main = outer(g, p[0], p[1]); extra = [pie(210, 240)]; extraInside = true; }
      const mainT = main.map((l) => orient(xf(l, t, mirror), revB));
      const extraT = extra.map((l) => orient(xf(l, t, mirror), revB));
      const a = loopArea(C), b = mainT.map(loopArea).reduce((s, v) => s + v, 0), x = extraT.map(loopArea).reduce((s, v) => s + v, 0);
      const mainInside = sub === "inner" || sub === "innercusp" || sub === "innernb";
      // inside part of B, outside part of B
      const bin = (mainInside ? b : 0) + (extraInside ? x : 0), bout = (mainInside ? 0 : b) + (extraInside ? 0 : x);
      const exp = { [Op.Union]: a + bout, [Op.Intersection]: bin, [Op.AMinusB]: a - bin, [Op.BMinusA]: bout, [Op.Parity]: a - bin + bout };
      const parts = [...mainT, ...extraT];
      const B = parts.length === 1 ? parts[0] : UnionRegion.create(...parts);
      const key = `${sub} g=${g} p=${p.map((v) => +v.toPrecision(5)).join("/")} s=${sx}/${sy} mt=${mt ?? "-"} seam=${seam} ccw=${capCcw} revA=${revA} revB=${revB} rot=${rot} mirror=${mirror}`;
      run(key + " swap=false", C, B, exp, mt);
      const expS = { [Op.Union]: exp[Op.Union], [Op.Intersection]: exp[Op.Intersection], [Op.AMinusB]: exp[Op.BMinusA], [Op.BMinusA]: exp[Op.AMinusB], [Op.Parity]: exp[Op.Parity] };
      run(key + " swap=true", B, C, expS, mt);
    }
console.log(`${fam}: ${fails.length}/${total} wrong`, JSON.stringify(stat));
if (outFile) fs.writeFileSync(outFile, fails.sort().join("\n") + (fails.length ? "\n" : ""));
