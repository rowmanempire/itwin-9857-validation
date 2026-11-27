// Review r2: variants of regression A (arcs of nearly equal radius crossing at a small angle), with an exact
// expected answer. Shapes are convex: full disk or circular segment (disk cut by a chord). Area of the intersection
// is computed analytically by Green's theorem on the boundary pieces of each shape inside the other.
// Usage: node crossing-arcs.js <core-geometry.js> [out.txt]
const G = require(process.argv[2]);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, Transform, Matrix3d, RegionOps, RegionBinaryOpType: Op, Angle } = G;
const TWO_PI = 2 * Math.PI;

// shape: { cx, cy, r, t0, sweep (radians, >0 ccw; full if sweep >= 2pi) }
function isFull(s) { return s.sweep >= TWO_PI - 1e-14; }
function inside(s, x, y) {
  const dx = x - s.cx, dy = y - s.cy;
  if (dx * dx + dy * dy > s.r * s.r) return false;
  if (isFull(s)) return true;
  const p0 = [s.cx + s.r * Math.cos(s.t0), s.cy + s.r * Math.sin(s.t0)];
  const p1 = [s.cx + s.r * Math.cos(s.t0 + s.sweep), s.cy + s.r * Math.sin(s.t0 + s.sweep)];
  // ccw arc from p0 to p1 then chord p1->p0: interior is to the left of chord p1->p0
  return (p0[0] - p1[0]) * (y - p1[1]) - (p0[1] - p1[1]) * (x - p1[0]) >= 0;
}
function chord(s) {
  return [[s.cx + s.r * Math.cos(s.t0 + s.sweep), s.cy + s.r * Math.sin(s.t0 + s.sweep)], [s.cx + s.r * Math.cos(s.t0), s.cy + s.r * Math.sin(s.t0)]];
}
// angles on circle (cx,cy,r) where it meets circle o
function circleCircle(cx, cy, r, ox, oy, or) {
  const dx = ox - cx, dy = oy - cy, d = Math.hypot(dx, dy);
  if (d === 0) return [];
  const c = (d * d + (r - or) * (r + or)) / (2 * d * r);
  if (Math.abs(c) > 1) return [];
  const base = Math.atan2(dy, dx), a = Math.acos(c);
  return [base - a, base + a];
}
// angles on circle where it meets segment p->q (within segment)
function circleSegment(cx, cy, r, p, q) {
  const ux = q[0] - p[0], uy = q[1] - p[1];
  const fx = p[0] - cx, fy = p[1] - cy;
  const A = ux * ux + uy * uy, B = 2 * (fx * ux + fy * uy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const out = [];
  for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)])
    if (t >= 0 && t <= 1) out.push(Math.atan2(fy + t * uy, fx + t * ux));
  return out;
}
// params on segment p->q where it meets circle
function segmentCircleParams(p, q, cx, cy, r) {
  const ux = q[0] - p[0], uy = q[1] - p[1];
  const fx = p[0] - cx, fy = p[1] - cy;
  const A = ux * ux + uy * uy, B = 2 * (fx * ux + fy * uy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  return [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].filter((t) => t > 0 && t < 1);
}
function segSeg(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (den === 0) return [];
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den, u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? [t] : [];
}
const normAngle = (a, t0) => { let x = (a - t0) % TWO_PI; if (x < 0) x += TWO_PI; return x; };
// integral of (x dy - y dx)/2 over the boundary of s that is inside o
function partialGreen(s, o) {
  let sum = 0;
  // arc
  const cuts = [0, s.sweep];
  for (const a of circleCircle(s.cx, s.cy, s.r, o.cx, o.cy, o.r)) cuts.push(normAngle(a, s.t0));
  if (!isFull(o)) { const [p, q] = chord(o); for (const a of circleSegment(s.cx, s.cy, s.r, p, q)) cuts.push(normAngle(a, s.t0)); }
  const cs = cuts.filter((c) => c >= 0 && c <= s.sweep).sort((a, b) => a - b);
  for (let i = 0; i + 1 < cs.length; i++) {
    if (cs[i + 1] - cs[i] <= 0) continue;
    const tm = s.t0 + 0.5 * (cs[i] + cs[i + 1]);
    if (!inside(o, s.cx + s.r * Math.cos(tm), s.cy + s.r * Math.sin(tm))) continue;
    const t0 = s.t0 + cs[i], t1 = s.t0 + cs[i + 1];
    sum += 0.5 * (s.r * s.r * (t1 - t0) + s.r * s.cx * (Math.sin(t1) - Math.sin(t0)) - s.r * s.cy * (Math.cos(t1) - Math.cos(t0)));
  }
  if (!isFull(s)) {
    const [p, q] = chord(s);
    const ts = [0, 1, ...segmentCircleParams(p, q, o.cx, o.cy, o.r)];
    if (!isFull(o)) { const [a, b] = chord(o); ts.push(...segSeg(p, q, a, b)); }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i++) {
      const tm = 0.5 * (ts[i] + ts[i + 1]);
      if (!inside(o, p[0] + tm * (q[0] - p[0]), p[1] + tm * (q[1] - p[1]))) continue;
      const x0 = p[0] + ts[i] * (q[0] - p[0]), y0 = p[1] + ts[i] * (q[1] - p[1]);
      const x1 = p[0] + ts[i + 1] * (q[0] - p[0]), y1 = p[1] + ts[i + 1] * (q[1] - p[1]);
      sum += 0.5 * (x0 * y1 - x1 * y0);
    }
  }
  return sum;
}
function shapeArea(s) { return isFull(s) ? Math.PI * s.r * s.r : 0.5 * s.r * s.r * (s.sweep - Math.sin(s.sweep)); }
function intersectionArea(a, b) { return partialGreen(a, b) + partialGreen(b, a); }
function perimeter(s) { return s.r * s.sweep + (isFull(s) ? 0 : 2 * s.r * Math.sin(s.sweep / 2)); }

function toLoop(s, transform) {
  const arc = Arc3d.createXY(Point3d.create(s.cx, s.cy), s.r, isFull(s) ? AngleSweep.createStartEndDegrees(0, 360) : AngleSweep.createStartSweepRadians(s.t0, s.sweep));
  const loop = isFull(s) ? Loop.create(arc) : Loop.create(arc, LineSegment3d.create(arc.endPoint(), arc.startPoint()));
  loop.tryTransformInPlace(transform);
  if (RegionOps.computeXYArea(loop) < 0) loop.reverseInPlace();
  return loop;
}

const deg = Math.PI / 180;
const fails = [];
const stats = {};
let total = 0;
function runCase(group, a, b, transform, det, scale, key) {
  const A = toLoop(a, transform), B = toLoop(b, transform);
  const aA = shapeArea(a) * det, aB = shapeArea(b) * det, aI = intersectionArea(a, b) * det;
  // ambiguity: a sliver of width up to tolerance along the boundary (tolerance is absolute 1e-6)
  const allow = 4 * 1e-6 * (perimeter(a) + perimeter(b)) * scale + 1e-9 * (aA + aB);
  for (const swap of [false, true]) {
    const [X, Y, aX, aY] = swap ? [B, A, aB, aA] : [A, B, aA, aB];
    for (const [op, exp, su] of [[Op.Union, aX + aY - aI, false], [Op.Union, aX + aY - aI, true], [Op.Intersection, aI, false], [Op.AMinusB, aX - aI, false], [Op.BMinusA, aY - aI, false], [Op.Parity, aX + aY - 2 * aI, false]]) {
      total++;
      const st = stats[group] ??= [0, 0]; st[1]++;
      let got;
      try { const r = RegionOps.regionBooleanXY(X, Y, op, { simplifyUnion: su }); got = r ? Math.abs(RegionOps.computeXYArea(r)) : 0; } catch (e) { got = NaN; }
      if (!(Math.abs(got - exp) <= allow)) { st[0]++; fails.push(`${group} ${key} swap=${swap} op=${Op[op]} su=${su} expected=${exp.toPrecision(10)} got=${got}`); }
    }
  }
}

// family 1: A = disk or segment radius R at origin, B = segment radius R*(1+eps) with center offset d in direction phi.
// B's arc runs from near the crossing (startDelta from it) over sweepB. Crossing of equal circles is at phi +- 90 deg.
for (const R of [1, 10, 1000]) {
  for (const eps of [0, 1e-9, -1e-9, 3e-8, -3e-8]) {
    for (const dRel of [2e-7, 5e-7, 1e-6, 3e-6]) { // d = dRel * R at scale 1: equals 2e-6..3e-5 for R=10
      const d = dRel * R;
      for (const phi of [0, 50]) {
        for (const aType of ["full", "seg"]) {
          for (const startDelta of [-12, -4, -0.5, 0.5, 4, 12]) {
            for (const sweepB of [45, -45]) {
              const crossing = (phi + 90);
              const rB = R * (1 + eps);
              let t0B = (crossing + startDelta) * deg, swB = sweepB * deg;
              if (swB < 0) { t0B = t0B + swB; swB = -swB; } // ccw param: arc ends near crossing instead
              const b = { cx: d * Math.cos(phi * deg), cy: d * Math.sin(phi * deg), r: rB, t0: t0B, sweep: swB };
              const a = aType === "full" ? { cx: 0, cy: 0, r: R, t0: 0, sweep: TWO_PI } : { cx: 0, cy: 0, r: R, t0: (crossing - 100) * deg, sweep: 170 * deg };
              for (const [tName, sc, rot, sx, sy, skew] of [["id", 1, 0, 1, 1, 0], ["rot37", 1, 37, 1, 1, 0], ["s1e-3", 1e-3, 200, 1, 1, 0], ["s0.1", 0.1, 0, 1, 1, 0], ["s100", 100, 113, 1, 1, 0], ["s1e4", 1e4, 0, 1, 1, 0], ["ell", 1, 20, 2, 1, 0], ["ellskew", 1, 0, 1, 0.5, 0.3]]) {
                const m = Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(rot)).multiplyMatrixMatrix(Matrix3d.createScale(sc * sx, sc * sy, 1)).multiplyMatrixMatrix(Matrix3d.createRowValues(1, skew, 0, 0, 1, 0, 0, 0, 1));
                const t = Transform.createOriginAndMatrix(undefined, m);
                const det = Math.abs(m.determinant());
                runCase(`R=${R} T=${tName}`, a, b, t, det, sc * Math.max(sx, sy), `eps=${eps} dRel=${dRel} phi=${phi} A=${aType} start=${startDelta} sweep=${sweepB}`);
              }
            }
          }
        }
      }
    }
  }
}
let bad = 0;
for (const [k, v] of Object.entries(stats)) { bad += v[0]; console.log(`${v[0] ? "BAD" : "ok "} ${k}: ${v[0]}/${v[1]}`); }
console.log(`total ${bad}/${total}`);
if (process.argv[3]) require("fs").writeFileSync(process.argv[3], fails.join("\n") + "\n");
