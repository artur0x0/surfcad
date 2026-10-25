/**
 * Bike v2 playtest: insert_chamfer_edges { use_selection: true, chamfer: 1 }
 * on the named face of a rounded-box faceplate with four M5 holes shredded
 * the part into dozens of bodies. A face pick chamfers that face's boundary
 * only, and a chamfer that would split the solid fails instead of returning
 * the pieces. A box top stays one body.
 */
import { runScript } from '../../src/lib/surfcad/index.js';
import { describeHelperRefusal } from '../../src/agent/helperPaletteAgent.js';
import { classifySelectedFace } from '../../src/utils/faceFeaturePlacement.js';
import { composeHelperInsert } from '../../src/utils/helperPaletteSnippets.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function face(mode, name) {
  return classifySelectedFace({
    center: [2, 0, 0],
    normal: [1, 0, 0],
    area: 400,
    triangleCount: 8,
    selectionMode: mode,
    ...(name ? { name, feature: 'plate', role: 'right' } : {}),
  });
}

const PLATE = `// --- roundedBox begin id=plate ---
let part = roundedBox([4, 60, 40], 1.5, 6);
// --- roundedBox end id=plate ---
const bore = (y, z) => Manifold.cylinder(20, 2.5, 2.5, 24).rotate([0, 90, 0]).translate([0, y, z]);
part = part.subtract(bore(16, 10)).subtract(bore(16, -10)).subtract(bore(-16, 10)).subtract(bore(-16, -10));
`;

const CUBE = `// --- cube begin id=box ---
let part = Manifold.cube([20, 30, 40], true);
// --- cube end id=box ---
`;

const named = composeHelperInsert(PLATE, 'chamferEdges', null, { chamfer: 1 }, face('coplanar', 'plate.right'), null);
const irregular = composeHelperInsert(PLATE, 'chamferEdges', null, { chamfer: 1 }, face('all-connected', 'plate.right'), null);
const bare = composeHelperInsert(PLATE, 'chamferEdges', null, { chamfer: 1 }, face('all-connected'), null);
check('named face writes edgesOf', named && /edgesOf\(part, "plate\.right"\)/.test(named) && !/convexEdges\(part\)/.test(named));
check('irregular named face still writes edgesOf', irregular && /edgesOf\(part, "plate\.right"\)/.test(irregular));
check('irregular unnamed face is refused', bare == null);
const why = describeHelperRefusal(
  { id: 'chamferEdges', label: 'Chamfer' },
  { faceContext: face('all-connected'), edgeContext: null, buffer: PLATE },
);
check('refusal names the missing face', /no face name/.test(why), why);

const cubeFace = classifySelectedFace({
  center: [0, 0, 20], normal: [0, 0, 1], area: 600, triangleCount: 2,
  selectionMode: 'coplanar', name: 'box.top', feature: 'box', role: 'top',
});
const cubeScript = composeHelperInsert(CUBE, 'chamferEdges', null, { chamfer: 1 }, cubeFace, null);
check('cube top writes edgesOf', cubeScript && /edgesOf\(part, "box\.top"\)/.test(cubeScript));

const base = await runScript(`${PLATE}\nreturn part;\n`);
const chamfered = named ? await runScript(named) : null;
const cube = cubeScript ? await runScript(cubeScript) : null;

check('faceplate starts as one body', base.bodyCount === 1, String(base.bodyCount));
check(
  'faceplate chamfer stays one body',
  chamfered && chamfered.bodyCount === 1,
  chamfered ? String(chamfered.bodyCount) : 'no script',
);
const split = /split the solid/.test(chamfered?.featureSkip?.message || '');
const intact = chamfered && !chamfered.featureSkip && chamfered.bodyCount === 1
  && chamfered.volume < base.volume && chamfered.volume > base.volume * 0.85;
check(
  'faceplate chamfer fails cleanly or keeps the holes',
  split || intact,
  chamfered?.featureSkip?.message || `volume ${chamfered?.volume} vs ${base.volume}`,
);
check(
  'cube top chamfer stays one body',
  cube && cube.bodyCount === 1 && !cube.featureSkip && cube.volume < 20 * 30 * 40,
  cube ? `bodies ${cube.bodyCount} vol ${cube.volume} ${cube.featureSkip?.message || ''}` : 'no script',
);

base.manifold?.delete?.();
chamfered?.manifold?.delete?.();
cube?.manifold?.delete?.();

if (failed) {
  console.log(`agent chamfer face golden: ${failed} failed`);
  process.exit(1);
}
console.log('agent chamfer face golden: ok');
