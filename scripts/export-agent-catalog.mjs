/**
 * Emit the machine-readable agent catalog from the live helper source,
 * helper-functions.md, the shipped Manifold .d.ts, the .surf.json rules,
 * and the sheet-metal modules.
 *
 *   npm run export:agent
 *
 * Writes src/lib/surfcad/catalog/*.json. Exits non-zero when an exposed
 * helper has no signature or one-line description, so a new helper cannot
 * be catalogued by accident.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURF_JSON_FORMAT, SURF_JSON_VERSION } from '../src/utils/git/surfJson.js';
import { SURF_ID_RE } from '../src/utils/git/surfId.js';
import { SHEET_METAL_BEGIN, SHEET_METAL_END } from '../src/utils/sheetMetal/sheetMetalScript.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const runtimeSrc = read('src/lib/surfcad/runtime.js');
const mdSrc = read('docs/helper-functions.md');
const dtsSrc = read('built/manifold-encapsulated-types.d.ts');
const sheetDfmSrc = read('src/utils/sheetMetal/sheetDfm.js');
const sheetModelSrc = read('src/utils/sheetMetal/sheetModel.js');

const extraSrc = [
  runtimeSrc,
  read('src/workers/fastenerSizes.js'),
  read('src/utils/makeLoft.js'),
];

/** One-liners for helpers the markdown / JSDoc pass does not name on their own. */
const GAP_DOCS = {
  booleanBodies: {
    description: 'Boolean union, difference, or intersect of bodies picked by centroid, composing the rest back.',
    example: "part = booleanBodies(part, { op: 'difference', bodies: [{ at: [0, 0, 5] }, { at: [0, 0, -5] }] });",
  },
  externalBody: {
    description: 'Frozen copy of another part: run a script function (or take a solid), keep bodies by centroid, then translate.',
    example: 'const copy = externalBody(() => otherScript(), { offset: [40, 0, 0] });',
  },
  move: {
    description: 'Translate exactly one body, chosen by vertex centroid; the other bodies stay.',
    example: 'part = move(part, [10, 0, 0], { bodies: [{ at: [0, 0, 0] }] });',
  },
  signedFeatureEdges: {
    description: 'Feature edges tagged convex or concave from the face dihedral, for fillet and chamfer selection.',
    example: 'const edges = signedFeatureEdges(part);',
  },
  concaveEdges: {
    description: 'Feature edges whose dihedral is concave (the solid side is the reflex angle).',
    example: 'const inner = concaveEdges(part);',
  },
  sheetMetalSolid: {
    description: 'Build one sheet-metal solid from a sheet spec (base flange, bends, tabs, holes).',
    example: 'let part = sheetMetalSolid(sheetSpec);',
  },
  sumSqDist: {
    description: 'Sum of squared distances between matched points of two loft contours.',
    example: 'const err = sumSqDist(a, b);',
  },
  rotateContour: {
    description: 'Rotate a loft contour so its start point best matches the previous section.',
    example: 'const turned = rotateContour(contour, pivot);',
  },
  vecAdd: {
    description: 'Add two 3-vectors.',
    example: 'const p = vecAdd(a, b);',
  },
  vecSub: {
    description: 'Subtract two 3-vectors.',
    example: 'const d = vecSub(a, b);',
  },
  vecMul: {
    description: 'Scale a 3-vector by a number.',
    example: 'const p = vecMul(v, 2);',
  },
  vecDot: {
    description: 'Dot product of two 3-vectors.',
    example: 'const s = vecDot(a, b);',
  },
  vecCross: {
    description: 'Cross product of two 3-vectors.',
    example: 'const n = vecCross(a, b);',
  },
  vecNorm: {
    description: 'Euclidean length of a 3-vector.',
    example: 'const len = vecNorm(v);',
  },
  vecNormalize: {
    description: 'Return the unit-length copy of a 3-vector.',
    example: 'const u = vecNormalize(v);',
  },
  fastenerMajorDia: {
    description: 'Major (nominal) diameter in mm for a metric or UNC fastener size.',
    example: "const d = fastenerMajorDia('M4');",
  },
  listFastenerSizes: {
    description: 'List the fastener size keys the clearance and tap-drill tables accept.',
    example: 'const sizes = listFastenerSizes();',
  },
  resolveFastenerSize: {
    description: 'Resolve a size token (\'M3\', 3, \'#8-32\') to the table entry, or throw.',
    example: "const size = resolveFastenerSize('M3');",
  },
  rectTube: {
    description: 'Rectangular tube: outer box minus an inner box, open through Z.',
    example: 'const t = rectTube([20, 10], [16, 6], 30);',
  },
  loft: {
    description: 'Legacy two-section loft from a bottom and a top cross section, with height, twist, and top scale. Prefer makeLoft for contour-mode lofts.',
    example: 'const cup = loft({ bottomCS, topCS, height: 30 });',
  },
};

function helperNames(src) {
  const start = src.indexOf('const HELPER_FUNCTIONS = {');
  if (start < 0) throw new Error('HELPER_FUNCTIONS block not found');
  const end = src.indexOf('\n};', start);
  const block = src.slice(start, end);
  const names = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|:)/);
    if (!m) continue;
    if (m[1] === 'const') continue;
    names.push(m[1]);
  }
  return names;
}

function findFunction(sources, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  for (const src of sources) {
    const i = src.search(re);
    if (i < 0) continue;
    const open = src.indexOf('(', i);
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    const params = src.slice(open + 1, j - 1)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { signature: `${name}(${params})`, params, jsdoc: jsDocBefore(src, i) };
  }
  return null;
}

function jsDocBefore(src, index) {
  let end = index;
  const exp = src.slice(Math.max(0, index - 16), index).match(/export\s+$/);
  if (exp) end = index - exp[0].length;
  const before = src.slice(0, end).replace(/\s*$/, '');
  if (!before.endsWith('*/')) return null;
  const start = before.lastIndexOf('/**');
  if (start < 0) return null;
  const block = before.slice(start);
  const inner = block.slice(3, -2);
  if (inner.includes('*/')) return null;
  return block
    .replace(/^\/\*\*\s*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function proseBeforeTags(jsdoc) {
  if (!jsdoc) return '';
  const lines = [];
  for (const line of jsdoc.split('\n')) {
    if (line.trim().startsWith('@')) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

function firstSentence(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim().split(/\s@/)[0].trim();
  if (!flat) return '';
  const cut = flat.search(/(?<=\.)\s+[A-Z(]/);
  const sentence = cut > 20 ? flat.slice(0, cut + 1) : flat;
  return sentence.length > 280 ? `${sentence.slice(0, 277)}...` : sentence;
}

function parseMarkdown(md) {
  const sections = [];
  const parts = md.split(/\n(?=### )/);
  for (const part of parts) {
    if (!part.startsWith('### ')) continue;
    const nl = part.indexOf('\n');
    const heading = part.slice(4, nl < 0 ? part.length : nl).trim();
    const body = nl < 0 ? '' : part.slice(nl + 1).trim();
    const names = [...heading.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    const fences = [...body.matchAll(/```(?:javascript|js)?\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    const prose = body.replace(/```[\s\S]*?```/g, '').trim();
    sections.push({ heading, names, body, prose, fences });
  }
  return sections;
}

function paramsFromSignature(signature) {
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open < 0 || close < open) return [];
  const raw = signature.slice(open + 1, close).trim();
  if (!raw) return [];
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of raw) {
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((part) => {
    let depth = 0;
    let eq = -1;
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      if (c === '{' || c === '[' || c === '(') depth += 1;
      else if (c === '}' || c === ']' || c === ')') depth -= 1;
      else if (c === '=' && depth === 0) { eq = i; break; }
    }
    let name = (eq >= 0 ? part.slice(0, eq) : part).trim();
    const def = eq >= 0 ? part.slice(eq + 1).trim() : undefined;
    name = name.replace(/^\.\.\./, '');
    const destructured = name.startsWith('{') || name.startsWith('[');
    return {
      name: destructured ? name : name.replace(/[^A-Za-z0-9_$].*$/, ''),
      text: part,
      ...(def !== undefined ? { default: def } : {}),
      ...(destructured ? { destructured: true } : {}),
    };
  }).filter((p) => p.name || p.destructured);
}

function catalogHelpers() {
  const names = helperNames(runtimeSrc);
  const sections = parseMarkdown(mdSrc);
  const byName = new Map();
  for (const section of sections) {
    for (const name of section.names) {
      if (!byName.has(name)) byName.set(name, section);
    }
  }
  const missing = [];
  const helpers = names.map((name) => {
    const fn = findFunction(extraSrc, name);
    const section = byName.get(name);
    const gap = GAP_DOCS[name];
    const jsdoc = proseBeforeTags(fn?.jsdoc || '');
    const mdProse = section?.prose || '';
    const description = firstSentence(jsdoc) || firstSentence(mdProse) || gap?.description || '';
    const doc = (jsdoc.length >= mdProse.length ? jsdoc : mdProse) || jsdoc || mdProse || gap?.description || '';
    const examples = [...(section?.fences || [])];
    if (!examples.length && gap?.example) examples.push(gap.example);
    const cleanSig = fn?.signature || '';
    if (!cleanSig || !description) missing.push(name);
    return {
      name,
      signature: cleanSig,
      params: paramsFromSignature(cleanSig),
      description,
      doc,
      examples,
    };
  });
  if (missing.length) {
    console.error(`catalog: helpers missing signature or description: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) {
    console.error(`catalog: duplicate helper names: ${dup.join(', ')}`);
    process.exitCode = 1;
  }
  return {
    generatedFrom: 'src/lib/surfcad/runtime.js HELPER_FUNCTIONS',
    count: helpers.length,
    helpers,
  };
}

function cleanJsDoc(raw) {
  if (!raw) return '';
  return raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function parseDts(src) {
  const classes = {};
  const classRe = /export class (\w+) \{/g;
  const starts = [];
  let m;
  while ((m = classRe.exec(src))) starts.push({ name: m[1], index: m.index });
  for (let i = 0; i < starts.length; i++) {
    const { name, index } = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const body = src.slice(index, end);
    const methods = [];
    const methodRe = /(?:\/\*\*[\s\S]*?\*\/\s*)?(static\s+)?([A-Za-z_][\w]*)\s*\(([\s\S]*?)\)\s*(?::\s*([^;{]+))?;/g;
    let mm;
    while ((mm = methodRe.exec(body))) {
      const kind = mm[2] === 'constructor' ? 'constructor' : (mm[1] ? 'static' : 'instance');
      const docRaw = mm[0].match(/^\/\*\*[\s\S]*?\*\//);
      const doc = cleanJsDoc(docRaw ? docRaw[0] : '');
      const params = mm[3].replace(/\s+/g, ' ').trim();
      const ret = (mm[4] || '').trim();
      methods.push({
        name: mm[2],
        kind,
        signature: `${mm[1] ? 'static ' : ''}${mm[2]}(${params})${ret ? `: ${ret}` : ''}`,
        description: firstSentence(doc),
        doc,
      });
    }
    for (const method of methods) {
      if (method.description) continue;
      const prior = methods.find((other) => other.name === method.name && other.description);
      if (prior) method.description = prior.description;
    }
    classes[name] = methods;
  }
  const functions = [];
  const fnRe = /\/\*\*[\s\S]*?\*\/\s*export function ([A-Za-z_][\w]*)\s*\(([\s\S]*?)\)\s*:\s*([^;]+);/g;
  let fm;
  while ((fm = fnRe.exec(src))) {
    const doc = cleanJsDoc(src.slice(fm.index, fm.index + 800).match(/\/\*\*[\s\S]*?\*\//)[0]);
    const params = fm[2].replace(/\s+/g, ' ').trim();
    functions.push({
      name: fm[1],
      kind: 'function',
      signature: `${fm[1]}(${params}): ${fm[3].trim()}`,
      description: firstSentence(doc),
      doc,
    });
  }
  return { classes, functions };
}

function assemblySchema() {
  const id = SURF_ID_RE.source;
  const vec3 = {
    type: 'array',
    items: { type: 'number' },
    minItems: 3,
    maxItems: 3,
  };
  const faceKey = {
    type: 'object',
    additionalProperties: false,
    required: ['at', 'n', 'area'],
    dependentRequired: { src: ['ord'], ord: ['src'] },
    properties: {
      at: { ...vec3, description: 'Area-weighted face centroid, mm, in the part frame.' },
      n: { ...vec3, description: 'Area-weighted face normal, in the part frame.' },
      area: { type: 'number', exclusiveMinimum: 0 },
      src: {
        type: 'integer',
        exclusiveMaximum: 0,
        description: 'Fillet or chamfer call index, stored as -(index+1). Omitted on a primitive face.',
      },
      ord: {
        type: 'integer',
        minimum: 0,
        description: 'Patch index inside that fillet, sorted by center. Set only with src.',
      },
    },
  };
  const jointRef = {
    type: 'object',
    additionalProperties: false,
    required: ['part'],
    properties: {
      part: {
        type: 'string',
        pattern: id,
        description: 'Surf id of the part. A path is not stored.',
      },
      kind: {
        enum: ['face', 'edge', 'axis'],
        description: 'Omitted on fixed, which stores the part only. Coincident and distance are both faces. Concentric is an axis or an edge on each side. Angle is any of the three.',
      },
      key: {
        description: 'Fingerprint in the part frame. Face: { at, n, area, src?, ord? }, the same key paint stores. Axis: { at, dir, radius }. Edge: { at, dir, length, faces }.',
        oneOf: [
          faceKey,
          {
            type: 'object',
            additionalProperties: false,
            required: ['at', 'dir', 'radius'],
            properties: {
              at: vec3,
              dir: { ...vec3, description: 'Unit direction.' },
              radius: { type: 'number', exclusiveMinimum: 0 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['at', 'dir', 'length', 'faces'],
            properties: {
              at: vec3,
              dir: { ...vec3, description: 'Unit direction.' },
              length: { type: 'number', exclusiveMinimum: 0 },
              faces: { type: 'array', minItems: 2, maxItems: 2, items: faceKey },
            },
          },
        ],
      },
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/artur0x0/3dculos/schema/surf-assembly.json',
    title: 'SurfCAD assembly (.surf.json)',
    description: 'Assembly document stored at assemblies/<Name>/.surf.json. Part rows reference scripts by repo path. The stable id is // @surf-id in the script and { id, path } here. The id is permanent. Optional groups list inserted parts by those ids. validateSurfJson also requires each part visible boolean and order integer.',
    type: 'object',
    additionalProperties: false,
    required: ['format', 'version', 'name', 'parts'],
    properties: {
      format: { const: SURF_JSON_FORMAT },
      version: { const: SURF_JSON_VERSION },
      name: { type: 'string', minLength: 1, description: 'Path-safe assembly folder name.' },
      activeId: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Repo path of the active part, or null.',
      },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'name', 'visible', 'order'],
          properties: {
            id: {
              type: 'string',
              pattern: id,
              description: 'Stable surf id. Optional on read so older repos still load. Permanent once minted. A legacy local- prefix is accepted on read.',
            },
            path: {
              type: 'string',
              description: 'Repo-relative part script path. New parts are parts/<Part>.js. An assembly folder holds a Copy to this assembly. Another assembly folder is a link. Legacy assemblies/<Name>/parts/<Part>.js is accepted on read.',
            },
            name: { type: 'string' },
            visible: { type: 'boolean' },
            order: {
              type: 'integer',
              minimum: 0,
              description: 'Non-negative integer. validateSurfJson rejects a non-integer.',
            },
            position: {
              type: 'array',
              items: { type: 'number' },
              minItems: 3,
              maxItems: 3,
              description: 'Translation [x, y, z] in mm. Equals placement.t when both are present. Omitted when the translation is the origin, except a legacy row that already stored [0, 0, 0].',
            },
            placement: {
              type: 'object',
              additionalProperties: false,
              required: ['t', 'q'],
              description: 'Rigid pose. Written when the quaternion is not identity, or when a joint names this part. Omitted on a pre-joints row. t equals position when both are present.',
              properties: {
                t: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 3,
                  maxItems: 3,
                  description: 'Translation in mm.',
                },
                q: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 4,
                  maxItems: 4,
                  description: 'Unit quaternion [x, y, z, w].',
                },
              },
            },
            sheetMetal: {
              type: 'object',
              additionalProperties: false,
              required: ['sku'],
              properties: {
                sku: { type: 'string' },
                name: { type: 'string' },
                thicknessIn: { type: 'number' },
                gauge: { type: 'number' },
              },
              description: 'SendCutSend binding snapshot. sku is the key.',
            },
            copiedFrom: {
              type: 'string',
              pattern: id,
              description: 'Surf id this row was copied from, when set.',
            },
          },
        },
      },
      groups: {
        type: 'array',
        description: 'Optional. Parts inserted from another assembly, shown together in the Parts list. Older files omit this. A part id is in at most one group.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'source', 'partIds'],
          properties: {
            id: {
              type: 'string',
              pattern: id,
              description: 'Stable group id. Not a part id.',
            },
            name: {
              type: 'string',
              minLength: 1,
              description: 'Label in the Parts list. Starts as the source assembly name.',
            },
            source: {
              anyOf: [
                { type: 'string', minLength: 1 },
                { type: 'null' },
              ],
              description: 'Source assembly path, assemblies/<Name>/.surf.json. Null after that assembly is deleted; the group name stays.',
            },
            partIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', pattern: id },
              description: 'Surf ids of the member parts. Dangling ids are dropped on load and save.',
            },
          },
        },
      },
      colors: {
        type: 'object',
        minProperties: 1,
        propertyNames: { pattern: id },
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            part: {
              type: 'string',
              pattern: '^#[0-9a-f]{6}$',
              description: 'Whole-part color. A face color wins on that face.',
            },
            faces: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['color', 'key'],
                properties: {
                  color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
                  key: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['at', 'n', 'area'],
                    dependentRequired: { src: ['ord'], ord: ['src'] },
                    properties: {
                      at: {
                        type: 'array',
                        items: { type: 'number' },
                        minItems: 3,
                        maxItems: 3,
                        description: 'Area-weighted face centroid, mm.',
                      },
                      n: {
                        type: 'array',
                        items: { type: 'number' },
                        minItems: 3,
                        maxItems: 3,
                        description: 'Area-weighted face normal.',
                      },
                      area: { type: 'number', exclusiveMinimum: 0 },
                      src: {
                        type: 'integer',
                        exclusiveMaximum: 0,
                        description: 'Fillet or chamfer call index, stored as -(index+1). Omitted on a primitive face.',
                      },
                      ord: {
                        type: 'integer',
                        minimum: 0,
                        description: 'Patch index inside that fillet, sorted by center. Set only with src.',
                      },
                    },
                  },
                },
              },
            },
          },
          description: 'part, faces, or both. Unknown keys are rejected.',
        },
        description: 'Optional face colors for this assembly, keyed by surf id. Omitted when empty. A key whose surf id is not in parts is dropped on load and save. The same part in another assembly has its own map. Copy to this assembly mints a new id and does not copy these entries. Version stays 1.',
      },
      joints: {
        type: 'array',
        minItems: 1,
        description: 'Optional assembly joints. Omitted when empty. A joint names parts by surf id and stores a face, edge, or axis fingerprint in the part frame. It does not store script text. Status is computed, not stored. A joint whose part surf id is not in parts is dropped on load and save. Copy to this assembly does not retarget a joint onto the new surf id. Version stays 1.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'type', 'a'],
          properties: {
            id: {
              type: 'string',
              pattern: id,
              description: 'Surf id of this joint. Unique in the file. Not a part id and not a group id.',
            },
            name: { type: 'string', minLength: 1 },
            type: {
              enum: ['coincident', 'concentric', 'distance', 'angle', 'fixed'],
            },
            value: {
              type: 'number',
              description: 'Distance in millimetres, or angle in degrees. Required on distance and angle. Omitted on the other types.',
            },
            sense: {
              enum: [1, -1],
              description: 'Which side of the reference the value sits on. Required on distance and angle. Omitted on the other types.',
            },
            opposed: {
              type: 'boolean',
              description: 'Coincident only. True means the face normals are opposed. Omitted means true. Always written for coincident. Rejected on other types.',
            },
            a: jointRef,
            b: {
              ...jointRef,
              description: 'Second reference. Omitted on fixed. a.part and b.part are different surf ids.',
            },
          },
        },
      },
    },
    defs: {
      surfId: {
        pattern: id,
        examples: ['2026-10-07-20-56-31-0423-a3f9'],
      },
      surfIdHeader: {
        description: 'First line of a part script.',
        pattern: '^// @surf-id (?:local-)?\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{4}-[0-9a-f]{4}\\s*$',
      },
    },
  };
}

const DFM_DOCS = {
  spec: 'The sheet spec did not parse.',
  model: 'The spec did not solve to a foldable sheet (solver error).',
  'no-bending': 'Bends on a SKU whose catalog record has no bending service.',
  flange: 'Flange length is below the SKU min flange length after the bend.',
  angle: 'Bend angle is outside the SKU min … max bend angle.',
  'bend-length': 'Bend line is longer than the SKU max bend length.',
  'min-hole': 'Hole diameter is below the SKU min hole size.',
  'hole-edge': 'Hole edge is closer to a free panel edge than the SKU minimum, or the hole leaves its face.',
  'hole-bend': 'Tapped hole centre is closer to a bend line than the SKU minimum (fail), or any hole edge is within 2.5·t + r of a bend (warn).',
  bridge: 'Web between two holes on one panel is below the SKU min bridge, or the holes overlap.',
  'tab-small': 'Tab width or depth is below max(thickness, min bridge). Warning only.',
  'flat-size': 'Flat pattern is outside the SKU min / max flat size (bent) or part size (flat).',
  'step-faceted': 'Exact bends could not be built; STEP fell back to the faceted mesh. Warning, from the exporter.',
  'mesh-stale': 'With the mesh fallback, built volume differs from the spec volume by more than 5%. Warning.',
  'script-extras': 'The part script has code outside the sheet-metal block. DXF and STEP come from the spec. Warning.',
};

function sheetMetalCatalog() {
  const found = [];
  const re = /push\('(fail|warn)', '([^']+)'/g;
  let m;
  while ((m = re.exec(sheetDfmSrc))) {
    found.push({ level: m[1], rule: m[2] });
  }
  const seen = new Set();
  const rules = [];
  for (const row of found) {
    const key = `${row.level}:${row.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({
      rule: row.rule,
      level: row.level,
      check: DFM_DOCS[row.rule] || '',
      source: 'src/utils/sheetMetal/sheetDfm.js',
    });
  }
  for (const rule of ['step-faceted', 'mesh-stale', 'script-extras']) {
    rules.push({
      rule,
      level: 'warn',
      check: DFM_DOCS[rule],
      source: 'src/utils/sheetMetal/sheetExport.js',
    });
  }
  const header = sheetModelSrc.match(/spec = \{[\s\S]*?\n \* \}/);
  return {
    partSheetMetal: {
      description: 'What persists on the assembly part row. sku is the key; the rest is a display snapshot so a reload without the network still shows material and thickness.',
      source: 'src/utils/scs/scsCatalog.js sheetMetalBinding / normalizeSheetMetalBinding',
      fields: {
        sku: { type: 'string', required: true },
        name: { type: 'string', description: 'Material name snapshot.' },
        thicknessIn: { type: 'number', description: 'Stock thickness in inches.' },
        gauge: { type: 'number', description: 'Sheet gauge, when the SKU has one.' },
      },
    },
    script: {
      begin: SHEET_METAL_BEGIN,
      end: SHEET_METAL_END,
      specLine: 'const sheetSpec = <JSON>;',
      solid: 'let part = sheetMetalSolid(sheetSpec);',
      source: 'src/utils/sheetMetal/sheetMetalScript.js',
      note: 'Sheet Metal mode writes this marked block, then `return part;` after the end marker. It replaces the starter cube rather than adding onto an existing part. A returned sheet wrapper ({ solid, spec } or { solid, flat }) is unwrapped to solid.',
    },
    spec: {
      source: 'src/utils/sheetMetal/sheetModel.js',
      comment: header ? header[0].replace(/\n \* ?/g, '\n').trim() : '',
      fields: {
        v: 'Schema version. 1.',
        sku: 'SendCutSend SKU.',
        material: 'Material display name.',
        t: 'Thickness in mm.',
        r: 'Inner bend radius in mm.',
        k: 'K-factor.',
        limits: 'mm / deg limits copied from the SKU (sheetLimitsFromRecord) so DFM works offline.',
        plane: "'XY' | 'XZ' | 'YZ'. Base flange plane.",
        width: 'Base flange width, mm, centered.',
        height: 'Base flange height, mm, centered.',
        bends: "[{ id, panel: 'base' | bendId, edge: 'u+'|'u-'|'v+'|'v-', angle, length, flip }]",
        tabs: '[{ id, panel, edge, width, depth, centered, offset }]',
        holes: "[{ id, panel, u, v, d, kind: 'hole'|'countersink'|'tapped' }]",
      },
    },
    dfm: {
      source: 'src/utils/sheetMetal/sheetDfm.js',
      entry: 'checkSheetDfm(spec, { unit })',
      note: 'Limits and the spec stay in millimetres. unit only formats messages. Hard fails block export and order in the app; warnings do not.',
      rules,
    },
    export: {
      entry: 'buildSheetExport(spec, { mesh, script, partName, timestamp, exactStep, unit })',
      source: 'src/utils/sheetMetal/sheetExport.js',
      step: 'exactStep true (default) builds an AP214 B-rep with real cylinders at bends (sheetBrep.js → brepToStep). exactStep false, or a spec that cannot fold, falls back to meshToStep (faceted).',
      dxf: 'Flat pattern DXF from the spec (sheetFlat.js), not from the mesh.',
      headless: 'src/lib/surfcad/export.js sheetSpecToStep(spec) returns the same STEP text.',
    },
  };
}

function walkImports(entryRel) {
  const seen = new Set();
  const files = [];
  function visit(rel) {
    if (seen.has(rel)) return;
    const abs = join(root, rel);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      return;
    }
    seen.add(rel);
    files.push(rel);
    const re = /from\s+['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      let next = join(dirname(abs), m[1]);
      if (!next.endsWith('.js') && !next.endsWith('.mjs')) {
        if (statExists(`${next}.js`)) next += '.js';
        else if (statExists(`${next}.mjs`)) next += '.mjs';
      }
      visit(relative(root, next));
    }
  }
  function statExists(p) {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  }
  visit(entryRel);
  return files.sort();
}

function manifoldCatalog() {
  const parsed = parseDts(dtsSrc);
  const manifold = parsed.classes.Manifold || [];
  const cross = parsed.classes.CrossSection || [];
  if (manifold.length < 10 || cross.length < 10) {
    console.error(`catalog: Manifold/CrossSection parse looks short (${manifold.length}/${cross.length})`);
    process.exitCode = 1;
  }
  return {
    kernel: 'built/manifold.js',
    types: 'built/manifold-encapsulated-types.d.ts',
    note: 'The app and the headless entry ship this custom embind build. npm manifold-3d is a different build (status() is a string there and an enum object here) and is not a substitute.',
    functions: parsed.functions,
    CrossSection: cross,
    Manifold: manifold,
    Mesh: parsed.classes.Mesh || [],
  };
}

const outDir = join(root, 'src/lib/surfcad/catalog');
mkdirSync(outDir, { recursive: true });

const helpers = catalogHelpers();
const manifold = manifoldCatalog();
const assembly = assemblySchema();
const sheetMetal = sheetMetalCatalog();
const runtimeFiles = walkImports('src/lib/surfcad/index.js');
const wasm = 'built/manifold.wasm';
if (!runtimeFiles.includes('built/manifold.js')) {
  console.error('catalog: import walk did not reach built/manifold.js');
  process.exitCode = 1;
}

const sync = {
  mechanism: 'pinned-commit import-graph copy',
  entry: 'src/lib/surfcad/index.js',
  workerEntry: 'src/workers/sandboxWorker.js',
  wasm,
  runtimeFiles: [...runtimeFiles, wasm].sort(),
  catalogFiles: readdirSync(outDir).filter((n) => n.endsWith('.json') || n === '.gitkeep').map((n) => `src/lib/surfcad/catalog/${n}`),
  regenerate: 'npm run export:agent',
};

writeFileSync(join(outDir, 'helpers.json'), `${JSON.stringify(helpers, null, 2)}\n`);
writeFileSync(join(outDir, 'manifold.json'), `${JSON.stringify(manifold, null, 2)}\n`);
writeFileSync(join(outDir, 'assembly.schema.json'), `${JSON.stringify(assembly, null, 2)}\n`);
writeFileSync(join(outDir, 'sheet-metal.json'), `${JSON.stringify(sheetMetal, null, 2)}\n`);
writeFileSync(join(outDir, 'sync-files.json'), `${JSON.stringify(sync, null, 2)}\n`);

// sync-files listed catalog files before this write; refresh once so the list includes itself.
sync.catalogFiles = readdirSync(outDir).filter((n) => n.endsWith('.json')).sort().map((n) => `src/lib/surfcad/catalog/${n}`);
writeFileSync(join(outDir, 'sync-files.json'), `${JSON.stringify(sync, null, 2)}\n`);

console.log(`helpers ${helpers.count}`);
console.log(`manifold methods ${manifold.Manifold.length} cross ${manifold.CrossSection.length} fns ${manifold.functions.length}`);
console.log(`runtime files ${sync.runtimeFiles.length}`);

// Bridge command catalog for surfcad-mcp (M2).
await import('./export-agent-bridge-commands.mjs');

if (process.exitCode) process.exit(process.exitCode);
