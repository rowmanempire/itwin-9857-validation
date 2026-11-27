// Exact (bitwise) JSON for regions made of Arc3d, LineSegment3d, LineString3d: numbers are written as JS doubles (radians for
// sweeps), so a region read back is identical to the one written (IModelJson writes sweeps in degrees, which rounds).
function toExact(G, r) {
  if (!r) return null;
  if (r instanceof G.Loop) return { loop: r.children.map((c) => toExact(G, c)) };
  if (r instanceof G.ParityRegion) return { parity: r.children.map((c) => toExact(G, c)) };
  if (r instanceof G.UnionRegion) return { union: r.children.map((c) => toExact(G, c)) };
  if (r instanceof G.Arc3d) return { arc: [r.center.toJSON(), r.vector0.toJSON(), r.vector90.toJSON(), r.sweep.startRadians, r.sweep.endRadians] };
  if (r instanceof G.LineSegment3d) return { line: [r.point0Ref.toJSON(), r.point1Ref.toJSON()] };
  if (r instanceof G.LineString3d) return { lineString: r.points.map((p) => p.toJSON()) };
  if (r instanceof G.BSplineCurve3d) return { bsp: [r.copyPoints(), r.copyKnots(false), r.order] };
  throw new Error("toExact: unsupported " + r.constructor.name);
}
function fromExact(G, j) {
  if (j === null) return undefined;
  const P = (a) => G.Point3d.create(a[0], a[1], a[2] ?? 0), V = (a) => G.Vector3d.create(a[0], a[1], a[2] ?? 0);
  if (j.loop) return G.Loop.create(...j.loop.map((c) => fromExact(G, c)));
  if (j.parity) return G.ParityRegion.create(...j.parity.map((c) => fromExact(G, c)));
  if (j.union) return G.UnionRegion.create(...j.union.map((c) => fromExact(G, c)));
  if (j.arc) return G.Arc3d.create(P(j.arc[0]), V(j.arc[1]), V(j.arc[2]), G.AngleSweep.createStartEndRadians(j.arc[3], j.arc[4]));
  if (j.line) return G.LineSegment3d.create(P(j.line[0]), P(j.line[1]));
  if (j.lineString) return G.LineString3d.create(j.lineString.map(P));
  if (j.bsp) return G.BSplineCurve3d.create(j.bsp[0].map(P), j.bsp[1], j.bsp[2]);
  throw new Error("fromExact: unknown " + JSON.stringify(j).slice(0, 80));
}
module.exports = { toExact, fromExact };
