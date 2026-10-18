/* global window */
/**
 * Clear local cache.
 *
 * - the wipe empties parts, the assembly document, and the outbox
 * - a warning is planned for an unpushed outbox entry and for an unsynced part
 * - Push first pushes, then clears; a failed flush does not clear
 * - signed out, confirm clears and no fetch runs; Push first is not offered
 * - desktop mounts one profile chip; mobile mounts one per pane
 *
 * Screenshots (confirm popup with the warning): GOLDEN_SHOT_DIR or
 * os.tmpdir()/surfcad-golden-shots. Never /opt/cursor/artifacts.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { clearCachePlan, runClearLocalCache } from '../../src/utils/clearLocalCache.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('clear local cache — plan');
{
  const outboxOnly = clearCachePlan({
    source: 'local', hasRepo: false, outboxCount: 1, queuedCount: 1, unsyncedCount: 0,
  });
  ok('unpushed outbox warns and does not offer push when signed out',
    outboxOnly.warn && !outboxOnly.offerPush && outboxOnly.after === 'local');

  const unsyncedOnly = clearCachePlan({
    source: 'git', hasRepo: true, outboxCount: 0, queuedCount: 0, unsyncedCount: 1,
  });
  ok('unsynced part warns without Push first',
    unsyncedOnly.warn && !unsyncedOnly.offerPush && unsyncedOnly.unsynced === 1);

  const both = clearCachePlan({
    source: 'git', hasRepo: true, outboxCount: 2, queuedCount: 1, unsyncedCount: 1,
  });
  ok('queued git outbox offers Push first and reloads the repo',
    both.warn && both.offerPush && both.queued === 1 && both.after === 'repo');

  const clean = clearCachePlan({ source: 'local', hasRepo: false });
  ok('empty local plan does not warn', !clean.warn && !clean.offerPush);

  const failedOnly = clearCachePlan({
    source: 'git', hasRepo: true, outboxCount: 1, queuedCount: 0, unsyncedCount: 0,
  });
  ok('failed outbox warns but is not offered as Push first',
    failedOnly.warn && !failedOnly.offerPush);
}

console.log('clear local cache — push then wipe');
{
  const plan = clearCachePlan({
    source: 'git', hasRepo: true, outboxCount: 2, queuedCount: 1, unsyncedCount: 1,
  });
  const order = [];
  const pushed = await runClearLocalCache({
    pushFirst: true,
    plan,
    push: async () => { order.push('push'); return { status: 'synced' }; },
    wipe: async () => { order.push('wipe'); },
  });
  ok('Push first pushes before clearing',
    pushed.cleared && pushed.pushed && order.join(',') === 'push,wipe');

  const idleOrder = [];
  const idled = await runClearLocalCache({
    pushFirst: true,
    plan,
    push: async () => { idleOrder.push('push'); return { status: 'idle' }; },
    wipe: async () => { idleOrder.push('wipe'); },
  });
  ok('idle flush still clears', idled.cleared && idleOrder.join(',') === 'push,wipe');

  for (const status of ['failed', 'offline', 'conflict']) {
    let wiped = false;
    const held = await runClearLocalCache({
      pushFirst: true,
      plan,
      push: async () => ({ status }),
      wipe: async () => { wiped = true; },
    });
    ok(`${status} flush keeps the cache`, !held.cleared && !wiped);
  }

  let threwWipe = false;
  const threw = await runClearLocalCache({
    pushFirst: true,
    plan,
    push: async () => { throw new Error('network'); },
    wipe: async () => { threwWipe = true; },
  });
  ok('a thrown push does not wipe', !threw.cleared && !threwWipe && threw.reason === 'push-threw');
}

console.log('clear local cache — signed out does not fetch');
{
  let fetches = 0;
  globalThis.fetch = () => {
    fetches += 1;
    throw new Error('signed-out clear must not fetch');
  };
  const plan = clearCachePlan({
    source: 'local', hasRepo: false, outboxCount: 2, queuedCount: 2, unsyncedCount: 1,
  });
  let wiped = false;
  const refused = await runClearLocalCache({
    pushFirst: true,
    plan,
    push: async () => { fetches += 1; return { status: 'synced' }; },
    wipe: async () => { wiped = true; },
  });
  ok('signed-out Push first is refused',
    !refused.cleared && !wiped && refused.reason === 'no-push' && fetches === 0);

  const confirmed = await runClearLocalCache({
    pushFirst: false,
    plan,
    push: async () => { fetches += 1; return { status: 'synced' }; },
    wipe: async () => { wiped = true; },
  });
  ok('signed-out confirm wipes without a fetch',
    confirmed.cleared && wiped && fetches === 0 && confirmed.reload === 'local');
}

console.log('clear local cache — IndexedDB wipe');
{
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const makeTx = (store) => {
    const tx = { pending: 0, oncomplete: null };
    const pump = () => later(() => {
      if (tx.pending > 0) { pump(); return; }
      if (typeof tx.oncomplete === 'function') tx.oncomplete();
    });
    const request = (apply) => {
      tx.pending += 1;
      const req = {};
      later(() => {
        apply(req);
        tx.pending -= 1;
        if (typeof req.onsuccess === 'function') req.onsuccess();
      });
      return req;
    };
    pump();
    return {
      objectStore() {
        return {
          put: (value, key) => request((req) => {
            const k = key !== undefined ? key : (store.keyPath ? value?.[store.keyPath] : undefined);
            store.data.set(k, value);
            req.result = k;
          }),
          get: (key) => request((req) => {
            req.result = store.data.has(key) ? store.data.get(key) : undefined;
          }),
          delete: (key) => request(() => { store.data.delete(key); }),
          clear: () => request(() => { store.data.clear(); }),
          getAll: () => request((req) => { req.result = [...store.data.values()]; }),
          getAllKeys: () => request((req) => { req.result = [...store.data.keys()]; }),
        };
      },
      set oncomplete(fn) { tx.oncomplete = fn; },
      set onabort(_) { void _; },
      set onerror(_) { void _; },
    };
  };
  globalThis.indexedDB = {
    open(name) {
      const req = {};
      later(() => {
        let rec = dbs.get(name);
        const first = !rec;
        if (!rec) {
          rec = { stores: new Map() };
          dbs.set(name, rec);
        }
        req.result = {
          objectStoreNames: { contains: (n) => rec.stores.has(n) },
          createObjectStore(storeName, opts) {
            const store = { data: new Map(), keyPath: opts?.keyPath || null };
            rec.stores.set(storeName, store);
            return store;
          },
          close() {},
          transaction(storeName) {
            const store = rec.stores.get(storeName);
            if (!store) throw new Error(`missing store ${name}/${storeName}`);
            return makeTx(store);
          },
        };
        if (first && typeof req.onupgradeneeded === 'function') req.onupgradeneeded();
        if (typeof req.onsuccess === 'function') req.onsuccess();
      });
      return req;
    },
  };
  const local = new Map();
  globalThis.localStorage = {
    getItem: (k) => (local.has(k) ? local.get(k) : null),
    setItem: (k, v) => local.set(k, String(v)),
    removeItem: (k) => local.delete(k),
  };
  const session = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v)),
    removeItem: (k) => session.delete(k),
  };
  session.set('surfcad.github.token', 'keep-me');
  local.set('surfcad.game.wins', '[]');
  let fetches = 0;
  globalThis.fetch = () => {
    fetches += 1;
    throw new Error('wipe must not fetch');
  };

  const stamp = Date.now();
  const asmUrl = pathToFileURL(join(root, 'src/utils/assemblyStore.js')).href + `?t=${stamp}`;
  const syncUrl = pathToFileURL(join(root, 'src/utils/git/syncStore.js')).href + `?t=${stamp}`;
  const draftUrl = pathToFileURL(join(root, 'src/utils/editorDraft.js')).href + `?t=${stamp}`;
  const asm = await import(asmUrl);
  const sync = await import(syncUrl);
  const draft = await import(draftUrl);

  const saved = await asm.saveAssemblyDocument({
    name: 'Widget',
    source: 'local',
    parts: [{ id: 'local:1', name: 'A', visible: true, order: 0, isSynced: false }],
    activeId: 'local:1',
  });
  ok('assembly document saved', saved?.parts?.[0]?.isSynced === false);
  ok('part script saved', await asm.savePartScript('local:1', 'const part = cube(1);', { isSynced: false }));
  const store = sync.createSyncStore({ persist: true });
  const op = await store.enqueue(
    { owner: 'me', name: 'surfcad' },
    { op: 'save', branch: 'main', partIds: ['local:1'], message: 'local edit' },
  );
  ok('outbox entry queued', !!op && store.pending({ owner: 'me', name: 'surfcad' }, 'main').length === 1);
  ok('editor draft saved', await draft.saveEditorDraft({
    script: 'const part = cube(1);', filename: 'A', partId: 'local:1',
  }));

  await asm.clearAssemblyStore();
  await sync.clearSyncStore();
  await draft.clearEditorDraft();

  const after = sync.createSyncStore({ persist: true });
  await after.ready();
  ok('assembly document empty', (await asm.loadAssemblyDocument()) == null);
  ok('parts store empty', (await asm.loadPartScript('local:1')) == null);
  ok('outbox empty', after.ops().length === 0
    && after.pending({ owner: 'me', name: 'surfcad' }, 'main').length === 0);
  ok('editor draft empty', (await draft.loadEditorDraft()) == null);
  ok('GitHub token kept', session.get('surfcad.github.token') === 'keep-me');
  ok('game-wins setting kept', local.get('surfcad.game.wins') === '[]');
  ok('wipe did not fetch', fetches === 0);
}

console.log('clear local cache — chips and docs');
{
  const feed = read('src/components/PartFeed.jsx');
  const editor = read('src/components/CodeEditor.jsx');
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const dialog = read('src/components/ClearCacheDialog.jsx');
  const util = read('src/utils/clearLocalCadData.js');
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  const pkg = read('package.json');

  const before = (src, attr) => {
    const i = src.indexOf(attr);
    return i < 0 ? '' : src.slice(Math.max(0, i - 220), i);
  };
  ok('Parts chip is mobile-only', /isMobile &&/.test(before(feed, 'data-parts-profile-chip')));
  ok('Script chip is mobile-only', /isMobile &&/.test(before(editor, 'data-script-profile-chip')));
  const viewMount = before(view, 'variant="viewport"');
  ok('viewer chip stays at desktop widths',
    /mode !== 'game'/.test(viewMount) && !/isMobile/.test(viewMount));
  ok('App passes the mobile flag into Parts', /<PartFeed[\s\S]*?isMobile=\{isMobile\}/.test(app));
  ok('viewer chip can clear while signed out',
    /onClearLocalCadData=\{onClearLocalCadData\}/.test(view)
    && /onClearLocalCadData=\{openClearLocalCache\}/.test(app));
  ok('menu action is Clear local cache',
    /Clear local cache/.test(read('src/components/ProfilePanel.jsx'))
    && /data-clear-cache/.test(read('src/components/ProfilePanel.jsx'))
    && /Clear local cache/.test(read('src/components/AccountPane.jsx'))
    && /data-clear-cache/.test(read('src/components/AccountPane.jsx')));
  ok('popup warns and offers Push first',
    /data-clear-cache-dialog/.test(dialog)
    && /data-clear-cache-warning/.test(dialog)
    && /data-clear-cache-outbox/.test(dialog)
    && /data-clear-cache-unsynced/.test(dialog)
    && /data-clear-cache-push/.test(dialog)
    && /data-clear-cache-confirm/.test(dialog));
  ok('dialog copy avoids outbox and isSynced',
    /change hasn't been pushed yet/.test(dialog)
    && /changes haven't been pushed yet/.test(dialog)
    && /part isn't in the repo yet/.test(dialog)
    && /parts aren't in the repo yet/.test(dialog)
    && /assemblies, and unpushed changes/.test(dialog)
    && !/isSynced/.test(dialog)
    && !/outbox entry/.test(dialog)
    && !/the outbox/.test(dialog));
  ok('wipe covers the three stores and leaves the token',
    /clearAssemblyStore/.test(util)
    && /clearSyncStore/.test(util)
    && /clearEditorDraft/.test(util)
    && !/clearGithubToken/.test(util)
    && !/fetch\(/.test(util)
    && /surfcad-scs/.test(util));
  ok('App reload follows the wipe and does not fetch inside the wipe helper',
    /clearLocalCadData\(\)/.test(app)
    && /window\.location\.reload\(\)/.test(app)
    && /runClearLocalCache/.test(app)
    && /flushGitOps/.test(app));
  ok('ui-map.md places the chip per breakpoint',
    /desktop \(above the 768px mobile breakpoint\) shows only/.test(map)
    && /Mobile shows that chip plus one on the/.test(map)
    && /Clear local cache/.test(map));
  ok('architecture.md records the wipe and what stays',
    /Clear local cache/.test(arch)
    && /surfcad-sync/.test(arch)
    && /sessionStorage GitHub token/.test(arch)
    && /surfcad-scs/.test(arch));
  ok('package.json has golden:clear-local-cache', /golden:clear-local-cache/.test(pkg));
}

console.log('clear local cache — confirm popup, 390 and desktop');
const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });
if (shotDir.includes('/opt/cursor/artifacts')) {
  ok('shots stay out of /opt/cursor/artifacts', false, shotDir);
} else {
  ok('shot dir is GOLDEN_SHOT_DIR or tmp', true);
}

const html = `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderClearCacheDialog } from '/scripts/golden/clear_cache_shot.js';
renderClearCacheDialog(document.getElementById('root'));
window.__READY__ = true;
</script>`;

const vite = await createVite({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const shots = [
    ['clear-cache-confirm-warning-390.png', 390, 700],
    ['clear-cache-confirm-warning-desktop.png', 1100, 720],
  ];
  for (const [name, width, height] of shots) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
    await page.locator('[data-clear-cache-dialog]').waitFor();
    await page.locator('[data-clear-cache-warning]').waitFor();
    const changes = await page.locator('[data-clear-cache-outbox]').innerText();
    const parts = await page.locator('[data-clear-cache-unsynced]').innerText();
    await page.locator('[data-clear-cache-push]').waitFor();
    ok(`${name} warning copy`,
      changes === "2 changes haven't been pushed yet."
      && parts === "1 part isn't in the repo yet.");
    const file = join(shotDir, name);
    await page.screenshot({ path: file });
    ok(`${name} shows the warning`, errors.length === 0, errors.join('; '));
    console.log(`  shot ${file}`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
  await vite.close();
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
