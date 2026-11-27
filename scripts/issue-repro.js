// Standalone reproduction of iTwin/itwinjs-core #9857 (the script from the issue, with the library path as an argument).
// Usage: node issue-repro.js <path to core-geometry.js>
// Before the fix: simplifyUnion true -> undefined, simplifyUnion false -> Loop with area 585.229 (too small).
// After the fix: both results have area about 1635.938.
const lib = process.argv[2];
const { Arc3d, AngleSweep, Point3d, LineSegment3d, Loop, Transform, Matrix3d, RegionOps, RegionBinaryOpType } = require(lib);

const circle = (start, end) =>
  Arc3d.createXY(Point3d.createZero(), 18.288, AngleSweep.createStartEndDegrees(start, end));

const lower = Arc3d.createXY(Point3d.create(-24.19274997, -3.048), 6.096, AngleSweep.createStartEndDegrees(90, 7.1807557815));
const upper = Arc3d.createXY(Point3d.create(-14.21492567, 19.812), 6.096, AngleSweep.createStartEndDegrees(-54.340912307, -90));
const bottom = Point3d.create(-70, 3.048);
const top = Point3d.create(-70, 13.716);
const mirror = Transform.createOriginAndMatrix(Point3d.create(-140, 0), Matrix3d.createScale(-1, 1, 1));

const cap = Loop.create(circle(0, 360).cloneTransformed(mirror));
const driveway = Loop.create(
  ...[
    LineSegment3d.create(bottom, lower.startPoint()),
    lower,
    circle(-172.8192442185, 125.659087693 - 360),
    upper,
    LineSegment3d.create(upper.endPoint(), top),
    LineSegment3d.create(top, bottom),
  ].map((curve) => curve.cloneTransformed(mirror)),
);

for (const region of [cap, driveway]) {
  if (RegionOps.computeXYArea(region) < 0)
    region.reverseInPlace();
}
console.log("input areas", RegionOps.computeXYArea(cap), RegionOps.computeXYArea(driveway));
for (const simplifyUnion of [true, false]) {
  const result = RegionOps.regionBooleanXY(cap, driveway, RegionBinaryOpType.Union, { simplifyUnion });
  console.log(JSON.stringify({ simplifyUnion, type: result?.constructor.name ?? "undefined", area: result ? RegionOps.computeXYArea(result) : null }));
}
