import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOML_PATH = join(ROOT, '.gitleaks.toml');
const GITLEAKS_VERSION = '8.30.1';
const PLANTED_PAT = 'ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII';

function readToml() {
  return readFileSync(TOML_PATH, 'utf8');
}

test('gitleaks allowlist is AND, anchored, and only the consent key', () => {
  const toml = readToml();
  assert.match(toml, /\[\[rules\.allowlists\]\]/);
  assert.match(toml, /condition\s*=\s*"AND"/);
  assert.match(toml, /src\/utils\/consent\\\.js\$/);
  assert.match(toml, /presetConsentInit\\\.mjs\$/);
  assert.match(toml, /surfcad\\\.consent\\\.v1/);
  assert.equal(/consent\\\.test\\\.js/.test(toml), false);
  assert.equal(/CONSENT_STORAGE_KEY/.test(toml.split('regexes')[1] || ''), false);
  assert.match(toml, /consent\.js:9/);
  assert.match(toml, /presetConsentInit\.mjs:7/);
});

async function ensureGitleaks() {
  if (process.env.GITLEAKS_BIN && existsSync(process.env.GITLEAKS_BIN)) {
    return process.env.GITLEAKS_BIN;
  }
  const cached = join(tmpdir(), `gitleaks-${GITLEAKS_VERSION}`);
  if (existsSync(cached)) return cached;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;
  const tar = join(tmpdir(), `gitleaks-${GITLEAKS_VERSION}.tar.gz`);
  const curl = spawnSync('curl', ['-fsSL', '-o', tar, url], { encoding: 'utf8' });
  if (curl.status !== 0) return null;
  const extract = spawnSync('tar', ['-xzf', tar, '-C', tmpdir(), 'gitleaks'], { encoding: 'utf8' });
  if (extract.status !== 0) return null;
  const extracted = join(tmpdir(), 'gitleaks');
  if (!existsSync(extracted)) return null;
  try {
    writeFileSync(cached, readFileSync(extracted));
    chmodSync(cached, 0o755);
  } catch {
    return existsSync(extracted) ? extracted : null;
  }
  return cached;
}

test('a planted GitHub PAT in consent.js still reports', async (t) => {
  const bin = await ensureGitleaks();
  if (!bin) {
    t.skip('gitleaks binary could not be downloaded');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-consent-'));
  try {
    mkdirSync(join(dir, 'src/utils'), { recursive: true });
    mkdirSync(join(dir, 'scripts/golden/lib'), { recursive: true });
    writeFileSync(join(dir, '.gitleaks.toml'), readToml());
    const consent = readFileSync(join(ROOT, 'src/utils/consent.js'), 'utf8');
    writeFileSync(join(dir, 'src/utils/consent.js'), `${consent}\nconst planted = '${PLANTED_PAT}';\n`);
    writeFileSync(
      join(dir, 'scripts/golden/lib/presetConsentInit.mjs'),
      readFileSync(join(ROOT, 'scripts/golden/lib/presetConsentInit.mjs')),
    );
    const report = join(dir, 'report.json');
    const run = spawnSync(bin, [
      'detect',
      '--no-git',
      '--source', dir,
      '--config', join(dir, '.gitleaks.toml'),
      '--report-format', 'json',
      '--report-path', report,
      '--exit-code', '0',
    ], { encoding: 'utf8' });
    assert.equal(run.error, undefined, run.stderr || run.stdout);
    const findings = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8') || '[]') : [];
    const secrets = findings.map((f) => f.Secret || f.Match || '').join('\n');
    assert.match(secrets, /ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII/);
    assert.equal(/surfcad\.consent\.v1/.test(secrets), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
