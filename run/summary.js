"use strict";
// Summary table per comparison set from the cmp-<set>.txt files written by run/compare-all.sh.
// Usage: node run/summary.js <dir with cmp-<set>.txt>
// Counts are configurations ("cases"): failing on master, fully correct with the fix (repaired),
// fully correct on master and wrong with the fix (broken).
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const sets = ["issue", "cusp", "placement", "sweep", "tangent", "tangent-fixed", "corner", "corner-cusp", "nested", "ellipse-fillet", "ellipse-chord", "chain2", "vertex"];
const re = /^(\S+)\s+ops:.*cases: base\s+(\d+) fix\s+(\d+) fixed\s+(\d+) broken\s+(\d+)/;
const tot = [0, 0, 0];
const lines = ["| set | fail on master | repaired by the fix | broken by the fix |", "|---|---|---|---|"];
for (const s of sets) {
  const f = path.join(dir, `cmp-${s}.txt`);
  if (!fs.existsSync(f)) continue;
  const g = [0, 0, 0];
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(re);
    if (m) { g[0] += +m[2]; g[1] += +m[4]; g[2] += +m[5]; }
  }
  lines.push(`| ${s} | ${g.join(" | ")} |`);
  g.forEach((x, i) => { tot[i] += x; });
}
lines.push(`| total | ${tot.join(" | ")} |`);
console.log(lines.join("\n"));
