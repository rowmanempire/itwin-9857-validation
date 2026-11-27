"use strict";
// Independent fuzz for one-edge faces and touching regions (last check).
// node fz.js <families comma> <n> <seed0> <out.jsonl>
// Libraries: env LIB_master and LIB_head = paths to core-geometry.js of each build (LIBS = list of names, default
// "master,head"). Without LIB_<name> the script looks for libs/<name>/core-geometry.js next to it.
// Exact areas by own scanline integration of own region model.
const path = require("path");
const LIBS = (process.env.LIBS || "master,head").split(",");
const libs = {};
for (const l of LIBS) libs[l] = require(process.env["LIB_" + l] || path.join(__dirname, "libs", l, "core-geometry.js"));
const G0 = libs[LIBS[0]];
const fs = require("fs");

// ---------- RNG ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
let R = rng(1);
const U = (a, b) => a + (b - a) * R();
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const deg = (r) => r * 180 / Math.PI, rad = (d) => d * Math.PI / 180;

// ---------- own curve model ----------
// curve: {t:"arc", c:[x,y], vx:[..], vy:[..], s0, s1 (deg)} | {t:"line", p0, p1} | {t:"bsp", poles:[[x,y]..], order}
function arcPt(a, d) { const t = rad(d); return [a.c[0] + a.vx[0] * Math.cos(t) + a.vy[0] * Math.sin(t), a.c[1] + a.vx[1] * Math.cos(t) + a.vy[1] * Math.sin(t)]; }
function circle(c, r, s0, ccw = true) { return { t: "arc", c, vx: [r, 0], vy: [0, r], s0, s1: s0 + (ccw ? 360 : -360) }; }
function ellipse(c, a, b, rot, s0, ccw = true) {
  const cr = Math.cos(rad(rot)), sr = Math.sin(rad(rot));
  return { t: "arc", c, vx: [a * cr, a * sr], vy: [-b * sr, b * cr], s0, s1: s0 + (ccw ? 360 : -360) };
}
const line = (p0, p1) => ({ t: "line", p0, p1 });
function polygonCurves(pts) { const out = []; for (let i = 0; i < pts.length; i++) out.push(line(pts[i], pts[(i + 1) % pts.length])); return out; }

// build lib object
function libCurve(G, c) {
  if (c.t === "arc") return G.Arc3d.create(G.Point3d.create(c.c[0], c.c[1]), G.Vector3d.create(c.vx[0], c.vx[1]), G.Vector3d.create(c.vy[0], c.vy[1]), G.AngleSweep.createStartEndDegrees(c.s0, c.s1));
  if (c.t === "line") return G.LineSegment3d.createXYXY(c.p0[0], c.p0[1], c.p1[0], c.p1[1]);
  if (c.t === "bsp") return G.BSplineCurve3d.createPeriodicUniformKnots(c.poles.map((p) => G.Point3d.create(p[0], p[1])), c.order);
  throw new Error("curve");
}
// region: {t:"loop", curves} | {t:"parity", loops:[loop]} | {t:"union", regions:[...]}
function libRegion(G, r) {
  if (r.t === "loop") return G.Loop.create(...r.curves.map((c) => libCurve(G, c)));
  if (r.t === "parity") return G.ParityRegion.create(...r.loops.map((l) => libRegion(G, l)));
  if (r.t === "union") return G.UnionRegion.create(...r.regions.map((x) => libRegion(G, x)));
  throw new Error("region");
}
// polyline strokes of own curves
function strokeOwn(c, out) {
  if (c.t === "line") { out.push(c.p0, c.p1); return; }
  if (c.t === "arc") { const n = Math.max(8, Math.ceil(Math.abs(c.s1 - c.s0) * 4)); for (let i = 0; i <= n; i++) out.push(arcPt(c, c.s0 + (c.s1 - c.s0) * i / n)); return; }
  if (c.t === "bsp") { const b = libCurve(G0, c); const n = 6000; for (let i = 0; i <= n; i++) { const p = b.fractionToPoint(i / n); out.push([p.x, p.y]); } return; }
}
// segments of a loop (array of [x0,y0,x1,y1]) from own model
function ownLoopSegs(l) { const segs = []; for (const c of l.curves) { const pts = []; strokeOwn(c, pts); for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]); } return segs; }
// region -> membership tree with segment lists
function ownTree(r) {
  if (r.t === "loop") return { t: "par", segs: ownLoopSegs(r) };
  if (r.t === "parity") return { t: "par", segs: r.loops.flatMap(ownLoopSegs) };
  return { t: "or", kids: r.regions.map(ownTree) };
}
// lib result -> tree (stroked from lib geometry, independent of boolean code)
function libLoopSegs(G, loop) {
  const segs = [];
  for (const p of loop.children) {
    let n = 1;
    if (p instanceof G.Arc3d) n = Math.max(8, Math.ceil(Math.abs(p.sweep.sweepDegrees) * 4));
    else if (!(p instanceof G.LineSegment3d)) n = 6000;
    if (p instanceof G.LineString3d) { const pts = p.points; for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y]); continue; }
    let q = p.fractionToPoint(0);
    for (let i = 1; i <= n; i++) { const r2 = p.fractionToPoint(i / n); segs.push([q.x, q.y, r2.x, r2.y]); q = r2; }
  }
  return segs;
}
function libTree(G, r) {
  if (r instanceof G.Loop) return { t: "par", segs: libLoopSegs(G, r) };
  if (r instanceof G.ParityRegion) return { t: "par", segs: r.children.flatMap((l) => libLoopSegs(G, l)) };
  if (r instanceof G.UnionRegion) return { t: "or", kids: r.children.map((x) => libTree(G, x)) };
  throw new Error("lib region " + r.constructor.name);
}
function treeSegs(t, out = []) { if (t.t === "par") out.push(...t.segs); else for (const k of t.kids) treeSegs(k, out); return out; }
// scanline area with per-row crossing lists (exact in x, midpoint rule in y)
function parNodes(t, out = []) { if (t.t === "par") out.push(t); else for (const k of t.kids) parNodes(k, out); return out; }
function insideRow(t, i, x) {
  if (t.t === "par") { const xs = t.rowX[i]; let k = 0; if (xs) for (const v of xs) { if (v < x) k++; else break; } return (k & 1) === 1; }
  return t.kids.some((k) => insideRow(k, i, x));
}
function opIn(op, a, b) { switch (op) { case "union": return a || b; case "intersection": return a && b; case "aMinusB": return a && !b; case "bMinusA": return b && !a; case "parity": return a !== b; case "selfUnion": return a; } }
function scanArea(trees, fn, rows = 2000) {
  const nodes = trees.flatMap((t) => (t ? parNodes(t) : []));
  let y0 = Infinity, y1 = -Infinity;
  for (const nd of nodes) for (const s of nd.segs) { y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
  if (!(y1 > y0)) return 0;
  const h = (y1 - y0) / rows;
  for (const nd of nodes) {
    nd.rowX = new Array(rows);
    for (const s of nd.segs) {
      const [xa, ya, xb, yb] = s; const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      let i0 = Math.max(0, Math.ceil((lo - y0) / h - 0.5)); for (let i = i0; i < rows; i++) {
        const y = y0 + (i + 0.5) * h; if (y >= hi) break; if (y < lo) continue;
        if ((ya <= y) !== (yb <= y)) (nd.rowX[i] || (nd.rowX[i] = [])).push(xa + (y - ya) * (xb - xa) / (yb - ya));
      }
    }
    for (const a of nd.rowX) if (a) a.sort((p, q) => p - q);
  }
  let area = 0;
  for (let i = 0; i < rows; i++) {
    const xs = []; for (const nd of nodes) if (nd.rowX[i]) xs.push(...nd.rowX[i]);
    if (xs.length < 2) continue; xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k++) { const w = xs[k + 1] - xs[k]; if (w <= 0) continue; const xm = 0.5 * (xs[k] + xs[k + 1]); if (fn(trees.map((t) => (t ? insideRow(t, i, xm) : false)))) area += w * h; }
  }
  return area;
}

// ---------- families ----------
function rot2(v, d) { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; }
function randStart() { return pick([0, 0, 90, 180, U(0, 360)]); }
function randCircleNear(sc) { return circle([U(-1, 1) * sc, U(-1, 1) * sc], U(0.4, 1.3) * sc, randStart(), R() < 0.8); }
function randPolygon(c, r, n) { const pts = []; const a0 = U(0, 360); for (let i = 0; i < n; i++) { const a = a0 + 360 * i / n + U(-10, 10); const rr = r * U(0.6, 1.1); pts.push([c[0] + rr * Math.cos(rad(a)), c[1] + rr * Math.sin(rad(a))]); } return pts; }
const L = (...curves) => ({ t: "loop", curves });
// a closed one-curve loop with known start point P and outward unit normal at P
function closedCurveAt(sc, kind) {
  kind = kind || pick(["circle", "circle", "ellipse", "bsp"]);
  const c = [U(-0.3, 0.3) * sc, U(-0.3, 0.3) * sc];
  const ccw = R() < 0.85;
  if (kind === "circle") { const r = U(0.6, 1.2) * sc; const s0 = randStart(); const cur = circle(c, r, s0, ccw); const P = arcPt(cur, s0); return { cur, P, n: [Math.cos(rad(s0)), Math.sin(rad(s0))], kind }; }
  if (kind === "ellipse") {
    const a = U(0.6, 1.3) * sc, b = U(0.3, 0.9) * sc, rot = U(0, 180), s0 = randStart(); const cur = ellipse(c, a, b, rot, s0, ccw);
    const P = arcPt(cur, s0); // normal: perpendicular to tangent, pointing away from center
    const t = rad(s0); const tg = [-cur.vx[0] * Math.sin(t) + cur.vy[0] * Math.cos(t), -cur.vx[1] * Math.sin(t) + cur.vy[1] * Math.cos(t)];
    let n = [tg[1], -tg[0]]; const ln = Math.hypot(n[0], n[1]); n = [n[0] / ln, n[1] / ln]; if ((P[0] - c[0]) * n[0] + (P[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
    return { cur, P, n, kind };
  }
  // convex-ish periodic bspline
  const m = 6 + Math.floor(R() * 4), poles = []; const a0 = U(0, 360);
  for (let i = 0; i < m; i++) { const a = a0 + (ccw ? 1 : -1) * 360 * i / m; const rr = sc * U(0.8, 1.2); poles.push([c[0] + rr * Math.cos(rad(a)), c[1] + rr * Math.sin(rad(a))]); }
  const cur = { t: "bsp", poles, order: pick([3, 4]) };
  const b = libCurve(G0, cur); const ray = b.fractionToPointAndDerivative(0); const P = [ray.origin.x, ray.origin.y];
  let n = [ray.direction.y, -ray.direction.x]; const ln = Math.hypot(n[0], n[1]); n = [n[0] / ln, n[1] / ln];
  if ((P[0] - c[0]) * n[0] + (P[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { cur, P, n, kind };
}
// circle tangent at P to normal n, outside (side=+1) or inside (side=-1), radius r, start at P with prob pStart
function tangentCircle(P, n, side, r, pStart, gap = 0) {
  const c = [P[0] + n[0] * (side * r + gap), P[1] + n[1] * (side * r + gap)];
  const sAt = deg(Math.atan2(P[1] - c[1], P[0] - c[0]));
  return circle(c, r, R() < pStart ? sAt : U(0, 360), R() < 0.8);
}
function gapTol(tol) { return R() < 0.5 ? 0 : U(-1, 1) * (+(process.env.GAPK || 0.4)) * tol; }
const fams = {
  extTouch(sc, tol) { const a = closedCurveAt(sc); const B = tangentCircle(a.P, a.n, 1, U(0.2, 1.0) * sc, 0.75, gapTol(tol)); return { A: L(a.cur), B: L(B) }; },
  intTouch(sc, tol) { const a = closedCurveAt(sc, pick(["circle", "circle", "ellipse"])); const B = tangentCircle(a.P, a.n, -1, U(0.05, 0.3) * sc, 0.75, gapTol(tol)); return R() < 0.5 ? { A: L(a.cur), B: L(B) } : { A: L(B), B: L(a.cur) }; },
  nestedHole(sc, tol) {
    const a = closedCurveAt(sc, pick(["circle", "circle", "ellipse"])); const touch = R() < 0.6;
    const hole = touch ? tangentCircle(a.P, a.n, -1, U(0.05, 0.3) * sc, 0.75, gapTol(tol)) : circle([a.cur.c ? a.cur.c[0] : 0, a.cur.c ? a.cur.c[1] : 0], U(0.05, 0.25) * sc, randStart(), R() < 0.5);
    const A = { t: "parity", loops: [L(a.cur), L(hole)] };
    let B; const k = R();
    if (k < 0.4) B = L(randCircleNear(sc)); else if (k < 0.7) B = L(tangentCircle(a.P, a.n, 1, U(0.2, 0.8) * sc, 0.7)); else B = L(...polygonCurves(randPolygon([U(-1, 1) * sc, U(-1, 1) * sc], sc, 3 + Math.floor(R() * 4))));
    return { A, B };
  },
  nestedUnion(sc, tol) {
    const a = closedCurveAt(sc, "circle"); const regs = [L(a.cur)];
    const r1 = U(0.1, 0.5) * sc; regs.push(L(tangentCircle(a.P, a.n, -1, r1, 0.8, gapTol(tol))));
    if (R() < 0.5) regs.push(L(circle(a.cur.c, U(0.05, 0.2) * sc, randStart())));
    return { A: { t: "union", regions: regs }, B: L(randCircleNear(sc)) };
  },
  vertexTouch(sc, tol) {
    const pts = randPolygon([0, 0], sc, 3 + Math.floor(R() * 4)); const i = Math.floor(R() * pts.length);
    const V = pts[i], Pm = pts[(i + pts.length - 1) % pts.length], Pp = pts[(i + 1) % pts.length];
    const u1 = [Pm[0] - V[0], Pm[1] - V[1]], u2 = [Pp[0] - V[0], Pp[1] - V[1]]; const n1 = Math.hypot(...u1), n2 = Math.hypot(...u2);
    let bis = [-(u1[0] / n1 + u2[0] / n2), -(u1[1] / n1 + u2[1] / n2)]; const nb = Math.hypot(...bis); bis = [bis[0] / nb, bis[1] / nb];
    let cir;
    if (R() < 0.6) cir = tangentCircle(V, bis, 1, U(0.1, 0.8) * sc, 0.8, gapTol(tol));
    else { const d = rot2(bis, U(-150, 150)); cir = tangentCircle(V, d, 1, U(0.1, 0.8) * sc, 0.8); }
    const poly = L(...polygonCurves(pts)); return R() < 0.5 ? { A: poly, B: L(cir) } : { A: L(cir), B: poly };
  },
  multiLoops(sc, tol) {
    const a = closedCurveAt(sc, pick(["circle", "ellipse", "bsp"])); const regs = [L(a.cur)]; let cur = { P: a.P, n: a.n };
    const k = 1 + Math.floor(R() * 3);
    for (let j = 0; j < k; j++) {
      const side = R() < 0.6 ? 1 : -1; const r = U(0.1, 0.6) * sc; const c = tangentCircle(cur.P, cur.n, side, r, 0.8, gapTol(tol)); regs.push(L(c));
      const s = U(0, 360); const P = arcPt(c, s); cur = { P, n: [Math.cos(rad(s)), Math.sin(rad(s))] };
    }
    let B; const q = R(); if (q < 0.5) B = L(randCircleNear(sc)); else if (q < 0.8) B = L(...polygonCurves(randPolygon([U(-1, 1) * sc, U(-1, 1) * sc], sc, 3 + Math.floor(R() * 4)))); else B = { t: "union", regions: [L(randCircleNear(sc)), L(randCircleNear(sc))] };
    return R() < 0.5 ? { A: { t: "union", regions: regs }, B } : { A: B, B: { t: "union", regions: regs } };
  },
  dup(sc, tol) {
    const a = closedCurveAt(sc, pick(["circle", "circle", "ellipse"])); const b = JSON.parse(JSON.stringify(a.cur));
    const m = R();
    if (m < 0.3) { /* identical */ } else if (m < 0.55) { const d = U(0, 360); b.s0 += d; b.s1 += d; } else if (m < 0.8) { const t = b.s0; b.s0 = b.s1; b.s1 = t; } else { const f = 1 + U(-0.3, 0.3) * tol / sc; b.vx = b.vx.map((v) => v * f); b.vy = b.vy.map((v) => v * f); }
    const q = R();
    if (q < 0.5) return { A: L(a.cur), B: L(b) };
    if (q < 0.75) return { A: { t: "union", regions: [L(a.cur), L(b)] }, B: L(randCircleNear(sc)) };
    return { A: L(a.cur), B: { t: "union", regions: [L(b), L(randCircleNear(sc))] } };
  },
  figure8(sc, tol) {
    const a = closedCurveAt(sc, pick(["circle", "circle", "ellipse"])); const side = R() < 0.6 ? 1 : -1;
    const c2 = tangentCircle(a.P, a.n, side, U(0.1, side > 0 ? 0.9 : 0.4) * sc, 1.0, gapTol(tol));
    const A = L(a.cur, c2); const q = R();
    return { A, B: q < 0.3 ? null : L(q < 0.7 ? randCircleNear(sc) : tangentCircle(a.P, a.n, side > 0 ? -1 : 1, U(0.1, 0.4) * sc, 0.5)) };
  },
  selfTouchPoly(sc, tol) {
    // polygon loop with a full circle inserted at a vertex, outside the polygon
    const pts = randPolygon([0, 0], sc, 3 + Math.floor(R() * 4)); const i = Math.floor(R() * pts.length);
    const V = pts[i], Pm = pts[(i + pts.length - 1) % pts.length], Pp = pts[(i + 1) % pts.length];
    const u1 = [Pm[0] - V[0], Pm[1] - V[1]], u2 = [Pp[0] - V[0], Pp[1] - V[1]]; const n1 = Math.hypot(...u1), n2 = Math.hypot(...u2);
    let bis = [-(u1[0] / n1 + u2[0] / n2), -(u1[1] / n1 + u2[1] / n2)]; const nb = Math.hypot(...bis); bis = [bis[0] / nb, bis[1] / nb];
    const cir = tangentCircle(V, bis, 1, U(0.1, 0.6) * sc, 1.0);
    const curves = []; for (let j = 0; j < pts.length; j++) { const p0 = pts[(i + j) % pts.length], p1 = pts[(i + j + 1) % pts.length]; if (j === 0) curves.push(cir); curves.push(line(p0, p1)); }
    const A = L(...curves); const q = R();
    return { A, B: q < 0.3 ? null : L(q < 0.7 ? randCircleNear(sc) : tangentCircle(V, bis, 1, U(0.1, 0.6) * sc, 0.6)) };
  },
  lollipop(sc, tol) {
    // loop: stick from Q to P, full circle at P, stick back P to Q (zero-area stick, circle area)
    const a = closedCurveAt(sc, pick(["circle", "ellipse"])); const Q = [a.P[0] + a.n[0] * U(0.2, 1) * sc, a.P[1] + a.n[1] * U(0.2, 1) * sc];
    const A = L(line(Q, a.P), a.cur, line(a.P, Q)); const q = R();
    return { A, B: q < 0.3 ? null : L(randCircleNear(sc)) };
  },
  edgeTangent(sc, tol) {
    // circle tangent to a polygon edge at its start point, inside or outside, as region or hole
    const pts = randPolygon([0, 0], sc, 3 + Math.floor(R() * 3)); const i = Math.floor(R() * pts.length); const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
    const t = U(0.2, 0.8); const P = [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])];
    const d = [p1[0] - p0[0], p1[1] - p0[1]]; const ld = Math.hypot(...d); const area = pts.reduce((s, p, k) => s + p[0] * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * p[1], 0);
    let n = [d[1] / ld, -d[0] / ld]; if (area < 0) n = [-n[0], -n[1]]; // outward
    const side = R() < 0.5 ? 1 : -1; const cir = tangentCircle(P, n, side, U(0.03, 0.2) * sc, 0.85, gapTol(tol));
    const poly = L(...polygonCurves(pts)); const q = R();
    if (side < 0 && q < 0.4) return { A: { t: "parity", loops: [poly, L(cir)] }, B: L(randCircleNear(sc)) };
    return R() < 0.5 ? { A: poly, B: L(cir) } : { A: L(cir), B: poly };
  },
  tiny(sc, tol) {
    const a = closedCurveAt(sc, pick(["circle", "ellipse"])); const side = R() < 0.5 ? 1 : -1; const B = tangentCircle(a.P, a.n, side, U(1.5, 30) * tol, 0.8);
    return R() < 0.5 ? { A: L(a.cur), B: L(B) } : { A: { t: "union", regions: [L(a.cur), L(B)] }, B: L(randCircleNear(sc)) };
  },
  thereBack(sc, tol) {
    // loop with a full circle traversed there and back (zero area), plus a region
    const a = closedCurveAt(sc, "circle"); const back = JSON.parse(JSON.stringify(a.cur)); [back.s0, back.s1] = [back.s1, back.s0];
    const q = R();
    if (q < 0.5) return { A: L(a.cur, back), B: L(randCircleNear(sc)) };
    return { A: { t: "union", regions: [L(a.cur, back), L(tangentCircle(a.P, a.n, 1, U(0.2, 0.8) * sc, 0.8))] }, B: R() < 0.5 ? null : L(randCircleNear(sc)) };
  },
};

const OPS = ["union", "intersection", "aMinusB", "bMinusA", "parity"];
function libOp(G, op) { return { union: G.RegionBinaryOpType.Union, intersection: G.RegionBinaryOpType.Intersection, aMinusB: G.RegionBinaryOpType.AMinusB, bMinusA: G.RegionBinaryOpType.BMinusA, parity: G.RegionBinaryOpType.Parity }[op]; }

function runCase(fam, seed) {
  R = rng(seed * 7919 + fam.length * 104729 + 17);
  const sc = pick([1, 1, 10, 100]); const tol = 1e-6;
  const cs = fams[fam](sc, tol);
  const tA = ownTree(cs.A), tB = cs.B ? ownTree(cs.B) : null;
  const rows = [];
  const ops = cs.B ? OPS.map((o) => ({ op: o, simp: false })).concat([{ op: "union", simp: true }]) : [{ op: "selfUnion", simp: false }, { op: "selfUnion", simp: true }];
  const scaleArea = scanArea([tA], (m) => m[0]) + (tB ? scanArea([tB], (m) => m[0]) : 0);
  for (const { op, simp } of ops) {
    const exact = scanArea([tA, tB], (m) => opIn(op, m[0], m[1]));
    const row = { fam, seed, op, simp, exact, scale: scaleArea, res: {} };
    for (const ln of LIBS) {
      const G = libs[ln];
      let area, libArea, err, nLoops;
      try {
        const A = libRegion(G, cs.A), B = cs.B ? libRegion(G, cs.B) : undefined;
        const o = op === "selfUnion" ? G.RegionBinaryOpType.Union : libOp(G, op);
        const res = G.RegionOps.regionBooleanXY(A, B, o, simp ? { simplifyUnion: true } : G.Geometry.smallMetricDistance);
        if (!res) area = 0; else { const t = libTree(G, res); area = scanArea([t], (m) => m[0]); libArea = G.RegionOps.computeXYArea(res); }
      } catch (e) { err = String(e && e.message || e).slice(0, 80); }
      row.res[ln] = { area, rel: area === undefined ? 1 : Math.abs(area - exact) / Math.max(scaleArea, 1e-30), libArea, err };
    }
    rows.push(row);
  }
  return { cs, rows };
}

if (require.main === module) {
  const famList = process.argv[2].split(","); const n = +process.argv[3]; const s0 = +process.argv[4]; const out = process.argv[5];
  const f = fs.openSync(out, "w");
  for (const fam of famList) for (let s = s0; s < s0 + n; s++) {
    let r; try { r = runCase(fam, s); } catch (e) { fs.writeSync(f, JSON.stringify({ fam, seed: s, genErr: String(e.message) }) + "\n"); continue; }
    for (const row of r.rows) fs.writeSync(f, JSON.stringify(row) + "\n");
  }
  fs.closeSync(f);
}
module.exports = { runCase, fams, libs, ownTree, scanArea };
