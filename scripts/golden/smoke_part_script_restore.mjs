/**
 * Golden: new-part script must survive session restore (IndexedDB / draft).
 *
 * Playtest bug: create part A (FilletKilla), create part B (default cube),
 * leave and return — B's name stays but its solid becomes a copy of A.
 *
 * Root cause: a global editor draft from A overwrote B's correctly saved
 * part-script slot on hydrate. Draft must be bound to part id; restore must
 * never bleed another part's buffer into the active row.
 */
import { readFileSync } from 'node:fs';
import { resolveActiveRestore } from '../../src/utils/partScriptRestore.js';
import { starterCubeScript } from '../../src/utils/helperPaletteSnippets.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const FILLET = `// FilletKilla (stand-in)
let part = Manifold.cube([50, 40, 30], true);
return part;
`;
const CUBE = starterCubeScript();

console.log('part script restore — resolveActiveRestore binding');
{
  const activeB = { id: 'local:b', name: 'Part 2' };
  const scripts = {
    'local:a': FILLET,
    'local:b': CUBE,
  };

  const staleDraft = {
    script: FILLET,
    filename: 'FilletKilla',
    partId: 'local:a',
  };
  const kept = resolveActiveRestore({ active: activeB, scripts, draft: staleDraft });
  check('stale other-part draft does not clobber B', kept.script === CUBE);
  check('B script map unchanged', kept.scripts['local:b'] === CUBE);
  check('A script untouched', kept.scripts['local:a'] === FILLET);
  check('does not persist overwrite', kept.persistActive === false);
  check('not marked fromDraft', kept.fromDraft === false);

  const legacy = resolveActiveRestore({
    active: activeB,
    scripts,
    draft: { script: FILLET, filename: 'FilletKilla', partId: null },
  });
  check('legacy unbound draft does not clobber saved B', legacy.script === CUBE);
  check('legacy does not persist over B', legacy.persistActive === false);

  const edited = `${CUBE}\n// tweak\n`;
  const match = resolveActiveRestore({
    active: activeB,
    scripts,
    draft: { script: edited, filename: 'Part 2', partId: 'local:b' },
  });
  check('matching partId draft restores B edits', match.script === edited);
  check('matching draft updates scripts map', match.scripts['local:b'] === edited);
  check('matching draft persists', match.persistActive === true);
  check('matching draft fromDraft', match.fromDraft === true);

  const empty = resolveActiveRestore({
    active: { id: 'local:c', name: 'Part 3' },
    scripts: { 'local:a': FILLET },
    draft: { script: CUBE, filename: 'Part 3', partId: null },
  });
  check('legacy draft seeds empty active slot', empty.script === CUBE && empty.fromDraft);
  check('legacy seed persists', empty.persistActive === true);
}

console.log('part script restore — editorDraft carries partId');
{
  const fakeLocalStorage = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      _map: map,
    };
  };
  const fakeIndexedDB = () => {
    const stores = new Map();
    const later = (fn) => setTimeout(fn, 0);
    return {
      open() {
        const req = { result: null, error: null };
        later(() => {
          if (!stores.has('editorDraft')) stores.set('editorDraft', new Map());
          req.result = {
            objectStoreNames: { contains: (n) => stores.has(n) },
            createObjectStore: (n) => stores.set(n, new Map()),
            close() {},
            transaction(name) {
              const data = stores.get(name);
              const tx = { pending: 0 };
              const settle = () => later(() => {
                if (tx.pending > 0) { settle(); return; }
                if (tx.oncomplete) tx.oncomplete();
              });
              const request = (fn) => {
                tx.pending += 1;
                const r = {};
                later(() => {
                  fn(r);
                  tx.pending -= 1;
                  if (r.onsuccess) r.onsuccess();
                });
                return r;
              };
              settle();
              return {
                objectStore: () => ({
                  put: (value, key) => request(() => data.set(key, value)),
                  get: (key) => request((r) => { r.result = data.get(key); }),
                  delete: (key) => request(() => data.delete(key)),
                }),
                set oncomplete(fn) { tx.oncomplete = fn; },
                set onabort(_fn) {},
                set onerror(_fn) {},
              };
            },
          };
          if (req.onupgradeneeded) req.onupgradeneeded();
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      },
    };
  };

  globalThis.indexedDB = fakeIndexedDB();
  globalThis.localStorage = fakeLocalStorage();
  const { saveEditorDraft, loadEditorDraft, clearEditorDraft } = await import(
    `../../src/utils/editorDraft.js?t=${Math.random()}`
  );

  await saveEditorDraft({
    script: CUBE,
    filename: 'Part 2',
    partId: 'local:b',
  });
  const back = await loadEditorDraft();
  check('draft round-trips partId', back?.partId === 'local:b');
  check('draft round-trips script', back?.script === CUBE);
  await clearEditorDraft();
}

console.log('part script restore — App wiring');
{
  const app = read('src/App.jsx');
  const draft = read('src/utils/editorDraft.js');
  const helper = read('src/utils/partScriptRestore.js');
  const arch = read('docs/architecture.md');

  check('App imports resolveActiveRestore', /resolveActiveRestore/.test(app));
  check('hydrate uses resolveActiveRestore', /resolveActiveRestore\(\{/.test(app));
  check('debounce captures idAtSchedule', /idAtSchedule/.test(app));
  check('debounce passes partId', /partId:\s*idAtSchedule/.test(app));
  check('pagehide draft passes partId', /saveEditorDraft\(\{[\s\S]*?partId:\s*id/.test(app));
  check('New part bumps partSaveEpoch', /handleAddPart[\s\S]*?partSaveEpochRef\.current \+= 1/.test(app));
  check('New part binds draft immediately', /saveEditorDraft\(\{\s*script:\s*starter[\s\S]*?partId:\s*id/.test(app));
  check('Select part bumps partSaveEpoch', /partSaveEpochRef\.current \+= 1[\s\S]*?rememberAssembly\(\{\s*\.\.\.doc,\s*activeId:\s*id/.test(app));
  check('editorDraft stores partId', /partId/.test(draft) && /bound/.test(draft));
  check('helper documents no cross-part bleed', /FilletKilla|bleed|clobber/.test(helper));
  check('architecture notes draft partId binding', /partId|editor draft.*part|draft.*active part/i.test(arch));
}

if (failed) {
  console.error(`\n❌ part script restore: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✅ part script restore — all checks passed');
