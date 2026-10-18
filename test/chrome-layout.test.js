import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('desktop git branch chip lives in the parts list header, not the CAD title', () => {
  const feed = read('src/components/PartFeed.jsx');
  const viewport = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  assert.match(feed, /data-parts-ribbon-branch/);
  assert.match(feed, /placement === 'desktop' && source === 'git'/);
  assert.doesNotMatch(viewport, /data-viewer-git-branch/);
  assert.doesNotMatch(viewport, /cadGitBranch/);
  assert.doesNotMatch(app, /cadGitBranch/);
  assert.doesNotMatch(app, /onCadGitBranchClick/);
});

test('mobile parts ribbon still shows assembly name on branch', () => {
  const feed = read('src/components/PartFeed.jsx');
  assert.match(feed, /ribbonName && placement !== 'desktop'/);
  assert.match(feed, /RibbonAssemblyName/);
  assert.match(feed, /data-assembly-branch=""/);
  assert.match(feed, /onBranchClick=\{source === 'git'/);
});

test('feature ribbon uses one shared height token in every state', () => {
  const css = read('src/index.css');
  const strip = read('src/components/FeatureStrip.jsx');
  const guide = read('docs/ui_style_guide.md');
  assert.match(css, /--feature-strip-height:\s*2\.875rem/);
  assert.match(css, /\.feature-strip-bar\s*\{/);
  assert.match(css, /height:\s*var\(--feature-strip-height\)/);
  assert.match(strip, /feature-strip-bar/);
  assert.match(strip, /feature-strip-chip/);
  assert.doesNotMatch(strip, /\bh-8\b/);
  assert.match(guide, /--feature-strip-height/);
  assert.match(guide, /46px/);
});

test('tool rails sit 10px below the feature ribbon', () => {
  const css = read('src/index.css');
  const rail = read('src/utils/railPair.js');
  const panel = read('src/components/CrossSectionPanel.jsx');
  assert.match(css, /--feature-strip-rail-gap:\s*0\.625rem/);
  assert.match(css, /\.rail-full-below-strip\s*\{/);
  assert.match(css, /\.rail-max-below-strip\s*\{/);
  assert.match(css, /\.rail-right-below-strip\s*\{/);
  assert.match(rail, /RAIL_FULL_LENGTH_CLASS = 'rail-full-below-strip'/);
  assert.match(rail, /RAIL_PAIR_HEIGHT_CLASS = 'rail-max-below-strip'/);
  assert.match(rail, /RAIL_RIGHT_MAX_CLASS = 'rail-right-below-strip'/);
  assert.match(panel, /RAIL_RIGHT_MAX_CLASS/);
});

test('parts-header branch chip is a near-white outlined pill', () => {
  const css = read('src/index.css');
  const feed = read('src/components/PartFeed.jsx');
  const chipFn = feed.slice(
    feed.indexOf('function RibbonBranchButton'),
    feed.indexOf('function RibbonAssemblyName'),
  );
  assert.match(css, /\.parts-branch-chip\s*\{/);
  assert.match(css, /border:\s*1px solid rgb\(var\(--chrome-text\)\)/);
  assert.match(chipFn, /parts-branch-chip/);
  assert.match(chipFn, /text-on-dark/);
  assert.doesNotMatch(chipFn, /text-blue-300/);
});
