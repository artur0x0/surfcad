import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCargoTreeLine } from '../scripts/ci/generate-third-party-notices.mjs';

const notices = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/THIRD_PARTY_NOTICES.txt'), 'utf8');

test('the shipped notice names MPL sources and does not defer to LICENSES.md', () => {
  assert.match(notices, /8118f810478e0e65a7bf2d8cecdc5e203a876e97/);
  assert.match(notices, /https:\/\/github\.com\/wildmeshing\/fTetWild/);
  assert.match(notices, /40e7900ccbd767f1f360e0eb10f0f1a6432e0993/);
  assert.match(notices, /https:\/\/github\.com\/libigl\/libigl/);
  assert.match(notices, /3147391d946bb4b6c68edd901f2add6ac1f31f8c/);
  assert.match(notices, /https:\/\/gitlab\.com\/libeigen\/eigen/);
  assert.match(notices, /scripts\/fea\/overlay\/Rational\.h/);
  assert.match(notices, /scripts\/fea\/overlay\/Logger\.cpp/);
  assert.match(notices, /scripts\/fea\/build-mesh-wasm\.mjs/);
  assert.match(notices, /is not part of the production build/);
  assert.doesNotMatch(notices, /licences are listed in packages\/surfcad-mesh\/LICENSES\.md/);
});

test('cargo tree lines stay parseable when colour wraps the duplicate marker', () => {
  const coloured = 'dyn-stack v0.13.2 \u001b[33m\u001b[2m(*)\u001b[39m\u001b[22m';
  assert.deepEqual(parseCargoTreeLine(coloured), { name: 'dyn-stack', version: '0.13.2' });
  assert.deepEqual(parseCargoTreeLine('faer v0.24.0 (*)'), { name: 'faer', version: '0.24.0' });
  assert.equal(parseCargoTreeLine(' Downloading crates ...'), null);
});

test('jszip is elected under MIT', () => {
  assert.match(notices, /jszip is used under the MIT licence, elected from \(MIT OR GPL-3\.0-or-later\)/);
  assert.match(notices, /three-3mf-exporter/);
  assert.match(notices, /Shipped under: MIT \(elected\)/);
  assert.doesNotMatch(notices, /GNU GENERAL PUBLIC LICENSE/);
});

test('the STEP reader notice names OCCT, the LGPL, the exception, and where the source is', () => {
  assert.match(notices, /This software makes use of Open CASCADE Technology/);
  assert.match(notices, /https:\/\/github\.com\/Open-Cascade-SAS\/OCCT/);
  assert.match(notices, /Pinned tag: V8_0_1/);
  assert.match(notices, /b8f597c677811d1f9f4d8a97f5ae2825c0353a42/);
  assert.match(notices, /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1, February 1999/);
  assert.match(notices, /Open CASCADE exception \(version 1\.0\) to GNU LGPL version 2\.1/);
  assert.match(notices, /packages\/surfcad-step\/src\/api\.cpp/);
  assert.match(notices, /packages\/surfcad-step\/CMakeLists\.txt/);
  assert.match(notices, /scripts\/step\/build-step-wasm\.mjs/);
  assert.match(notices, /Using a modified build/);
  assert.match(notices, /Compiled without modification/);
  // Third-party code that ships inside OCCT keeps its own notice.
  assert.match(notices, /DELABELLA - Delaunay triangulation library/);
  assert.match(notices, /The author of this software is David M\. Gay/);
  assert.match(notices, /Copyright \(c\) 2001-2004 Unicode, Inc\./);
  assert.match(notices, /Copyright \(c\) 1993 The Regents of the University of California/);
  assert.match(notices, /As a special exception, you may create a larger work that contains/);
});

test('the notice pin is the pin the STEP build script fetches', async () => {
  const { OCCT_PIN } = await import('../scripts/step/build-step-wasm.mjs');
  assert.ok(notices.includes(`Pinned commit: ${OCCT_PIN.commit}`));
  assert.ok(notices.includes(`Pin: ${OCCT_PIN.tag} (${OCCT_PIN.commit})`));
});
