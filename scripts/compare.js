// Compare failure lists of two builds, set by set.
// Usage: node compare.js <base out dir> <fix out dir> [set ...]
// A failure line describes one wrong boolean operation. The "case" of a line is the configuration without the operand
// order, the operation and the result (everything from "swap" on is removed), so a case is a whole configuration
// (all operations, both operand orders, simplifyUnion true and false).
// fixed  = wrong on base, correct on fix. broken = correct on base, wrong on fix.
// Case level: fixed = case wrong on base and fully correct on fix. broken = case fully correct on base and wrong on fix.
// Operation level "broken" also counts single operations that become wrong inside cases that were already wrong on base.
const fs = require("fs");
const path = require("path");
const [baseDir, fixDir, ...only] = process.argv.slice(2);
const read = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim() !== "") : undefined;
const opKey = (l) => l.replace(/ got=.*/, "").replace(/,"got":.*\}/, "").replace(/ got .*/, "").trim();
const caseKey = (l) => opKey(l).replace(/,"swap".*/, "").replace(/ swap=.*/, "").trim();
const sets = only.length ? only : fs.readdirSync(fixDir).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)).sort();
const minus = (a, b) => [...a].filter((x) => !b.has(x));
const rows = [];
let brokenTotal = 0;
for (const s of sets) {
  const b = read(path.join(baseDir, s + ".txt")), x = read(path.join(fixDir, s + ".txt"));
  if (!b || !x) { rows.push(`${s.padEnd(18)} missing`); continue; }
  const bo = new Set(b.map(opKey)), xo = new Set(x.map(opKey));
  const bc = new Set(b.map(caseKey)), xc = new Set(x.map(caseKey));
  const brokenCases = minus(xc, bc);
  brokenTotal += brokenCases.length;
  rows.push(`${s.padEnd(18)} ops: base ${String(bo.size).padStart(7)} fix ${String(xo.size).padStart(7)} fixed ${String(minus(bo, xo).length).padStart(7)} broken ${String(minus(xo, bo).length).padStart(6)}`
    + ` | cases: base ${String(bc.size).padStart(6)} fix ${String(xc.size).padStart(6)} fixed ${String(minus(bc, xc).length).padStart(6)} broken ${String(brokenCases.length).padStart(5)}`);
  if (brokenCases.length) fs.writeFileSync(path.join(fixDir, `broken-cases-${s}.list`), brokenCases.join("\n") + "\n");
}
console.log(rows.join("\n"));
console.log(`TOTAL broken cases: ${brokenTotal}`);
