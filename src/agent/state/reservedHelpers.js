/**
 * Names the script sandbox passes as `new Function` parameters
 * (`HELPER_FUNCTIONS` in src/lib/surfcad/runtime.js). A user `const` / `let`
 * of one of these is a SyntaxError. The sandbox itself is unchanged.
 *
 * Keep this list in sync with that object. formatErrors.test.js checks it.
 */
export const RESERVED_HELPER_NAMES = Object.freeze([
  'shell',
  'hollow',
  'getScaleRatio',
  'roundedBox',
  'tube',
  'rectTube',
  'hexPrism',
  'mirror',
  'array3D',
  'polarArray',
  'patternOnPoints',
  'center',
  'align',
  'getDimensions',
  'addDraft',
  'draftFaces',
  'cut',
  'booleanBodies',
  'externalBody',
  'move',
  'rotateAbout',
  'moveFace',
  'deleteFace',
  'loft',
  'sumSqDist',
  'rotateContour',
  'sweep',
  'sweepPoints',
  'vecAdd',
  'vecSub',
  'vecMul',
  'vecDot',
  'vecCross',
  'vecNorm',
  'vecNormalize',
  'facesByNormal',
  'planarFaceAt',
  'edgesByOrientation',
  'workplaneFromFace',
  'placeInFrame',
  'transformByFrame',
  'placeOnFace',
  'hole',
  'holeSpan',
  'cboreHole',
  'cskHole',
  'chamferEdges',
  'convexEdges',
  'concaveEdges',
  'signedFeatureEdges',
  'holePattern',
  'clearanceHole',
  'tapDrillHole',
  'holesOnContour',
  'fastenerClearanceDia',
  'fastenerTapDrillDia',
  'fastenerMajorDia',
  'listFastenerSizes',
  'resolveFastenerSize',
  'filletEdges',
  'makeRevolve',
  'makeExtrude',
  'makeLoft',
  'offsetPlaneFrame',
  'sheetMetalSolid',
  'profileCircle',
  'profileRectangle',
  'profilePolygon',
  'makeCrossSection',
  'solveContour',
  'makeSweepPath',
  'filletAlongPath',
  'edge',
  'edgesBetween',
  'boundaryEdges',
  'faceNames',
  'facesNamed',
  'edgesOf',
  'surfaceOf',
]);

const RESERVED_HELPER_NAME_SET = new Set(RESERVED_HELPER_NAMES);

const REDECLARED_NAME = [
  /Identifier ['"]([A-Za-z_$][\w$]*)['"] has already been declared/,
  /redeclaration of (?:const |let |var |function |class )?['"]?([A-Za-z_$][\w$]*)['"]?/i,
  /Cannot declare a (?:let|const|var|class) variable twice:? ['"]([A-Za-z_$][\w$]*)['"]/,
  /Can't create duplicate variable:? ['"]([A-Za-z_$][\w$]*)['"]/,
];

/** One sentence for set_script / run tool descriptions. */
export function reservedHelperClause() {
  const names = [...RESERVED_HELPER_NAMES].sort().join(', ');
  return `Do not declare a reserved SurfCAD helper name with const, let, class, or function — the runtime passes these as function parameters: ${names}. A redeclaration fails; rename your variable (for example \`const cut\`).`;
}

/**
 * When `message` is a redeclaration of a reserved helper, replace it with a
 * plain sentence. Other messages, including a redeclaration of a user name,
 * pass through.
 * @param {string} message
 * @returns {string}
 */
export function explainReservedHelperError(message) {
  if (typeof message !== 'string' || !message) return message;
  for (const pattern of REDECLARED_NAME) {
    const match = message.match(pattern);
    if (!match) continue;
    const name = match[1];
    if (!RESERVED_HELPER_NAME_SET.has(name)) return message;
    return `\`${name}\` is a reserved SurfCAD helper name; rename your variable`;
  }
  return message;
}
