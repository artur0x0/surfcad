import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * iOS Safari tints its status bar and toolbar from the page's top rows and
 * keeps that sample after a layer closes. These pin the things that keep
 * that sample steady: the scrim's box and its blur stay out of the
 * safe-area bands, html and body share the viewport ground, no header pane
 * writes a background or theme onto html/body, and no full-viewport wash
 * uses a flat black instead of the shared scrim.
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

test('surface-scrim paints nothing and blurs nothing; the dim and the blur fill a ::before', () => {
  const scrim = block('  .surface-scrim');
  assert.match(scrim, /background-color: transparent;/);
  assert.match(scrim, /--scrim-dim: rgb\(0 0 0 \/ 0\.45\);/);
  assert.match(scrim, /isolation: isolate;/);
  assert.match(scrim, /-webkit-backdrop-filter: none;/);
  assert.match(scrim, /backdrop-filter: none;/);
  assert.doesNotMatch(CSS, /\.surface-glass,\s*\n\s*\.surface-glass-chip,\s*\n\s*\.surface-scrim \{/);
  const before = block('  .surface-scrim::before');
  assert.match(before, /position: absolute;/);
  assert.match(before, /top: 0;/);
  assert.match(before, /bottom: 0;/);
  assert.match(before, /z-index: -1;/);
  assert.match(before, /background-color: var\(--scrim-dim\);/);
  assert.match(before, /backdrop-filter: blur\(var\(--surface-blur, 4px\)\) saturate\(140%\);/);
  assert.match(before, /pointer-events: none;/);
});

test('the scrim box stays out of the safe-area bands, and modal-fit insets its own box', () => {
  const inset = block('.surface-scrim:not(.modal-fit)');
  assert.match(inset, /top: var\(--safe-area-top\);/);
  assert.match(inset, /bottom: var\(--safe-area-bottom\);/);
  const child = block('.modal-fit > .surface-scrim');
  assert.match(child, /top: 0;/);
  assert.match(child, /bottom: 0;/);
  const fit = block('.modal-fit');
  assert.match(fit, /top: calc\(var\(--modal-vv-top, 0px\) \+ var\(--safe-area-top\)\);/);
  assert.match(fit, /height: calc\(min\(100dvh, var\(--modal-vvh, 100dvh\)\) - var\(--safe-area-top\) - var\(--safe-area-bottom\)\);/);
  assert.match(fit, /padding-top: var\(--modal-margin\);/);
  assert.match(fit, /padding-bottom: var\(--modal-margin\);/);
  assert.doesNotMatch(fit, /env\(safe-area-inset-/);
});

test('the no-backdrop-filter fallback deepens the dim through the same token', () => {
  const idx = CSS.indexOf('@supports not (backdrop-filter: blur(1px))');
  assert.notEqual(idx, -1);
  const fallback = CSS.slice(idx, CSS.indexOf('\n}\n', idx));
  assert.match(fallback, /\.surface-scrim \{\s*--scrim-dim: rgb\(0 0 0 \/ 0\.7\);/);
  assert.doesNotMatch(fallback, /\.surface-scrim \{\s*background-color/);
});

test('html and body share the viewport ground, and the splash sets both', () => {
  assert.match(CSS, /html,\nbody \{\n {2}background: rgb\(var\(--chrome-background\)\);/);
  // Every html rule that sets a background also names body in the same selector list.
  const htmlBackgrounds = CSS.match(/html[^{]*\{[^}]*background[^}]*\}/g) || [];
  assert.ok(htmlBackgrounds.length > 0);
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
  // Callers keep the full-viewport utility. The unlayered rule pulls the box
  // out of the bands; the class is what makes that rule apply.
  for (const rel of ['components/AboutModal.jsx', 'components/AgentBridgePairingDialog.jsx']) {
    const src = readFileSync(join(dir, rel), 'utf8');
    assert.match(src, /fixed inset-0[^"]*surface-scrim/, rel);
  }
});

function sourceFiles(root) {
  const out = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, name.name);
    if (name.isDirectory()) {
      if (name.name === 'fea') continue;
      out.push(...sourceFiles(path));
    } else if (/\.jsx?$/.test(name.name) && !/\.test\./.test(name.name)) {
      out.push(path);
    }
  }
  return out;
}

test('a full-viewport wash uses surface-scrim, not a flat black layer', () => {
  const offenders = [];
  for (const path of sourceFiles(dir)) {
    const src = readFileSync(path, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('inset-0') && /bg-black\/\d/.test(line)) {
        offenders.push(`${path}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
  for (const rel of [
    'components/CartSheet.jsx',
    'components/checkout/CheckoutPage.jsx',
    'components/AssemblyOpenSpinner.jsx',
  ]) {
    const src = readFileSync(join(dir, rel), 'utf8');
    assert.match(src, /inset-0[^"]*surface-scrim/, rel);
  }
});
