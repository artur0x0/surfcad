/**
 * Agent create_part can leave bare local ids; assembly save must repair and validate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAssemblyVaultPaths } from '../src/utils/git/partVaultPath.js';
import { validateSurfJson, stringifySurfJson } from '../src/utils/git/surfJson.js';
import { mintSurfId, withSurfId } from '../src/utils/git/surfId.js';

test('three create_part-style local ids then save produce valid .surf.json', () => {
  const names = ['Kettle Body', 'Kettle Lid', 'Kettle Handle'];
  const localIds = ['local-body', 'local-lid', 'local-handle'];
  const doc = {
    source: 'git',
    name: 'Kettle',
    activeId: localIds[0],
    parts: [],
  };
  const scripts = {};
  for (let i = 0; i < names.length; i += 1) {
    const surfId = mintSurfId();
    scripts[localIds[i]] = withSurfId(`// ${names[i]}\n`, surfId);
    doc.parts.push({
      id: localIds[i],
      name: names[i],
      visible: true,
      order: i,
      surfId,
      isSynced: false,
    });
  }
  const { doc: repaired, moved } = ensureAssemblyVaultPaths(doc, scripts);
  assert.equal(moved.length, 3);
  assert.deepEqual(repaired.parts.map((part) => part.id), localIds);
  const raw = JSON.parse(stringifySurfJson(repaired));
  const check = validateSurfJson(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  assert.equal(raw.parts.length, 3);
  for (const row of raw.parts) {
    assert.ok(row.path.startsWith('assemblies/Kettle/'));
    assert.ok(row.path.endsWith('.js'));
  }
});
