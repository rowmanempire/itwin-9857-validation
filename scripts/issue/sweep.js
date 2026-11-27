// Independent stress tests for the iTwin/itwinjs-core #9857 fix: families around the issue geometry.
// Same as sweep-limited.js, without its limit of 5,000 recorded failures per family.
// Usage: node sweep.js <core-geometry.js>
const lib = process.argv[2];
const G = require(lib);
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, Transform, Matrix3d, RegionOps, RegionBinaryOpType: Op, Angle, Vector3d } = G;
const ops = [Op.Union, Op.Intersection, Op.AMinusB, Op.BMinusA, Op.Parity];
const opName = ["Union", "Parity", "Intersection", "AMinusB", "BMinusA"];
const R = 18.288;

// family 1: issue geometry, cap circle radius perturbed by g, cap seam angle, reversed loops
function issueRegions(g, seamDeg, revCap, revDrive, capCcw) {
  const circle = (start, end, r = R) => Arc3d.createXY(Point3d.createZero(), r, AngleSweep.createStartEndDegrees(start, end));
  const lower = Arc3d.createXY(Point3d.create(-24.19274997, -3.048), 6.096, AngleSweep.createStartEndDegrees(90, 7.1807557815));
  const upper = Arc3d.createXY(Point3d.create(-14.21492567, 19.812), 6.096, AngleSweep.createStartEndDegrees(-54.340912307, -90));
  const bottom = Point3d.create(-70, 3.048);
  const top = Point3d.create(-70, 13.716);
  const cap = Loop.create(capCcw ? circle(seamDeg, seamDeg + 360, R + g) : circle(seamDeg + 360, seamDeg, R + g));
  const driveway = Loop.create(
    LineSegment3d.create(bottom, lower.startPoint()), lower,
    circle(-172.8192442185, 125.659087693 - 360), upper,
    LineSegment3d.create(upper.endPoint(), top), LineSegment3d.create(top, bottom));
  for (const region of [cap, driveway])
    if (RegionOps.computeXYArea(region) < 0) region.reverseInPlace();
  if (revCap) cap.reverseInPlace();
  if (revDrive) driveway.reverseInPlace();
  return [cap, driveway];
}

// family 2: line-arc tangency. Driveway with straight lines tangent to the circle at the ends of the shared arc.
function lineRegions(g, seamDeg, revCap, revDrive) {
  const a1 = 150, a2 = 210; // shared arc from a1 to a2 (ccw), driveway to the left
  const p1 = Point3d.create(R * Math.cos(a1 * Math.PI / 180), R * Math.sin(a1 * Math.PI / 180));
  const p2 = Point3d.create(R * Math.cos(a2 * Math.PI / 180), R * Math.sin(a2 * Math.PI / 180));
  // tangent lines at p1 and p2 meet at X on the negative x axis: a curved triangle tangent to the circle at both ends
  const X = Point3d.create(-R / Math.cos(30 * Math.PI / 180), 0);
  const shared = Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(a1, a2));
  const drive = Loop.create(shared, LineSegment3d.create(p2, X), LineSegment3d.create(X, p1));
  const cap = Loop.create(Arc3d.createXY(Point3d.createZero(), R + g, AngleSweep.createStartEndDegrees(seamDeg, seamDeg + 360)));
  for (const region of [cap, drive])
    if (RegionOps.computeXYArea(region) < 0) region.reverseInPlace();
  if (revCap) cap.reverseInPlace();
  if (revDrive) drive.reverseInPlace();
  return [cap, drive];
}


const deg = Math.PI / 180;
const dir = (a) => Vector3d.create(Math.cos(a * deg), Math.sin(a * deg));
// family 3: cusp fillets like in the issue. Fillet circles at distance R + r - g from the circle center
// (g > 0 overlap, g < 0 gap), fillet ends at its point nearest the circle, shared arc starts exactly on the circle.
function filletRegions(g, seamDeg, revCap, revDrive, capCcw, r = 6.096) {
  const D = R + r - g;
  const C1 = Point3d.createZero().plusScaled(dir(150), D), C2 = Point3d.createZero().plusScaled(dir(210), D);
  const f1 = Arc3d.createXY(C1, r, AngleSweep.createStartEndDegrees(240, 330));
  const shared = Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(150, 210));
  const f2 = Arc3d.createXY(C2, r, AngleSweep.createStartEndDegrees(30, 120));
  const e1 = f1.startPoint(), e2 = f2.endPoint();
  const l1 = Point3d.create(-60, e2.y), l2 = Point3d.create(-60, e1.y);
  const drive = Loop.create(f1, shared, f2, LineSegment3d.create(e2, l1), LineSegment3d.create(l1, l2), LineSegment3d.create(l2, e1));
  const cap = Loop.create(capCcw ? Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(seamDeg, seamDeg + 360))
    : Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(seamDeg + 360, seamDeg)));
  for (const region of [cap, drive])
    if (RegionOps.computeXYArea(region) < 0) region.reverseInPlace();
  if (revCap) cap.reverseInPlace();
  if (revDrive) drive.reverseInPlace();
  return [cap, drive];
}
// family 4: cusp with straight lines. Tangent lines at 150 and 210 degrees shifted toward the center by g.
function lineCuspRegions(g, seamDeg, revCap, revDrive) {
  const p1 = Point3d.createZero().plusScaled(dir(150), R - g), p2 = Point3d.createZero().plusScaled(dir(210), R - g);
  const X = Point3d.create(-(R - g) / Math.cos(30 * deg), 0);
  const shared = Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(150, 210));
  const drive = Loop.create(shared, LineSegment3d.create(p2, X), LineSegment3d.create(X, p1));
  const cap = Loop.create(Arc3d.createXY(Point3d.createZero(), R, AngleSweep.createStartEndDegrees(seamDeg, seamDeg + 360)));
  for (const region of [cap, drive])
    if (RegionOps.computeXYArea(region) < 0) region.reverseInPlace();
  if (revCap) cap.reverseInPlace();
  if (revDrive) drive.reverseInPlace();
  return [cap, drive];
}

function transformRegions(regions, rotDeg, mirror, shift) {
  let t = Transform.createOriginAndMatrix(Point3d.create(shift[0], shift[1]), Matrix3d.createRotationAroundAxisIndex(2, Angle.createDegrees(rotDeg)));
  if (mirror) t = t.multiplyTransformTransform(Transform.createOriginAndMatrix(undefined, Matrix3d.createScale(-1, 1, 1)));
  return regions.map((r) => { const c = r.cloneTransformed(t); if (mirror) c.reverseInPlace(); return c; });
}

function areaOf(x) { return x ? RegionOps.computeXYArea(x) : 0; }

function check(family, gaps) {
  const stats = {};
  const fails = [];
  for (const g of gaps) {
    let total = 0, bad = 0;
    for (const seam of [0, 37, 180, 270])
      for (const revCap of [false, true])
        for (const revDrive of [false, true])
          for (const capCcw of (family === "line" || family === "linecusp") ? [true] : [true, false])
            for (const rot of [0, 30, 113])
              for (const mirror of [false, true])
                for (const swap of [false, true]) {
                  const base = family === "arc" ? issueRegions(g, seam, revCap, revDrive, capCcw) : family === "fillet" ? filletRegions(g, seam, revCap, revDrive, capCcw)
                    : family === "linecusp" ? lineCuspRegions(g, seam, revCap, revDrive) : lineRegions(g, seam, revCap, revDrive);
                  const [cap, drive] = transformRegions(base, rot, mirror, rot === 113 ? [1000, -500] : [0, 0]);
                  const a = Math.abs(areaOf(cap)), b = Math.abs(areaOf(drive));
                  const [A, B, aa, bb] = swap ? [drive, cap, b, a] : [cap, drive, a, b];
                  for (const op of ops) {
                    const expected = op === Op.Union ? aa + bb : op === Op.Intersection ? 0 : op === Op.AMinusB ? aa : op === Op.BMinusA ? bb : aa + bb;
                    const variants = op === Op.Union ? [true, false] : [false];
                    for (const simplifyUnion of variants) {
                      total++;
                      let res, err;
                      try { res = RegionOps.regionBooleanXY(A, B, op, { simplifyUnion }); } catch (e) { err = e.message; }
                      const got = res ? Math.abs(areaOf(res)) : (op === Op.Intersection ? 0 : NaN);
                      const okv = !err && Number.isFinite(got) && Math.abs(got - expected) < 1e-3;
                      if (!okv) {
                        bad++;
                        fails.push({ g, seam, revCap, revDrive, capCcw, rot, mirror, swap, op: opName[op], simplifyUnion, expected: +expected.toFixed(4), got: res ? +got.toFixed(4) : (err ?? "undefined") });
                      }
                    }
                  }
                }
    stats[g] = `${bad}/${total}`;
  }
  return { stats, fails };
}

const gapsArc = [0, 1e-10, -1e-10, 1e-9, -1e-9, 1e-8, -1e-8, 1e-7, -1e-7, 1e-6, -1e-6];
const only = process.argv[3];
const fams = only ? only.split(",") : ["fillet", "linecusp", "arc", "line"];
for (const fam of fams) {
  const gl = process.env.GAPS ? process.env.GAPS.split(",").map(Number) : (fam === "arc" || fam === "line" ? [0, 1e-10, 1e-8, 1e-6, -1e-6] : gapsArc);
  const rr = check(fam, gl);
  console.log(`${fam} family, bad/total by g:`, JSON.stringify(rr.stats));
  for (const f of rr.fails) console.log("  fail", JSON.stringify(f));
}
if (process.argv[4] !== "raw") return;


// family 3: raw CurveCurve.intersectionXY sanity for near-tangent circle pairs: every reported pair must be within tol on both curves
const { CurveCurve } = G;
let pairs = 0, badPairs = 0, snappedCount = 0;
for (let k = 0; k < 2000; k++) {
  const rA = 3 + (k % 7), rB = 2 + ((k * 3) % 5);
  const g = [0, 1e-9, -1e-9, 5e-8, -5e-8, 5e-7, -5e-7, 2e-6, -2e-6][k % 9];
  const theta = (k * 0.73) % (2 * Math.PI);
  const d = rA + rB + g;
  const cA = Point3d.create(0, 0), cB = Point3d.create(d * Math.cos(theta), d * Math.sin(theta));
  const tDeg = theta * 180 / Math.PI;
  const offA = ((k * 13) % 40) - 20, offB = ((k * 17) % 40) - 20; // endpoint near the tangency (degrees)
  const lenA = 30 + (k % 50), lenB = 30 + ((k * 7) % 50);
  const dirA = k % 2 ? 1 : -1, dirB = k % 4 < 2 ? 1 : -1;
  const sA = tDeg + offA * 0.01;
  const sB = tDeg + 180 + offB * 0.01;
  const arcA = Arc3d.createXY(cA, rA, AngleSweep.createStartEndDegrees(sA, sA + dirA * lenA));
  const arcB = Arc3d.createXY(cB, rB, AngleSweep.createStartEndDegrees(sB, sB + dirB * lenB));
  const res = CurveCurve.intersectionXYPairs(arcA, false, arcB, false);
  for (const p of res) {
    pairs++;
    const pa = p.detailA.point, pb = p.detailB.point;
    const onA = arcA.closestPointXY(pb, false), onB = arcB.closestPointXY(pa, false);
    if (pa.distanceXY(pb) > 1e-6 || onA.a > 1e-6 || onB.a > 1e-6) badPairs++;
    if (p.detailA.fraction === 0 || p.detailA.fraction === 1 || p.detailB.fraction === 0 || p.detailB.fraction === 1) snappedCount++;
  }
}
console.log(`ARC-ARC raw: pairs ${pairs}, out-of-tolerance pairs ${badPairs}, pairs at an endpoint ${snappedCount}`);
