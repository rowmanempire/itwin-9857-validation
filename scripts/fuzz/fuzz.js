"use strict";
// Independent random region boolean inputs, master vs branch.
// Usage: node fuzz.js <masterLib> <branchLib> <family|all> <nCases> <seed0> <outPrefix>
const isMain = require.main === module;
const libM = isMain ? require(process.argv[2]) : null;
const libB = isMain ? require(process.argv[3]) : null;
const famArg = process.argv[4] || "all";
const N = +(process.argv[5] || 50);
const SEED0 = +(process.argv[6] || 1);
const OUT = process.argv[7] || "out";
const fs = require("fs");

// ---------------- rng ----------------
let s32 = 1;
function seedRng(s) { s32 = (s >>> 0) || 1; for (let i = 0; i < 5; i++) rnd(); }
function rnd() { // xorshift32
  s32 ^= s32 << 13; s32 >>>= 0; s32 ^= s32 >>> 17; s32 ^= s32 << 5; s32 >>>= 0; return s32 / 4294967296;
}
const U = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const TAU = 2 * Math.PI;
// tiny signed epsilon (gap > 0, overlap < 0, exact 0)
function eps(lo = -11, hi = -4, pZero = 0.15) { if (chance(pZero)) return 0; const m = Math.pow(10, U(lo, hi)); return chance(0.5) ? m : -m; }

// ---------------- recipe primitives ----------------
const L = (p0, p1) => ({ k: "L", p0, p1 });
const A = (c, v0, v90, s0, sw) => ({ k: "A", c, v0, v90, s0, sw });
const circArc = (c, r, s0, sw) => A(c, [r, 0], [0, r], s0, sw);
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const mul = (p, s) => [p[0] * s, p[1] * s];
const nrm = (p) => { const l = Math.hypot(p[0], p[1]); return [p[0] / l, p[1] / l]; };
const rot90 = (p) => [-p[1], p[0]];
const rotv = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];

// circle split at random cut angles; optional forced cut near angle tc
function circleLoop(c, R, k, forced) {
  const cuts = [];
  const seam = U(0, TAU);
  cuts.push(seam);
  for (let i = 1; i < k; i++) cuts.push(U(0, TAU));
  if (forced !== undefined) cuts[0] = forced;
  const base = cuts[0];
  const rel = cuts.map((t) => ((t - base) % TAU + TAU) % TAU).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < rel.length; i++) {
    const a0 = base + rel[i], a1 = base + (i + 1 < rel.length ? rel[i + 1] : TAU);
    if (a1 - a0 < 1e-9) continue;
    out.push(circArc(c, R, a0, a1 - a0));
  }
  return out;
}
function ellipseLoop(c, a, b, th, k, forced) {
  const v0 = rotv([a, 0], th), v90 = rotv([0, b], th);
  return circleLoop(c, 1, k, forced).map((p) => A(c, v0, v90, p.s0, p.sw));
}
// rounded rectangle, CCW, radii [BL, BR, TR, TL]
function roundedRect(x0, y0, x1, y1, r) {
  const out = [];
  const corners = [
    { p: [x1, y0], r: r[1], c: [x1 - r[1], y0 + r[1]], a: -Math.PI / 2 },
    { p: [x1, y1], r: r[2], c: [x1 - r[2], y1 - r[2]], a: 0 },
    { p: [x0, y1], r: r[3], c: [x0 + r[3], y1 - r[3]], a: Math.PI / 2 },
    { p: [x0, y0], r: r[0], c: [x0 + r[0], y0 + r[0]], a: Math.PI },
  ];
  // start point: bottom edge after BL
  for (const q of corners) {
    if (q.r > 0) out.push(circArc(q.c, q.r, q.a, Math.PI / 2)); else out.push({ k: "P", p: q.p });
  }
  // insert lines between consecutive corner items
  const loop = [];
  for (let i = 0; i < 4; i++) {
    const cur = out[i], nxt = out[(i + 1) % 4];
    if (cur.k === "A") loop.push(cur);
    const e = cur.k === "A" ? arcEnd(cur) : cur.p, s = nxt.k === "A" ? arcStart(nxt) : nxt.p;
    if (Math.hypot(e[0] - s[0], e[1] - s[1]) > 1e-12 * (1 + Math.abs(e[0]) + Math.abs(e[1]))) loop.push(L(e, s));
  }
  return loop;
}
function arcPt(a, t) { return [a.c[0] + a.v0[0] * Math.cos(t) + a.v90[0] * Math.sin(t), a.c[1] + a.v0[1] * Math.cos(t) + a.v90[1] * Math.sin(t)]; }
const arcStart = (a) => arcPt(a, a.s0), arcEnd = (a) => arcPt(a, a.s0 + a.sw);
// polygon (CCW or not) with fillet radius per vertex
function filletPolygon(pts, radii) {
  const n = pts.length, items = [];
  for (let i = 0; i < n; i++) {
    const P = pts[i], Q = pts[(i + n - 1) % n], S = pts[(i + 1) % n];
    const u = nrm(sub(P, Q)), w = nrm(sub(S, P));
    const turn = cross(u, w), ang = Math.acos(Math.max(-1, Math.min(1, dot(u, w))));
    let r = radii[i];
    const lq = Math.hypot(P[0] - Q[0], P[1] - Q[1]), ls = Math.hypot(S[0] - P[0], S[1] - P[1]);
    if (r > 0 && ang > 1e-6 && ang < Math.PI - 1e-3) {
      let d = r * Math.tan(ang / 2);
      const dmax = 0.45 * Math.min(lq, ls);
      if (d > dmax) { d = dmax; r = d / Math.tan(ang / 2); }
      const T1 = sub(P, mul(u, d)), n1 = turn > 0 ? rot90(u) : mul(rot90(u), -1);
      const C = add(T1, mul(n1, r));
      const v0 = sub(T1, C), v90 = rot90(v0);
      items.push(A(C, v0, v90, 0, turn > 0 ? ang : -ang));
    } else items.push({ k: "P", p: P });
  }
  const loop = [];
  for (let i = 0; i < n; i++) {
    const cur = items[i], nxt = items[(i + 1) % n];
    if (cur.k === "A") loop.push(cur);
    const e = cur.k === "A" ? arcEnd(cur) : cur.p, s = nxt.k === "A" ? arcStart(nxt) : nxt.p;
    loop.push(L(e, s));
  }
  return loop;
}
const reverseLoop = (lp) => lp.slice().reverse().map((p) => p.k === "L" ? L(p.p1, p.p0) : A(p.c, p.v0, p.v90, p.s0 + p.sw, -p.sw));
const R_loop = (loop) => ({ t: "loop", loop });
const R_par = (loops) => ({ t: "par", loops });
const R_uni = (regs) => ({ t: "uni", regs });
function mapRegion(r, f) {
  if (r.t === "json") { if (f === reverseLoop) return { ...r, rev: !r.rev }; return { ...r, T: f.T }; }
  if (r.t === "loop") return R_loop(f(r.loop));
  if (r.t === "par") return R_par(r.loops.map(f));
  return R_uni(r.regs.map((x) => mapRegion(x, f)));
}
function xformLoop(lp, T) { // T: {c,s,th,mir,tx,ty}
  const P = (p) => { let q = [p[0] * T.s, (T.mir ? -p[1] : p[1]) * T.s]; q = rotv(q, T.th); return [q[0] + T.tx, q[1] + T.ty]; };
  const V = (v) => { let q = [v[0] * T.s, (T.mir ? -v[1] : v[1]) * T.s]; return rotv(q, T.th); };
  const out = lp.map((p) => p.k === "L" ? L(P(p.p0), P(p.p1)) : A(P(p.c), V(p.v0), V(p.v90), p.s0, p.sw));
  return out;
}

// ---------------- families ----------------
const FAM = {};
// 1. near-tangent disks (external / internal), seams optionally at the contact point
FAM.disks = () => {
  const R1 = U(1, 10), R2 = R1 * Math.pow(10, U(-2, 0.7));
  const dir = U(0, TAU), e = eps();
  let inner = chance(0.5) && R2 < R1 * 0.98;
  const d = inner ? R1 - R2 + e : R1 + R2 + e;
  const c2 = [d * Math.cos(dir), d * Math.sin(dir)];
  const near = () => chance(0.5) ? undefined : dir + (chance(0.3) ? 0 : eps(-9, -3, 0.2));
  const fA = near(), fB0 = near();
  const fB = fB0 === undefined ? undefined : (inner ? fB0 : fB0 + Math.PI);
  return { A: R_loop(circleLoop([0, 0], R1, 1 + Math.floor(rnd() * 3), fA)), B: R_loop(circleLoop(c2, R2, 1 + Math.floor(rnd() * 3), fB)) };
};
// 2. rounded rects touching along a shared edge from opposite sides, B ends near A's fillet tangent points
FAM.edgeTouch = () => {
  const W = U(3, 10), H = U(2, 8);
  const rA = [0, 1, 2, 3].map(() => chance(0.8) ? U(0.05, 0.45) * Math.min(W, H) : 0);
  const cand = [rA[0], W - rA[1], 0, W, U(0, W), rA[0] * U(0.2, 0.9), W - rA[1] * U(0.2, 0.9)];
  let bx0 = pick(cand) + eps(-10, -3, 0.3), bx1 = pick(cand) + eps(-10, -3, 0.3);
  if (bx1 < bx0) [bx0, bx1] = [bx1, bx0];
  if (bx1 - bx0 < 0.2) { bx0 -= U(0.5, 2); bx1 += U(0.5, 2); }
  if (chance(0.3)) { bx0 -= U(0, 3); }
  const e = eps(-11, -5, 0.35), hB = U(0.5, 5);
  const rB = [0, 1, 2, 3].map(() => chance(0.6) ? (chance(0.4) ? pick(rA) * (1 + eps(-9, -3, 0.4)) : U(0.05, 0.45) * Math.min(hB, bx1 - bx0)) : 0)
    .map((r) => Math.min(r, 0.49 * Math.min(hB, bx1 - bx0)));
  return { A: R_loop(roundedRect(0, 0, W, H, rA)), B: R_loop(roundedRect(bx0, -hB - e, bx1, -e, rB)) };
};
// 3. nested rounded rects: inner with tiny gaps, concentric / near-equal fillets
FAM.nested = () => {
  const W = U(3, 10), H = U(2, 8);
  const rA = [0, 1, 2, 3].map(() => chance(0.85) ? U(0.05, 0.45) * Math.min(W, H) : 0);
  const gap = () => chance(0.55) ? Math.abs(eps(-11, -4, 0.35)) * (chance(0.15) ? -1 : 1) : U(0.05, 0.25) * Math.min(W, H);
  const g = [gap(), gap(), gap(), gap()]; // left bottom right top
  const x0 = g[0], y0 = g[1], x1 = W - g[2], y1 = H - g[3];
  const gc = [[0, 1], [2, 1], [2, 3], [0, 3]];
  const rB = rA.map((r, i) => {
    const gg = Math.max(g[gc[i][0]], g[gc[i][1]]);
    const m = pick(["conc", "same", "near", "rand", "zero"]);
    let v = m === "conc" ? r - gg : m === "same" ? r : m === "near" ? r * (1 + eps(-9, -3, 0.2)) : m === "rand" ? U(0.02, 0.45) * Math.min(W, H) : 0;
    return Math.max(0, Math.min(v, 0.49 * Math.min(x1 - x0, y1 - y0)));
  });
  let outer = R_loop(roundedRect(0, 0, W, H, rA)), inner = R_loop(roundedRect(x0, y0, x1, y1, rB));
  if (chance(0.25)) { // inner region becomes a frame (parity) with a hole near its own boundary
    const h = 0.3 * Math.min(x1 - x0, y1 - y0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    inner = R_par([inner.loop, reverseLoop(circleLoop([cx, cy], h, 1 + Math.floor(rnd() * 2)))]);
  }
  return chance(0.5) ? { A: outer, B: inner } : { A: inner, B: outer };
};
// 4. coincident or nearly coincident arcs of one circle
FAM.coincident = () => {
  const R = U(1, 10);
  const A0 = R_loop(circleLoop([0, 0], R, 1 + Math.floor(rnd() * 4)));
  const m = pick(["annSector", "sameCircle", "lune", "shifted"]);
  const dl = eps(-11, -5, 0.4);
  if (m === "annSector") {
    const a = U(0, TAU), b = U(0.05, 3), w = U(0.05, 0.6) * R, Ro = R * (1 + dl);
    const lp = [circArc([0, 0], Ro, a, b), L(arcPt(circArc([0, 0], Ro, a, b), a + b), [Math.cos(a + b) * (R - w), Math.sin(a + b) * (R - w)]),
      circArc([0, 0], R - w, a + b, -b), L([Math.cos(a) * (R - w), Math.sin(a) * (R - w)], arcPt(circArc([0, 0], Ro, a, b), a))];
    return { A: A0, B: R_loop(lp) };
  }
  if (m === "sameCircle") return { A: A0, B: R_loop(circleLoop([0, 0], R * (1 + dl), 1 + Math.floor(rnd() * 4))) };
  if (m === "shifted") { const d = R * Math.abs(eps(-10, -4, 0.0)), th = U(0, TAU); return { A: A0, B: R_loop(circleLoop([d * Math.cos(th), d * Math.sin(th)], R, 1 + Math.floor(rnd() * 3))) }; }
  // lune: arc of the circle closed by a chord or by an arc of another radius
  const a = U(0, TAU), b = U(0.1, 4), Ro = R * (1 + dl);
  const arc = circArc([0, 0], Ro, a, b);
  const p0 = arcStart(arc), p1 = arcEnd(arc);
  if (chance(0.5)) return { A: A0, B: R_loop([arc, L(p1, p0)]) };
  // second arc through p1 -> p0 with radius R2 (center on bisector)
  const mid = mul(add(p0, p1), 0.5), half = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2;
  const R2 = half * U(1.02, 5);
  const off = Math.sqrt(R2 * R2 - half * half);
  const dirIn = nrm(mul(mid, -1));
  const c2 = add(mid, mul(dirIn, chance(0.5) ? off : -off));
  const v0 = sub(p1, c2), ang1 = 0, endv = sub(p0, c2);
  let sw = Math.atan2(cross(v0, endv), dot(v0, endv));
  // choose the arc that stays inside the original sector side
  const r2 = Math.hypot(v0[0], v0[1]);
  return { A: A0, B: R_loop([arc, A(c2, v0, mul(rot90(nrm(v0)), r2), ang1, sw)]) };
};
// 5. several small shapes tangent to a big boundary (union of loops)
FAM.multi = () => {
  const R = U(3, 10), big = chance(0.6) ? R_loop(circleLoop([0, 0], R, 1 + Math.floor(rnd() * 3))) : R_loop(roundedRect(-R, -R, R, R, [0, 1, 2, 3].map(() => U(0, 0.5) * R)));
  const isCircle = big.loop[0].k === "A" && big.loop.every((p) => p.k === "A");
  const n = 2 + Math.floor(rnd() * 5);
  const regs = [];
  const r = R * U(0.05, 0.25);
  const chain = chance(0.3);
  const start = U(0, TAU);
  for (let i = 0; i < n; i++) {
    const side = chance(0.5) ? 1 : -1; // outside / inside
    let th, c;
    if (isCircle) {
      th = chain ? start + i * 2 * Math.asin(Math.min(1, r * (1 + Math.abs(eps(-9, -5, 0.3))) / (R + side * r))) * 1.0000001 : start + i * TAU / n + U(-0.1, 0.1);
      const d = R + side * (r + eps(-11, -5, 0.3));
      c = [d * Math.cos(th), d * Math.sin(th)];
    } else {
      const t = -R + 2 * R * (i + 0.5) / n, e = eps(-11, -5, 0.3);
      c = [t, R + side * (r + e)];
    }
    const shape = chance(0.6) ? circleLoop(c, r, 1 + Math.floor(rnd() * 2), chance(0.4) ? Math.atan2(-c[1], -c[0]) : undefined)
      : roundedRect(c[0] - r, c[1] - r, c[0] + r, c[1] + r, [0, 1, 2, 3].map(() => chance(0.7) ? r * U(0.1, 1) : 0));
    regs.push(R_loop(shape));
  }
  return { A: big, B: regs.length === 1 ? regs[0] : R_uni(regs) };
};
// 6. region with a hole, disk near-tangent to the hole or equal to it
FAM.hole = () => {
  const W = U(6, 12), rh = U(0.8, 2.5), ch = [W / 2 + U(-1, 1), W / 2 + U(-1, 1)];
  const outer = chance(0.5) ? roundedRect(0, 0, W, W, [0, 1, 2, 3].map(() => U(0, 0.3) * W)) : circleLoop([W / 2, W / 2], W / 2, 2);
  const hole = reverseLoop(circleLoop(ch, rh, 1 + Math.floor(rnd() * 3)));
  const A0 = R_par([outer, hole]);
  const m = pick(["inHole", "outHole", "equal", "equalShift"]);
  const dir = U(0, TAU), e = eps();
  if (m === "equal") return { A: A0, B: R_loop(circleLoop(ch, rh * (1 + eps(-11, -5, 0.4)), 1 + Math.floor(rnd() * 3))) };
  if (m === "equalShift") { const d = rh * Math.abs(eps(-10, -4, 0)); return { A: A0, B: R_loop(circleLoop(add(ch, [d * Math.cos(dir), d * Math.sin(dir)]), rh * U(0.999, 1.001), 2)) }; }
  const rb = m === "inHole" ? rh * U(0.1, 0.9) : rh * U(0.1, 0.8);
  const d = m === "inHole" ? rh - rb + e : rh + rb + e;
  const cb = add(ch, [d * Math.cos(dir), d * Math.sin(dir)]);
  return { A: A0, B: R_loop(circleLoop(cb, rb, 1 + Math.floor(rnd() * 3), chance(0.5) ? dir + Math.PI : undefined)) };
};
// 7. ellipse with osculating-like circle or tangent line at a vertex
FAM.ellipse = () => {
  const a = U(2, 8), b = a * U(0.2, 0.9), th = 0;
  const E = R_loop(ellipseLoop([0, 0], a, b, th, 1 + Math.floor(rnd() * 3), chance(0.4) ? (chance(0.5) ? 0 : eps(-9, -3, 0)) : undefined));
  const m = pick(["osc", "line", "minor"]);
  const e = eps();
  if (m === "osc") {
    const rho = b * b / a * (1 + pick([eps(-9, -3, 0.3), U(-0.5, -0.05), U(0.05, 0.5)]));
    return { A: E, B: R_loop(circleLoop([a - rho + e, 0], rho, 1 + Math.floor(rnd() * 2), chance(0.5) ? 0 : undefined)) };
  }
  if (m === "minor") { // circle tangent at the flat vertex (0,b), radius vs curvature a^2/b
    const rho = a * a / b * pick([U(0.2, 0.9), 1 + eps(-9, -3, 0.3), U(1.1, 2)]);
    const side = chance(0.5);
    return { A: E, B: R_loop(circleLoop(side ? [0, b - rho + e] : [0, b + rho + e], rho, 2)) };
  }
  const w = U(0.5, 4), h = U(0.5, 2) * b;
  const out = chance(0.5);
  const x0 = out ? a + e : a + e - w;
  return { A: E, B: R_loop(roundedRect(x0, -h, x0 + w, h, [0, 1, 2, 3].map(() => chance(0.5) ? U(0, 0.4) * Math.min(w, 2 * h) : 0))) };
};
// 8. filleted polygon and a tiny transform of itself
FAM.offsetCopy = () => {
  const n = 3 + Math.floor(rnd() * 6), R = U(2, 8);
  const pts = [];
  for (let i = 0; i < n; i++) { const t = i * TAU / n + U(-0.3, 0.3) * TAU / n; const rr = R * U(0.55, 1.0); pts.push([rr * Math.cos(t), rr * Math.sin(t)]); }
  const radii = pts.map(() => chance(0.7) ? U(0.05, 1.5) : 0);
  const base = filletPolygon(pts, radii);
  const m = pick(["shift", "rotate", "scale", "refillet"]);
  let other;
  if (m === "shift") { const d = Math.pow(10, U(-11, -4)), t = U(0, TAU); other = base.map((p) => p.k === "L" ? L(add(p.p0, [d * Math.cos(t), d * Math.sin(t)]), add(p.p1, [d * Math.cos(t), d * Math.sin(t)])) : A(add(p.c, [d * Math.cos(t), d * Math.sin(t)]), p.v0, p.v90, p.s0, p.sw)); }
  else if (m === "rotate") { const a = eps(-11, -4, 0), v = pick(pts); other = xformLoop(base.map((p) => p.k === "L" ? L(sub(p.p0, v), sub(p.p1, v)) : A(sub(p.c, v), p.v0, p.v90, p.s0, p.sw)), { s: 1, th: a, mir: false, tx: v[0], ty: v[1] }); }
  else if (m === "scale") { const k = 1 + eps(-11, -4, 0); other = xformLoop(base, { s: k, th: 0, mir: false, tx: 0, ty: 0 }); }
  else other = filletPolygon(pts, radii.map((r) => r > 0 && chance(0.6) ? r * (1 + eps(-9, -3, 0.3)) : chance(0.3) ? U(0.05, 1.5) : r));
  return { A: R_loop(base), B: R_loop(other) };
};

// ---------------- second group of families: aimed at snap / fallback code ----------------
function polyLoop(pts) { const out = []; for (let i = 0; i < pts.length; i++) out.push(L(pts[i], pts[(i + 1) % pts.length])); return out; }
function annSector(R1, R2, a, b) {
  const o = circArc([0, 0], R2, a, b - a), i = circArc([0, 0], R1, b, a - b);
  return [o, L(arcEnd(o), arcStart(i)), i, L(arcEnd(i), arcStart(o))];
}
// 9. corner of B (shallow wedge) at the near-tangent point of A's circle
FAM.corner = () => {
  const R = U(1, 10), phi = U(0, TAU), e = eps();
  const V = [(R + e) * Math.cos(phi), (R + e) * Math.sin(phi)];
  const t = [-Math.sin(phi), Math.cos(phi)], nO = [Math.cos(phi), Math.sin(phi)];
  const b1 = chance(0.25) ? 0 : Math.pow(10, U(-5, -0.7)), b2 = chance(0.25) ? 0 : Math.pow(10, U(-5, -0.7));
  const s1 = chance(0.7) ? 1 : -1, s2 = chance(0.7) ? 1 : -1;
  const l1 = R * U(0.2, 1.5), l2 = R * U(0.2, 1.5);
  const d1 = add(mul(t, Math.cos(b1)), mul(nO, s1 * Math.sin(b1))), d2 = add(mul(t, -Math.cos(b2)), mul(nO, s2 * Math.sin(b2)));
  const P1 = add(V, mul(d1, l1)), P2 = add(V, mul(d2, l2));
  const far = add(V, mul(nO, R * U(0.3, 1.5) * (chance(0.8) ? 1 : -1)));
  let pts = [V, P1, far, P2];
  // keep a simple quadrilateral: order by angle around the centroid
  const cen = mul(pts.reduce((s, p) => add(s, p), [0, 0]), 0.25);
  pts = pts.slice().sort((p, q) => Math.atan2(p[1] - cen[1], p[0] - cen[0]) - Math.atan2(q[1] - cen[1], q[0] - cen[0]));
  while (pts[0] !== V) pts.push(pts.shift());
  const filletV = chance(0.3) ? R * Math.pow(10, U(-6, -2)) : 0;
  const B = filletV > 0 ? filletPolygon(pts, [filletV, 0, 0, 0]) : polyLoop(pts);
  return { A: R_loop(circleLoop([0, 0], R, 1 + Math.floor(rnd() * 3), chance(0.5) ? phi + eps(-9, -4, 0.4) : undefined)), B: R_loop(B) };
};
// 10. two adjacent annular sectors (one operand) and a circle near-tangent at the shared radial line
FAM.sharedArc = () => {
  const R2 = U(2, 10), R1 = R2 * U(0.3, 0.9), a = U(0, TAU), m = a + U(0.2, 2), b = m + U(0.2, 2);
  const two = R_uni([R_loop(annSector(R1, R2, a, m)), R_loop(annSector(R1, R2, m, b))]);
  const Rc = R2 * Math.pow(10, U(-2, 0.5)), side = chance(0.6) ? 1 : -1, d = eps(-9, -2, 0.3), e = eps();
  const th = m + d, rr = pick([R2, R2, R1]);
  const dist = rr + side * (Rc + e);
  if (dist <= 0) return FAM.sharedArc();
  const c = [dist * Math.cos(th), dist * Math.sin(th)];
  return { A: two, B: R_loop(circleLoop(c, Rc, 1 + Math.floor(rnd() * 3), chance(0.5) ? th + (side > 0 ? Math.PI : 0) : undefined)) };
};
// 11. fillet complement: rounded rect and the cusped spandrel (or a bigger shape) that fills its TR corner
FAM.spandrel = () => {
  const W = U(3, 10), H = U(2, 8), r = U(0.1, 0.45) * Math.min(W, H);
  const rA = [0, 1, 2, 3].map((i) => i === 2 ? r : (chance(0.5) ? U(0.05, 0.4) * Math.min(W, H) : 0));
  const rs = r * (1 + eps(-10, -4, 0.4)), e1 = eps(-11, -5, 0.5), e2 = eps(-11, -5, 0.5);
  const X = W + e1, Y = H + e2;
  const arc = circArc([X - rs, Y - rs], rs, 0, Math.PI / 2); // (X, Y-rs) -> (X-rs, Y)
  const back = A(arc.c, arc.v0, arc.v90, arc.s0 + arc.sw, -arc.sw); // (X-rs, Y) -> (X, Y-rs)
  let B;
  if (chance(0.6)) B = [L(arcStart(arc), [X, Y]), L([X, Y], arcEnd(arc)), back];
  else {
    const k1 = rs * U(0.1, 1), k2 = rs * U(0.2, 2);
    B = [L(arcStart(arc), [X + k1, Y - rs]), L([X + k1, Y - rs], [X + rs, Y + rs]), L([X + rs, Y + rs], [X - rs, Y + k2]), L([X - rs, Y + k2], arcEnd(arc)), back];
  }
  return { A: R_loop(roundedRect(0, 0, W, H, rA)), B: R_loop(B) };
};
// 12. tiny fillets against long collinear edges
FAM.tinyFillet = () => {
  const W = U(3, 10), H = U(2, 8);
  const rA = [0, 1, 2, 3].map(() => Math.min(W, H) * Math.pow(10, U(-5, -1.5)));
  const e = eps(-11, -5, 0.4);
  const right = chance(0.5), atFillet = chance(0.6);
  const nearX = (right ? (atFillet ? W - rA[1] : W) : (atFillet ? rA[0] : 0)) + eps(-9, -4, 0.3);
  const h = U(0.5, 3), w = U(0.5, 3);
  const mode = pick(["below", "inside", "side"]);
  const rb = () => (chance(0.4) ? pick(rA) * U(0.5, 2) : 0);
  let B;
  const x0 = right ? nearX - w : nearX, x1 = right ? nearX : nearX + w;
  if (mode === "below") B = roundedRect(x0, -h - e, x1, -e, [rb(), rb(), rb(), rb()]);
  else if (mode === "inside") B = roundedRect(x0, e, x1, h, [rb(), rb(), rb(), rb()]);
  else B = roundedRect(W + e, pick([0, rA[1], -rA[1], -h * 0.3]), W + w, H * 0.5, [rb(), rb(), rb(), rb()]);
  return { A: R_loop(roundedRect(0, 0, W, H, rA)), B: R_loop(B) };
};
// 13. elliptic corner arc and a circle tangent to the side near the end of the ellipse arc
FAM.ellCorner = () => {
  const W = U(4, 10), H = U(3, 8), rx = U(0.3, 1.5), ry = rx * U(0.3, 3);
  const c = [W - rx, H - ry], ea = A(c, [rx, 0], [0, ry], 0, Math.PI / 2);
  const lp = [L([0, 0], [W, 0]), L([W, 0], arcStart(ea)), ea, L(arcEnd(ea), [0, H]), L([0, H], [0, 0])];
  const Rc = U(0.2, 5), e = eps(), side = chance(0.5) ? 1 : -1;
  const yT = H - ry + pick([0, eps(-9, -3, 0), -U(0, 1)]);
  const cc = [W + side * (Rc + e), yT];
  return { A: R_loop(lp), B: R_loop(circleLoop(cc, Rc, 1 + Math.floor(rnd() * 2), chance(0.5) ? Math.PI * (side > 0 ? 1 : 0) : undefined)) };
};
const FAM1 = ["disks", "edgeTouch", "nested", "multi", "hole", "ellipse"];
// 14. boolean result (master) reused as input, with a new near-tangent disk on one of its arcs
let baseLib = null;
FAM.reuse = () => {
  if (!baseLib) baseLib = require(process.env.FUZZ_BASELIB);
  const fam = pick(FAM1), seed = 1 + Math.floor(rnd() * 100000), op = pick([0, 2, 3]);
  const saved = s32;
  const cs = makeCase(fam, seed, { noXform: true });
  s32 = saved;
  const r = baseLib.RegionOps.regionBooleanXY(build(baseLib, cs.A), build(baseLib, cs.B), op);
  if (!r) return FAM.reuse();
  const arcs = []; (function walk(x) { if (x.constructor.name !== "Loop") x.children.forEach(walk); else x.children.forEach((p) => { if (p.constructor.name === "Arc3d" && p.curveLength() > 1e-3) arcs.push(p); }); })(r);
  if (!arcs.length) return FAM.reuse();
  const arc = pick(arcs), f = chance(0.3) ? pick([0, 1]) + eps(-9, -3, 0) : U(0.05, 0.95);
  const ff = Math.min(1, Math.max(0, f));
  const P = arc.fractionToPoint(ff), T = arc.fractionToPointAndDerivative(ff).direction.normalize();
  const nrmv = [-T.y, T.x], rr = Math.pow(10, U(-2, 0.7)), side = chance(0.5) ? 1 : -1, e = eps();
  const c = [P.x + nrmv[0] * side * (rr + e), P.y + nrmv[1] * side * (rr + e)];
  return { A: { t: "json", json: JSON.stringify(baseLib.IModelJson.Writer.toIModelJson(r)) }, B: R_loop(circleLoop(c, rr, 1 + Math.floor(rnd() * 2))) };
};

// ---------------- build in a lib ----------------
function buildLoop(lib, lp) {
  const prims = lp.map((p) => p.k === "A" ? lib.Arc3d.create(lib.Point3d.create(p.c[0], p.c[1], 0), lib.Vector3d.create(p.v0[0], p.v0[1], 0), lib.Vector3d.create(p.v90[0], p.v90[1], 0), lib.AngleSweep.createStartSweepRadians(p.s0, p.sw)) : null);
  const n = lp.length;
  for (let i = 0; i < n; i++) {
    if (lp[i].k !== "L") continue;
    const prev = prims[(i + n - 1) % n], next = prims[(i + 1) % n];
    const p0 = prev ? prev.endPoint() : lib.Point3d.create(lp[i].p0[0], lp[i].p0[1], 0);
    const p1 = next ? next.startPoint() : lib.Point3d.create(lp[i].p1[0], lp[i].p1[1], 0);
    prims[i] = lib.LineSegment3d.create(p0, p1);
  }
  // for line-line junctions use the same point object values
  for (let i = 0; i < n; i++) {
    const a = prims[i], b = prims[(i + 1) % n];
    if (lp[i].k === "L" && lp[(i + 1) % n].k === "L") b.point0Ref.setFrom(a.point1Ref);
  }
  return lib.Loop.create(...prims);
}
function reverseRegionLib(lib, g) {
  const nm = g.constructor.name;
  if (nm === "Loop") { g.reverseChildrenInPlace(); return g; }
  for (const c of g.children) reverseRegionLib(lib, c);
  return g;
}
function build(lib, r) {
  if (r.t === "json") {
    let g = lib.IModelJson.Reader.parse(JSON.parse(r.json)); if (Array.isArray(g)) g = g[0];
    if (r.T) { const T = r.T, m = T.mir ? -1 : 1; g.tryTransformInPlace(lib.Transform.createRefs(lib.Point3d.create(T.tx, T.ty, 0), lib.Matrix3d.createRowValues(T.s * Math.cos(T.th), -T.s * Math.sin(T.th) * m, 0, T.s * Math.sin(T.th), T.s * Math.cos(T.th) * m, 0, 0, 0, 1))); }
    if (r.rev) g = reverseRegionLib(lib, g);
    return g;
  }
  if (r.t === "loop") return buildLoop(lib, r.loop);
  if (r.t === "par") return lib.ParityRegion.create(...r.loops.map((l) => buildLoop(lib, l)));
  return lib.UnionRegion.create(...r.regs.map((x) => build(lib, x)));
}

// ---------------- scanline oracle (coordinates relative to ref) ----------------
function primsOfLoop(loop) { return loop.children; }
function crossPrim(p, y, ref, xs) {
  const nm = p.constructor.name;
  if (nm === "LineSegment3d") {
    const a = p.point0Ref, b = p.point1Ref; const y0 = a.y - ref[1], y1 = b.y - ref[1];
    if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) xs.push(a.x - ref[0] + (y - y0) / (y1 - y0) * (b.x - a.x));
    return;
  }
  if (nm === "LineString3d") {
    for (let i = 0; i + 1 < p.numPoints(); i++) {
      const a = p.pointAt(i), b = p.pointAt(i + 1); const y0 = a.y - ref[1], y1 = b.y - ref[1];
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) xs.push(a.x - ref[0] + (y - y0) / (y1 - y0) * (b.x - a.x));
    }
    return;
  }
  if (nm === "Arc3d") {
    const c = p.centerRef, v0 = p.vector0, v90 = p.vector90, sw = p.sweep;
    const s0 = sw.startRadians, swr = sw.sweepRadians;
    const cy = c.y - ref[1], cx = c.x - ref[0];
    const a = v0.y, b = v90.y, R = Math.hypot(a, b);
    if (R === 0) return;
    const q = (y - cy) / R;
    if (q <= -1 || q >= 1) return;
    const phi = Math.atan2(b, a), ac = Math.acos(q);
    for (const t of [phi + ac, phi - ac]) {
      let f;
      if (Math.abs(swr) >= TAU - 1e-15) f = 0.5;
      else if (swr > 0) f = (((t - s0) % TAU) + TAU) % TAU / swr;
      else f = (((s0 - t) % TAU) + TAU) % TAU / -swr;
      if (f >= 0 && f < 1) xs.push(cx + v0.x * Math.cos(t) + v90.x * Math.sin(t));
    }
    return;
  }
  throw new Error("oracle: unsupported " + nm);
}
function evenOdd(xs) { xs.sort((a, b) => a - b); const out = []; for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]); return { iv: out, odd: xs.length % 2 }; }
function unionIv(lists) {
  const all = [].concat(...lists).sort((a, b) => a[0] - b[0]); const out = [];
  for (const iv of all) { if (out.length && iv[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]); else out.push([iv[0], iv[1]]); }
  return out;
}
let oddCount = 0;
function intervals(region, y, ref) {
  const nm = region.constructor.name;
  if (nm === "Loop") { const xs = []; for (const p of region.children) crossPrim(p, y, ref, xs); const r = evenOdd(xs); oddCount += r.odd; return r.iv; }
  if (nm === "ParityRegion") { const xs = []; for (const l of region.children) for (const p of l.children) crossPrim(p, y, ref, xs); const r = evenOdd(xs); oddCount += r.odd; return r.iv; }
  if (nm === "UnionRegion") return unionIv(region.children.map((c) => intervals(c, y, ref)));
  throw new Error("oracle: region " + nm);
}
function combine(a, b, f) { // boolean f(inA,inB) on interval lists
  const ev = [];
  for (const [x0, x1] of a) { ev.push([x0, 1, 0]); ev.push([x1, -1, 0]); }
  for (const [x0, x1] of b) { ev.push([x0, 0, 1]); ev.push([x1, 0, -1]); }
  ev.sort((p, q) => p[0] - q[0]);
  let ca = 0, cb = 0, out = [], open = null;
  for (const e of ev) {
    ca += e[1]; cb += e[2];
    const v = f(ca > 0, cb > 0);
    if (v && open === null) open = e[0];
    else if (!v && open !== null) { if (e[0] > open) out.push([open, e[0]]); open = null; }
  }
  return out;
}
const len = (iv) => iv.reduce((s, q) => s + q[1] - q[0], 0);
function critYs(region, ref, ys) {
  const nm = region.constructor.name;
  if (nm === "UnionRegion" || nm === "ParityRegion") { for (const c of region.children) critYs(c, ref, ys); return; }
  for (const p of region.children) {
    const n = p.constructor.name;
    if (n === "LineSegment3d") { ys.push(p.point0Ref.y - ref[1], p.point1Ref.y - ref[1]); }
    else if (n === "LineString3d") { for (let i = 0; i < p.numPoints(); i++) ys.push(p.pointAt(i).y - ref[1]); }
    else if (n === "Arc3d") {
      ys.push(p.startPoint().y - ref[1], p.endPoint().y - ref[1]);
      const c = p.centerRef, a = p.vector0.y, b = p.vector90.y, R = Math.hypot(a, b);
      ys.push(c.y - ref[1] + R, c.y - ref[1] - R);
    }
  }
}
const OPS = [["union", 0, (a, b) => a || b], ["parity", 1, (a, b) => a !== b], ["inter", 2, (a, b) => a && b], ["aminusb", 3, (a, b) => a && !b], ["bminusa", 4, (a, b) => b && !a]];
const GX = [-0.9324695142, -0.6612093865, -0.2386191861, 0.2386191861, 0.6612093865, 0.9324695142];
const GW = [0.1713244924, 0.3607615730, 0.4679139346, 0.4679139346, 0.3607615730, 0.1713244924];
// integrate over y: area(A), area(B), and per result: symmetric difference with expected
function measure(rA, rB, results, ref) {
  const ys = [];
  critYs(rA, ref, ys); critYs(rB, ref, ys);
  for (const r of results) if (r.reg) critYs(r.reg, ref, ys);
  ys.sort((a, b) => a - b);
  const lo = ys[0], hi = ys[ys.length - 1], H = hi - lo;
  const cuts = [lo];
  for (const y of ys) if (y - cuts[cuts.length - 1] > 1e-13 * (1 + H)) cuts.push(y);
  // subdivide long bands
  const bands = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], m = Math.max(1, Math.ceil((b - a) / H * 150));
    for (let j = 0; j < m; j++) bands.push([a + (b - a) * j / m, a + (b - a) * (j + 1) / m]);
  }
  let aA = 0, aB = 0; const sd = results.map(() => 0), ex = results.map(() => 0);
  for (const [a, b] of bands) {
    for (let g = 0; g < 6; g++) {
      const s = (GX[g] + 1) / 2; // smoothstep substitution
      const y = a + (b - a) * (3 * s * s - 2 * s * s * s), w = GW[g] / 2 * (b - a) * 6 * s * (1 - s);
      if (y <= a || y >= b) continue;
      const ia = intervals(rA, y, ref), ib = intervals(rB, y, ref);
      aA += w * len(ia); aB += w * len(ib);
      for (let k = 0; k < results.length; k++) {
        const e = combine(ia, ib, results[k].f);
        ex[k] += w * len(e);
        const got = results[k].reg ? intervals(results[k].reg, y, ref) : [];
        sd[k] += w * len(combine(e, got, (p, q) => p !== q));
      }
    }
  }
  return { aA, aB, sd, ex };
}

// ---------------- case driver ----------------
function makeCase(fam, seed, ov = {}) {
  seedRng(seed * 7919 + fam.length * 104729 + fam.charCodeAt(0));
  let { A: a, B: b } = FAM[fam]();
  const T = { s: Math.pow(10, U(-1, 2)), th: pick([0, 0, Math.PI / 2, Math.PI, U(0, TAU), U(0, TAU)]), mir: chance(0.2), tx: pick([0, 0, 1e2, 1e4, 3e5]) * U(-1, 1), ty: pick([0, 0, 1e2, 1e4, 3e5]) * U(-1, 1) };
  const revA = chance(0.2), revB = chance(0.2), swap = chance(0.3);
  if (ov.noXform) Object.assign(T, { s: 1, th: 0, mir: false, tx: 0, ty: 0 });
  if (ov.noScale) T.s = 1;
  if (ov.noShift) { T.tx = 0; T.ty = 0; }
  if (ov.noRot) { T.th = 0; T.mir = false; }
  if (!ov.noRev) { if (revA) a = mapRegion(a, reverseLoop); if (revB) b = mapRegion(b, reverseLoop); }
  if (swap && !ov.noSwap) [a, b] = [b, a];
  const xf = (l) => xformLoop(l, T); xf.T = T;
  a = mapRegion(a, xf); b = mapRegion(b, xf);
  return { A: a, B: b, ref: [T.tx, T.ty], scale: T.s };
}
function runLib(lib, cs, opIdx, timing) {
  const rA = build(lib, cs.A), rB = build(lib, cs.B);
  const out = [];
  for (const [name, op, f] of OPS) {
    if (opIdx !== undefined && op !== opIdx) continue;
    let reg, err;
    const t0 = process.hrtime.bigint();
    try { reg = process.env.FUZZ_TOL ? lib.RegionOps.regionBooleanXY(rA, rB, op, +process.env.FUZZ_TOL * (cs.scale || 1)) : lib.RegionOps.regionBooleanXY(rA, rB, op); } catch (x) { err = String(x && x.message || x).slice(0, 80); }
    if (timing) timing.t += Number(process.hrtime.bigint() - t0) / 1e6;
    out.push({ name, op, f, reg, err });
  }
  return { rA, rB, out };
}
const REL = [1e-4, 1e-5, 1e-6];
function judge(cs, lib, opIdx, timing) {
  const r = runLib(lib, cs, opIdx, timing);
  oddCount = 0;
  const m = measure(r.rA, r.rB, r.out, cs.ref);
  const scale = m.aA + m.aB;
  return r.out.map((o, k) => ({ name: o.name, err: o.err, undef: !o.reg, sd: m.sd[k], rel: m.sd[k] / scale, ex: m.ex[k] / scale, scale }));
}
module.exports = { makeCase, judge, FAM, build, OPS };

if (require.main === module) {
  const fams = famArg === "all" ? Object.keys(FAM) : famArg.split(",");
  const tM = { t: 0 }, tB = { t: 0 };
  const stats = {};
  const rows = [];
  const t0 = Date.now();
  for (const fam of fams) {
    const st = stats[fam] = { cases: 0, ops: 0, mWrong: [0, 0, 0], bWrong: [0, 0, 0], fixed: [0, 0, 0], broken: [0, 0, 0], caseFixed: 0, caseBroken: 0, mErr: 0, bErr: 0, oracleErr: 0 };
    for (let s = SEED0; s < SEED0 + N; s++) {
      let cs, jm, jb;
      try { cs = makeCase(fam, s); jm = judge(cs, libM, undefined, tM); jb = judge(cs, libB, undefined, tB); } catch (x) { st.oracleErr++; continue; }
      st.cases++;
      let cf = false, cb = false;
      for (let k = 0; k < jm.length; k++) {
        st.ops++;
        if (jm[k].err) st.mErr++; if (jb[k].err) st.bErr++;
        for (let ti = 0; ti < REL.length; ti++) {
          const wm = !!jm[k].err || !(jm[k].rel <= REL[ti]), wb = !!jb[k].err || !(jb[k].rel <= REL[ti]);
          if (wm) st.mWrong[ti]++; if (wb) st.bWrong[ti]++;
          if (wm && !wb) { st.fixed[ti]++; if (ti === 1) cf = true; }
          if (!wm && wb) { st.broken[ti]++; if (ti === 1) cb = true; }
        }
        if ((jm[k].err || jm[k].rel > 1e-6) || (jb[k].err || jb[k].rel > 1e-6))
          rows.push({ fam, seed: s, op: jm[k].name, m: jm[k].err ? "ERR:" + jm[k].err : jm[k].rel, b: jb[k].err ? "ERR:" + jb[k].err : jb[k].rel, mU: jm[k].undef, bU: jb[k].undef });
      }
      if (cf) st.caseFixed++; if (cb) st.caseBroken++;
    }
  }
  const summary = { fams, N, SEED0, secs: (Date.now() - t0) / 1000, timeMasterMs: tM.t, timeBranchMs: tB.t, stats };
  fs.writeFileSync(OUT + ".summary.json", JSON.stringify(summary, null, 1));
  fs.writeFileSync(OUT + ".rows.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(JSON.stringify({ secs: summary.secs, tM: Math.round(tM.t), tB: Math.round(tB.t) }));
  for (const f of fams) { const s = stats[f]; console.log(f, "cases", s.cases, "ops", s.ops, "wrongM", s.mWrong.join("/"), "wrongB", s.bWrong.join("/"), "fixed", s.fixed.join("/"), "broken", s.broken.join("/"), "caseF", s.caseFixed, "caseB", s.caseBroken, "errM", s.mErr, "errB", s.bErr, "oracleErr", s.oracleErr); }
}
