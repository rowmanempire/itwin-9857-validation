// Review r2: family B "arc" at fixed g, rotation sweep. Wrong operations out of 192 per rotation (both cap directions summed = 384).
const G = require(process.argv[2]);
const src = require("fs").readFileSync(require("path").join(__dirname, "sweep.js"), "utf8");
const m = {};
new Function("G", "exports", "process", src.split("function areaOf")[0].replace("const lib = process.argv[2];\nconst G = require(lib);", "") + ";exports.issueRegions=issueRegions;exports.transformRegions=transformRegions;")(G, m, { argv: [], env: {} });
const { RegionOps, RegionBinaryOpType: Op } = G;
const areaOf = (x) => x ? RegionOps.computeXYArea(x) : 0;
const g = Number(process.argv[3]);
const row = [];
let sum = 0, clean = 0, n = 0;
for (let rot = 0; rot < 360; rot += 10) for (const mirror of [false, true]) {
  let bad = 0;
  for (const capCcw of [true, false]) for (const seam of [0, 37, 180, 270]) for (const revCap of [false, true]) for (const revDrive of [false, true]) {
    const [cap, drive] = m.transformRegions(m.issueRegions(g, seam, revCap, revDrive, capCcw), rot, mirror, [0, 0]);
    const a = Math.abs(areaOf(cap)), b = Math.abs(areaOf(drive));
    for (const swap of [false, true]) {
      const [A, B, aa, bb] = swap ? [drive, cap, b, a] : [cap, drive, a, b];
      for (const [op, su, exp] of [[Op.Union, true, aa + bb], [Op.Union, false, aa + bb], [Op.Intersection, false, 0], [Op.AMinusB, false, aa], [Op.BMinusA, false, bb], [Op.Parity, false, aa + bb]]) {
        let got; try { const r = RegionOps.regionBooleanXY(A, B, op, { simplifyUnion: su }); got = r ? Math.abs(areaOf(r)) : (op === Op.Intersection ? 0 : NaN); } catch { got = NaN; }
        if (!(Math.abs(got - exp) < 1e-3)) bad++;
      }
    }
  }
  row.push(`${rot}${mirror ? "M" : ""}:${bad}`); sum += bad; n++; if (bad === 0) clean++;
}
console.log(`g=${g} total wrong ${sum}/${n * 384}, fully correct placements ${clean}/${n}`);
console.log(row.join(" "));
