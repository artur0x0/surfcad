#!/usr/bin/env node
/**
 * G13: slim vault create modal (name + Save/Cancel) and conflict popup
 * (Stay on branch / Open on GitHub / Overwrite main) — no toast for that flow.
 */
import { readFileSync } from 'node:fs';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const behindToast = readFileSync(new URL('../../src/components/GitBehindToast.jsx', import.meta.url), 'utf8');
const arch = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8');

console.log('git G13 — slim vault create + conflict popup');

ok('vault create modal title + markers', /Create repo/.test(feed)
  && /data-git-vault-create/.test(feed) && /data-git-vault-name/.test(feed)
  && /data-git-vault-save/.test(feed));
ok('Save + Cancel only (no plan/shared/switch)', /data-git-move-confirm/.test(feed)
  && /data-git-dialog-cancel/.test(feed)
  && !/data-git-move-plan/.test(feed) && !/data-git-move-shared=/.test(feed)
  && !/data-git-move-switch-only/.test(feed) && !/Switch only/.test(feed)
  && !/data-git-move-assembly-path/.test(feed));
ok('seeds without Shared checkboxes', /sharedIds: \[\]/.test(feed));

ok('conflict is a popup not toast', /data-git-conflict-popup/.test(feed)
  && /data-git-force-merge-ask/.test(feed)
  && !/data-git-conflict-toast/.test(feed));
ok('Stay on branch', /data-git-conflict-stay/.test(feed) && /Stay on branch/.test(feed)
  && /data-git-keep-branch/.test(feed) && !/Keep on branch/.test(feed));
ok('Open on GitHub', /data-git-conflict-open-github/.test(feed) && /Open on GitHub/.test(feed)
  && /openConflictOnGithub/.test(feed) && /onMergeBranch\?\.\(\{ head/.test(feed));
ok('Overwrite main keeps force-merge wiring', /data-git-conflict-overwrite/.test(feed)
  && /Overwrite main/.test(feed) && /data-git-force-merge=""/.test(feed)
  && /data-git-force-merge-warning/.test(feed) && /runForceMerge/.test(feed)
  && !/>Force merge</.test(feed));
ok('Overwrite main force-writes', /data-git-conflict-warning/.test(feed)
  && /onOverwriteMain/.test(feed)
  && /runForceMerge/.test(feed)
  && !/Sync will not overwrite the remote repo/.test(feed)
  && /handleOverwriteMain/.test(app)
  && /force:\s*true/.test(app)
  && /syncHold/.test(feed));
ok('G4 behind toast unchanged (separate flow)', /data-git-behind-toast/.test(behindToast)
  && /GitBehindToast/.test(app)
  && /data-git-behind-reload/.test(feed)
  && !/data-git-behind-toast/.test(feed));

ok('light vocab: Repo label, + Part|Assembly create; folder open', /htmlFor="git-move-vault-name"[\s\S]{0,80}Repo/.test(feed)
  && /data-part-add-action="part"/.test(feed)
  && /data-part-add-action="assembly"/.test(feed)
  && /data-part-open-action="part"/.test(feed)
  && /data-part-open-action="assembly"/.test(feed)
  && /title="New part or assembly"/.test(feed));

ok('architecture documents G13', /G13/.test(arch)
  && /Create repo|Create vault|repo create|vault create|slim/i.test(arch)
  && /Stay on branch|Overwrite main|Open on GitHub/.test(arch));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
