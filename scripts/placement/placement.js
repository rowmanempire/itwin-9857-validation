// Placement stress families for the fix of iTwin/itwinjs-core #9857 (RegionOps.regionBooleanXY with near-tangent arcs).
// Usage: node placement.js <core-geometry.js> <family> [out.txt] [caseFilter]     (env N = configurations, default 120)
// Output: one line per wrong operation, as in cusp/cusp.js (same scanline oracle, copied below unchanged).
// Everything before " swap=" is the case key. Expected areas come from the oracle, never from the library under test.
// The oracle integrates in coordinates relative to the placement origin, so large offsets do not cost it precision.
//
// Families (C = main circle of radius R, default tolerance 1e-6, g = overlap of a fillet end into C, chosen around the
// tolerance, including 0.7 tol, the margin used by the fix, and exactly tol):
//   scale    : issue-like cusp at both ends of a shared arc, R = 1e-3 .. 1e5 (coordinates small or large versus tol)
//   farshift : the same with R = 18.288 placed at a distance 1e5 .. 1e8 from the origin
//   coarc    : the shared arc of B is only nearly coincident with C (radius R + dr, center offset e, both 0 .. 3e-6)
//   shortedge: degenerate short edges (1.5e-6 .. 1e-3) at the cusp: a line between fillet and shared arc, the shared
//              arc split into a short piece, or a very short fillet
//   multi    : B = union of 2 .. 5 issue-like shapes around C whose fillet ends are shared, nearly shared or apart
//   meet     : two shapes of B meet at (nearly) the same point of C from both sides (multi with k = 2)
//   twin     : both operands have a cusp fillet ending at (or near) the same point of C
//   slicerout: issue-like cusp plus a thin quadrilateral crossing C near the cusp, also beyond the end of the shared arc
//   arcslicer: issue-like cusp plus a small circle (radius 1e-4 R .. 0.5 R) crossing the sliver near the cusp
//   chain    : many operands in a row, X = op(X, Y_i) with union, intersection, differences and parity, Y_i issue-like
//              shapes, near-tangent circles and boxes, every intermediate result checked
// Placement: random rotation, optional reflection, translation (farshift: 1e5 .. 1e8), seam, loop reversal.
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


// ---------- placement families (as in placement/placement.js) ----------
// Each configuration has build(pl) returning { operands: [region, ...], ops?: [op, ...] } in local coordinates.
// Two operands without ops: all 6 booleans, both orders (as cusp/cusp.js). With ops: a chain X = op_i(X, operand_i).
const GAPS_REL = [-1e-6, -9.9e-7, -5e-7, -1e-8, 0, 1e-9, 1e-8, 1e-7, 3e-7, 5e-7, 6e-7, 6.9e-7, 7.1e-7, 7.5e-7, 8e-7, 9.9e-7, 1e-6];
const OPNAMES = { [Op.Union]: "Union", [Op.Intersection]: "Intersection", [Op.AMinusB]: "AMinusB", [Op.BMinusA]: "BMinusA", [Op.Parity]: "Parity" };
const OPF = { [Op.Union]: U, [Op.Intersection]: I, [Op.AMinusB]: AmB, [Op.BMinusA]: BmA, [Op.Parity]: X };

// arc of a circle with center c, radius R, params t1..t2
const arcOf = (c, R, t1, t2) => Arc3d.createXY(c, R, sweepR(t1, t2));
// issue-like shape on an arbitrary arc S (ccw, t1 < t2): cusp fillets at both ends, optional extra pieces
function cuspOnArc(S, opt) {
  const t1 = S.sweep.startRadians, t2 = S.sweep.endRadians;
  const full = S.clone(); full.sweep.setStartEndRadians(t1, t1 + TWO_PI);
  const [p1, d1] = ptTan(full, t1), [p2, d2] = ptTan(full, t2);
  const F1 = fillet(p1, d1, opt.r1, opt.g1, true, true, true, opt.len1);
  const F2 = fillet(p2, d2, opt.r2, opt.g2, false, true, true, opt.len2);
  const chain = opt.chain ? opt.chain(F1, S, F2) : [F1, S, F2];
  const [pm, dm] = ptTan(full, 0.5 * (t1 + t2));
  return regionLoop(closeChain(chain, opt.close, V(dm.y, -dm.x)));
}

function genConfigs(family) {
  const cfgs = [];
  const N = Number(process.env.N ?? 120);
  for (let id = 0; id < N; id++) {
    seed = 1000033 * (1 + id) + family.length * 7907 + family.charCodeAt(0) * 31 + family.charCodeAt(1);
    for (let w = 0; w < 7; w++) rnd();
    const c = { id, fam: family, mt: undefined, prm: {} };
    const tol = () => c.mt ?? 1e-6;
    const g = () => pick(GAPS_REL) * tol() / 1e-6;
    let R = 18.288;
    if (family === "scale") R = pick([1e-3, 0.01, 0.1, 1e3, 1e4, 1e5]);
    const half = uni(0.05, 1.3);
    const t1 = Math.PI - half, t2 = Math.PI + half;
    const rr = () => R * pick([0.003, 0.03, 0.1, 0.5, 1, 3, 20]) * uni(0.8, 1.25);
    const lenFor = (r) => Math.min(1.2, uni(0.3, 1.5) * R / r);
    if (family === "scale" || family === "farshift") {
      // issue-like cusp at both ends, extreme coordinate magnitudes: radius 1e-3 .. 1e5 or offset 1e5 .. 1e8
      const r1 = rr(), r2 = rr(), g1 = g(), g2 = g(), len1 = lenFor(r1), len2 = lenFor(r2);
      Object.assign(c.prm, { R, half: f5(half), r1: f5(r1), r2: f5(r2), g1, g2 });
      c.build = (pl) => ({ operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), cuspShape(circleC(R, pl.seam, true), t1, t2, { r1, r2, g1, g2, len1, len2, size: R })] });
    } else if (family === "coarc") {
      // the shared arc of B is a nearly coincident arc: radius R + dr, center offset e (around the tolerance)
      const dr = pick([0, 1e-9, 1e-8, 1e-7, 5e-7, 9e-7, -5e-7, -9e-7, 1.1e-6, 3e-6]);
      const e = pick([0, 1e-9, 1e-7, 5e-7, 9e-7, 2e-6]), eAng = uni(0, TWO_PI);
      const r1 = rr(), r2 = rr(), g1 = g(), g2 = g(), len1 = lenFor(r1), len2 = lenFor(r2);
      Object.assign(c.prm, { dr, e, eAng: f5(eAng), half: f5(half), r1: f5(r1), r2: f5(r2), g1, g2 });
      c.build = (pl) => {
        const S = arcOf(P(e * Math.cos(eAng), e * Math.sin(eAng)), R + dr, t1, t2);
        return { operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), cuspOnArc(S, { r1, r2, g1, g2, len1, len2, close: 3 * R })] };
      };
    } else if (family === "shortedge") {
      // degenerate short edges at the cusp: a short line or a short arc of C between fillet and S, a short piece of S,
      // or a short closing edge right at the fillet end
      const kind = pick(["line", "arcpiece", "splitS", "closeShort", "lineBoth"]);
      const L = pick([1.5e-6, 3e-6, 1e-5, 1e-4, 1e-3]);
      const r1 = rr(), r2 = rr(), g1 = g(), g2 = g(), len1 = lenFor(r1), len2 = lenFor(r2);
      Object.assign(c.prm, { kind, L, half: f5(half), r1: f5(r1), r2: f5(r2), g1, g2 });
      c.build = (pl) => {
        const C0 = circleC(R, pl.seam, true);
        const S = C0.clone(); S.sweep.setStartEndRadians(t1, t2);
        const [p1, d1] = ptTan(C0, t1), [p2, d2] = ptTan(C0, t2);
        const dA = L / R;
        let chain, F1, F2;
        if (kind === "line" || kind === "lineBoth") {
          // fillets end L away from S along the tangent, joined to S by a short segment
          const q1 = P(p1.x - d1.x * L, p1.y - d1.y * L);
          F1 = fillet(q1, d1, r1, g1, true, true, true, len1);
          const segs = [F1, LineSegment3d.create(F1.endPoint(), p1), S];
          if (kind === "lineBoth") {
            const q2 = P(p2.x + d2.x * L, p2.y + d2.y * L);
            F2 = fillet(q2, d2, r2, g2, false, true, true, len2);
            segs.push(LineSegment3d.create(p2, F2.startPoint()), F2);
          } else segs.push(fillet(p2, d2, r2, g2, false, true, true, len2));
          chain = segs;
        } else if (kind === "arcpiece") {
          const Sa = C0.clone(); Sa.sweep.setStartEndRadians(t1, t1 + dA);
          const Sb = C0.clone(); Sb.sweep.setStartEndRadians(t1 + dA, t2);
          chain = [fillet(p1, d1, r1, g1, true, true, true, len1), Sa, Sb, fillet(p2, d2, r2, g2, false, true, true, len2)];
        } else if (kind === "splitS") {
          const Sa = C0.clone(); Sa.sweep.setStartEndRadians(t1, t2 - dA);
          const Sb = C0.clone(); Sb.sweep.setStartEndRadians(t2 - dA, t2);
          chain = [fillet(p1, d1, r1, g1, true, true, true, len1), Sa, Sb, fillet(p2, d2, r2, g2, false, true, true, len2)];
        } else { // closeShort: the second fillet is very short (length L) and then the loop closes
          const lenShort = L / r2;
          chain = [fillet(p1, d1, r1, g1, true, true, true, len1), S, fillet(p2, d2, r2, g2, false, true, true, lenShort)];
        }
        const [pm, dm] = ptTan(C0, Math.PI);
        return { operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), regionLoop(closeChain(chain, 3 * R, V(dm.y, -dm.x)))] };
      };
    } else if (family === "multi") {
      // B = union of 2 .. 5 issue-like shapes around the same circle; neighbours share or nearly share fillet ends
      const k = 2 + Math.floor(rnd() * 4);
      const shapes = [];
      let a = uni(0, TWO_PI);
      const gapKind = pick(["shared", "near", "apart"]);
      for (let i = 0; i < k; i++) {
        const hw = uni(0.05, 0.5);
        const r1 = rr(), r2 = rr();
        shapes.push({ a0: a, a1: a + 2 * hw, r1, r2, g1: g(), g2: g(), len1: Math.min(0.6, uni(0.2, 0.8) * hw * R / r1), len2: Math.min(0.6, uni(0.2, 0.8) * hw * R / r2) });
        a += 2 * hw + (gapKind === "shared" ? 0 : gapKind === "near" ? pick([1e-7, 5e-7, 2e-6, 1e-5]) / R : uni(0.05, 0.4));
      }
      Object.assign(c.prm, { k, gapKind, g: shapes.map((s) => `${s.g1},${s.g2}`).join("/") });
      c.build = (pl) => {
        const Cf = circleC(R, pl.seam, true);
        const loops = shapes.map((s) => cuspShape(Cf, s.a0, s.a1, { ...s, size: R, close: R }));
        return { operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), UnionRegion.create(...loops)] };
      };
    } else if (family === "meet") {
      // two issue-like shapes of B meet at (nearly) the same point of C from both sides: the end fillet of one and the
      // start fillet of the other are near-tangent to C there (multi with k = 2, more samples)
      const gap = pick([0, 1e-7, 3e-7, 6e-7, 1e-6, 2e-6]) / R;
      const s1 = uni(0.1, 0.5), s2 = uni(0.1, 0.5), a0 = uni(0, TWO_PI);
      const r1 = rr(), r2 = rr(), r3 = rr(), r4 = rr();
      const gs = [g(), g(), g(), g()];
      Object.assign(c.prm, { gap: f5(gap * R), g: gs.join(","), r: [r1, r2, r3, r4].map(f5).join(",") });
      c.build = (pl) => {
        const Cf = circleC(R, pl.seam, true);
        const la = (r, hw) => Math.min(0.6, 0.5 * hw * R / r);
        const L1 = cuspShape(Cf, a0, a0 + 2 * s1, { r1, r2, g1: gs[0], g2: gs[1], len1: la(r1, s1), len2: la(r2, s1), size: R, close: R });
        const L2 = cuspShape(Cf, a0 + 2 * s1 + gap, a0 + 2 * s1 + gap + 2 * s2, { r1: r3, r2: r4, g1: gs[2], g2: gs[3], len1: la(r3, s2), len2: la(r4, s2), size: R, close: R });
        return { operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), UnionRegion.create(L1, L2)] };
      };
    } else if (family === "twin") {
      // two operands each have a cusp fillet ending at (or near) the same point of C, one inside the union with C
      const r1 = rr(), r2 = rr(), r3 = rr(), g1 = g(), g2 = g(), g3 = g();
      const d = pick([0, 0, 1e-7, 5e-7, 2e-6, 1e-4]) / R;
      Object.assign(c.prm, { half: f5(half), r1: f5(r1), r2: f5(r2), r3: f5(r3), g1, g2, g3, d });
      c.build = (pl) => {
        const Cf = circleC(R, pl.seam, true);
        const sB = cuspShape(Cf, t1, t2, { r1, r2, g1, g2, len1: lenFor(r1), len2: lenFor(r2), size: R });
        const sA = cuspShape(Cf, t1 + d - 0.6, t1 + d, { r1: r3, r2: r3, g1: g3, g2: g3, len1: Math.min(0.8, lenFor(r3)), len2: Math.min(0.8, lenFor(r3)), size: R, close: 1.5 * R });
        return { operands: [UnionRegion.create(Loop.create(circleC(R, pl.seam, pl.ccw)), sA), sB] };
      };
    } else if (family === "chain") {
      // X = C, then X = op(X, operand) for 2 .. 4 operands: issue-like shapes, near-tangent circles, boxes
      const k = 2 + Math.floor(rnd() * 3);
      const steps = [];
      for (let i = 0; i < k; i++) {
        const kind = pick(["cusp", "cusp", "tangentCircle", "box"]);
        const at = uni(0, TWO_PI), hw = uni(0.05, 0.6), r1 = rr(), r2 = rr();
        steps.push({ kind, op: pick([Op.Union, Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity]), at, hw, r1, r2, g1: g(), g2: g(), bx: [uni(-1.5, 0.5), uni(-1.5, 0.5), uni(0.3, 2), uni(0.3, 2)] });
      }
      Object.assign(c.prm, { k, steps: steps.map((s) => `${s.kind}:${OPNAMES[s.op]}:${s.g1},${s.g2}`).join("/") });
      c.build = (pl) => {
        const Cf = circleC(R, pl.seam, true);
        const operands = [Loop.create(circleC(R, pl.seam, pl.ccw))];
        for (const s of steps) {
          if (s.kind === "cusp") operands.push(cuspShape(Cf, s.at - s.hw, s.at + s.hw, { r1: s.r1, r2: s.r2, g1: s.g1, g2: s.g2, len1: Math.min(0.8, lenFor(s.r1)), len2: Math.min(0.8, lenFor(s.r2)), size: R, close: R }));
          else if (s.kind === "tangentCircle") { // circle externally near-tangent to C
            const n = V(Math.cos(s.at), Math.sin(s.at));
            operands.push(Loop.create(Arc3d.createXY(P(n.x * (R + s.r1 - s.g1), n.y * (R + s.r1 - s.g1)), s.r1, sweepR(s.at, s.at + TWO_PI))));
          } else {
            const [x0, y0, w, h] = s.bx.map((v) => v * R);
            operands.push(Loop.create(LineString3d.create(P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + h), P(x0, y0 + h), P(x0, y0))));
          }
        }
        return { operands, ops: steps.map((s) => s.op) };
      };
    } else if (family === "slicerout" || family === "arcslicer") {
      // issue-like cusp plus a slicer near the cusp: slicerout = a thin quadrilateral crossing C just outside the shared
      // arc (beyond its end, where only C continues) or inside it; arcslicer = a small circle through the sliver
      const r1 = rr(), r2 = rr(), g1 = g(), g2 = g(), len1 = lenFor(r1), len2 = lenFor(r2);
      const at1 = rnd() < 0.5;
      const mult = pick(family === "slicerout" ? [-0.05, -0.2, -0.5, -0.9, -1.2, -2, -3.5, 0.5, 1.5] : [-1.5, -0.5, 0, 0.3, 0.7, 1, 1.3, 2.5]);
      const alpha = pick([90, 60, 20, 5, 0.5]) * Math.PI / 180 * pick([1, -1]);
      const rho = R * pick([1e-4, 1e-3, 0.01, 0.1, 0.5]);
      const inA = rnd() < 0.5;
      Object.assign(c.prm, { half: f5(half), r1: f5(r1), r2: f5(r2), g1, g2, at1, mult, alpha: f5(alpha * 180 / Math.PI), rho: family === "arcslicer" ? f5(rho) : "-", inA });
      c.build = (pl) => {
        const Cf = circleC(R, pl.seam, true);
        const shape = cuspShape(Cf, t1, t2, { r1, r2, g1, g2, len1, len2, size: R });
        const at = at1 ? t1 : t2;
        const [p, d] = ptTan(Cf, at);
        const gg = Math.abs(at1 ? g1 : g2), rf = at1 ? r1 : r2;
        const u0 = Math.sqrt(Math.max(gg, 1e-12) / (0.5 * (1 / rf + 1 / R)));
        const u = (at1 ? 1 : -1) * u0 * mult; // positive mult: toward the shared arc, negative: beyond its end
        const x = P(p.x + d.x * u, p.y + d.y * u);
        const nOut = V(d.y, -d.x);
        const dir = V(nOut.x * Math.sin(alpha) + d.x * Math.cos(alpha), nOut.y * Math.sin(alpha) + d.y * Math.cos(alpha));
        let sl;
        if (family === "slicerout") {
          const perp = rot90(dir).scale(0.05 * R), h = 0.2 * R;
          const q = [P(x.x - dir.x * h, x.y - dir.y * h), P(x.x + dir.x * h, x.y + dir.y * h)];
          sl = Loop.create(LineString3d.create(q[0], q[1], P(q[1].x + perp.x, q[1].y + perp.y), P(q[0].x + perp.x, q[0].y + perp.y), q[0]));
        } else { // circle of radius rho through x, its tangent at x along dir
          const nrm = rot90(dir);
          sl = Loop.create(Arc3d.createXY(P(x.x + nrm.x * rho, x.y + nrm.y * rho), rho, sweepR(0, TWO_PI)));
        }
        const A = Loop.create(circleC(R, pl.seam, pl.ccw));
        return { operands: inA ? [UnionRegion.create(A, sl), shape] : [A, UnionRegion.create(shape, sl)] };
      };
    } else throw new Error("unknown family " + family);
    c.placements = [];
    for (let kpl = 0; kpl < 3; kpl++) {
      const shift = family === "farshift" ? pick([1e5, 1e6, 1e7, 1e8]) : pick([0, 0, 10 * R]);
      c.placements.push({
        rot: f5(uni(0, 360)), mir: rnd() < 0.5 ? f5(uni(0, 180)) : "-", shift,
        sdir: f5(uni(0, 360)), seam: f5(uni(0, TWO_PI)), ccw: rnd() < 0.5, revA: rnd() < 0.5, revB: rnd() < 0.5, rs: Math.floor(rnd() * 1e9),
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
  const sd = pl.sdir * Math.PI / 180;
  return Transform.createOriginAndMatrix(P(pl.shift * Math.cos(sd), pl.shift * Math.sin(sd)), m);
}
function reverseRegion(r) {
  if (r instanceof Loop) { r.reverseInPlace(); return r; }
  for (const ch of r.children) reverseRegion(ch);
  return r;
}
function loopsSimple(region) {
  const loops = region instanceof Loop ? [region] : region.children;
  for (const l of loops) {
    const eo = areaOn(makeGrid([l]), l), sa = Math.abs(RegionOps.computeXYArea(l));
    if (!(Math.abs(eo - sa) <= 1e-4 * Math.max(sa, 1e-30) + 1e-9)) return false;
  }
  return true;
}
// the oracle works in coordinates relative to a reference point (large offsets would cost precision in the scanline)
function toLocal(region, ref) { return region.cloneTransformed(Transform.createTranslationXYZ(-ref.x, -ref.y, 0)); }

const opsList = [[Op.Union, true], [Op.Union, false], [Op.Intersection, false], [Op.AMinusB, false], [Op.BMinusA, false], [Op.Parity, false]];
const fails = []; let total = 0, cases = 0, skipped = 0, oracleErr = 0;
for (const c of genConfigs(fam)) {
  for (const pl of c.placements) {
    seed = pl.rs;
    const built = c.build(pl);
    const keyBase = `${fam} id=${c.id} ` + Object.entries(c.prm).map(([k, v]) => `${k}=${v}`).join(" ") + ` mt=${c.mt ?? "-"} rot=${pl.rot} mir=${pl.mir} shift=${pl.shift} sdir=${pl.sdir} seam=${pl.seam} ccw=${pl.ccw} revA=${pl.revA} revB=${pl.revB}`;
    if (filter && !(keyBase + " ").includes(filter)) continue;
    const t = placementTransform(pl);
    const ref = t.multiplyPoint3d(P(0, 0));
    const operands = built.operands.map((r, i) => {
      const x = r.cloneTransformed(t);
      if (i === 0 ? pl.revA : pl.revB) reverseRegion(x);
      return x;
    });
    if (process.env.DUMP)
      fs.writeFileSync(process.env.DUMP, JSON.stringify({ key: keyBase, mergeTolerance: c.mt, ops: built.ops, operands: operands.map((r) => G.IModelJson.Writer.toIModelJson(r)), A: G.IModelJson.Writer.toIModelJson(operands[0]), B: G.IModelJson.Writer.toIModelJson(operands[1]) }));
    const local = operands.map((r) => toLocal(r, ref));
    const grid = makeGrid(local);
    if (!local.every((r) => loopsSimple(r))) { skipped++; continue; }
    cases++;
    const ivs = local.map((r) => grid.ys.map((y) => intervals(r, y)));
    const measured = (res) => areaOn(grid, res ? toLocal(res, ref) : undefined);
    const sumArea = local.reduce((s, r) => s + areaOn(grid, r), 0);
    const tolArea = 1e-5 * sumArea + 20 * (c.mt ?? 1e-6) * Math.sqrt(sumArea) + 1e-12; // relative, plus tolerance times a length
    const opts = (su) => { const o = { simplifyUnion: su }; if (c.mt !== undefined) o.mergeTolerance = c.mt; return o; };
    if (!built.ops) {
      const [A, B] = operands;
      const ex = {};
      for (const op of [Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity])
        ex[op] = grid.h * ivs[0].reduce((s, a, i) => s + measure(combine(a, ivs[1][i], OPF[op])), 0);
      for (const swap of [false, true]) {
        const [X1, X2] = swap ? [B, A] : [A, B];
        for (const [op, su] of opsList) {
          total++;
          const e = swap ? (op === Op.AMinusB ? ex[Op.BMinusA] : op === Op.BMinusA ? ex[Op.AMinusB] : ex[op]) : ex[op];
          let res, err, got;
          try { res = RegionOps.regionBooleanXY(X1, X2, op, opts(su)); } catch (x) { err = "throw"; }
          try { got = err ? NaN : measured(res); } catch (x) { oracleErr++; got = NaN; err = "oracle:" + x.message; }
          if (!Number.isFinite(got) || Math.abs(got - e) > tolArea)
            fails.push(`fail ${keyBase} swap=${swap} op=${OPNAMES[op]} su=${su} got=${err ?? (res ? got.toPrecision(9) : "undefined")} exp=${e.toPrecision(9)}`);
        }
      }
      continue;
    }
    // chain: X = op_i(X, operand_i); undefined result = empty region
    for (const su of [true, false]) {
      let X = operands[0], acc = ivs[0];
      for (let i = 0; i < built.ops.length; i++) {
        total++;
        const op = built.ops[i], Y = operands[i + 1];
        acc = acc.map((a, j) => combine(a, ivs[i + 1][j], OPF[op]));
        const e = grid.h * acc.reduce((s, a) => s + measure(a), 0);
        let res, err, got;
        if (X === undefined) res = (op === Op.Union || op === Op.BMinusA || op === Op.Parity) ? Y : undefined;
        else try { res = RegionOps.regionBooleanXY(X, Y, op, opts(su)); } catch (x) { err = "throw"; }
        try { got = err ? NaN : measured(res); } catch (x) { oracleErr++; got = NaN; err = "oracle:" + x.message; }
        if (!Number.isFinite(got) || Math.abs(got - e) > tolArea) {
          fails.push(`fail ${keyBase} swap=- op=step${i}:${OPNAMES[op]} su=${su} got=${err ?? (res ? got.toPrecision(9) : "undefined")} exp=${e.toPrecision(9)}`);
          break; // later steps depend on this one
        }
        X = res;
      }
    }
  }
}
const nCaseFail = new Set(fails.map((l) => l.replace(/ swap=.*/, ""))).size;
console.log(`${fam}: ${fails.length}/${total} wrong ops, ${nCaseFail}/${cases} wrong cases, skipped ${skipped} non-simple, oracle errors ${oracleErr}`);
if (outFile) fs.writeFileSync(outFile, fails.sort().join("\n") + (fails.length ? "\n" : ""));
