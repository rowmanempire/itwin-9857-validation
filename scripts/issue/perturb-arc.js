// Review r2: robustness of master and fix in family B "arc" (circle of radius R+g, shared arc of radius R).
// For the configurations broken by the fix (g=1e-8/1e-7, cap clockwise, rotation 0, no mirror), apply tiny
// perturbations (rotation, translation, radius) and count wrong operations out of 384 per variant.
// Usage: node perturb-arc.js <core-geometry.js>
const G = require(process.argv[2]);
const src = require("fs").readFileSync(require("path").join(__dirname, "sweep.js"), "utf8");
const m = {};
new Function("G", "exports", "process", src.split("function areaOf")[0].replace("const lib = process.argv[2];\nconst G = require(lib);", "") + ";exports.issueRegions=issueRegions;exports.transformRegions=transformRegions;")(G, m, { argv: [], env: {} });
const { RegionOps, RegionBinaryOpType: Op, Transform, Matrix3d, Angle, Point3d } = G;
const areaOf = (x) => x ? RegionOps.computeXYArea(x) : 0;
function count(g, capCcw, rotDeg, mirror, shift) {
  let bad = 0, total = 0;
  for (const seam of [0, 37, 180, 270]) for (const revCap of [false, true]) for (const revDrive of [false, true]) {
    const [cap, drive] = m.transformRegions(m.issueRegions(g, seam, revCap, revDrive, capCcw), rotDeg, mirror, shift);
    const a = Math.abs(areaOf(cap)), b = Math.abs(areaOf(drive));
    for (const swap of [false, true]) {
      const [A, B, aa, bb] = swap ? [drive, cap, b, a] : [cap, drive, a, b];
      for (const [op, su, exp] of [[Op.Union, true, aa + bb], [Op.Union, false, aa + bb], [Op.Intersection, false, 0], [Op.AMinusB, false, aa], [Op.BMinusA, false, bb], [Op.Parity, false, aa + bb]]) {
        total++;
        let got; try { const r = RegionOps.regionBooleanXY(A, B, op, { simplifyUnion: su }); got = r ? Math.abs(areaOf(r)) : (op === Op.Intersection ? 0 : NaN); } catch { got = NaN; }
        if (!(Math.abs(got - exp) < 1e-3)) bad++;
      }
    }
  }
  return `${bad}/${total}`;
}
const variants = [["base", 0, [0, 0], 0]];
for (const d of [1e-12, 1e-10, 1e-8, 1e-6, 1e-3, 0.5, 2]) variants.push([`rot+${d}deg`, d, [0, 0], 0]);
for (const s of [1e-12, 1e-10, 1e-8]) variants.push([`shiftx ${s}`, 0, [s, 0], 0], [`shifty ${s}`, 0, [0, s], 0]);
for (const s of [1, 1000]) variants.push([`shift (${s},${-s / 2})`, 0, [s, -s / 2], 0]);
for (const dg of [1e-12, 1e-11, 1e-10]) variants.push([`g+${dg}`, 0, [0, 0], dg]);
for (const g of [1e-8, 1e-7, 3e-8, 3e-7]) {
  const out = [];
  for (const [name, rot, shift, dg] of variants) out.push(`${name}:${count(g + dg, false, rot, false, shift)}`);
  console.log(`g=${g} capCw rot0 nomirror | ${out.join(" ")}`);
}
