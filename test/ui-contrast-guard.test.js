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

function channelLuminance(value) {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
  const lum = (hex) => (
    0.2126 * channelLuminance((hex >> 16) & 255)
    + 0.7152 * channelLuminance((hex >> 8) & 255)
    + 0.0722 * channelLuminance(hex & 255)
  );
  const a = lum(foreground);
  const b = lum(background);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

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

test('Allow success surfaces meet WCAG against chrome text', () => {
  const text = 0xf3f4f6; // --chrome-text / text-on-dark
  assert.ok(contrastRatio(text, 0x047857) >= 4.5, 'surface-success rest');
  assert.ok(contrastRatio(text, 0x059669) >= 3, 'surface-success hover');
  assert.ok(contrastRatio(text, 0x10b981) < 3, 'emerald-500 hover is the failing rest state');
});

test('lint scan of src includes the pairing Allow/Deny popup and has no hits', () => {
  const files = collectScanFiles(ROOT).map((f) => f.split('\\').join('/'));
  assert.equal(files.some((f) => f.endsWith('ui-contrast-violation.jsx')), false);
  assert.equal(files.some((f) => f.endsWith('AgentBridgeApprovalPopup.jsx')), true);
  const hits = scanFiles(collectScanFiles(ROOT), ROOT);
  assert.deepEqual(hits, []);
});
