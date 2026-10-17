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
