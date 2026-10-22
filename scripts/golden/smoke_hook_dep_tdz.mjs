#!/usr/bin/env node
/**
 * Blank-screen guard: no hook dependency array may reference a `const` declared
 * further down the same component.
 *
 * This is the bug that shipped a white page. A `useEffect` was inserted above
 * the `const [cadToolbarHost] = useState(null)` it depended on:
 *
 *     useEffect(() => { … }, [cadToolbarHost]);   // line 98
 *     …
 *     const [cadToolbarHost, setCadToolbarHost] = useState(null);  // line 289
 *
 * The effect BODY is deferred and would have been fine, but the dependency
 * array is an ordinary expression evaluated during render — so it hit the
 * temporal dead zone, threw `ReferenceError: Cannot access 'cadToolbarHost'
 * before initialization`, and React rendered nothing at all.
 *
 * Neither `npm run build` nor a text-matching golden catches this: the code is
 * syntactically perfect. eslint's no-use-before-define flags it, but also flags
 * every (safe) deferred use inside a callback body, so it can't be switched on
 * as-is. This check looks only at dependency arrays, where the reference is
 * genuinely evaluated at render time.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../../src');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('hook dependency arrays never reach into the temporal dead zone');

/** Every .jsx under src/, recursively. */
function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsxFiles(full));
    else if (entry.name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

const HOOK_DEPS = /\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/g;
// `const [a, b] = …` and `const a = …`, capturing the bound names.
const DESTRUCTURED = /^\s*const\s*\[\s*([^\]]+?)\s*\]\s*=/;
const SIMPLE = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=/;
// Column-0 declarations: `function Name(`, `export default function`, and
// `const Name = (…) =>` / `memo(` / `forwardRef(` component wrappers.
const TOP_LEVEL_SCOPE = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\b|^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=/;

for (const file of jsxFiles(SRC)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const rel = file.slice(file.indexOf('/src/') + 1);

  // A top-level `function` or `const X = …` starts a new scope. A `const`
  // inside one component cannot shadow a prop or binding of another, so a
  // dependency is only checked against declarations in its own component.
  const scopeStarts = [];
  lines.forEach((line, i) => {
    if (TOP_LEVEL_SCOPE.test(line)) scopeStarts.push(i + 1);
  });
  const scopeOf = (lineNo) => {
    let start = 0;
    let end = Infinity;
    for (const s of scopeStarts) {
      if (s <= lineNo) start = s;
      else { end = s; break; }
    }
    return { start, end };
  };

  // name → 1-based lines where a `const` of that name is initialised
  const declaredAt = new Map();
  const declare = (name, lineNo) => {
    if (!name) return;
    if (!declaredAt.has(name)) declaredAt.set(name, []);
    declaredAt.get(name).push(lineNo);
  };
  lines.forEach((line, i) => {
    const d = line.match(DESTRUCTURED);
    if (d) {
      for (const raw of d[1].split(',')) declare(raw.trim().split(':').pop().trim(), i + 1);
      return;
    }
    const m = line.match(SIMPLE);
    if (m) declare(m[1], i + 1);
  });

  const offenders = [];
  for (const m of text.matchAll(HOOK_DEPS)) {
    const depLine = text.slice(0, m.index).split('\n').length;
    const scope = scopeOf(depLine);
    for (const raw of m[1].split(',')) {
      // Bare identifiers only; `a?.b` / `a.b` read the base at render too, so
      // take the head of any member expression.
      const name = raw.trim().split(/[.?[]/)[0].trim();
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      const at = (declaredAt.get(name) || []).find((l) => l >= scope.start && l < scope.end);
      if (at && at > depLine) {
        offenders.push(`${rel}:${depLine} depends on '${name}' declared at line ${at}`);
      }
    }
  }
  check(`${rel} has no dep-array TDZ`, offenders.length === 0, offenders.join('; '));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll hook dependency arrays are declared after what they read.');
