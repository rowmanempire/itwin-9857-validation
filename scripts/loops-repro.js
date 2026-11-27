// Saved input of RegionOps.constructAllXYRegionLoops (regressions/loops): sum of the areas of the positive area loops
// for both operand orders, on one or more builds. Expected: area(A) + area(B), since A and B only touch.
// Usage: node loops-repro.js <json> <core-geometry.js> [<core-geometry.js> ...]
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = [];
for (const lib of process.argv.slice(3)) {
  const { IModelJson, RegionOps } = require(lib);
  const A = IModelJson.Reader.parse(input.A), B = IModelJson.Reader.parse(input.B);
  const expected = RegionOps.computeXYArea(A) + RegionOps.computeXYArea(B);
  const parts = [];
  for (const operands of [[A, B], [B, A]]) {
    let area = 0;
    for (const set of RegionOps.constructAllXYRegionLoops(operands, 1e-6))
      for (const loop of set.positiveAreaLoops) area += RegionOps.computeXYArea(loop);
    parts.push(`${area.toFixed(3)} ${Math.abs(area - expected) <= 1e-5 * expected ? "ok" : "wrong"}`);
  }
  out.push(`expected ${expected.toFixed(3)}: ${parts.join(", ")}`);
}
console.log(out.join(" | "));
