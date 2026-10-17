import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  findContrastViolations,
  collectScanFiles,
  scanFiles,
} from '../scripts/ci/check-ui-contrast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'scripts/ci/fixtures/ui-contrast-violation.jsx');

test('fixture is caught as dark-on-dark', () => {
  const source = readFileSync(FIXTURE, 'utf8');
  const hits = findContrastViolations(source, 'scripts/ci/fixtures/ui-contrast-violation.jsx');
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].excerpt, /surface-dark/);
  assert.match(hits[0].excerpt, /text-black/);
});

test('light button with black text is not a hit', () => {
  const src = `export const Ok = () => <button className="bg-gray-200 text-black">OK</button>;`;
  assert.deepEqual(findContrastViolations(src), []);
});

test('dark surface with light text is not a hit', () => {
  const src = `export const Ok = () => <div className="surface-panel text-on-dark">Hi</div>;`;
  assert.deepEqual(findContrastViolations(src), []);
});

test('ui-contrast-allow suppresses a true exception', () => {
  const src = `// ui-contrast-allow: screenshot only
const bad = 'surface-dark text-black';`;
  assert.deepEqual(findContrastViolations(src), []);
});

test('known-bad text-chrome-text-secondary typo on chrome surface is a hit', () => {
  const src = `<p className="bg-chrome-surface text-chrome-text-secondary">x</p>`;
  const hits = findContrastViolations(src);
  assert.equal(hits.length, 1);
});

test('lint scan of src does not include the fixture or pairing popup', () => {
  const files = collectScanFiles(ROOT).map((f) => f.split('\\').join('/'));
  assert.equal(files.some((f) => f.endsWith('ui-contrast-violation.jsx')), false);
  assert.equal(files.some((f) => f.endsWith('AgentBridgeApprovalPopup.jsx')), false);
  const hits = scanFiles(collectScanFiles(ROOT), ROOT);
  assert.deepEqual(hits, []);
});
