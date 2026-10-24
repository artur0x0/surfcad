import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * iOS Safari tints its status bar and toolbar from the page's top rows and
 * keeps that sample after a layer closes. These pin the two things that
 * keep that sample steady: the modal scrim never dims the safe-area band,
 * and no header pane writes a background or theme onto html/body.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(dir, 'index.css'), 'utf8');
const HTML = readFileSync(join(dir, '../index.html'), 'utf8');

/** The rule whose selector list is exactly `selector`: the line before it does not end in a comma. */
function block(selector) {
  const lines = CSS.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== `${selector} {`) continue;
    const prev = (lines[i - 1] || '').trimEnd();
    if (prev.endsWith(',')) continue;
    const rest = lines.slice(i).join('\n');
    return rest.slice(0, rest.indexOf('}'));
  }
  assert.fail(`${selector} rule missing`);
}

test('safe-area insets are tokens on :root that goldens can override', () => {
  const root = block(':root');
  assert.match(root, /--safe-area-top: env\(safe-area-inset-top, 0px\);/);
  assert.match(root, /--safe-area-bottom: env\(safe-area-inset-bottom, 0px\);/);
});

test('surface-scrim paints nothing itself; the dim is a ::before clear of the safe areas', () => {
  const scrim = block('  .surface-scrim');
  assert.match(scrim, /background-color: transparent;/);
  assert.match(scrim, /--scrim-dim: rgb\(0 0 0 \/ 0\.45\);/);
  assert.match(scrim, /isolation: isolate;/);
  const before = block('  .surface-scrim::before');
  assert.match(before, /position: absolute;/);
  assert.match(before, /top: var\(--safe-area-top\);/);
  assert.match(before, /bottom: var\(--safe-area-bottom\);/);
  assert.match(before, /z-index: -1;/);
  assert.match(before, /background-color: var\(--scrim-dim\);/);
  assert.match(before, /pointer-events: none;/);
});

test('the no-backdrop-filter fallback deepens the dim through the same token', () => {
  const idx = CSS.indexOf('@supports not (backdrop-filter: blur(1px))');
  assert.notEqual(idx, -1);
  const fallback = CSS.slice(idx, CSS.indexOf('\n}\n', idx));
  assert.match(fallback, /\.surface-scrim \{\s*--scrim-dim: rgb\(0 0 0 \/ 0\.7\);/);
  assert.doesNotMatch(fallback, /\.surface-scrim \{\s*background-color/);
});

test('html carries no background of its own: body owns --chrome-background and the splash sets both', () => {
  assert.match(block('body'), /background: rgb\(var\(--chrome-background\)\);/);
  // Every html rule that sets a background also names body in the same selector list.
  const htmlBackgrounds = CSS.match(/html[^{]*\{[^}]*background[^}]*\}/g) || [];
  for (const rule of htmlBackgrounds) {
    const selectors = rule.slice(0, rule.indexOf('{'));
    assert.match(selectors, /body/, `html background without body: ${selectors.trim()}`);
  }
  assert.doesNotMatch(CSS, /^html \{[^}]*background/m);
  // The splash tokens in index.html are the ones index.css declares.
  assert.match(HTML, /--brand-paper: 250 250 249; --brand-navy: 15 23 42;/);
  assert.match(block(':root'), /--brand-paper: 250 250 249;/);
  assert.match(block(':root'), /--brand-navy: 15 23 42;/);
});

test('the header panes do not write a background or theme onto html or body', () => {
  const panes = [
    'components/AboutModal.jsx',
    'components/AgentBridgePairingDialog.jsx',
    'components/AgentBridgePairing.jsx',
    'components/ProfileChip.jsx',
    'components/ProfilePanel.jsx',
    'components/AccountPane.jsx',
  ];
  for (const rel of panes) {
    const src = readFileSync(join(dir, rel), 'utf8');
    assert.doesNotMatch(src, /document\.body\.style|documentElement\.style/, rel);
    assert.doesNotMatch(src, /data-loading-theme|theme-color/, rel);
    assert.doesNotMatch(src, /body\.classList|documentElement\.classList/, rel);
  }
  // The scrim callers keep the full-viewport box; the inset is the ::before's job.
  for (const rel of ['components/AboutModal.jsx', 'components/AgentBridgePairingDialog.jsx']) {
    const src = readFileSync(join(dir, rel), 'utf8');
    assert.match(src, /fixed inset-0[^"]*surface-scrim/, rel);
  }
});
