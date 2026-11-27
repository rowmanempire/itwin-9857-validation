// log near-tangent snap candidates and which intersections moved (build with the fix)
const fs = require("fs");
const [file, lib] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const G = require(lib);
const X = require(lib.replace(/core-geometry\.js$/, "curve/internalContexts/CurveCurveIntersectXY.js")).CurveCurveIntersectXY;
const { RegionOps, IModelJson, CurveCurve } = G;
const A = IModelJson.Reader.parse(data.A), B = IModelJson.Reader.parse(data.B);
const prims = [...RegionOps.collectCurvePrimitives(A), ...RegionOps.collectCurvePrimitives(B)];
const orig = X.prototype.snapNearTangentIntersectionsToEndpoints;
X.prototype.snapNearTangentIntersectionsToEndpoints = function () {
  const before = this._results.map((p) => [p.detailA.point.clone(), p.detailB.point.clone()]);
  for (const s of this._nearTangentSnaps) {
    const pa = s.pair.detailA;
    console.log(`candidate pair ${prims.indexOf(s.pair.detailA.curve)}x${prims.indexOf(s.pair.detailB.curve)} arc ${prims.indexOf(s.arc)} end ${s.fraction} other ${prims.indexOf(s.other)} at (${pa.point.x.toFixed(7)},${pa.point.y.toFixed(7)})`);
  }
  orig.call(this);
  this._results.forEach((p, i) => { if (before[i] && p.detailA.point.distanceXY(before[i][0]) > 0) console.log(`moved ${prims.indexOf(p.detailA.curve)}x${prims.indexOf(p.detailB.curve)} by ${p.detailA.point.distanceXY(before[i][0]).toExponential(3)}`); });
};
CurveCurve.allIntersectionsAmongPrimitivesXY(prims, data.mergeTolerance ?? 1e-6);
