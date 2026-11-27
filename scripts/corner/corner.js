// Families tanpoly, lens, tanend, dshape. Oracle, placements and output format copied from placement/placement.js.
// Also families cornerang, multi, nested, parity, splitunion and their variants (see CORNER_FAMS below).
// Usage: node corner.js <core-geometry.js> <family> [out.txt] [caseFilter]   (env N, default 150)
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


// ---------- corner families: corners of the other region (the rule against moving onto a corner and its exceptions) ----------
// cornerang : A = arc of C (circle or ellipse) closed at its END by a corner curve of kind
//             chord | ang (line at angle th to the tangent, th from 0 .. 1 rad incl. around the 1e-4 threshold,
//             turning in or out) | angarc (arc leaving at angle th) | sector (two radii) | lens (arc through both ends).
//             B = fillet + shared arc S + fillet; S ends at the corner (+ near) or passes through it (pass).
// multi     : several cusp shapes on one C at both corners of A (UnionRegion B), optional chain with the full circle C.
// nested    : the corner region is itself a boolean result: (C op1 Cut) op2 B, Cut = half plane (Intersection) or wedge
//             (AMinusB), B a cusp shape at the resulting corner.
// parity    : A = ParityRegion(big square, hole = D shape of C), B at a corner of the hole.
// splitunion: A = UnionRegion of two loops that meet at the corner (different region members).
const ANG = [0, 1e-7, 1e-6, 1e-5, 5e-5, 9e-5, 1e-4, 1.1e-4, 2e-4, 1e-3, 1e-2, 0.1, 0.5, 1.2];
function rotV(v, a) { return V(v.x * Math.cos(a) - v.y * Math.sin(a), v.x * Math.sin(a) + v.y * Math.cos(a)); }
function mkA(C, u0, span, kind, th, rr, bulge) {
  const Aarc = C.clone(); Aarc.sweep.setStartEndRadians(u0, u0 + span);
  const [pe, de] = ptTan(C, u0 + span);
  const ps = Aarc.startPoint();
  const chordLen = pe.distance(ps);
  if (kind === "chord") return [Aarc, LineSegment3d.create(pe, ps)];
  if (kind === "ang") {
    const dd = rotV(de, th), L = 0.5 * chordLen;
    const q = P(pe.x + dd.x * L, pe.y + dd.y * L);
    return [Aarc, LineSegment3d.create(pe, q), LineSegment3d.create(q, ps)];
  }
  if (kind === "angarc") {
    const dd = rotV(de, th); dd.normalizeInPlace();
    const r = rr * chordLen, s = bulge > 0 ? 1 : -1; // s = 1 turns left
    const nL = rot90(dd);
    const center = P(pe.x + nL.x * r * s, pe.y + nL.y * r * s);
    const v0 = V(pe.x - center.x, pe.y - center.y), v90 = dd.scale(r);
    const arc = Arc3d.create(center, v0, v90, sweepR(0, Math.min(1.0, 0.5 * chordLen / r)));
    return [Aarc, arc, LineSegment3d.create(arc.endPoint(), ps)];
  }
  if (kind === "sector") { const c0 = C.center; return [Aarc, LineSegment3d.create(pe, c0), LineSegment3d.create(c0, ps)]; }
  // lens: arc from pe to ps through the chord midpoint moved by bulge * chordLen along the left normal of pe->ps
  const m = P(0.5 * (pe.x + ps.x), 0.5 * (pe.y + ps.y)), d = V(ps.x - pe.x, ps.y - pe.y); d.normalizeInPlace();
  const nl = rot90(d);
  const mid = P(m.x + nl.x * bulge * chordLen, m.y + nl.y * bulge * chordLen);
  return [Aarc, Arc3d.createCircularStartMiddleEnd(pe, mid, ps)];
}
const NEAR_CORNER = [0, 0, 0, 1e-8, -1e-8, 1e-7, -1e-7, 5e-7, -5e-7, 9e-7, -2e-6, 1e-3, "pass"];
function mkFil(R, g) { return { r: R * pick([0.003, 0.03, 0.1, 0.5, 1, 3]) * uni(0.8, 1.25), g: g(), ext: rnd() < 0.75, cusp: rnd() < 0.75, k: rnd() < 0.7 ? 1 : uni(0.5, 2) }; }
const filStr = (e) => `${e.ext ? "x" : "i"}${e.cusp ? "c" : "s"}:${e.g}:${f5(e.k)}:${f5(e.r)}`;
// B on C: S ends at param tEnd (if endAtCorner) or starts at tEnd (else), half width hw; fillets e1, e2
function mkB(C, R, tCorner, near, endAtCorner, hw, e1, e2, lens) {
  const scale = (Math.abs(near) < 0.1 ? 1 : 0) ;
  let t1, t2;
  if (near === "pass") { if (endAtCorner) { t2 = tCorner + 0.3 * hw; t1 = t2 - 2 * hw; } else { t1 = tCorner - 0.3 * hw; t2 = t1 + 2 * hw; } }
  else {
    const dn = scale ? near / Math.max(R * 0.5, 1e-30) : near;
    if (endAtCorner) { t2 = tCorner + dn; t1 = t2 - 2 * hw; } else { t1 = tCorner + dn; t2 = t1 + 2 * hw; }
  }
  const S = C.clone(); S.sweep.setStartEndRadians(t1, t2);
  const [p1, d1] = ptTan(C, t1), [p2, d2] = ptTan(C, t2);
  const F1 = fillet(p1, d1, e1.r, e1.g, true, e1.ext, e1.cusp, lens[0], e1.k);
  const F2 = fillet(p2, d2, e2.r, e2.g, false, e2.ext, e2.cusp, lens[1], e2.k);
  const [, dm] = ptTan(C, 0.5 * (t1 + t2));
  return regionLoop(closeChain([F1, S, F2], 3 * R, V(dm.y, -dm.x)));
}
const CORNER_FAMS = {
  cornerang(c, R, g) {
    const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
    const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI);
    const kind = pick(["chord", "ang", "ang", "ang", "angarc", "angarc", "sector", "lens"]);
    const th = pick(ANG) * pick([1, -1]), rr = pick([0.2, 1, 10]), bulge = pick([0.1, -0.1, 0.4, -0.3]);
    const near = pick(NEAR_CORNER), hw = uni(0.05, 0.6);
    const e1 = mkFil(R, g), e2 = mkFil(R, g);
    const len1 = Math.min(1.0, uni(0.3, 1.2) * R / e1.r), len2 = Math.min(1.0, uni(0.3, 1.2) * R / e2.r);
    Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), kind, th, rr, bulge, near, hw: f5(hw), e1: filStr(e1), e2: filStr(e2) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, 0, TWO_PI);
      const A = Loop.create(...mkA(C, u0, span, kind, th, rr, bulge));
      if (!pl.ccw) A.reverseInPlace();
      return { operands: [A, mkB(C, R, u0 + span, near, true, hw, e1, e2, [len1, len2])] };
    };
  },
  // cornercusp: like cornerang, but the corner curve of A leaves nearly backwards (angle pi - x to the tangent of the arc):
  // the code compares only |sin| of the angle with 1e-4, so a reverse (cusp) direction counts as tangent, not as a corner.
  cornercusp(c, R, g) {
    const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
    const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI);
    const kind = pick(["ang", "angarc", "angarc", "angarc"]);
    const th = (Math.PI - pick([0, 0, 1e-7, 1e-6, 1e-5, 9e-5, 1.1e-4, 1e-3, 1e-2, 0.1])) * pick([1, -1]), rr = pick([0.05, 0.2, 1, 10]), bulge = pick([1, -1]);
    const near = pick(NEAR_CORNER), hw = uni(0.05, 0.6);
    const e1 = mkFil(R, g), e2 = mkFil(R, g);
    const len1 = Math.min(1.0, uni(0.3, 1.2) * R / e1.r), len2 = Math.min(1.0, uni(0.3, 1.2) * R / e2.r);
    Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), kind, th, rr, bulge, near, hw: f5(hw), e1: filStr(e1), e2: filStr(e2) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, 0, TWO_PI);
      const A = Loop.create(...mkA(C, u0, span, kind, th, rr, bulge));
      if (!pl.ccw) A.reverseInPlace();
      return { operands: [A, mkB(C, R, u0 + span, near, true, hw, e1, e2, [len1, len2])] };
    };
  },
  multi(c, R, g) {
    const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
    const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI);
    const kind = pick(["chord", "chord", "ang", "sector", "lens"]);
    const th = pick([0.1, 0.5, -0.3]), bulge = pick([0.1, -0.1, 0.4]);
    const k = 2 + Math.floor(rnd() * 2);
    const shapes = [];
    for (let i = 0; i < k; i++) {
      const where = i === 0 ? "end" : i === 1 ? "start" : "mid";
      const e1 = mkFil(R, g), e2 = mkFil(R, g);
      shapes.push({ where, near: pick(NEAR_CORNER), hw: uni(0.05, 0.4), e1, e2, l1: Math.min(1.0, uni(0.3, 1.2) * R / e1.r), l2: Math.min(1.0, uni(0.3, 1.2) * R / e2.r) });
    }
    const chain = rnd() < 0.5;
    const ops = chain ? [pick([Op.Union, Op.Intersection, Op.AMinusB, Op.Parity]), pick([Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity])] : undefined;
    const order = pick(["ABC", "CAB", "BCA"]);
    Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), kind, th, bulge, k, chain, ops: ops ? ops.map((o) => OPNAMES[o]).join(",") : "-", order: chain ? order : "-",
      shapes: shapes.map((s) => `${s.where}:${s.near}:${f5(s.hw)}:${filStr(s.e1)}:${filStr(s.e2)}`).join("/") });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, 0, TWO_PI);
      const A = Loop.create(...mkA(C, u0, span, kind, th, 1, bulge));
      if (!pl.ccw) A.reverseInPlace();
      const loops = shapes.map((s) => s.where === "end" ? mkB(C, R, u0 + span, s.near, true, s.hw, s.e1, s.e2, [s.l1, s.l2])
        : s.where === "start" ? mkB(C, R, u0, s.near, false, s.hw, s.e1, s.e2, [s.l1, s.l2])
        : mkB(C, R, u0 + 0.5 * span, s.near, true, s.hw, s.e1, s.e2, [s.l1, s.l2]));
      const B = UnionRegion.create(...loops);
      if (!chain) return { operands: [A, B] };
      const Cf = Loop.create(ellArc(P(0, 0), R, R * q, th0, pl.seam, pl.seam + TWO_PI));
      const m = { A, B, C: Cf };
      return { operands: order.split("").map((x) => m[x]), ops };
    };
  },
  nested(c, R, g) {
    const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
    const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI);
    const cut = pick(["half", "wedge"]);
    const op2 = pick([Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity]);
    const near = pick(NEAR_CORNER), hw = uni(0.05, 0.6), atEnd = rnd() < 0.5;
    const e1 = mkFil(R, g), e2 = mkFil(R, g);
    const l1 = Math.min(1.0, uni(0.3, 1.2) * R / e1.r), l2 = Math.min(1.0, uni(0.3, 1.2) * R / e2.r);
    Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), cut, op2: OPNAMES[op2], near, atEnd, hw: f5(hw), e1: filStr(e1), e2: filStr(e2) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, pl.seam, pl.seam + TWO_PI);
      const pe = ptTan(C, u0 + span)[0], ps = ptTan(C, u0)[0];
      let Cut, op1;
      if (cut === "half") { // half plane left of pe -> ps
        const d = V(ps.x - pe.x, ps.y - pe.y); d.normalizeInPlace(); const l = rot90(d);
        const Q0 = P(pe.x - d.x * 3 * R, pe.y - d.y * 3 * R), Q1 = P(ps.x + d.x * 3 * R, ps.y + d.y * 3 * R);
        Cut = Loop.create(LineString3d.create(Q0, Q1, P(Q1.x + l.x * 4 * R, Q1.y + l.y * 4 * R), P(Q0.x + l.x * 4 * R, Q0.y + l.y * 4 * R), Q0));
        op1 = Op.Intersection;
      } else { // wedge from the center through pe and ps, removed
        const c0 = C.center, a = V(pe.x - c0.x, pe.y - c0.y), b = V(ps.x - c0.x, ps.y - c0.y); a.normalizeInPlace(); b.normalizeInPlace();
        Cut = Loop.create(LineString3d.create(c0, P(c0.x + a.x * 3 * R, c0.y + a.y * 3 * R), P(c0.x + b.x * 3 * R, c0.y + b.y * 3 * R), c0));
        if (RegionOps.computeXYArea(Cut) < 0) Cut.reverseInPlace();
        op1 = Op.AMinusB;
      }
      const B = atEnd ? mkB(C, R, u0 + span, near, true, hw, e1, e2, [l1, l2]) : mkB(C, R, u0, near, false, hw, e1, e2, [l1, l2]);
      return { operands: [Loop.create(C), Cut, B], ops: [op1, op2] };
    };
  },
  // nested2: as nested, but X = C op1 Cut is computed inside build (by the library under test) and then all 12
  // operations of X with B are checked, so a case is "correct on master" only if all of them are.
  nested2(c, R, g) {
    CORNER_FAMS.nested(c, R, g);
    const inner = c.build, s1 = rnd() < 0.5;
    c.prm.s1 = s1;
    c.build = (pl) => {
      const b = inner(pl);
      const X = RegionOps.regionBooleanXY(b.operands[0], b.operands[1], b.ops[0], { simplifyUnion: s1 });
      return { operands: [X ?? Loop.create(), b.operands[2]] };
    };
  },
  // multi2: as multi with a chain, but X = op0(first, second) is computed inside build (by the library under test, with
  // simplifyUnion s1), then all 12 operations of X with the third operand are checked.
  multi2(c, R, g) {
    let tries = 0;
    do { CORNER_FAMS.multi(c, R, g); tries++; } while (!c.prm.chain && tries < 50);
    const inner = c.build, s1 = rnd() < 0.5;
    c.prm.s1 = s1;
    c.build = (pl) => {
      const b = inner(pl);
      if (!b.ops) return b;
      let X;
      if (process.env.XLIB) { // step 0 by a fixed library (same input for every build under test)
        const GX = require(process.env.XLIB), EX = require("./exactjson.js");
        const conv = (r) => EX.fromExact(GX, EX.toExact(G, r));
        const XX = GX.RegionOps.regionBooleanXY(conv(b.operands[0]), conv(b.operands[1]), b.ops[0], { simplifyUnion: s1 });
        X = XX ? EX.fromExact(G, EX.toExact(GX, XX)) : undefined;
      } else X = RegionOps.regionBooleanXY(b.operands[0], b.operands[1], b.ops[0], { simplifyUnion: s1 });
      return { operands: [X ?? Loop.create(), b.operands[2]] };
    };
  },
  // ellfil: A = full circle or ellipse C, B = fillet + shared arc + fillet, where the fillets are elliptic (aspect k
  // 0.3 .. 3), external or internal, smooth or cusp (found by multi2: elliptic smooth external fillet on an ellipse).
  ellfil(c, R, g) {
    const q = rnd() < 0.3 ? 1 : uni(0.4, 0.95), th0 = uni(0, Math.PI), t0 = uni(0, TWO_PI), hw = uni(0.05, 0.6);
    const mk = () => ({ r: R * pick([0.003, 0.03, 0.1, 0.5, 1]) * uni(0.8, 1.25), g: g(), ext: rnd() < 0.8, cusp: rnd() < 0.4, k: pick([1, uni(0.3, 0.8), uni(0.3, 0.8), uni(1.25, 3)]) });
    const e1 = mk(), e2 = mk();
    const l1 = Math.min(1.0, uni(0.3, 1.2) * R / e1.r), l2 = Math.min(1.0, uni(0.3, 1.2) * R / e2.r);
    Object.assign(c.prm, { R: f5(R), q: f5(q), hw: f5(hw), e1: filStr(e1), e2: filStr(e2) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, pl.seam, pl.seam + TWO_PI);
      const A = Loop.create(C); if (!pl.ccw) A.reverseInPlace();
      return { operands: [A, mkB(C, R, t0, 0, false, hw, e1, e2, [l1, l2])] };
    };
  },
  // ellchord: minimal shape of the multi2 regression: A = full circle or ellipse C, B = one fillet (elliptic or circular,
  // external or internal, smooth or cusp) + shared arc S + chord back to the fillet start.
  ellchord(c, R, g) {
    const q = rnd() < 0.3 ? 1 : uni(0.4, 0.95), th0 = uni(0, Math.PI), t0 = uni(0, TWO_PI), sw = uni(0.1, 1.2);
    const e = { r: R * pick([0.001, 0.003, 0.01, 0.03, 0.1, 0.5]) * uni(0.8, 1.25), g: g(), ext: rnd() < 0.8, cusp: rnd() < 0.3, k: pick([1, uni(0.3, 0.8), uni(0.3, 0.8), uni(1.25, 3)]) };
    const len = Math.min(1.0, uni(0.3, 1.2) * R / e.r);
    const atStart = rnd() < 0.5;
    Object.assign(c.prm, { R: f5(R), q: f5(q), sw: f5(sw), atStart, e: filStr(e), len: f5(len) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, pl.seam, pl.seam + TWO_PI);
      const A = Loop.create(C); if (!pl.ccw) A.reverseInPlace();
      const S = C.clone(); S.sweep.setStartEndRadians(t0, t0 + sw);
      let curves;
      if (atStart) { const [p, d] = ptTan(C, t0); const F = fillet(p, d, e.r, e.g, true, e.ext, e.cusp, len, e.k); curves = [F, S, LineSegment3d.create(S.endPoint(), F.startPoint())]; }
      else { const [p, d] = ptTan(C, t0 + sw); const F = fillet(p, d, e.r, e.g, false, e.ext, e.cusp, len, e.k); curves = [S, F, LineSegment3d.create(F.endPoint(), S.startPoint())]; }
      return { operands: [A, Loop.create(...curves)] };
    };
  },
  parity(c, R, g) {
    const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
    const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI);
    const kind = pick(["chord", "ang", "sector", "lens"]), th = pick(ANG) * pick([1, -1]), bulge = pick([0.1, -0.1, 0.4]);
    const near = pick(NEAR_CORNER), hw = uni(0.05, 0.6);
    const e1 = mkFil(R, g), e2 = mkFil(R, g);
    const l1 = Math.min(1.0, uni(0.3, 1.2) * R / e1.r), l2 = Math.min(1.0, uni(0.3, 1.2) * R / e2.r);
    Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), kind, th, bulge, near, hw: f5(hw), e1: filStr(e1), e2: filStr(e2) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, 0, TWO_PI);
      const hole = Loop.create(...mkA(C, u0, span, kind, th, 1, bulge)); hole.reverseInPlace();
      const s = 8 * R;
      const outer = Loop.create(LineString3d.create(P(-s, -s), P(s, -s), P(s, s), P(-s, s), P(-s, -s)));
      const A = ParityRegion.create(outer, hole);
      if (!pl.ccw) reverseRegion(A);
      return { operands: [A, mkB(C, R, u0 + span, near, true, hw, e1, e2, [l1, l2])] };
    };
  },
  splitunion(c, R, g) {
    const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
    const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI), fm = uni(0.3, 0.8);
    const how = pick(["tri", "sector"]);
    const near = pick(NEAR_CORNER), hw = uni(0.05, 0.4);
    const e1 = mkFil(R, g), e2 = mkFil(R, g);
    const l1 = Math.min(1.0, uni(0.3, 1.2) * R / e1.r), l2 = Math.min(1.0, uni(0.3, 1.2) * R / e2.r);
    Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), fm: f5(fm), how, near, hw: f5(hw), e1: filStr(e1), e2: filStr(e2) });
    c.build = (pl) => {
      const C = ellArc(P(0, 0), R, R * q, th0, 0, TWO_PI);
      const um = u0 + span * fm, ue = u0 + span;
      const a1 = C.clone(); a1.sweep.setStartEndRadians(u0, um);
      const a2 = C.clone(); a2.sweep.setStartEndRadians(um, ue);
      const pe = a2.endPoint(), pm = a2.startPoint(), ps = a1.startPoint(), c0 = C.center;
      let L1, L2;
      if (how === "tri") { // corner loop: arc um..ue + line pe->pm. Rest: arc u0..um + line pm->pe + chord pe->ps
        L1 = Loop.create(a2, LineSegment3d.create(pe, pm));
        L2 = Loop.create(a1, LineSegment3d.create(pm, pe), LineSegment3d.create(pe, ps));
      } else { // two sectors from the center
        L1 = Loop.create(a2, LineSegment3d.create(pe, c0), LineSegment3d.create(c0, pm));
        L2 = Loop.create(a1, LineSegment3d.create(pm, c0), LineSegment3d.create(c0, ps));
      }
      if (!pl.ccw) { L1.reverseInPlace(); L2.reverseInPlace(); }
      const A = rnd() < 0.5 ? UnionRegion.create(L1, L2) : UnionRegion.create(L2, L1);
      return { operands: [A, mkB(C, R, ue, near, true, hw, e1, e2, [l1, l2])] };
    };
  },
};

// ---------- tangent families (not in the earlier sets) ----------
// tanpoly: A = circle C (R = 0.01 .. 1e4). B = a polygon around C whose 3 .. 6 sides touch C nearly tangentially
//          (gap from GAPS_REL, positive = overlap into C). Each touching side is a straight line, an external arc (circle
//          outside C, bulging toward C) or an internal arc (big circle containing C). Sides are joined by straight
//          lines through outer corner points. No shared arc at all, many near-tangent contacts at once.
// lens   : A = circle C. B = circle C2 nearly tangent to C at one point (internal: C2 inside C or C inside C2,
//          external: C2 outside), gap from GAPS_REL, optionally unioned with a thin box or an arc+line wedge crossing the
//          contact point. Some configs use an ellipse instead of C2. mergeTolerance 1e-7 / default / 1e-5.
function genConfigs(family) {
  const cfgs = [];
  const N = Number(process.env.N ?? 150);
  for (let id = 0; id < N; id++) {
    seed = 7700417 * (3 + id) + family.length * 104729 + family.charCodeAt(0) * 131 + family.charCodeAt(2) * 17;
    for (let w = 0; w < 11; w++) rnd();
    const c = { id, fam: family, mt: undefined, prm: {} };
    if (family === "lens") c.mt = pick([undefined, undefined, 1e-7, 1e-5]);
    const tol = () => c.mt ?? 1e-6;
    const g = () => pick(GAPS_REL) * tol() / 1e-6;
    const R = pick([0.01, 0.3, 1, 18.288, 250, 1e4]) * uni(0.9, 1.1);
    if (family === "tanpoly") {
      const k = 3 + Math.floor(rnd() * 4);
      // tangency angles, spaced so consecutive contacts are less than pi apart
      const base = uni(0, TWO_PI);
      const raw = []; for (let i = 0; i < k; i++) raw.push(uni(0.6, 1.4));
      const s = raw.reduce((a, b) => a + b, 0);
      const ths = []; let acc = base; for (let i = 0; i < k; i++) { ths.push(acc); acc += TWO_PI * raw[i] / s; }
      const sides = ths.map((th) => ({ th, kind: pick(["line", "ext", "int"]), gap: g(), w: uni(0.02, 0.25), rf: pick([0.05, 0.5, 2, 10]) * uni(0.8, 1.25) }));
      Object.assign(c.prm, { R: f5(R), k, sides: sides.map((q) => `${q.kind}:${q.gap}:${f5(q.w)}:${f5(q.rf)}`).join("/") });
      c.build = (pl) => {
        const curves = [];
        const pieces = sides.map((q) => {
          const n = V(Math.cos(q.th), Math.sin(q.th)), t = V(-n.y, n.x);
          const L = q.w * R; // half length of the touching piece
          if (q.kind === "line") {
            const o = R - q.gap; // distance of the line from the center
            return LineSegment3d.create(P(n.x * o - t.x * L, n.y * o - t.y * L), P(n.x * o + t.x * L, n.y * o + t.y * L));
          }
          if (q.kind === "ext") { // circle of radius rf*R outside C, touching at th; we walk it from th-side to th+side
            const r = q.rf * R, d = R + r - q.gap;
            const cc = P(n.x * d, n.y * d);
            const h = Math.min(0.9, L / r); // angular half extent on the small circle
            // on that circle the touching point is at angle th + pi; walking in the ccw direction of B means clockwise on it
            return Arc3d.createXY(cc, r, sweepR(q.th + Math.PI + h, q.th + Math.PI - h));
          }
          // int: big circle of radius rf*R + R containing C, touching at th
          const r = R * (1 + q.rf), d = R - r + q.gap; // center on the n axis (negative side)
          const cc = P(n.x * d, n.y * d);
          const h = Math.min(0.9, L / r);
          return Arc3d.createXY(cc, r, sweepR(q.th - h, q.th + h));
        });
        for (let i = 0; i < k; i++) {
          const a = pieces[i], b = pieces[(i + 1) % k];
          curves.push(a);
          const thm = 0.5 * (sides[i].th + (i + 1 < k ? sides[i + 1].th : sides[0].th + TWO_PI));
          const dth = (i + 1 < k ? sides[i + 1].th : sides[0].th + TWO_PI) - sides[i].th;
          const rc = R / Math.cos(Math.min(0.5 * dth, 1.3)) * 1.2 + 0.3 * R;
          const corner = P(rc * Math.cos(thm), rc * Math.sin(thm));
          curves.push(LineSegment3d.create(a.endPoint(), corner), LineSegment3d.create(corner, b.startPoint()));
        }
        return { operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), Loop.create(...curves)] };
      };
    } else if (family === "lens") {
      const kind = pick(["in", "out", "ext", "ext", "ellIn", "ellExt"]);
      const gap = g();
      const th = uni(0, TWO_PI);
      const rf = pick([0.01, 0.1, 0.5, 0.9, 0.99]) * uni(0.95, 1.05);
      const extra = pick(["none", "box", "box", "wedge"]);
      const alpha = pick([90, 45, 10, 1]) * Math.PI / 180 * pick([1, -1]);
      const off = pick([0, 0, 1e-6, -1e-6, 1e-3, -0.05]) * R;
      Object.assign(c.prm, { R: f5(R), kind, gap, th: f5(th), rf: f5(rf), extra, alpha: f5(alpha * 180 / Math.PI), off: f5(off) });
      c.build = (pl) => {
        const n = V(Math.cos(th), Math.sin(th)), t = V(-n.y, n.x);
        let C2;
        if (kind === "in") { const r = rf * R, d = R - r - gap; C2 = Arc3d.createXY(P(n.x * d, n.y * d), r, sweepR(th, th + TWO_PI)); }
        else if (kind === "out") { const r = R / rf, d = r - R - gap; C2 = Arc3d.createXY(P(-n.x * d, -n.y * d), r, sweepR(th, th + TWO_PI)); }
        else if (kind === "ext") { const r = rf * R * 3, d = R + r - gap; C2 = Arc3d.createXY(P(n.x * d, n.y * d), r, sweepR(th + Math.PI, th + Math.PI + TWO_PI)); }
        else { // ellipse with semi axes a (along n) and b (along t) touching C at th, inside or outside
          const a = rf * R, b = a * pick([0.3, 2, 5]);
          const d = kind === "ellIn" ? R - a - gap : R + a - gap;
          const cc = P(n.x * d, n.y * d);
          C2 = Arc3d.create(cc, V(n.x * a, n.y * a), V(t.x * b, t.y * b), sweepR(0, TWO_PI));
        }
        let B = Loop.create(C2);
        const p = P(n.x * R + t.x * off, n.y * R + t.y * off);
        const dir = V(n.x * Math.sin(alpha) + t.x * Math.cos(alpha), n.y * Math.sin(alpha) + t.y * Math.cos(alpha));
        const h = 0.3 * R, wdt = 0.03 * R;
        if (extra === "box") {
          const pp = rot90(dir).scale(wdt);
          const q0 = P(p.x - dir.x * h, p.y - dir.y * h), q1 = P(p.x + dir.x * h, p.y + dir.y * h);
          B = UnionRegion.create(B, Loop.create(LineString3d.create(q0, q1, P(q1.x + pp.x, q1.y + pp.y), P(q0.x + pp.x, q0.y + pp.y), q0)));
        } else if (extra === "wedge") { // a sector-like piece: two lines from p and an arc around p
          const rr = 0.2 * R, a0 = Math.atan2(dir.y, dir.x);
          const arc = Arc3d.createXY(p, rr, sweepR(a0, a0 + 0.7));
          B = UnionRegion.create(B, Loop.create(LineSegment3d.create(p, arc.startPoint()), arc, LineSegment3d.create(arc.endPoint(), p)));
        }
        return { operands: [Loop.create(circleC(R, pl.seam, pl.ccw)), B] };
      };
    } else if (family === "dshape") {
      // A is not a full circle: A = arc of C (circle or ellipse, span 1.1 pi .. 1.9 pi) closed by a chord (arc + line).
      // B shares an arc S of C (t1..t2) whose ends sit at, near or away from the arc/chord junction of A. The curves of
      // B at the ends of S are fillets of random kind: external or internal, cusp or smooth, circular or elliptic
      // (aspect 0.5 .. 2), overlap g from GAPS_REL. C is a circle or an ellipse (axis ratio 0.4 .. 0.9), R = 0.01 .. 1e4.
      const q = rnd() < 0.5 ? 1 : uni(0.4, 0.9), th0 = uni(0, Math.PI);
      const span = uni(1.1, 1.9) * Math.PI, u0 = uni(0, TWO_PI);
      const near = pick([0, 0, 1e-7, -1e-7, 5e-7, -2e-6, 1e-3, -1e-3, 0.2, -0.2]);
      const atEnd = rnd() < 0.5; // which junction of A
      const hw = uni(0.05, 0.6);
      const mk = () => ({ r: R * pick([0.003, 0.03, 0.1, 0.5, 1, 3]) * uni(0.8, 1.25), g: g(), ext: rnd() < 0.75, cusp: rnd() < 0.75, k: rnd() < 0.7 ? 1 : uni(0.5, 2) });
      const e1 = mk(), e2 = mk();
      Object.assign(c.prm, { R: f5(R), q: f5(q), span: f5(span), near, atEnd, hw: f5(hw), e1: `${e1.ext ? "x" : "i"}${e1.cusp ? "c" : "s"}:${e1.g}:${f5(e1.k)}:${f5(e1.r)}`, e2: `${e2.ext ? "x" : "i"}${e2.cusp ? "c" : "s"}:${e2.g}:${f5(e2.k)}:${f5(e2.r)}` });
      c.build = (pl) => {
        const C = ellArc(P(0, 0), R, R * q, th0, 0, TWO_PI);
        const Aarc = C.clone(); Aarc.sweep.setStartEndRadians(u0, u0 + span);
        const A = Loop.create(Aarc, LineSegment3d.create(Aarc.endPoint(), Aarc.startPoint()));
        if (!pl.ccw) A.reverseInPlace();
        // S starts (atEnd false) or ends (atEnd true) at the junction plus near (in radians of the parameter, scaled by R)
        const j = atEnd ? u0 + span : u0, dn = near / Math.max(R * q, 1e-30) * (Math.abs(near) < 0.1 ? 1 : R * q);
        const t1 = atEnd ? j + dn - 2 * hw : j + dn, t2 = t1 + 2 * hw;
        const S = C.clone(); S.sweep.setStartEndRadians(t1, t2);
        const [p1, d1] = ptTan(C, t1), [p2, d2] = ptTan(C, t2);
        const len = (e) => Math.min(1.0, uni(0.3, 1.2) * R / e.r);
        const F1 = fillet(p1, d1, e1.r, e1.g, true, e1.ext, e1.cusp, len(e1), e1.k);
        const F2 = fillet(p2, d2, e2.r, e2.g, false, e2.ext, e2.cusp, len(e2), e2.k);
        const [pm, dm] = ptTan(C, 0.5 * (t1 + t2));
        return { operands: [A, regionLoop(closeChain([F1, S, F2], 3 * R, V(dm.y, -dm.x)))] };
      };
    } else if (family === "tanend") {
      // like tanpoly, but every touching side is split into two curves at (or near, shift sh) its contact point, and A
      // (the circle) is split into arcs at (or near, shift e) the contact angles. So curve endpoints of both operands sit
      // at the near-tangent contacts, which is what the fix snaps. Kinds: line, ext, int, mix (ext arc then tangent line).
      const k = 2 + Math.floor(rnd() * 4);
      const base = uni(0, TWO_PI);
      const raw = []; for (let i = 0; i < k; i++) raw.push(uni(0.6, 1.4));
      const s = raw.reduce((a, b) => a + b, 0);
      const ths = []; let acc = base; for (let i = 0; i < k; i++) { ths.push(acc); acc += TWO_PI * raw[i] / s; }
      const SH = [0, 0, 1e-8, 1e-7, 5e-7, -5e-7, 9e-7, -1.1e-6, 1e-5, "r"];
      const sides = ths.map((th) => {
        const sh = pick(SH), e = pick(["none", 0, 0, 1e-7, -5e-7, 9e-7, 2e-6, "r"]);
        return { th, kind: pick(["line", "ext", "int", "mix"]), gap: g(), w: uni(0.02, 0.25), rf: pick([0.05, 0.5, 2, 10]) * uni(0.8, 1.25),
          sh: sh === "r" ? 1e-3 * R : sh * tol() / 1e-6, e: e === "r" ? -1e-3 * R : e === "none" ? "none" : e * tol() / 1e-6 };
      });
      Object.assign(c.prm, { R: f5(R), k, sides: sides.map((q) => `${q.kind}:${q.gap}:${f5(q.sh)}:${q.e === "none" ? "none" : f5(q.e)}:${f5(q.w)}:${f5(q.rf)}`).join("/") });
      c.build = (pl) => {
        const curves = [];
        const pieces = sides.map((q) => {
          const n = V(Math.cos(q.th), Math.sin(q.th)), t = V(-n.y, n.x);
          const L = q.w * R;
          if (q.kind === "line") {
            const o = R - q.gap;
            const a = P(n.x * o - t.x * L, n.y * o - t.y * L), b = P(n.x * o + t.x * L, n.y * o + t.y * L), m = P(n.x * o + t.x * q.sh, n.y * o + t.y * q.sh);
            return [LineSegment3d.create(a, m), LineSegment3d.create(m, b)];
          }
          if (q.kind === "ext" || q.kind === "mix") {
            const r = q.rf * R, d = R + r - q.gap, cc = P(n.x * d, n.y * d);
            const h = Math.min(0.9, L / r), phi = q.th + Math.PI, ps = phi - q.sh / r;
            const a1 = Arc3d.createXY(cc, r, sweepR(phi + h, ps));
            if (q.kind === "ext") return [a1, Arc3d.createXY(cc, r, sweepR(ps, phi - h))];
            const ray = a1.fractionToPointAndDerivative(1);
            const dir = ray.direction.normalize();
            const m = ray.origin;
            return [a1, LineSegment3d.create(m, P(m.x + dir.x * L, m.y + dir.y * L))];
          }
          const r = R * (1 + q.rf), d = R - r + q.gap, cc = P(n.x * d, n.y * d);
          const h = Math.min(0.9, L / r), ps = q.th + q.sh / r;
          return [Arc3d.createXY(cc, r, sweepR(q.th - h, ps)), Arc3d.createXY(cc, r, sweepR(ps, q.th + h))];
        });
        for (let i = 0; i < k; i++) {
          const a = pieces[i], b = pieces[(i + 1) % k];
          curves.push(...a);
          const thn = i + 1 < k ? sides[i + 1].th : sides[0].th + TWO_PI;
          const thm = 0.5 * (sides[i].th + thn), dth = thn - sides[i].th;
          const rc = R / Math.cos(Math.min(0.5 * dth, 1.3)) * 1.2 + 0.3 * R;
          const corner = P(rc * Math.cos(thm), rc * Math.sin(thm));
          curves.push(LineSegment3d.create(a[a.length - 1].endPoint(), corner), LineSegment3d.create(corner, b[0].startPoint()));
        }
        const cuts = sides.filter((q) => q.e !== "none").map((q) => q.th + q.e / R);
        const A = splitLoop(circleC(R, pl.seam, true), cuts);
        if (!pl.ccw) A.reverseInPlace();
        return { operands: [A, Loop.create(...curves)] };
      };
    } else if (CORNER_FAMS[family]) {
      CORNER_FAMS[family](c, R, g);
    } else throw new Error("unknown family " + family);
    c.placements = [];
    for (let kpl = 0; kpl < 3; kpl++) {
      const shift = pick([0, 0, 10 * R, 1e5]);
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
    if (process.env.DUMPX) fs.writeFileSync(process.env.DUMPX, JSON.stringify({ key: keyBase, mergeTolerance: c.mt, ops: built.ops ? built.ops.map((o) => OPNAMES[o]) : undefined, operands: operands.map((r) => require("./exactjson.js").toExact(G, r)), A: G.IModelJson.Writer.toIModelJson(operands[0]), B: G.IModelJson.Writer.toIModelJson(operands[1]) }, null, 0));
    const local = operands.map((r) => toLocal(r, ref));
    const grid = makeGrid(local);
    if (!local.every((r) => loopsSimple(r))) { skipped++; if (process.env.DBGSKIP) console.log("skip", local.map((r) => loopsSimple(r)).join(","), keyBase.slice(0, 200)); continue; }
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
        else {
          if (process.env.DUMPCHAIN) fs.writeFileSync(`${process.env.DUMPCHAIN}-su${su}-step${i}.json`, JSON.stringify({ key: keyBase, mergeTolerance: c.mt, op: OPNAMES[op], su, A: G.IModelJson.Writer.toIModelJson(X), B: G.IModelJson.Writer.toIModelJson(Y) }));
          try { res = RegionOps.regionBooleanXY(X, Y, op, opts(su)); } catch (x) { err = "throw"; }
        }
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
