// Artur's 9:13 bracket. fea-study and workplane blocks were not in the
// source that could be saved; the study is comments and does not change the
// solid. The return stays last.
// --- sheet-metal begin ---
const sheetSpec = {"v":1,"sku":"SST316-125","material":"Stainless Steel (316 Series)","t":3.175,"r":3.81,"k":0.38,"limits":{"bendable":true,"services":["bending","deburring","dimple_forming","hardware","powder","tapping","tumbling"],"minFlange":18.796,"minFlangeBefore":15.748,"maxAngle":120,"minAngle":null,"reliefDepth":7.493,"cornerRelief":0.508,"maxBendLength":457.2,"bendDeduction":6.096,"minFlat":[9.525,38.1],"maxFlat":[1117.6,762],"maxPart":[1117.6,762],"minPart":[9.525,6.35],"minHole":1.27,"minBridge":1.27,"minHoleToEdge":0.9652,"minHoleToBend":13.462},"plane":"XY","width":100,"height":60,"bends":[{"id":"b1","panel":"base","edge":"v+","angle":90,"length":28.2,"flip":false}],"tabs":[],"holes":[]};
let part = sheetMetalSolid(sheetSpec);
// --- sheet-metal end ---
const c1 = makeCrossSection({ center: [0, 0, 3.175], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, solveContour({ points: [{ id: 'p0', at: [19.803, -11.7361] }, { id: 'p1', at: [19.803, 20.9657] }, { id: 'p2', at: [-31.064, 20.9657] }, { id: 'p3', at: [-31.064, -11.7361] }], lines: [{ id: 'e0', a: 'p0', b: 'p1', seq: 1 }, { id: 'e2', a: 'p2', b: 'p3', seq: 3 }, { id: 'e3', a: 'p3', b: 'p0', seq: 4 }, { id: 'e1', a: 'p1', b: 'p2', seq: 2 }], arcs: [], dimensions: [], constraints: [{ id: 'k4', seq: 11, kind: 'perpendicular', items: ['e0', 'e3'] }, { id: 'k5', seq: 12, kind: 'perpendicular', items: ['e1', 'e0'] }, { id: 'k6', seq: 13, kind: 'perpendicular', items: ['e2', 'e3'] }, { id: 'k7', seq: 15, kind: 'parallel', items: ['e1', 'r0'] }], polyline: true, refs: [{ id: 'r0', seq: 14, kind: 'edge', refKey: 'bend:b1:base:w1', faceA: 1000000006, faceB: 1000000007, mid: [0, 30, 3.175], geom: { kind: 'line', a: [-50, 30], b: [50, 30] } }] })); // @contour id=c1
part = part.subtract(placeInFrame(c1.plane, makeExtrude(c1.contours, 10), [0, 0, -5]));
const c2 = makeCrossSection({ center: [0, 33.810001, 21.085001], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, solveContour({ points: [{ id: 'p0', at: [-11.0235, -8.125] }, { id: 'p1', at: [-11.0235, 1.4] }, { id: 'p2', at: [17.615, 14.1] }, { id: 'p4', at: [30.95, -8.125] }, { id: 'p5', at: [30.95, 14.1] }, { id: 'p6', at: [17.615, 1.4] }], lines: [{ id: 'e0', a: 'p0', b: 'p1' }, { id: 'e4', a: 'p4', b: 'p0' }, { id: 'e2', a: 'p2', b: 'p5' }, { id: 'e3', a: 'p4', b: 'p5' }, { id: 'e1', a: 'p1', b: 'p6' }, { id: 'e5', a: 'p6', b: 'p2' }], arcs: [], dimensions: [], constraints: [], polyline: true, refs: [] })); // @contour id=c2
part = part.subtract(placeInFrame(c2.plane, makeExtrude(c2.contours, 20), [0, 0, -10]));
const selEdges = [{ a: 2, b: 3, va: [-31.063999, -11.7361, 0], vb: [-31.063999, -11.7361, 3.175], length: 3.175, key: "coh-36-0", n0: [0, 1, 0], n1: [1, 0, 0], pts: [[-31.063999, -11.7361, 0], [-31.063999, -11.7361, 3.175]] }];
part = filletAlongPath(part, makeSweepPath(selEdges), 3.27);
const selEdges2 = [{ a: 4, b: 5, va: [-31.063999, 20.9657, 0], vb: [-31.063999, 20.9657, 3.175], length: 3.175, key: "e2", n0: [1, 0, 0], n1: [0, -1, 0], pts: [[-31.063999, 20.9657, 0], [-31.063999, 20.9657, 3.175]] }];
part = filletAlongPath(part, makeSweepPath([selEdges2[0]]), 2.54, { variableProfile: true });
const selEdges3 = [{ a: 6, b: 7, va: [19.802999, 20.9657, 0], vb: [19.802999, 20.9657, 3.175], length: 3.175, key: "e3", n0: [-1, 0, 0], n1: [0, -1, 0], pts: [[19.802999, 20.9657, 0], [19.802999, 20.9657, 3.175]] }];
part = filletAlongPath(part, makeSweepPath([selEdges3[0]]), 2.54, { variableProfile: true });
const selEdges4 = [{ a: 8, b: 9, va: [19.802999, -11.7361, 0], vb: [19.802999, -11.7361, 3.175], length: 3.175, key: "e4", n0: [0, 1, 0], n1: [-1, 0, 0], pts: [[19.802999, -11.7361, 0], [19.802999, -11.7361, 3.175]] }];
part = filletAlongPath(part, makeSweepPath([selEdges4[0]]), 2.54, { variableProfile: true });
const selEdges5 = [{ a: 10, b: 11, va: [-11.0235, 33.810001, 12.960001], vb: [-11.0235, 36.985001, 12.960001], length: 3.175, key: "e5", n0: [1, 0, 0], n1: [0, 0, 1], pts: [[-11.0235, 33.810001, 12.960001], [-11.0235, 36.985001, 12.960001]] }];
part = filletAlongPath(part, makeSweepPath([selEdges5[0]]), 2.54, { variableProfile: true });
const selEdges6 = [{ a: 12, b: 13, va: [-11.0235, 33.810001, 22.485001], vb: [-11.0235, 36.985001, 22.485001], length: 3.175, key: "e6", n0: [1, 0, 0], n1: [0, 0, -1], pts: [[-11.0235, 33.810001, 22.485001], [-11.0235, 36.985001, 22.485001]] }];
part = filletAlongPath(part, makeSweepPath([selEdges6[0]]), 2.54, { variableProfile: true });
const selEdges7 = [{ a: 14, b: 15, va: [30.950001, 33.810001, 12.960001], vb: [30.950001, 36.985001, 12.960001], length: 3.175, key: "e7", n0: [0, 0, 1], n1: [-1, 0, 0], pts: [[30.950001, 33.810001, 12.960001], [30.950001, 36.985001, 12.960001]] }];
part = filletAlongPath(part, makeSweepPath([selEdges7[0]]), 2.54, { variableProfile: true });
const selEdges8 = [{ a: 16, b: 17, va: [17.615, 33.810001, 22.485001], vb: [17.615, 36.985001, 22.485001], length: 3.175, key: "e8", n0: [0, 0, -1], n1: [1, 0, 0], pts: [[17.615, 33.810001, 22.485001], [17.615, 36.985001, 22.485001]] }];
part = filletAlongPath(part, makeSweepPath([selEdges8[0]]), 2.54, { variableProfile: true });
return part;
