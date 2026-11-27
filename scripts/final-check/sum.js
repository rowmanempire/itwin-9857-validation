"use strict";
// node sum.js files... ; prints per family/op counts of wrong (rel > TH) per lib and broken/fixed vs master
const fs = require("fs");
const TH = +(process.env.TH || 1e-4);
const stat = {}; const broken = []; const filterDiff = [];
let gen = 0;
for (const f of process.argv.slice(2)) for (const l of fs.readFileSync(f, "utf8").trim().split("\n")) {
  if (!l) continue; const r = JSON.parse(l); if (r.genErr) { gen++; continue; }
  const k = r.fam; const s = stat[k] || (stat[k] = { rows: 0, wrong: {}, fixed: 0, broken: 0, err: {} });
  s.rows++;
  const bad = {}; for (const [ln, v] of Object.entries(r.res)) { bad[ln] = !!(v.err || v.rel > TH); if (bad[ln]) s.wrong[ln] = (s.wrong[ln] || 0) + 1; if (v.err) s.err[ln] = (s.err[ln] || 0) + 1; }
  if (bad.master && !bad.head) s.fixed++;
  if (!bad.master && bad.head) { s.broken++; broken.push(r); }
  if (bad.head !== bad.headNoFilter || bad.master !== bad.masterFilter) filterDiff.push({ fam: r.fam, seed: r.seed, op: r.op, simp: r.simp, m: bad.master, mF: bad.masterFilter, h: bad.head, hNF: bad.headNoFilter });
}
console.log("genErr", gen, "TH", TH);
console.log("family rows | wrong master head headNoFilter masterFilter | fixed broken (head vs master) | exceptions");
const tot = { rows: 0, m: 0, h: 0, hn: 0, mf: 0, fx: 0, br: 0 };
for (const [k, s] of Object.entries(stat)) {
  const w = (n) => s.wrong[n] || 0;
  console.log(k.padEnd(14), s.rows, "|", w("master"), w("head"), w("headNoFilter"), w("masterFilter"), "|", s.fixed, s.broken, "|", JSON.stringify(s.err));
  tot.rows += s.rows; tot.m += w("master"); tot.h += w("head"); tot.hn += w("headNoFilter"); tot.mf += w("masterFilter"); tot.fx += s.fixed; tot.br += s.broken;
}
console.log("total", JSON.stringify(tot));
const fd = {}; for (const d of filterDiff) { const key = `${d.fam} head:${d.hNF ? "bad" : "ok"}->${d.h ? "bad" : "ok"} master:${d.m ? "bad" : "ok"}->${d.mF ? "bad" : "ok"}`; fd[key] = (fd[key] || 0) + 1; }
if (filterDiff.some((d) => d.hNF !== undefined || d.mF !== undefined)) { console.log("filter effect (noFilter->filter):"); for (const [k, v] of Object.entries(fd)) console.log("  ", k, v); }
console.log("broken vs master:"); for (const r of broken.slice(0, 40)) console.log("  ", r.fam, r.seed, r.op, r.simp ? "simp" : "", "exact", r.exact.toPrecision(8), "master", r.res.master.area?.toPrecision(8), "head", r.res.head.area?.toPrecision(8), r.res.head.err || "", "rel", r.res.head.rel.toExponential(2));
