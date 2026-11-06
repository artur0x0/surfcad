/**
 * Build the STEP reader wasm (Open CASCADE Technology).
 *
 *   node scripts/step/build-step-wasm.mjs
 *   node scripts/step/build-step-wasm.mjs --out-dir pkg-rebuild
 *
 * The module is a separate emscripten build, loaded by URL when a STEP file
 * is imported. OCCT is LGPL-2.1-only with the Open CASCADE exception. Nothing
 * else in the app is linked into this wasm, and the app does not link OCCT
 * anywhere else. The OCCT sources are the upstream tag below with no patches,
 * so the published source for the module is that tag plus
 * packages/surfcad-step. See packages/surfcad-step/LICENSES.md.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EMSDK_VERSION = '6.0.12';
export const OCCT_PIN = {
  url: 'https://github.com/Open-Cascade-SAS/OCCT.git',
  tag: 'V8_0_1',
  commit: 'b8f597c677811d1f9f4d8a97f5ae2825c0353a42',
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stepRoot = resolve(repoRoot, 'packages/surfcad-step');
const depsRoot = resolve(stepRoot, '.deps');
const occtDir = resolve(depsRoot, 'src/OCCT');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    const code = result.status === null ? 1 : result.status;
    throw new Error(`${command} ${args.join(' ')} failed (${code})`);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || '').trim();
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** The OCCT checkout must be the pinned commit with no local edits. */
function ensureOcct() {
  if (!existsSync(resolve(occtDir, '.git'))) {
    rmSync(occtDir, { recursive: true, force: true });
    mkdirSync(dirname(occtDir), { recursive: true });
    run('git', ['clone', '--depth', '1', '--branch', OCCT_PIN.tag, OCCT_PIN.url, occtDir]);
  }
  let head = capture('git', ['-C', occtDir, 'rev-parse', 'HEAD']);
  if (head !== OCCT_PIN.commit) {
    run('git', ['-C', occtDir, 'fetch', '--depth', '1', 'origin', OCCT_PIN.commit]);
    run('git', ['-C', occtDir, 'checkout', '--force', 'FETCH_HEAD']);
    head = capture('git', ['-C', occtDir, 'rev-parse', 'HEAD']);
  }
  if (head !== OCCT_PIN.commit) {
    throw new Error(`OCCT checkout is ${head}, expected ${OCCT_PIN.commit} (${OCCT_PIN.tag})`);
  }
  const dirty = capture('git', ['-C', occtDir, 'status', '--porcelain']);
  if (dirty) {
    throw new Error(`OCCT checkout has local changes; the module must be built from the unmodified tag:\n${dirty}`);
  }
}

function emsdkRoot() {
  if (process.env.EMSDK && existsSync(resolve(process.env.EMSDK, 'emsdk.py'))) {
    return process.env.EMSDK;
  }
  const local = resolve(depsRoot, 'emsdk');
  if (existsSync(resolve(local, 'emsdk.py'))) return local;
  const home = resolve(homedir(), 'emsdk');
  if (existsSync(resolve(home, 'emsdk.py'))) return home;
  return local;
}

function ensureEmsdk() {
  const root = emsdkRoot();
  if (!existsSync(resolve(root, 'emsdk.py'))) {
    mkdirSync(dirname(root), { recursive: true });
    run('git', ['clone', '--depth', '1', '--branch', EMSDK_VERSION, 'https://github.com/emscripten-core/emsdk.git', root]);
  }
  const envScript = resolve(root, 'emsdk_env.sh');
  if (!existsSync(resolve(root, 'upstream/emscripten/emcc'))) {
    run(resolve(root, 'emsdk'), ['install', EMSDK_VERSION], { cwd: root });
    run(resolve(root, 'emsdk'), ['activate', EMSDK_VERSION], { cwd: root });
  }
  if (!existsSync(envScript)) throw new Error(`emsdk env script missing at ${envScript}`);
  const version = readFileSync(resolve(root, 'upstream/emscripten/emscripten-version.txt'), 'utf8').replace(/["\s]/g, '');
  if (version !== EMSDK_VERSION) {
    throw new Error(`emsdk at ${root} is ${version}, expected ${EMSDK_VERSION}`);
  }
  return { root, envScript };
}

/**
 * Only OCCT sources and the wrapper may be compiled, and the link line may
 * only name the OCCT archive. Anything else would put non-OCCT code inside
 * the LGPL module or OCCT code outside it.
 */
function assertOnlyOcct(buildDir) {
  const commandsPath = resolve(buildDir, 'compile_commands.json');
  const entries = JSON.parse(readFileSync(commandsPath, 'utf8'));
  const wrapper = resolve(stepRoot, 'src/api.cpp');
  const occtSrc = `${resolve(occtDir, 'src')}/`;
  let compiled = 0;
  for (const entry of entries) {
    const file = resolve(entry.directory || buildDir, String(entry.file || ''));
    if (file === wrapper) continue;
    if (!file.startsWith(occtSrc)) {
      throw new Error(`compile_commands.json compiles a file outside OCCT and the wrapper: ${file}`);
    }
    compiled += 1;
  }
  if (compiled < 1000) throw new Error(`only ${compiled} OCCT sources were compiled; the toolkit list is broken`);
  for (const path of walk(buildDir).filter((name) => name.endsWith('link.txt') || name.endsWith('linkLibs.rsp'))) {
    const text = readFileSync(path, 'utf8');
    const libs = text.match(/\S+\.(?:a|so|bc)\b/g) || [];
    for (const lib of libs) {
      if (!/(?:^|\/)libocct\.a$/.test(lib)) {
        throw new Error(`${path} links ${lib}; only libocct.a is allowed`);
      }
    }
  }
  return compiled;
}

function hardenGlue(text) {
  // FILESYSTEM=0 still routes iostream writes through fd_write. fd 0 is stored
  // as null and a write crashes the page. Keep a buffer for every fd.
  const from = 'printCharBuffers=[null,[],[]];var printChar=(stream,curr)=>{var buffer=printCharBuffers[stream];';
  const to = 'printCharBuffers=[[],[],[]];var printChar=(stream,curr)=>{var buffer=printCharBuffers[stream]||(printCharBuffers[stream]=[]);';
  if (!text.includes('printCharBuffers')) return text;
  if (!text.includes(from)) throw new Error('patch printChar buffers did not match the emscripten glue');
  return text.replace(from, to);
}

function findArtifact(buildDir, name) {
  const hits = walk(buildDir).filter((path) => path.endsWith(`/${name}`));
  if (hits.length === 0) throw new Error(`missing ${name} under ${buildDir}`);
  hits.sort((a, b) => a.length - b.length);
  return hits[0];
}

function build(buildDir) {
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const { envScript } = ensureEmsdk();
  const prefix = [
    `-ffile-prefix-map=${depsRoot}=/deps`,
    `-ffile-prefix-map=${stepRoot}=/surfcad-step`,
    `-ffile-prefix-map=${repoRoot}=/repo`,
  ].join(' ');
  const cmakeArgs = [
    '-S', stepRoot,
    '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DOCCT_DIR=${occtDir}`,
  ];
  const jobs = Math.max(2, availableParallelism());
  const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };
  delete env.CCACHE_DIR;
  const command = [
    'set -euo pipefail',
    `source ${JSON.stringify(envScript)}`,
    'export SOURCE_DATE_EPOCH=0',
    `export CFLAGS=${JSON.stringify(prefix)}`,
    `export CXXFLAGS=${JSON.stringify(prefix)}`,
    `emcmake cmake ${cmakeArgs.map((arg) => JSON.stringify(arg)).join(' ')}`,
    `cmake --build ${JSON.stringify(buildDir)} -j${jobs} --target surfcad_step`,
  ].join('\n');
  run('bash', ['-lc', command], { env, cwd: repoRoot });
  return assertOnlyOcct(buildDir);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDirName = argValue('--out-dir') || 'pkg';
  if (outDirName.includes('/') || outDirName.includes('\\') || outDirName === '.' || outDirName === '..') {
    throw new Error('--out-dir must be a single directory name inside packages/surfcad-step');
  }
  ensureOcct();
  const buildDir = resolve(stepRoot, 'build-wasm');
  const compiled = build(buildDir);

  const outDir = resolve(stepRoot, outDirName);
  mkdirSync(outDir, { recursive: true });
  for (const name of ['surfcad_step.js', 'surfcad_step.wasm']) {
    cpSync(findArtifact(buildDir, name), resolve(outDir, name));
  }
  const gluePath = resolve(outDir, 'surfcad_step.js');
  writeFileSync(gluePath, hardenGlue(readFileSync(gluePath, 'utf8')));
  const wasm = readFileSync(resolve(outDir, 'surfcad_step.wasm'));
  const gzip = spawnSync('gzip', ['-c', '-n', resolve(outDir, 'surfcad_step.wasm')], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (gzip.status !== 0) throw new Error('gzip failed');
  console.log(`surfcad-step wasm: ${outDir}`);
  console.log(`  OCCT ${OCCT_PIN.tag} (${OCCT_PIN.commit}), ${compiled} sources compiled`);
  console.log(`  surfcad_step.wasm ${wasm.length} bytes, gzip ${gzip.stdout.length} bytes`);
}
