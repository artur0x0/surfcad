/**
 * Emit and parse a `solveContour({...})` call.
 *
 * The call is the contour. Dimension names are strings on the dimension,
 * not script bindings. Values are millimetres, or degrees for an angle.
 * A bare identifier is refused: a name does not escape the contour.
 */

function round4(n) {
  const r = Math.round(Number(n) * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}

function emitNum(n) {
  const r = round4(n);
  return Object.is(r, -0) ? '0' : String(r);
}

function emitString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

function emitAt(at) {
  const parts = [];
  for (const [id, uv] of Object.entries(at)) {
    if (uv.length >= 2) parts.push(`${id}: [${emitNum(uv[0])}, ${emitNum(uv[1])}]`);
    else parts.push(`${id}: [${emitNum(uv[0])}]`);
  }
  return `{ ${parts.join(', ')} }`;
}

function emitSeq(item, fields) {
  const n = Number(item?.seq);
  if (Number.isFinite(n) && n >= 1) fields.push(`seq: ${Math.round(n)}`);
}

function emitItem(item) {
  const fields = [`id: ${emitString(item.id)}`];
  emitSeq(item, fields);
  fields.push(`kind: ${emitString(item.kind)}`);
  if (item.edge) fields.push(`edge: ${emitString(item.edge)}`);
  if (item.arc) fields.push(`arc: ${emitString(item.arc)}`);
  if (item.point) fields.push(`point: ${emitString(item.point)}`);
  if (item.a) fields.push(`a: ${emitString(item.a)}`);
  if (item.b) fields.push(`b: ${emitString(item.b)}`);
  if (item.items) fields.push(`items: [${item.items.map(emitString).join(', ')}]`);
  if (item.value != null) fields.push(`value: ${emitNum(item.value)}`);
  if (item.name) fields.push(`name: ${emitString(item.name)}`);
  if (item.side != null) fields.push(`side: ${item.side < 0 ? -1 : 1}`);
  if (item.sense != null) fields.push(`sense: ${item.sense < 0 ? -1 : 1}`);
  if (item.broken) fields.push('broken: true');
  if (item.at) fields.push(`at: ${emitAt(item.at)}`);
  if (item.placement != null && Number.isFinite(Number(item.placement))) {
    fields.push(`placement: ${emitNum(item.placement)}`);
  }
  if (Array.isArray(item.anchors) && item.anchors.length) {
    const pairs = item.anchors.map((uv) => `[${emitNum(uv[0])}, ${emitNum(uv[1])}]`);
    fields.push(`anchors: [${pairs.join(', ')}]`);
  }
  return `{ ${fields.join(', ')} }`;
}

function emitArc(arc) {
  const fields = [
    `id: ${emitString(arc.id)}`,
  ];
  emitSeq(arc, fields);
  fields.push(
    `center: ${emitString(arc.center)}`,
    `radius: ${emitNum(arc.radius)}`,
  );
  if (arc.full) fields.push('full: true');
  else {
    fields.push(`start: ${emitString(arc.start)}`);
    fields.push(`end: ${emitString(arc.end)}`);
  }
  if (arc.sweep) fields.push(`sweep: ${emitString(arc.sweep)}`);
  if (arc.segments != null) fields.push(`segments: ${Math.round(arc.segments)}`);
  return `{ ${fields.join(', ')} }`;
}

function emitPoint(p) {
  return `{ id: ${emitString(p.id)}, at: [${emitNum(p.at[0])}, ${emitNum(p.at[1])}] }`;
}

function emitLine(l) {
  const fields = [`id: ${emitString(l.id)}`, `a: ${emitString(l.a)}`, `b: ${emitString(l.b)}`];
  emitSeq(l, fields);
  if (l.guide) fields.push('guide: true');
  return `{ ${fields.join(', ')} }`;
}

function emitUv(uv) {
  return `[${emitNum(uv[0])}, ${emitNum(uv[1])}]`;
}

function emitGeom(geom) {
  if (!geom) return 'null';
  if (geom.kind === 'point') return `{ kind: 'point', at: ${emitUv(geom.at)} }`;
  if (geom.kind === 'line') {
    return `{ kind: 'line', a: ${emitUv(geom.a)}, b: ${emitUv(geom.b)} }`;
  }
  if (geom.kind === 'polyline') {
    return `{ kind: 'polyline', points: [${geom.points.map(emitUv).join(', ')}] }`;
  }
  const fields = [
    `kind: 'arc'`,
    `center: ${emitUv(geom.center)}`,
    `radius: ${emitNum(geom.radius)}`,
    `sweep: ${emitString(geom.sweep || 'ccw')}`,
  ];
  if (geom.full) fields.push('full: true');
  else {
    if (geom.start != null) fields.push(`start: ${emitNum(geom.start)}`);
    if (geom.end != null) fields.push(`end: ${emitNum(geom.end)}`);
  }
  return `{ ${fields.join(', ')} }`;
}

function emitBoundary(boundary) {
  const fields = [
    `faceA: ${emitNum(boundary.faceA)}`,
    `faceB: ${emitNum(boundary.faceB)}`,
    `mid: [${boundary.mid.map(emitNum).join(', ')}]`,
  ];
  if (boundary.refKey) fields.push(`refKey: ${emitString(boundary.refKey)}`);
  return `{ ${fields.join(', ')} }`;
}

function emitRef(ref) {
  const fields = [`id: ${emitString(ref.id)}`];
  emitSeq(ref, fields);
  fields.push(`kind: ${emitString(ref.kind)}`);
  if (ref.refKey) fields.push(`refKey: ${emitString(ref.refKey)}`);
  if (ref.faceA != null) fields.push(`faceA: ${emitNum(ref.faceA)}`);
  if (ref.faceB != null) fields.push(`faceB: ${emitNum(ref.faceB)}`);
  if (Array.isArray(ref.mid)) fields.push(`mid: [${ref.mid.map(emitNum).join(', ')}]`);
  if (ref.faceId != null) fields.push(`faceId: ${emitNum(ref.faceId)}`);
  if (ref.end != null) fields.push(`end: ${emitNum(ref.end)}`);
  if (ref.boundary) fields.push(`boundary: ${emitBoundary(ref.boundary)}`);
  if (ref.broken) fields.push('broken: true');
  if (Array.isArray(ref.loop) && ref.loop.length) {
    fields.push(`loop: [${ref.loop.map(emitUv).join(', ')}]`);
  }
  if (ref.geom) fields.push(`geom: ${emitGeom(ref.geom)}`);
  return `{ ${fields.join(', ')} }`;
}

/**
 * The source of the call, not the solved return value. Seeds are rounded
 * to 4 decimals, matching the other contour emitters.
 */
function assertEqualPairs(spec) {
  const lines = new Set((spec.lines || []).map((line) => line.id));
  const arcs = new Set((spec.arcs || []).map((arc) => arc.id));
  for (const con of spec.constraints || []) {
    if (con.kind !== 'equal') continue;
    const items = con.items || [];
    const lineCount = items.filter((id) => lines.has(id)).length;
    const arcCount = items.filter((id) => arcs.has(id)).length;
    if (lineCount !== 2 && arcCount !== 2) {
      throw new Error('equal needs two lines or two arcs');
    }
  }
}

export function emitSolveContour(model) {
  const spec = model || {};
  assertEqualPairs(spec);
  const body = [
    `points: [${(spec.points || []).map(emitPoint).join(', ')}]`,
    `lines: [${(spec.lines || []).map(emitLine).join(', ')}]`,
    `arcs: [${(spec.arcs || []).map(emitArc).join(', ')}]`,
    `dimensions: [${(spec.dimensions || []).map(emitItem).join(', ')}]`,
    `constraints: [${(spec.constraints || []).map(emitItem).join(', ')}]`,
  ];
  if (spec.polyline) body.push('polyline: true');
  if ((spec.refs || []).length) body.push(`refs: [${spec.refs.map(emitRef).join(', ')}]`);
  return `solveContour({ ${body.join(', ')} })`;
}

class Parser {
  constructor(text) {
    this.s = String(text || '');
    this.i = 0;
  }

  peek() {
    return this.s[this.i];
  }

  skip() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1;
  }

  fail(message) {
    throw new Error(`solveContour: ${message}`);
  }

  parseValue() {
    this.skip();
    const c = this.peek();
    if (c === '{') return this.parseObject();
    if (c === '[') return this.parseArray();
    if (c === '"' || c === '\'') return this.parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber();
    if (this.s.startsWith('true', this.i)) { this.i += 4; return true; }
    if (this.s.startsWith('false', this.i)) { this.i += 5; return false; }
    if (this.s.startsWith('null', this.i)) { this.i += 4; return null; }
    if (/[A-Za-z_$]/.test(c || '')) {
      this.fail('expected a number or a string, not a name. A dimension name stays inside the contour.');
    }
    this.fail('expected a value');
  }

  parseObject() {
    this.i += 1;
    const obj = {};
    for (;;) {
      this.skip();
      if (this.peek() === '}') { this.i += 1; return obj; }
      const key = this.parseKey();
      this.skip();
      if (this.peek() !== ':') this.fail('expected :');
      this.i += 1;
      obj[key] = this.parseValue();
      this.skip();
      if (this.peek() === ',') { this.i += 1; continue; }
      if (this.peek() === '}') { this.i += 1; return obj; }
      this.fail('expected , or }');
    }
  }

  parseKey() {
    this.skip();
    if (this.peek() === '"' || this.peek() === '\'') return this.parseString();
    const start = this.i;
    if (!/[A-Za-z_$]/.test(this.peek() || '')) this.fail('expected a field name');
    while (/[\w$]/.test(this.peek() || '')) this.i += 1;
    return this.s.slice(start, this.i);
  }

  parseArray() {
    this.i += 1;
    const arr = [];
    for (;;) {
      this.skip();
      if (this.peek() === ']') { this.i += 1; return arr; }
      arr.push(this.parseValue());
      this.skip();
      if (this.peek() === ',') { this.i += 1; continue; }
      if (this.peek() === ']') { this.i += 1; return arr; }
      this.fail('expected , or ]');
    }
  }

  parseString() {
    const q = this.s[this.i];
    this.i += 1;
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== q) {
      if (this.s[this.i] === '\\') {
        this.i += 1;
        out += this.s[this.i] || '';
        this.i += 1;
        continue;
      }
      out += this.s[this.i];
      this.i += 1;
    }
    if (this.s[this.i] !== q) this.fail('unterminated string');
    this.i += 1;
    return out;
  }

  parseNumber() {
    const start = this.i;
    if (this.peek() === '-') this.i += 1;
    while (/[0-9.]/.test(this.peek() || '')) this.i += 1;
    const n = Number(this.s.slice(start, this.i));
    if (!Number.isFinite(n)) this.fail('bad number');
    return n;
  }
}

function keepSeq(item) {
  if (!item || typeof item !== 'object') return item;
  const n = Number(item.seq);
  if (Number.isFinite(n) && n >= 1) item.seq = Math.round(n);
  else delete item.seq;
  return item;
}

function objectOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('solveContour: expected a contour object');
  }
  return value;
}

/**
 * Parse a `solveContour({...})` call or the object itself.
 * Returns the contour spec (points, lines, arcs, dimensions, constraints, refs).
 * A call with no refs list parses as an empty list.
 */
export function parseSolveContour(source) {
  const text = String(source || '');
  const at = text.indexOf('solveContour');
  const body = at >= 0 ? text.slice(at) : text;
  const parser = new Parser(body);
  if (at >= 0) {
    parser.skip();
    if (!body.startsWith('solveContour')) parser.fail('expected solveContour');
    parser.i = 'solveContour'.length;
    parser.skip();
    if (parser.peek() !== '(') parser.fail('expected (');
    parser.i += 1;
  }
  const value = objectOf(parser.parseValue());
  const spec = {
    points: value.points || [],
    lines: (value.lines || []).map(keepSeq),
    arcs: (value.arcs || []).map(keepSeq),
    dimensions: (value.dimensions || []).map(keepSeq),
    constraints: (value.constraints || []).map(keepSeq),
    refs: (value.refs || []).map(keepSeq),
  };
  if (value.polyline) spec.polyline = true;
  return spec;
}
