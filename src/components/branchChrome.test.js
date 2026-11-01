/**
 * Branches pane: Merge sits on the current non-default row and is hidden
 * when main is current. The switch dialog is one popup with the three choices.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';

const { default: BranchPaneList } = await importJsx(new URL('./BranchPaneList.jsx', import.meta.url));
const { default: BranchSwitchConflictChoices } = await importJsx(
  new URL('./BranchSwitchConflictChoices.jsx', import.meta.url),
);

const COPY = 'There is a conflict between your local files and files in the repository on the branch you are switching to. What would you like to do?';

function rowWrap(html, name) {
  const marker = `data-git-branch-row-wrap="${name}"`;
  const at = html.indexOf(marker);
  assert.ok(at >= 0, marker);
  const end = html.indexOf('data-git-branch-row-wrap=', at + marker.length);
  return html.slice(at, end === -1 ? undefined : end);
}

function tagWith(html, attr) {
  const at = html.indexOf(attr);
  assert.ok(at >= 0, attr);
  const start = html.lastIndexOf('<', at);
  const end = html.indexOf('>', at);
  return html.slice(start, end + 1);
}

test('Merge is on the current non-default row and hidden when main is current', () => {
  const items = [
    { name: 'main', current: false },
    { name: 'flange-draft-test-d', current: true },
  ];
  const html = renderToStaticMarkup(React.createElement(BranchPaneList, {
    items,
    currentBranch: 'flange-draft-test-d',
    defaultBranch: 'main',
  }));
  assert.equal(html.includes('data-git-branch-pane-toolbar'), false);
  const feature = rowWrap(html, 'flange-draft-test-d');
  assert.match(feature, /data-git-branch-merge=""/);
  assert.match(feature, /data-git-branch-action="merge"/);
  assert.match(feature, /data-git-branch-marker=""/);
  assert.match(feature, /lucide-git-merge/);
  assert.match(feature, />Merge</);
  assert.match(feature, /min-w-0 flex-1 truncate/);
  const marker = tagWith(feature, 'data-git-branch-marker=""');
  const merge = tagWith(feature, 'data-git-branch-merge=""');
  assert.match(marker, /shrink-0/);
  assert.match(merge, /shrink-0/);
  assert.match(merge, /min-h-\[44px\]/);
  const main = rowWrap(html, 'main');
  assert.equal(main.includes('data-git-branch-merge'), false);

  const onMain = renderToStaticMarkup(React.createElement(BranchPaneList, {
    items: [
      { name: 'main', current: true },
      { name: 'flange-draft-test-d', current: false },
    ],
    currentBranch: 'main',
    defaultBranch: 'main',
  }));
  assert.equal(onMain.includes('data-git-branch-merge'), false);
  assert.match(rowWrap(onMain, 'main'), /data-git-branch-marker=""/);
});

test('branch-switch choices are one popup in order, Use remote danger', () => {
  const html = renderToStaticMarkup(React.createElement(BranchSwitchConflictChoices, {}));
  assert.equal((html.match(/data-git-branch-switch-popup/g) || []).length, 1);
  assert.match(html, new RegExp(COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const goBack = html.indexOf('>Go back<');
  const useLocal = html.indexOf('>Use local<');
  const useRemote = html.indexOf('>Use remote<');
  assert.ok(goBack >= 0 && useLocal > goBack && useRemote > useLocal);
  assert.match(tagWith(html, 'data-git-branch-switch-use-remote=""'), /surface-danger/);
  assert.equal(html.includes('Save mine to a new branch'), false);
  assert.equal(html.includes('Stay on branch'), false);
  assert.equal(html.includes('Get latest'), false);
  assert.equal(html.includes('Dismiss'), false);
});
