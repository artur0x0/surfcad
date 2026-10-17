#!/usr/bin/env node
/**
 * Assembly names use the part parenthesis rule (`nextNumberedName`).
 * A new assembly is Assembly, then Assembly (1), Assembly (2).
 * A copy, an import, or a rename that collides is Name (2), Name (3), …
 * and blocks when the folder is still taken. Saved names are not rewritten.
 *
 * Repo round-trip (G2/G5/G6 mock harness): save, push, list, reopen, delete
 * `assemblies/Assembly (1)/`, including Contents-API path encoding.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import {
  assemblyFilePath,
  assemblyPartPath,
  parseVaultPath,
  sharedPartPath,
  vaultSegment,
} from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, withSurfId } from '../../src/utils/git/surfId.js';
import { mintGroupId } from '../../src/utils/partGroups.js';
import { encodeGitHubContentsPath } from '../../src/utils/git/githubAdapter.js';
import {
  listVaultAssemblies,
  openVaultAssembly,
  resolveAssemblyFolderName,
  takenAssemblyNames,
} from '../../src/utils/git/gitWorkspace.js';
import { planDuplicateAssembly } from '../../src/utils/git/gitCommit.js';
import { listVaultBranches, switchVaultBranch } from '../../src/utils/git/gitBranch.js';
import { planDeleteAssembly } from '../../src/utils/git/gitDeleteAssembly.js';
import {
  assemblyName,
  assemblyNameForImport,
  nextAssemblyName,
  serializeAssembly,
} from '../../src/utils/assembly.js';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const WHEN = new Date('2026-10-08T12:00:00.000Z');
const PART_ID = mintSurfId({ now: WHEN, rand: 'a1b2' });
const LID_ID = mintSurfId({ now: new Date('2026-10-08T12:00:01.000Z'), rand: 'c3d4' });
const GROUP_ID = mintGroupId({ now: new Date('2026-10-08T12:00:02.000Z'), rand: 'e5f6' });
const PAREN = 'Assembly (1)';
const PART_PATH = assemblyPartPath(PAREN, 'Part (1)');
const ASM_PATH = assemblyFilePath(PAREN);
const LID = assemblyPartPath('Cover', 'Lid');

console.log('assembly autonumber — three new names');
{
  const created = [];
  for (let i = 0; i < 3; i += 1) created.push(nextAssemblyName(created));
  eq('Assembly, Assembly (1), Assembly (2)', created, ['Assembly', 'Assembly (1)', 'Assembly (2)']);
  eq('repo folder counts when nothing local is taken',
    nextAssemblyName(takenAssemblyNames({
      tree: [{ path: assemblyFilePath('Assembly') }],
      local: [],
    })),
    'Assembly (1)');
  eq('case-insensitive folder', nextAssemblyName(['assembly']), 'Assembly (1)');
  eq('saved Widget is not a generated name', assemblyName(serializeAssembly({
    name: 'Widget',
    parts: [{ id: 'p', name: 'Part (1)', visible: true, order: 0 }],
  })), 'Widget');
}

console.log('\nassembly autonumber — duplicate, import, rename');
{
  const bracket = assemblyPartPath('Gearbox', 'Bracket');
  const doc = {
    source: 'git',
    name: 'Gearbox',
    activeId: bracket,
    parts: [{ id: bracket, name: 'Bracket', visible: true, order: 0, surfId: PART_ID }],
  };
  const scripts = { [bracket]: withSurfId('return Manifold.cube([1,1,1], true);\n', PART_ID) };
  const dup = planDuplicateAssembly(doc, scripts, ['Gearbox']);
  eq('duplicate of Gearbox is Gearbox (2)', dup.name, 'Gearbox (2)');
  eq('duplicate moves the assembly-local part', dup.moved, [{
    from: bracket,
    to: assemblyPartPath('Gearbox (2)', 'Bracket'),
  }]);
  eq('duplicate script follows the new path',
    dup.scripts[assemblyPartPath('Gearbox (2)', 'Bracket')]?.includes('@surf-id'), true);
  eq('shared path would stay', planDuplicateAssembly({
    ...doc,
    parts: [{ id: sharedPartPath('Bolt'), name: 'Bolt', visible: true, order: 0 }],
    activeId: sharedPartPath('Bolt'),
  }, {}, []).doc.parts[0].id, sharedPartPath('Bolt'));

  eq('import collision uses the part copy rule',
    assemblyNameForImport({ name: 'Assembly', parts: [] }, 'Assembly.json', ['Assembly']),
    'Assembly (2)');
  eq('import of a free name is kept',
    assemblyNameForImport({ name: 'Cover', parts: [] }, 'Cover.json', ['Assembly']),
    'Cover');
  eq('import does not rewrite a saved custom name',
    assemblyNameForImport({ name: 'Widget', parts: [] }, 'Assembly.json', []),
    'Widget');

  const renamed = resolveAssemblyFolderName('Cover', ['Cover', 'Gearbox'], { except: 'Gearbox' });
  eq('rename collision is Cover (2)', renamed, { ok: true, name: 'Cover (2)', numbered: true });
  eq('rename to self is unchanged',
    resolveAssemblyFolderName('Gearbox', ['Gearbox'], { except: 'Gearbox' }).unchanged, true);
  eq('free rename is kept',
    resolveAssemblyFolderName('Widget', ['Gearbox'], { except: 'Gearbox' }).name, 'Widget');

  const stem = 'A'.repeat(58);
  const truncated = vaultSegment(`${stem} (2)`);
  ok('long suffix truncates at 60', truncated.length === 60 && truncated.endsWith(' ('));
  const blocked = resolveAssemblyFolderName(stem, [stem, truncated], { except: 'Other' });
  eq('still-taken folder blocks, like a part path', [blocked.ok, blocked.reason], [false, 'taken']);
}

console.log('\nassembly autonumber — path encoding');
{
  eq('folder', ASM_PATH, 'assemblies/Assembly (1)/.surf.json');
  eq('part under that folder', PART_PATH, 'assemblies/Assembly (1)/Part (1).js');
  eq('parse keeps the parenthesis segment', parseVaultPath(ASM_PATH), {
    kind: 'assembly', assembly: PAREN,
  });
  eq('parse keeps the part segment', parseVaultPath(PART_PATH)?.part, 'Part (1)');
  const encoded = encodeGitHubContentsPath(ASM_PATH);
  eq('contents path encodes the space', encoded, 'assemblies/Assembly%20(1)/.surf.json');
  ok('parentheses stay in the contents path', encoded.includes('(1)') && !encoded.includes('%28'));
  const adapter = read( 'src/utils/git/githubAdapter.js');
  ok('empty-repo create uses the encoder', /encodeGitHubContentsPath\(first\.path\)/.test(adapter));
  ok('contents read uses the encoder', /encodeGitHubContentsPath\(p\)/.test(adapter));
}

console.log('\nassembly autonumber — repo round-trip');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const widgetPart = sharedPartPath('Widget');
  const widget = {
    source: 'git',
    name: 'Widget',
    activeId: widgetPart,
    parts: [{ id: widgetPart, name: 'Widget', visible: true, order: 0, surfId: LID_ID }],
  };
  const parenDoc = {
    source: 'git',
    name: PAREN,
    activeId: PART_PATH,
    parts: [{ id: PART_PATH, name: 'Part (1)', visible: true, order: 0, surfId: PART_ID }],
    colors: {
      [PART_ID]: {
        part: '#336699',
        faces: [{
          color: '#aa5500',
          key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 },
        }],
      },
    },
  };
  const cover = {
    source: 'git',
    name: 'Cover',
    activeId: LID,
    parts: [{ id: LID, name: 'Lid', visible: true, order: 0, surfId: LID_ID }],
    groups: [{
      id: GROUP_ID,
      name: PAREN,
      source: ASM_PATH,
      partIds: [LID_ID],
    }],
  };
  const script = withSurfId('return Manifold.cube([4,4,4], true);\n', PART_ID);
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'Save Assembly (1)',
    baseSha: vault.headSha,
    files: [
      fileWrite(ASM_PATH, stringifySurfJson(parenDoc)),
      fileWrite(PART_PATH, script),
      fileWrite(assemblyFilePath('Widget'), stringifySurfJson(widget)),
      fileWrite(widgetPart, '// widget\n'),
      fileWrite(assemblyFilePath('Cover'), stringifySurfJson(cover)),
      fileWrite(LID, withSurfId('return Manifold.cube([2,2,2], true);\n', LID_ID)),
    ],
  });
  eq('commit sha', typeof seeded.sha, 'string');
  eq('listed on main', await listVaultAssemblies(gh, vault.repo, 'main'), [PAREN, 'Cover', 'Widget']);

  const opened = await openVaultAssembly(gh, vault.repo, PAREN, {
    branch: 'main', headSha: seeded.sha,
  });
  eq('reopen keeps Assembly (1)', opened.doc.name, PAREN);
  eq('reopen path', opened.baseline.assemblyPath, ASM_PATH);
  eq('reopen part path', opened.doc.parts[0].id, PART_PATH);
  eq('color key survived', opened.doc.colors?.[PART_ID]?.part, '#336699');
  eq('face color key survived', opened.doc.colors?.[PART_ID]?.faces?.[0]?.color, '#aa5500');
  ok('script survived', opened.scripts[PART_PATH]?.includes('cube([4,4,4]'));
  const widgetOpen = await openVaultAssembly(gh, vault.repo, 'Widget', { branch: 'main' });
  eq('saved Widget is not renamed', widgetOpen.doc.name, 'Widget');

  await gh.createBranch(vault.repo, 'feature/paren', seeded.sha);
  const branches = await listVaultBranches(gh, vault.repo, { current: 'main' });
  eq('branch pane lists main and the side branch', branches.map((b) => b.name), ['main', 'feature/paren']);
  const switched = await switchVaultBranch(gh, vault.repo, PAREN, 'feature/paren');
  eq('switch reopens the parenthesized folder', switched.doc.name, PAREN);
  eq('switch baseline path', switched.baseline.assemblyPath, ASM_PATH);

  const tree = await gh.listTree(vault.repo, 'main');
  const entries = [];
  for (const row of tree) {
    const file = await gh.readFile(vault.repo, row.path, 'main');
    if (file) entries.push({ path: file.path, content: file.content });
  }
  const plan = planDeleteAssembly(entries, PAREN, 'keep');
  eq('delete targets the parenthesized folder', plan.assemblyPath, ASM_PATH);
  ok('delete removes the folder files', plan.files.some((f) => f.delete && f.path === ASM_PATH)
    && plan.files.some((f) => f.delete && f.path === PART_PATH));
  const removed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: plan.message,
    baseSha: seeded.sha,
    files: plan.files,
  });
  eq('delete commit', typeof removed.sha, 'string');
  ok('folder is gone', !(await gh.readFile(vault.repo, ASM_PATH, 'main')));
  ok('assembly part moved to parts/', (await gh.readFile(vault.repo, sharedPartPath('Part (1)'), 'main'))?.content?.includes('cube([4,4,4]'));
  eq('list after delete', await listVaultAssemblies(gh, vault.repo, 'main'), ['Cover', 'Widget']);
  const coverAfter = parseSurfJson((await gh.readFile(vault.repo, assemblyFilePath('Cover'), 'main')).content);
  eq('group source of the deleted folder is cleared', coverAfter.groups?.[0]?.source ?? null, null);
  eq('group name stays', coverAfter.groups?.[0]?.name, PAREN);
}

console.log('\nassembly autonumber — wiring');
{
  const app = read('src/App.jsx');
  const feed = read('src/components/PartFeed.jsx');
  const commit = read('src/utils/git/gitCommit.js');
  ok('new assembly allocates', /const handleNewAssembly[\s\S]{0,400}nextAssemblyName\(/.test(app));
  ok('new assembly reads repo folders', /collectTakenAssemblyNames/.test(app) && /takenAssemblyNames\(/.test(app));
  ok('import allocates', /assemblyNameForImport\(/.test(app));
  ok('rename allocates or blocks', /resolveAssemblyFolderName\(/.test(app)
    && /An assembly with that name already exists/.test(app));
  ok('duplicate allocates', /function planDuplicateAssembly[\s\S]{0,700}nextAssemblyName\(/.test(commit));
  ok('plus menu creates an assembly', /data-part-add-action="assembly"[\s\S]{0,240}requestAssemblyAction\('new'\)/.test(feed));
  ok('folder menu opens or imports', /data-part-open-action="assembly"[\s\S]{0,240}requestAssemblyAction\('existing'\)/.test(feed)
    && /onLoadFile=\{handleLoadAssembly\}/.test(app));
  ok('vault open does not allocate a name', !/function openVaultAssembly[\s\S]{0,1200}nextAssemblyName\(/.test(read('src/utils/git/gitWorkspace.js')));
}

console.log('\nassembly autonumber — 390px list');
{
  const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
  mkdirSync(shotDir, { recursive: true });
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', process.env.CHROME_PATH]
    .find((p) => p && existsSync(p));
  ok('chrome available for the assemblies list shot', !!chrome);
  if (chrome) {
    const css = await postcss([
      tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
      autoprefixer(),
    ]).process(read('src/index.css'), { from: join(ROOT, 'src/index.css') });
    const pageBundle = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
import PartFeed from './src/components/PartFeed.jsx';
const names = ['Assembly', 'Assembly (1)', 'Assembly (2)'];
createRoot(document.getElementById('root')).render(
  <div style={{ width: '390px', height: '844px', background: '#1e1e1e' }}>
    <PartFeed
      placement="mobile"
      source="git"
      assemblyName="Assembly (1)"
      currentBranch="main"
      rows={[{ id: 'assemblies/Assembly (1)/Part (1).js', name: 'Part (1)', visible: true, order: 0 }]}
      activeId="assemblies/Assembly (1)/Part (1).js"
      onListVaultAssemblies={() => Promise.resolve(names)}
    />
  </div>
);`,
        resolveDir: ROOT,
        loader: 'jsx',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'error',
    });
    const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css.css}</style></head>
<body style="margin:0;background:#1e1e1e;color-scheme:dark"><div id="root"></div><script>${pageBundle.outputFiles[0].text}</script></body></html>`;
    const browser = await chromium.launch({
      executablePath: chrome,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
attachConsentPresetToBrowser(browser);
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
      });
      await page.setContent(html, { waitUntil: 'load' });
      await page.click('[data-assembly-load]');
      await page.click('[data-part-open-action="assembly"]');
      await page.waitForSelector('[data-git-open-item="Assembly (2)"]');
      const text = await page.locator('[data-git-open-assemblies]').innerText();
      ok('list shows Assembly (1) and Assembly (2)', text.includes('Assembly (1)') && text.includes('Assembly (2)'));
      const ribbon = await page.locator('[data-assembly-name]').first().innerText();
      ok('ribbon shows Assembly (1)', ribbon.includes('Assembly (1)'));
      const shot = join(shotDir, 'assembly-autonumber-390.png');
      await page.screenshot({ path: shot });
      ok('shot is 390px wide', (await page.viewportSize()).width === 390);
      ok('shot stays out of artifacts', !shot.includes('/opt/cursor/artifacts') && existsSync(shot));
      console.log(`  shot ${shot}`);
    } finally {
      await browser.close();
    }
  }
}

console.log('\nassembly rename — 390px spinner and post-rename row');
{
  const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
  mkdirSync(shotDir, { recursive: true });
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', process.env.CHROME_PATH]
    .find((p) => p && existsSync(p));
  ok('chrome available for the rename row shots', !!chrome);
  if (chrome) {
    const css = await postcss([
      tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
      autoprefixer(),
    ]).process(read('src/index.css'), { from: join(ROOT, 'src/index.css') });
    const pageBundle = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
import PartFeed from './src/components/PartFeed.jsx';
const shot = window.__RENAME_SHOT || 'spinner';
const pending = shot === 'spinner';
const dirty = shot === 'dot';
const path = 'assemblies/Transmission/Bracket.js';
createRoot(document.getElementById('root')).render(
  <div style={{ width: '390px', height: '844px', background: '#1e1e1e' }} data-rename-shot={shot}>
    <PartFeed
      placement="mobile"
      source="git"
      assemblyName="Transmission"
      currentBranch="main"
      sourceDirty={dirty}
      canCommit={dirty}
      rows={[{ id: path, name: 'Bracket', visible: true, order: 0, pending, dirty }]}
      activeId={path}
    />
  </div>
);`,
        resolveDir: ROOT,
        loader: 'jsx',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'error',
    });
    const htmlFor = (shot) => `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css.css}</style></head>
<body style="margin:0;background:#1e1e1e;color-scheme:dark"><div id="root"></div>
<script>window.__RENAME_SHOT=${JSON.stringify(shot)}</script>
<script>${pageBundle.outputFiles[0].text}</script></body></html>`;
    const browser = await chromium.launch({
      executablePath: chrome,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
attachConsentPresetToBrowser(browser);
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
      });
      await page.setContent(htmlFor('spinner'), { waitUntil: 'load' });
      await page.waitForSelector('[data-part-pending-spinner]');
      const spinning = await page.locator('[data-assembly-name]').first().innerText();
      ok('spinner shot shows the new assembly name', spinning.includes('Transmission'));
      ok('row spinner is the create spinner', await page.locator('[data-part-pending-spinner]').count() === 1);
      const spinShot = join(shotDir, 'assembly-rename-spinner-390.png');
      await page.screenshot({ path: spinShot });
      ok('spinner shot is 390px and stays out of artifacts',
        (await page.viewportSize()).width === 390 && !spinShot.includes('/opt/cursor/artifacts') && existsSync(spinShot));
      console.log(`  shot ${spinShot}`);

      await page.setContent(htmlFor('clean'), { waitUntil: 'load' });
      await page.waitForSelector('[data-part-save]');
      const renamed = await page.locator('[data-assembly-name]').first().innerText();
      ok('post-rename shot shows Transmission', renamed.includes('Transmission'));
      ok('post-rename row is not spinning', await page.locator('[data-part-pending-spinner]').count() === 0);
      ok('post-rename row has no unsynced dot', await page.locator('span[data-part-dirty]').count() === 0);
      const cleanShot = join(shotDir, 'assembly-rename-clean-390.png');
      await page.screenshot({ path: cleanShot });
      ok('clean shot is 390px and stays out of artifacts',
        (await page.viewportSize()).width === 390 && !cleanShot.includes('/opt/cursor/artifacts') && existsSync(cleanShot));
      console.log(`  shot ${cleanShot}`);
    } finally {
      await browser.close();
    }
  }
}

if (failed) {
  console.log(`\nassembly autonumber: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nassembly autonumber: ${passed} passed`);
