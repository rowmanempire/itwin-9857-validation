// Side effects of the snap on CurveCurve.intersectionXYPairs for arc-arc: compare two builds.
const [libA, libB] = [require(process.argv[2]), require(process.argv[3])];
function run(G, makePairs) {
  const { Arc3d, AngleSweep, Point3d, CurveCurve } = G;
  return makePairs(G).map(([a, b, ea, eb]) => CurveCurve.intersectionXYPairs(a, ea, b, eb).map((p) => ({ fa: p.detailA.fraction, fb: p.detailB.fraction, x: p.detailA.point.x, y: p.detailA.point.y, iv: p.detailA.isInterval() })));
}
let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function randomPairs(G) {
  const { Arc3d, AngleSweep, Point3d } = G; seed = 12345; const out = [];
  for (let i = 0; i < 20000; i++) {
    const s = Math.pow(10, -3 + 9 * rnd());
    const c1 = Point3d.create(rnd() * s, rnd() * s), r1 = s * (0.2 + rnd());
    const a = Arc3d.createXY(c1, r1, AngleSweep.createStartSweepDegrees(rnd() * 360, (rnd() - 0.5) * 700));
    let b;
    if (rnd() < 0.5) { // near-tangent: second circle tangent internally or externally plus tiny perturbation
      const r2 = s * (0.1 + rnd()), ang = rnd() * 2 * Math.PI, ext = rnd() < 0.5;
      const d = (ext ? r1 + r2 : Math.abs(r1 - r2)) + (rnd() - 0.5) * 4e-6;
      b = Arc3d.createXY(Point3d.create(c1.x + d * Math.cos(ang), c1.y + d * Math.sin(ang)), r2, AngleSweep.createStartSweepDegrees(ang * 180 / Math.PI + 180 + (rnd() - 0.5) * 2, (rnd() - 0.5) * 200));
    } else {
      b = Arc3d.createXY(Point3d.create(rnd() * s, rnd() * s), s * (0.2 + rnd()), AngleSweep.createStartSweepDegrees(rnd() * 360, (rnd() - 0.5) * 700));
    }
    out.push([a, b, rnd() < 0.2, rnd() < 0.2]);
  }
  return out;
}
function offsetCircles(G) { // equal circles with centers offset slightly more than tolerance: transversal angle is tiny
  const { Arc3d, AngleSweep, Point3d } = G; const out = [];
  for (const d of [1.5e-6, 3e-6, 1e-5]) for (const start of [80, 60, 30, 0])
    out.push([Arc3d.createXY(Point3d.create(0, 0), 10, AngleSweep.createStartEndDegrees(0, 360)), Arc3d.createXY(Point3d.create(d, 0), 10, AngleSweep.createStartEndDegrees(start, 100)), false, false]);
  return out;
}
for (const [name, gen] of [["random", randomPairs], ["offsetCircles", offsetCircles]]) {
  const ra = run(libA, gen), rb = run(libB, gen);
  let diffCount = 0, maxMove = 0; const ex = [];
  for (let i = 0; i < ra.length; i++) {
    const A = ra[i], B = rb[i];
    let same = A.length === B.length;
    let move = 0;
    if (same) for (let k = 0; k < A.length; k++) { move = Math.max(move, Math.hypot(A[k].x - B[k].x, A[k].y - B[k].y)); if (move > 1e-12) same = false; }
    if (!same) { diffCount++; maxMove = Math.max(maxMove, move); if (ex.length < 6) ex.push({ i, master: A, fix: B }); }
  }
  console.log(`${name}: ${ra.length} pairs, differ in ${diffCount}, max point move ${maxMove}`);
  for (const e of ex) console.log("  " + JSON.stringify(e));
}
