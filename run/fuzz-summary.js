"use strict";
// Totals of the fuzz runs. Usage: node run/fuzz-summary.js <dir with run*.summary.json>
// fuzz.js counts one boolean operation as wrong when its relative area error exceeds a threshold, for three
// thresholds (1e-4, 1e-5, 1e-6). The article cites the middle one (1e-5).
// "ops" = boolean operations. "cases" = inputs with at least one repaired (broken) operation at 1e-5.
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const rows = ["| run | ops repaired (1e-4 / 1e-5 / 1e-6) | ops broken (1e-4 / 1e-5 / 1e-6) | cases with a repaired op (1e-5) | cases with a broken op (1e-5) |", "|---|---|---|---|---|"];
const T = { f: [0, 0, 0], b: [0, 0, 0], cf: 0, cb: 0 };
for (const r of ["run1", "run2", "run3", "run4"]) {
  const f = path.join(dir, `${r}.summary.json`);
  if (!fs.existsSync(f)) continue;
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  const g = { f: [0, 0, 0], b: [0, 0, 0], cf: 0, cb: 0 };
  for (const x of Object.values(s.stats)) {
    x.fixed.forEach((v, i) => { g.f[i] += v; });
    x.broken.forEach((v, i) => { g.b[i] += v; });
    g.cf += x.caseFixed; g.cb += x.caseBroken;
  }
  rows.push(`| ${r} | ${g.f.join(" / ")} | ${g.b.join(" / ")} | ${g.cf} | ${g.cb} |`);
  for (let i = 0; i < 3; i++) { T.f[i] += g.f[i]; T.b[i] += g.b[i]; }
  T.cf += g.cf; T.cb += g.cb;
}
rows.push(`| total | ${T.f.join(" / ")} | ${T.b.join(" / ")} | ${T.cf} | ${T.cb} |`);
console.log(rows.join("\n"));
