// Standalone repro of a case dumped by corner.js with DUMPX=<file> (exact geometry, two operands, no chain).
// Usage: node corner-repro.js <json> <core-geometry.js> [<core-geometry.js> ...]
// For every build: all 12 booleans (both operand orders, Union with simplifyUnion true/false) with the area of the result
// (sum of loop areas by the scanline oracle of corner.js) and the expected area, "ok" or "WRONG".
const fs = require("fs");
const path = require("path");
const [file, ...libs] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const src = fs.readFileSync(path.join(__dirname, "corner.js"), "utf8");
const oracleSrc = src.slice(src.indexOf("// ---------- oracle"), src.indexOf("// ---------- geometry helpers"));
const { fromExact } = require("./exactjson.js");
console.log(data.key);
for (const lib of libs) {
  const G = require(lib);
  const { Arc3d, LineSegment3d, LineString3d, Loop, UnionRegion, ParityRegion, RegionOps, RegionBinaryOpType: Op, Transform } = G;
  const O = new Function("Arc3d", "LineSegment3d", "LineString3d", "Loop", "UnionRegion", "ParityRegion",
    oracleSrc + "\nreturn { intervals, combine, measure, makeGrid, areaOn, U, I, AmB, BmA, X };")(Arc3d, LineSegment3d, LineString3d, Loop, UnionRegion, ParityRegion);
  let [A, B] = data.operands.map((j) => fromExact(G, j));
  if (data.ops) { // chain of 3 operands: A = op0(operand0, operand1) with simplifyUnion from env STEP0SU (default false), B = operand2
    const ops = data.operands.map((j) => fromExact(G, j));
    A = RegionOps.regionBooleanXY(ops[0], ops[1], Op[data.ops[0]], { simplifyUnion: process.env.STEP0SU === "true" });
    B = ops[2];
    console.log(`  step0 ${data.ops[0]} simplifyUnion=${process.env.STEP0SU === "true"} -> ${A ? A.constructor.name : "undefined"}`);
  }
  const ref = A.range().low;
  const toLocal = (r) => r.cloneTransformed(Transform.createTranslationXYZ(-ref.x, -ref.y, 0));
  const la = toLocal(A), lb = toLocal(B);
  const grid = O.makeGrid([la, lb]);
  const ia = grid.ys.map((y) => O.intervals(la, y)), ib = grid.ys.map((y) => O.intervals(lb, y));
  const F = { Union: O.U, Intersection: O.I, AMinusB: O.AmB, BMinusA: O.BmA, Parity: O.X };
  const exp = {}; for (const [n, f] of Object.entries(F)) exp[n] = grid.h * ia.reduce((s, a, i) => s + O.measure(O.combine(a, ib[i], f)), 0);
  const sumArea = O.areaOn(grid, la) + O.areaOn(grid, lb);
  const tolArea = 1e-5 * sumArea + 20 * (data.mergeTolerance ?? 1e-6) * Math.sqrt(sumArea) + 1e-12;
  const rows = []; let wrong = 0;
  for (const swap of [false, true]) for (const [opn, su] of [["Union", true], ["Union", false], ["Intersection", false], ["AMinusB", false], ["BMinusA", false], ["Parity", false]]) {
    const [X1, X2] = swap ? [B, A] : [A, B];
    const e = swap ? (opn === "AMinusB" ? exp.BMinusA : opn === "BMinusA" ? exp.AMinusB : exp[opn]) : exp[opn];
    const o = { simplifyUnion: su }; if (data.mergeTolerance !== undefined) o.mergeTolerance = data.mergeTolerance;
    let res, got;
    try { res = RegionOps.regionBooleanXY(X1, X2, Op[opn], o); got = res ? O.areaOn(grid, toLocal(res)) : 0; } catch (x) { got = NaN; }
    const ok = Number.isFinite(got) && Math.abs(got - e) <= tolArea;
    if (!ok) wrong++;
    rows.push(`  ${swap ? "B,A" : "A,B"} ${opn}${su ? " simplifyUnion" : ""}: ${res ? got.toPrecision(9) : "undefined"} expected ${e.toPrecision(9)} ${ok ? "ok" : "WRONG"}`);
  }
  console.log(`${lib}: ${wrong} of 12 wrong`); console.log(rows.join("\n"));
}
