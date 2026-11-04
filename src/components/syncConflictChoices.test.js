import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';

const { default: SyncConflictChoices } = await importJsx(new URL('./SyncConflictChoices.jsx', import.meta.url));

/**
 * The outbox-hold popup ("Conflict with main", shown when an assembly opens
 * with local changes queued and a remote that moved) offers Go back, Keep
 * mine and Get remote on one row. Open on GitHub is gone.
 */

const tagWith = (html, attr) => {
  const at = html.indexOf(attr);
  assert.ok(at >= 0, `${attr} rendered`);
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1);
};

test('three choices in order on one row: Go back, Keep mine (danger), Get remote', () => {
  const html = renderToStaticMarkup(React.createElement(SyncConflictChoices, {}));
  assert.equal((html.match(/data-git-conflict-choices/g) || []).length, 1);
  assert.match(html, /flex flex-nowrap justify-end gap-2/);
  const goBack = html.indexOf('>Go back<');
  const keepMine = html.indexOf('>Keep mine<');
  const getRemote = html.indexOf('>Get remote<');
  assert.ok(goBack >= 0 && keepMine > goBack && getRemote > keepMine, html);
  assert.match(tagWith(html, 'data-git-conflict-overwrite=""'), /surface-danger/);
  assert.match(tagWith(html, 'data-git-conflict-overwrite=""'), /data-ui-action="data-git-conflict-overwrite"/);
  assert.match(tagWith(html, 'data-git-conflict-overwrite=""'), /data-git-force-merge=""/);
  assert.match(tagWith(html, 'data-git-conflict-get-remote=""'), /surface-quiet/);
  assert.match(tagWith(html, 'data-git-conflict-get-remote=""'), /data-ui-action="data-git-conflict-get-remote"/);
  assert.match(tagWith(html, 'data-git-conflict-stay=""'), /data-git-keep-branch=""/);
  for (const tag of [tagWith(html, 'data-git-conflict-stay=""'), tagWith(html, 'data-git-conflict-overwrite=""'), tagWith(html, 'data-git-conflict-get-remote=""')]) {
    assert.match(tag, /whitespace-nowrap/);
  }
  assert.equal(html.includes('Open on GitHub'), false);
  assert.equal(html.includes('Stay on branch'), false);
  assert.equal(html.includes('Overwrite main'), false);
});

test('busy disables all three and each button calls its handler', () => {
  const busy = renderToStaticMarkup(React.createElement(SyncConflictChoices, { busy: true }));
  assert.equal((busy.match(/disabled=""/g) || []).length, 3);
  const calls = [];
  const el = React.createElement(SyncConflictChoices, {
    onGoBack: () => calls.push('back'),
    onKeepMine: () => calls.push('keep'),
    onGetRemote: () => calls.push('remote'),
  });
  // Click handlers are plain callbacks: invoke them through the element's props tree.
  const buttons = SyncConflictChoices(el.props).props.children;
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, ['back', 'keep', 'remote']);
});

test('PartFeed mounts the choices on the ask-force stage and keeps the force-merge wiring', () => {
  const feed = readFileSync(new URL('./PartFeed.jsx', import.meta.url), 'utf8');
  assert.match(feed, /import SyncConflictChoices from '\.\/SyncConflictChoices'/);
  assert.match(feed, /<SyncConflictChoices[\s\S]*?onGoBack=\{closeCommit\}[\s\S]*?onKeepMine=\{runForceMerge\}[\s\S]*?onGetRemote=\{runTakeRemote\}/);
  assert.match(feed, /const runTakeRemote = async/);
  assert.match(feed, /onTakeRemote\?\.\(\)/);
  assert.equal(feed.includes('openConflictOnGithub'), false);
  assert.equal(feed.includes('Open on GitHub'), false);
  assert.equal(feed.includes('Stay on branch'), false);
  assert.equal(feed.includes('Overwrite main'), false);
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /onTakeRemote=\{handleTakeRemote\}/);
  assert.match(app, /const handleTakeRemote = async/);
  assert.match(app, /store\.drop\(op\.id\)/);
  assert.match(app, /handleSwitchBranch\(branch, \{ choice: 'use_remote', reload: true \}\)/);
});
