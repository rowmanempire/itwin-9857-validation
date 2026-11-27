// list primitives and intersections near a point, for each build
const fs = require("fs");
const [file, px, py, rad, ...libs] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
for (const lib of libs) {
  const G = require(lib);
  const { RegionOps, IModelJson, CurveCurve, Point3d } = G;
  const A = IModelJson.Reader.parse(data.A), B = IModelJson.Reader.parse(data.B);
  const pa = RegionOps.collectCurvePrimitives(A), pb = RegionOps.collectCurvePrimitives(B);
  const prims = [...pa, ...pb];
  const c = Point3d.create(+px, +py);
  console.log("== " + lib.split("/").slice(-5, -3).join("/"));
  prims.forEach((p, i) => { const s = p.startPoint(), e = p.endPoint(); if (s.distanceXY(c) < +rad || e.distanceXY(c) < +rad || p.closestPoint(c, false).a < +rad) console.log(`prim ${i} ${i < pa.length ? "A" : "B"} ${p.constructor.name} start(${s.x.toFixed(8)},${s.y.toFixed(8)}) end(${e.x.toFixed(8)},${e.y.toFixed(8)}) dist ${p.closestPoint(c,false).a.toExponential(2)}`); });
  for (const p of CurveCurve.allIntersectionsAmongPrimitivesXY(prims, data.mergeTolerance ?? 1e-6)) {
    const d = p.detailA.point.distanceXY(c);
    if (d > +rad) continue;
    const f = (x) => x.isInterval() ? `[${x.fraction.toFixed(9)},${x.fraction1.toFixed(9)}] (${x.point.x.toFixed(9)},${x.point.y.toFixed(9)})-(${x.point1.x.toFixed(9)},${x.point1.y.toFixed(9)})` : `${x.fraction.toFixed(9)} (${x.point.x.toFixed(9)},${x.point.y.toFixed(9)})`;
    console.log(`  ${prims.indexOf(p.detailA.curve)} x ${prims.indexOf(p.detailB.curve)}: ${f(p.detailA)} | ${f(p.detailB)}`);
  }
}
