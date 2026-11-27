// Standalone repro of a configuration saved by cusp/cusp.js or placement/placement.js (DUMP=<file>): A and B as IModelJson.
// Usage: node saved-repro.js <json> <core-geometry.js> [<second core-geometry.js>]
// Prints the result of every boolean (both operand orders, simplifyUnion false/true) as the list of loop areas, and the
// arc-arc intersections among all primitives (CurveCurve.allIntersectionsAmongPrimitivesXY) that differ between the builds.
const fs = require("fs");
const [file, ...libs] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(data.key);
const results = [];
for (const lib of libs) {
  const G = require(lib);
  const { RegionOps, RegionBinaryOpType: Op, IModelJson, CurveCurve, Loop } = G;
  const A = IModelJson.Reader.parse(data.A), B = IModelJson.Reader.parse(data.B);
  const describe = (r) => {
    if (!r) return "undefined";
    const loops = r instanceof Loop ? [r] : r.children;
    return `${r.constructor.name}[${loops.map((l) => RegionOps.computeXYArea(l).toFixed(6)).join(", ")}]`;
  };
  const lines = [];
  for (const [X, Y, order] of [[A, B, "A,B"], [B, A, "B,A"]])
    for (const [op, name] of [[Op.Union, "Union"], [Op.Intersection, "Intersection"], [Op.AMinusB, "AMinusB"], [Op.BMinusA, "BMinusA"], [Op.Parity, "Parity"]])
      for (const su of [false, true]) {
        if (su && op !== Op.Union) continue;
        const opts = { simplifyUnion: su };
        if (data.mergeTolerance !== undefined) opts.mergeTolerance = data.mergeTolerance;
        lines.push(`${order} ${name}${su ? " simplifyUnion" : ""}: ${describe(RegionOps.regionBooleanXY(X, Y, op, opts))}`);
      }
  const prims = [...RegionOps.collectCurvePrimitives(A), ...RegionOps.collectCurvePrimitives(B)];
  const ix = CurveCurve.allIntersectionsAmongPrimitivesXY(prims, data.mergeTolerance ?? 1e-6).map((p) => {
    const ia = prims.indexOf(p.detailA.curve), ib = prims.indexOf(p.detailB.curve);
    const pa = p.detailA.point;
    return `${ia}:${p.detailA.curve.constructor.name} x ${ib}:${p.detailB.curve.constructor.name} fA=${p.detailA.fraction.toFixed(9)} fB=${p.detailB.fraction.toFixed(9)} at (${pa.x.toFixed(7)}, ${pa.y.toFixed(7)})${p.detailA.isInterval() ? " interval" : ""}`;
  });
  results.push({ lib, lines, ix });
}
for (let i = 0; i < results[0].lines.length; i++)
  console.log(results.map((r) => r.lines[i]).join("   |   "));
if (results.length === 2) {
  const [a, b] = results.map((r) => new Set(r.ix));
  console.log("intersections only in build 1:"); for (const x of a) if (!b.has(x)) console.log("  " + x);
  console.log("intersections only in build 2:"); for (const x of b) if (!a.has(x)) console.log("  " + x);
}
