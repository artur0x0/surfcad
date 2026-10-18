import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSheetAgentHandlers } from './sheetAgentHost.js';

test('sheet_check then sheet_refold sees exportOpen without a React flush', () => {
  const modeRef = { current: { stage: 'edit', draft: null, exportOpen: false } };
  const host = createSheetAgentHandlers({
    modeRef,
    pickerRef: { current: null },
    setMode: () => {},
    setPicker: () => {},
  });
  const check = host.sheetCheck();
  assert.equal(check.result?.check, true);
  assert.equal(modeRef.current.exportOpen, true);
  const refold = host.sheetRefold();
  assert.equal(refold.result?.refold, true);
  assert.equal(modeRef.current.exportOpen, false);
});
