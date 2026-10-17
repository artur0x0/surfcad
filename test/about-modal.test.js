import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  commitGithubUrl,
  formatSurfcadBuildTime,
  shortCommitSha,
  surfcadCommitSha,
  surfcadBuildTimeIso,
} from '../src/utils/surfcadBuildInfo.js';
import {
  resolveSurfcadBuildTime,
  resolveSurfcadCommit,
} from '../scripts/vite-surfcad-build-define.mjs';

describe('About build metadata', () => {
  test('shortCommitSha and github url', () => {
    const full = '0b48c08d05c6e2483c81463650a26525fd0481fa';
    assert.equal(shortCommitSha(full), '0b48c08');
    assert.equal(
      commitGithubUrl(full),
      'https://github.com/artur0x0/surfcad/commit/0b48c08d05c6e2483c81463650a26525fd0481fa',
    );
    assert.equal(shortCommitSha('unknown'), 'unknown');
    assert.equal(commitGithubUrl('unknown'), null);
    assert.equal(commitGithubUrl('not-a-sha'), null);
  });

  test('formatSurfcadBuildTime uses medium date and short time', () => {
    const label = formatSurfcadBuildTime('2026-10-17T14:30:00.000Z', {
      locale: 'en-US',
      timeZone: 'UTC',
    });
    assert.match(label, /Oct/);
    assert.match(label, /17/);
    assert.match(label, /2026/);
    assert.equal(formatSurfcadBuildTime('unknown'), 'Unknown');
    assert.equal(formatSurfcadBuildTime('not-a-date'), 'Unknown');
  });

  test('vite define resolver falls back without throwing', () => {
    const prev = process.env.SURFCAD_COMMIT;
    delete process.env.SURFCAD_COMMIT;
    const commit = resolveSurfcadCommit();
    assert.equal(typeof commit, 'string');
    assert.ok(commit.length > 0);
    process.env.SURFCAD_COMMIT = 'abc123def4567890abcdef1234567890abcd';
    assert.equal(resolveSurfcadCommit(), 'abc123def4567890abcdef1234567890abcd');
    process.env.SURFCAD_COMMIT = prev;

    const iso = resolveSurfcadBuildTime();
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(iso));
  });

  test('injected define readers default to unknown in unit tests', () => {
    assert.equal(surfcadCommitSha(), 'unknown');
    assert.equal(surfcadBuildTimeIso(), 'unknown');
  });

  test('Viewport opens About from the header logo', () => {
    const view = readFileSync(new URL('../src/components/Viewport.jsx', import.meta.url), 'utf8');
    const modal = readFileSync(new URL('../src/components/AboutModal.jsx', import.meta.url), 'utf8');
    assert.match(view, /data-brand-about-trigger/);
    assert.match(view, /AboutModal/);
    assert.match(modal, /data-about-modal/);
    assert.match(modal, /data-about-commit-link/);
    assert.match(readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8'), /surfcadBuildDefine/);
  });
});
