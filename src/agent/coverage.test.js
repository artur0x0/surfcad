import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowlistIds,
  collectUiActionLiteralsFromComponents,
  coveredActionIds,
  helperPaletteIds,
  referencedActionIds,
  validateAgentCoverage,
} from './coverage.js';

test('coverage:agent', async () => {
  const helperIds = helperPaletteIds();
  const literals = await collectUiActionLiteralsFromComponents();
  const covered = coveredActionIds();
  const allowlisted = allowlistIds();
  const referenced = referencedActionIds({ helperIds, literals });

  const result = validateAgentCoverage({
    helperIds,
    literals,
    covered,
    allowlisted,
    referenced,
  });

  if (!result.ok) {
    assert.fail(result.errors.join('\n'));
  }

  assert.ok(covered.has('data-cad-run'), 'run command uiEntry is tagged on the toolbar');
  assert.equal(allowlisted.includes('data-cad-run'), false, 'covered ids must not stay on the allowlist');
});
