// Stress families for the fix of iTwin/itwinjs-core #9857 (RegionOps.regionBooleanXY with near-tangent arcs).
// Usage: node cusp.js <core-geometry.js> <family> [out.txt] [caseFilter]
//   caseFilter: optional substring, only cases whose key contains it are run (to reproduce one failure).
// Output: one line per wrong boolean operation: "fail <family> id=<n> <parameters> swap=.. op=.. su=.. got=.. exp=..".
// Everything before " swap=" is the case key (one configuration in one placement).
//
// Expected areas come from an independent oracle (scanline integration, see below), not from the library under test, so
// the configurations can be random. The same oracle measures the result regions. A configuration whose input loops are
// not simple (even-odd area differs from the absolute signed area) is skipped and counted.
//
// Families (C = main circle or ellipse, S = arc of C shared by a loop of the other operand, g = overlap of a fillet
// end into C, positive = inside C, tol = mergeTolerance or the default 1e-6 when not given):
//   radii    : issue-like cusp at both ends of S, random R (0.5 .. 250), independent fillet radii r1, r2 (0.002 .. 30 R),
//              independent g1, g2, random length of S
//   ellipse  : C is a true ellipse (axis ratio 0.3 .. 3, rotated), S an arc of it, fillets are circles or ellipses
//              externally near-tangent to C at the ends of S
//   mixed    : one end an external cusp (as in the issue), the other end a smooth internal or external continuation,
//              or a line tangent to C, or a line crossing C at a small angle
//   slicer   : issue-like cusp plus a thin quadrilateral whose edges cross the sliver between the fillet and C near the
//              cusp, at angles 0.2 .. 90 degrees, in either operand
//   touch    : no shared arc in one loop: A = C, B = union of an arc sector of a circle D externally near-tangent to C
//              whose arc ends near the tangency point, and a sector of an annulus around C sharing an arc of C that
//              starts at that point (variants: D arc stops short of / passes the point, annulus missing)
//   selfop   : the near-tangent cusp is inside one operand (A = union of C and the issue-like loop), B = random box
//   affine   : radii configurations under a random non-uniform scale and shear (skewed elliptic arcs)
//   smalltol : issue-like cusp with mergeTolerance 1e-10 .. 1e-2 and g relative to it, R up to 1e3
//   loops-<f>: the configurations of family f, checking RegionOps.constructAllXYRegionLoops instead of the booleans
//   split    : C made of 2 .. 4 arcs with seams near (within 0 .. 50 tol of) the fillet ends, S made of 1 .. 3 arcs
// Placement of every configuration: random rotation, optional reflection across a random axis, random translation
// (0, 10 or 1e3 times the size), random loop reversal and seam, both operand orders.
const lib = process.argv[2];
const fam = process.argv[3];
const outFile = process.argv[4];
const filter = process.argv[5];
const G = require(lib);
const { Arc3d, AngleSweep, Point3d, Vector3d, LineSegment3d, LineString3d, Loop, UnionRegion, ParityRegion, Transform, Matrix3d,
  RegionOps, RegionBinaryOpType: Op } = G;
const fs = require("fs");

// ---------- deterministic random numbers ----------
let seed = 1;
function rnd() { seed = (seed * 48271) % 2147483647; return seed / 2147483647; }
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const logU = (a, b) => a * Math.pow(b / a, rnd());
const uni = (a, b) => a + (b - a) * rnd();

// ---------- oracle: scanline integration ----------
// Region membership on a horizontal line y is a union of disjoint x-intervals. Loop: even-odd rule on the crossings.
// UnionRegion: union of children. ParityRegion: symmetric difference of children.
const TWO_PI = 2 * Math.PI;
function inSweep(t, s0, sw) {
  if (Math.abs(sw) >= TWO_PI - 1e-15) return true;
  let d = sw > 0 ? t - s0 : s0 - t;
  d = ((d % TWO_PI) + TWO_PI) % TWO_PI;
  return d <= Math.abs(sw);
}
function crossings(curve, y, xs) {
  if (curve instanceof Arc3d) {
    const c = curve.center, u = curve.vector0, v = curve.vector90;
    const s0 = curve.sweep.startRadians, sw = curve.sweep.sweepRadians;
    const rho = Math.hypot(u.y, v.y);
    if (rho === 0) return;
    const q = (y - c.y) / rho;
    if (q <= -1 || q >= 1) return;
    const phi = Math.atan2(v.y, u.y), a = Math.acos(q);
    for (const t of [phi + a, phi - a])
      if (inSweep(t, s0, sw)) xs.push(c.x + u.x * Math.cos(t) + v.x * Math.sin(t));
    return;
  }
  let pts;
  if (curve instanceof LineSegment3d) pts = [curve.startPoint(), curve.endPoint()];
  else if (curve instanceof LineString3d) { pts = []; for (let i = 0; i < curve.numPoints(); i++) pts.push(curve.pointAt(i)); }
  else throw new Error("oracle: unsupported curve " + curve.constructor.name);
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], r = pts[i + 1];
    if ((p.y <= y && y < r.y) || (r.y <= y && y < p.y)) xs.push(p.x + (r.x - p.x) * (y - p.y) / (r.y - p.y));
  }
}
function curvesOf(loop) {
  const out = [];
  for (const c of loop.children) {
    if (c.children && !(c instanceof LineString3d)) out.push(...curvesOf(c)); else out.push(c);
  }
  return out;
}
// combine two interval lists with a boolean function of membership
function combine(a, b, f) {
  const ev = [];
  for (const [x0, x1] of a) ev.push([x0, 0, 1], [x1, 0, -1]);
  for (const [x0, x1] of b) ev.push([x0, 1, 1], [x1, 1, -1]);
  ev.sort((p, q) => p[0] - q[0]);
  const cnt = [0, 0]; const out = []; let open = undefined;
  for (const [x, w, d] of ev) {
    cnt[w] += d;
    const inside = f(cnt[0] > 0, cnt[1] > 0);
    if (inside && open === undefined) open = x;
    else if (!inside && open !== undefined) { if (x > open) out.push([open, x]); open = undefined; }
  }
  return out;
}
const U = (p, q) => p || q, I = (p, q) => p && q, AmB = (p, q) => p && !q, BmA = (p, q) => q && !p, X = (p, q) => p !== q;
function intervals(region, y) {
  if (region instanceof Loop) {
    const xs = [];
    for (const c of curvesOf(region)) crossings(c, y, xs);
    xs.sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) out.push([xs[i], xs[i + 1]]);
    return out;
  }
  if (region instanceof UnionRegion || region instanceof ParityRegion) {
    const f = region instanceof UnionRegion ? U : X;
    let acc = [];
    for (const ch of region.children) acc = combine(acc, intervals(ch, y), f);
    return acc;
  }
  throw new Error("oracle: unsupported region " + (region && region.constructor.name));
}
const measure = (iv) => iv.reduce((s, [a, b]) => s + b - a, 0);
function makeGrid(regions) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of regions) { const rg = r.range(); y0 = Math.min(y0, rg.low.y); y1 = Math.max(y1, rg.high.y); }
  const n = 2500, h = (y1 - y0) / n, ys = [];
  for (let i = 0; i < n; i++) ys.push(y0 + (i + 0.5 + 0.1234567 * Math.sin(i * 7.31)) * h);
  return { ys, h };
}
const areaOn = (grid, region) => region ? grid.h * grid.ys.reduce((s, y) => s + measure(intervals(region, y)), 0) : 0;

// ---------- geometry helpers ----------
const P = (x, y) => Point3d.create(x, y);
const V = (x, y) => Vector3d.create(x, y);
const rot90 = (v) => V(-v.y, v.x);
const sweepR = (a, b) => AngleSweep.createStartEndRadians(a, b);
// ellipse (center c, semi-axes a, b, axis angle th) as an Arc3d with param range [t0, t1]
function ellArc(c, a, b, th, t0, t1) {
  return Arc3d.create(c, V(a * Math.cos(th), a * Math.sin(th)), V(-b * Math.sin(th), b * Math.cos(th)), sweepR(t0, t1));
}
// point and unit tangent (direction of increasing parameter) of an arc at parameter t
function ptTan(arc, t) {
  const c = arc.center, u = arc.vector0, v = arc.vector90;
  const p = P(c.x + u.x * Math.cos(t) + v.x * Math.sin(t), c.y + u.y * Math.cos(t) + v.y * Math.sin(t));
  const d = V(-u.x * Math.sin(t) + v.x * Math.cos(t), -u.y * Math.sin(t) + v.y * Math.cos(t));
  d.normalizeInPlace();
  return [p, d];
}
// fillet at point p of a counterclockwise boundary with unit tangent tn (direction of the shared arc S).
// atStart: the fillet ends at p (S starts there), else it starts at p (S ends there). Cusp: the fillet runs along -tn.
// external: fillet outside C (center on the outer normal), else inside C. g: overlap of the fillet end into C.
// k: aspect ratio of an elliptic fillet (1 = circle). len: angular length (radians).
function fillet(p, tn, r, g, atStart, external, cusp, len, k = 1) {
  const nOut = V(tn.y, -tn.x); // outer normal of a ccw boundary
  const side = external ? 1 : -1; // center side
  const n = nOut.scale(side);
  const c = P(p.x + n.x * (r - side * g) , p.y + n.y * (r - side * g));
  // param 0 at the point closest to p: c - n * r (= p - g * nOut for both sides)
  const v0 = n.scale(-r);
  // tangent at param 0 is v90 / |v90|. Required travel direction at p: cusp -> -tn, smooth -> +tn.
  const travel = cusp ? tn.scale(-1) : tn.clone();
  const v90 = travel.scale(r * k);
  const arc = Arc3d.create(c, v0, v90, atStart ? sweepR(-len, 0) : sweepR(0, len));
  return arc;
}
function regionLoop(curves) { return Loop.create(...curves); }
// close an open chain e2 -> ... -> e1 with lines away from the shape along direction dir
function closeChain(curves, dist, dir) {
  const e1 = curves[0].startPoint(), e2 = curves[curves.length - 1].endPoint();
  const q2 = P(e2.x + dir.x * dist, e2.y + dir.y * dist), q1 = P(e1.x + dir.x * dist, e1.y + dir.y * dist);
  return [...curves, LineSegment3d.create(e2, q2), LineSegment3d.create(q2, q1), LineSegment3d.create(q1, e1)];
}

// ---------- families: each config returns { key, A, B, mt } ----------
const GS = [-1e-6, -3e-7, -1e-8, 0, 1e-10, 1e-9, 4e-9, 1e-8, 5e-8, 1e-7, 3e-7, 6e-7, 7e-7, 8e-7];
const f5 = (v) => +(+v).toPrecision(4);

// circle or ellipse C with shared arc S between params t1, t2 (ccw), external cusp fillets at both ends
function cuspShape(C, t1, t2, opt) {
  const S = C.clone(); S.sweep.setStartEndRadians(t1, t2);
  const [p1, d1] = ptTan(C, t1), [p2, d2] = ptTan(C, t2);
  const F1 = opt.end1 ?? fillet(p1, d1, opt.r1, opt.g1, true, true, true, opt.len1, opt.k1 ?? 1);
  const F2 = opt.end2 ?? fillet(p2, d2, opt.r2, opt.g2, false, true, true, opt.len2, opt.k2 ?? 1);
  const [pm, dm] = ptTan(C, 0.5 * (t1 + t2));
  const out = V(dm.y, -dm.x);
  return regionLoop(closeChain([F1, S, F2], opt.close ?? 3 * opt.size, out));
}
function circleC(R, seam, ccw, center = P(0, 0)) {
  return Arc3d.createXY(center, R, ccw ? sweepR(seam, seam + TWO_PI) : sweepR(seam + TWO_PI, seam));
}
// C as an ellipse loop, possibly split into pieces at given params
function splitLoop(C, cuts) {
  const s0 = C.sweep.startRadians, sw = C.sweep.sweepRadians;
  if (!cuts || cuts.length === 0) return Loop.create(C);
  const ts = [...cuts].map((t) => s0 + (((t - s0) % TWO_PI) + TWO_PI) % TWO_PI * Math.sign(sw)).sort((a, b) => (a - b) * Math.sign(sw));
  const pts = [s0, ...ts.filter((t) => Math.abs(t - s0) > 1e-12), s0 + sw];
  const arcs = [];
  for (let i = 0; i + 1 < pts.length; i++) { const a = C.clone(); a.sweep.setStartEndRadians(pts[i], pts[i + 1]); arcs.push(a); }
  return Loop.create(...arcs);
}

function genConfigs(family) {
  const cfgs = [];
  const N = Number(process.env.N ?? 160);
  for (let id = 0; id < N; id++) {
    seed = 1000003 * (1 + id) + family.length * 7919 + family.charCodeAt(0);
    for (let w = 0; w < 5; w++) rnd();
    const c = { id, fam: family };
    const R = family === "radii" ? pick([0.5, 3, 18.288, 250]) : family === "smalltol" ? pick([0.3, 18.288, 1000]) : 18.288;
    const size = R;
    const half = uni(0.08, 1.3); // half-angle of S (radians)
    const t1 = Math.PI - half, t2 = Math.PI + half;
    c.mt = undefined;
    const tol = () => c.mt ?? 1e-6;
    const gpick = () => process.env.GFIX ? Number(process.env.GFIX) * pick([1, -1]) : family === "smalltol" ? pick([0.01, 0.1, 0.5, 0.7, 0.74, 0.76, 0.9, 1.3, -0.5]) * tol() : pick(GS);
    const rr = () => R * pick([0.002, 0.03, 0.1, 0.333, 1, 3, 30]) * uni(0.8, 1.25);
    const lenFor = (r) => Math.min(1.2, uni(0.3, 1.5) * size / r);
    if (family === "radii" || family === "affine" || family === "smalltol" || family === "slicer" || family === "selfop" || family === "split") {
      if (family === "smalltol") c.mt = pick([1e-10, 1e-9, 1e-7, 1e-5, 1e-2]);
      const r1 = rr(), r2 = rr();
      c.prm = { R, half: f5(half), r1: f5(r1), r2: f5(r2), g1: f5(0), g2: f5(0) };
      const g1 = gpick(), g2 = gpick();
      c.prm.g1 = g1; c.prm.g2 = g2;
      const len1 = lenFor(r1), len2 = lenFor(r2);
      c.build = (seam, ccw) => {
        const Cfull = circleC(R, seam, true);
        const shape = cuspShape(Cfull, t1, t2, { r1, r2, g1, g2, len1, len2, size });
        let A = Loop.create(circleC(R, seam, ccw));
        if (family === "split") {
          const n = 1 + Math.floor(rnd() * 3);
          const cuts = [];
          for (let i = 0; i < n; i++) cuts.push((rnd() < 0.5 ? t1 : t2) + (rnd() - 0.5) * pick([0, 1e-9, 1e-7, 1e-6, 1e-5]) / R * pick([1, 10, 50]));
          A = splitLoop(circleC(R, seam, ccw), cuts);
          c.prm.cuts = cuts.length;
        }
        if (family === "slicer") {
          const at = rnd() < 0.5 ? t1 : t2;
          const [p, d] = ptTan(Cfull, at);
          const gg = Math.abs(at === t1 ? g1 : g2);
          const rf = at === t1 ? r1 : r2;
          const kk = 0.5 * (1 / rf + 1 / R);
          const u0 = Math.sqrt(Math.max(gg, 1e-12) / kk);
          const u = (at === t1 ? 1 : -1) * u0 * pick([0, 0.3, 0.5, 0.9, 1, 1.1, 2]);
          const x = P(p.x + d.x * u, p.y + d.y * u);
          const nOut = V(d.y, -d.x);
          const alpha = pick([90, 30, 5, 0.2]) * Math.PI / 180 * pick([1, -1]);
          const dir = V(nOut.x * Math.sin(alpha) + d.x * Math.cos(alpha), nOut.y * Math.sin(alpha) + d.y * Math.cos(alpha));
          const perp = rot90(dir).scale(0.05 * size);
          const h = 0.2 * size;
          const q = [P(x.x - dir.x * h, x.y - dir.y * h), P(x.x + dir.x * h, x.y + dir.y * h)];
          const quad = Loop.create(LineString3d.create(q[0], q[1], P(q[1].x + perp.x, q[1].y + perp.y), P(q[0].x + perp.x, q[0].y + perp.y), q[0]));
          c.prm.sl = `${f5(u / Math.max(u0, 1e-30))}/${f5(alpha * 180 / Math.PI)}`;
          const inA = c.slicerInA ?? (c.slicerInA = rnd() < 0.5);
          c.prm.slA = inA;
          return inA ? [UnionRegion.create(A, quad), shape] : [A, UnionRegion.create(shape, quad)];
        }
        if (family === "selfop") {
          const bx = c.box ?? (c.box = [uni(-2, 0.5) * R, uni(-1.2, 1.2) * R, uni(0.2, 1.5) * R, uni(0.2, 1.5) * R]);
          const [x0, y0, w, h] = bx;
          const box = Loop.create(LineString3d.create(P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + h), P(x0, y0 + h), P(x0, y0)));
          c.prm.box = bx.map(f5).join("/");
          return [UnionRegion.create(A, shape), box];
        }
        return [A, shape];
      };
    } else if (family === "ellipse") {
      const q = pick([0.3, 0.6, 1.7, 3]), th = uni(0, Math.PI);
      const r1 = rr(), r2 = rr(), g1 = gpick(), g2 = gpick();
      const k1 = pick([1, 1, 0.3, 3]), k2 = pick([1, 1, 0.5, 2]);
      const len1 = lenFor(r1) / Math.max(1, k1), len2 = lenFor(r2) / Math.max(1, k2);
      c.prm = { q, th: f5(th), half: f5(half), r1: f5(r1), r2: f5(r2), g1, g2, k1, k2 };
      c.build = (seam, ccw) => {
        const Cfull = ellArc(P(0, 0), R, R * q, th, seam, seam + TWO_PI);
        const shape = cuspShape(Cfull, t1, t2, { r1, r2, g1, g2, len1, len2, k1, k2, size: R * Math.max(1, q) });
        const A = Loop.create(ccw ? Cfull : ellArc(P(0, 0), R, R * q, th, seam + TWO_PI, seam));
        return [A, shape];
      };
    } else if (family === "mixed") {
      const kind = pick(["innerSmooth", "outerSmooth", "tangentLine", "crossLine", "innerCuspOther"]);
      const r1 = rr(), r2 = rr(), g1 = gpick(), g2 = gpick();
      const len1 = lenFor(r1), len2 = lenFor(r2);
      const cross = pick([1e-3, 1e-2, 0.1]) * pick([1, -1]);
      const swapEnds = rnd() < 0.5;
      c.prm = { kind, half: f5(half), r1: f5(r1), r2: f5(r2), g1, g2, cross, swapEnds };
      c.build = (seam, ccw) => {
        const Cfull = circleC(R, seam, true);
        const [p1, d1] = ptTan(Cfull, t1), [p2, d2] = ptTan(Cfull, t2);
        const cuspEnd = (atStart) => atStart ? fillet(p1, d1, r1, g1, true, true, true, len1) : fillet(p2, d2, r2, g2, false, true, true, len2);
        const other = (atStart) => {
          const [p, d] = atStart ? [p1, d1] : [p2, d2];
          const r = atStart ? r1 : r2, g = atStart ? g1 : g2, len = atStart ? len1 : len2;
          const L = 0.5 * R;
          if (kind === "innerSmooth") return fillet(p, d, Math.min(r, 0.9 * R), g, atStart, false, false, Math.min(len, 1.2));
          if (kind === "outerSmooth") return fillet(p, d, r, g, atStart, true, false, len);
          if (kind === "innerCuspOther") return fillet(p, d, Math.min(r, 0.9 * R), g, atStart, false, true, Math.min(len, 1.0));
          const nOut = V(d.y, -d.x);
          const a = kind === "crossLine" ? cross : 0;
          const dirL = V(d.x * Math.cos(a) + nOut.x * Math.sin(a), d.y * Math.cos(a) + nOut.y * Math.sin(a)); // along S direction, tilted
          const q0 = P(p.x - nOut.x * g, p.y - nOut.y * g);
          return atStart ? LineSegment3d.create(P(q0.x - dirL.x * L, q0.y - dirL.y * L), q0) : LineSegment3d.create(q0, P(q0.x + dirL.x * L, q0.y + dirL.y * L));
        };
        const shape = cuspShape(Cfull, t1, t2, { size: R, end1: swapEnds ? other(true) : cuspEnd(true), end2: swapEnds ? cuspEnd(false) : other(false) });
        return [Loop.create(circleC(R, seam, ccw)), shape];
      };
    } else if (family === "touch") {
      const variant = pick(["exact", "short", "long", "noAnnulus", "pieOnly2"]);
      const r = rr(), g = gpick();
      const tp = uni(0, TWO_PI); // tangency angle on C
      const back = uni(0.2, 1.0); // angular length of the D arc before the tangency (radians of D)
      const over = variant === "short" ? -pick([1e-7, 1e-5, 1e-3]) / r : variant === "long" ? pick([1e-7, 1e-5, 1e-3, 0.1]) / r : 0;
      const annLen = uni(0.1, 1.2), annDir = pick([1, -1]);
      c.prm = { variant, r: f5(r), g, tp: f5(tp), back: f5(back), over: f5(over), annLen: f5(annLen), annDir };
      c.build = (seam, ccw) => {
        const Cfull = circleC(R, seam, true);
        const p = P(R * Math.cos(tp), R * Math.sin(tp)), nOut = V(Math.cos(tp), Math.sin(tp));
        const dC = P(nOut.x * (R + r - g), nOut.y * (R + r - g));
        const phi = tp + Math.PI; // direction from D's center to the tangency point
        // D arc arrives at the tangency point; annulus sector starts there along C in direction annDir
        const dArc = Arc3d.createXY(dC, r, annDir > 0 ? sweepR(phi - back, phi + over) : sweepR(phi + back, phi - over));
        const pie = Loop.create(dArc, LineSegment3d.create(dArc.endPoint(), dC), LineSegment3d.create(dC, dArc.startPoint()));
        const parts = [pie];
        if (variant !== "noAnnulus") {
          const s = tp, e = tp + annDir * annLen;
          const Ci = Arc3d.createXY(P(0, 0), R, sweepR(s, e)), Co = Arc3d.createXY(P(0, 0), 1.25 * R, sweepR(e, s));
          parts.push(Loop.create(Ci, LineSegment3d.create(Ci.endPoint(), Co.startPoint()), Co, LineSegment3d.create(Co.endPoint(), Ci.startPoint())));
        }
        if (variant === "pieOnly2") { // second, mirrored D sector on the other side of the tangency point
          const d2 = Arc3d.createXY(dC, r, annDir > 0 ? sweepR(phi + back, phi) : sweepR(phi - back, phi));
          parts.push(Loop.create(d2, LineSegment3d.create(d2.endPoint(), dC), LineSegment3d.create(dC, d2.startPoint())));
        }
        return [Loop.create(circleC(R, seam, ccw)), parts.length === 1 ? parts[0] : UnionRegion.create(...parts)];
      };
    } else throw new Error("unknown family " + family);
    // placements
    c.placements = [];
    for (let k = 0; k < 4; k++) {
      c.placements.push({
        rot: f5(uni(0, 360)), mir: rnd() < 0.5 ? f5(uni(0, 180)) : "-", shift: pick([0, 10, 1000]) * size,
        sdir: f5(uni(0, 360)), seam: f5(uni(0, TWO_PI)), ccw: rnd() < 0.5, revA: rnd() < 0.5, revB: rnd() < 0.5, rs: Math.floor(rnd() * 1e9),
        aff: family === "affine" ? [f5(pick([0.2, 0.5, 2, 5])), f5(uni(-1.5, 1.5))] : undefined,
      });
    }
    cfgs.push(c);
  }
  return cfgs;
}

function placementTransform(pl) {
  const a = pl.rot * Math.PI / 180;
  let m = Matrix3d.createRowValues(Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1);
  if (pl.mir !== "-") {
    const b = 2 * pl.mir * Math.PI / 180;
    m = m.multiplyMatrixMatrix(Matrix3d.createRowValues(Math.cos(b), Math.sin(b), 0, Math.sin(b), -Math.cos(b), 0, 0, 0, 1));
  }
  if (pl.aff) // non-uniform scale and shear: circles become ellipses with skewed (non-perpendicular) vectors
    m = m.multiplyMatrixMatrix(Matrix3d.createRowValues(pl.aff[0], pl.aff[1], 0, 0, 1, 0, 0, 0, 1));
  const sd = pl.sdir * Math.PI / 180;
  return Transform.createOriginAndMatrix(P(pl.shift * Math.cos(sd), pl.shift * Math.sin(sd)), m);
}
function reverseRegion(r) {
  if (r instanceof Loop) { r.reverseInPlace(); return r; }
  for (const ch of r.children) reverseRegion(ch);
  return r;
}
// even-odd area equals the absolute signed area for every input loop (no self intersections), each loop on its own grid
function loopsSimple(region, grid) {
  const loops = region instanceof Loop ? [region] : region.children;
  for (const l of loops) {
    const eo = areaOn(makeGrid([l]), l), sa = Math.abs(RegionOps.computeXYArea(l));
    if (!(Math.abs(eo - sa) <= 1e-4 * Math.max(sa, 1e-30) + 1e-9)) return false;
  }
  return true;
}

const opsList = [[Op.Union, true, "Union"], [Op.Union, false, "Union"], [Op.Intersection, false, "Intersection"], [Op.AMinusB, false, "AMinusB"], [Op.BMinusA, false, "BMinusA"], [Op.Parity, false, "Parity"]];
const fails = []; let total = 0, cases = 0, skipped = 0, oracleErr = 0;
// "loops-<family>": same configurations, but check RegionOps.constructAllXYRegionLoops (also uses the changed
// CurveCurve.allIntersectionsAmongPrimitivesXY) instead of the booleans: the positive area loops must cover A union B.
const loopsMode = fam.startsWith("loops-");
const cfgs = genConfigs(loopsMode ? fam.slice(6) : fam);
for (const c of cfgs) {
  for (const pl of c.placements) {
    seed = pl.rs; // reproducible per placement
    // build first: some families record per placement parameters (cuts, slicer) in c.prm
    let [A, B] = c.build(pl.seam, pl.ccw);
    const keyBase = `${fam} id=${c.id} ` + Object.entries(c.prm ?? {}).map(([k, v]) => `${k}=${v}`).join(" ") + ` mt=${c.mt ?? "-"} rot=${pl.rot}${pl.aff ? ` aff=${pl.aff.join("/")}` : ""} mir=${pl.mir} shift=${pl.shift} sdir=${pl.sdir} seam=${pl.seam} ccw=${pl.ccw} revA=${pl.revA} revB=${pl.revB}`;
    if (filter && !(keyBase + " ").includes(filter)) continue;
    const t = placementTransform(pl);
    A = A.cloneTransformed(t); B = B.cloneTransformed(t);
    if (pl.revA) reverseRegion(A);
    if (pl.revB) reverseRegion(B);
    if (process.env.DUMP) // write the placed operands as IModelJson (for a standalone repro)
      fs.writeFileSync(process.env.DUMP, JSON.stringify({ key: keyBase, mergeTolerance: c.mt, A: G.IModelJson.Writer.toIModelJson(A), B: G.IModelJson.Writer.toIModelJson(B) }));
    const grid = makeGrid([A, B]);
    if (!loopsSimple(A, grid) || !loopsSimple(B, grid)) { skipped++; if (process.env.DBG) console.log('skip', keyBase, loopsSimple(A, grid), loopsSimple(B, grid)); continue; }
    cases++;
    // per scanline intervals of A and B, then expected areas of all operations
    const ia = grid.ys.map((y) => intervals(A, y)), ib = grid.ys.map((y) => intervals(B, y));
    const ex = {};
    for (const [op, f] of [[Op.Union, U], [Op.Intersection, I], [Op.AMinusB, AmB], [Op.BMinusA, BmA], [Op.Parity, X]])
      ex[op] = grid.h * ia.reduce((s, a, i) => s + measure(combine(a, ib[i], f)), 0);
    const aA = areaOn(grid, A), aB = areaOn(grid, B);
    const tolArea = 1e-5 * (aA + aB) + 1e-12;
    if (loopsMode) {
      // bounded faces of the arrangement of all boundaries = A union B when the union has no holes
      for (const swap of [false, true]) {
        total++;
        let got, err;
        try {
          const sets = RegionOps.constructAllXYRegionLoops(swap ? [B, A] : [A, B], c.mt ?? 1e-6);
          got = 0;
          for (const set of sets) for (const l of set.positiveAreaLoops) got += areaOn(grid, l);
        } catch (x) { err = "throw"; got = NaN; }
        if (!Number.isFinite(got) || Math.abs(got - ex[Op.Union]) > tolArea)
          fails.push(`fail ${keyBase} swap=${swap} op=Loops su=- got=${err ?? got.toPrecision(9)} exp=${ex[Op.Union].toPrecision(9)}`);
      }
      continue;
    }
    for (const swap of [false, true]) {
      const [X1, X2] = swap ? [B, A] : [A, B];
      for (const [op, su, name] of opsList) {
        total++;
        const e = swap ? (op === Op.AMinusB ? ex[Op.BMinusA] : op === Op.BMinusA ? ex[Op.AMinusB] : ex[op]) : ex[op];
        let res, err, got;
        const opts = { simplifyUnion: su };
        if (c.mt !== undefined) opts.mergeTolerance = c.mt;
        try { res = RegionOps.regionBooleanXY(X1, X2, op, opts); } catch (x) { err = "throw"; }
        try { got = err ? NaN : areaOn(grid, res); } catch (x) { oracleErr++; got = NaN; err = "oracle:" + x.message; }
        if (!Number.isFinite(got) || Math.abs(got - e) > tolArea)
          fails.push(`fail ${keyBase} swap=${swap} op=${name} su=${su} got=${err ?? (res ? got.toPrecision(9) : "undefined")} exp=${e.toPrecision(9)}`);
      }
    }
  }
}
const nCaseFail = new Set(fails.map((l) => l.replace(/ swap=.*/, ""))).size;
console.log(`${fam}: ${fails.length}/${total} wrong ops, ${nCaseFail}/${cases} wrong cases, skipped ${skipped} non-simple, oracle errors ${oracleErr}`);
if (outFile) fs.writeFileSync(outFile, fails.sort().join("\n") + (fails.length ? "\n" : ""));
