# Git integration: lessons learned

Short rules for anyone changing SurfCAD's git save path. The spec is `docs/git-save-model.md`; this file records the mistakes we've already made so we don't repeat them.

## 1. Stuck "unsaved" dots

We've shipped stale amber dots more than once (most recently #614, fixed in #621). The cause is always the same: dirty state has several baselines (the git baseline, the agent script snapshot and the part-row hashes), and a save path updates only some of them.

- **Every successful commit resets every baseline.** After a `committed` or `branched` Save, refresh the git baseline *and* the agent snapshot in one place (`adoptV2SaveResult`). Don't add a second save path that skips it.
- **Baseline from the committed bytes, not the working copy.** Use `result.files`. An edit typed while a Save is in flight must keep its dot.
- **Compare the way the writer writes.** Save stamps `@surf-id`/`@name` headers. Dirty checks must call the same function (`stampPartScript` / `partScriptMatchesCommitted` in `planSave.js`). Import it; never copy it.
- **Non-commit outcomes touch nothing.** `conflict`, `pending_save`, `save_refused` and failures leave dirty state exactly as it was.
- **Required test** for any change near Save or dirty state: edit, then save, then clean with no dots, then edit, then dirty. Run it for an opened assembly *and* a first commit, plus an edit made during an in-flight save.

## 2. Save is the only writer

- No git writes on load, reload, edit, going online or connecting. `writeVaultCommit` is the only `commitFiles` caller, and the allowlist test enforces it. Don't weaken that test.
- The agent's `git_save` goes through the same `planSave` / `executePlanSave` path as the Save button.

## 3. Fail closed

- `planSave` refuses when inputs are missing, the tip can't be read, or a compare is truncated (GitHub caps at 300 files). Treat truncation as a conflict.
- Get latest reloads every changed file in the assembly. If any read fails, refuse the Save; don't save over what you couldn't read.

## 4. Ids, not paths

- The agent contract takes `part_id` / `assembly_id` only. No path fields in payloads or results.
- Load strips the old `local:` prefix from part ids. Never hard-code ids in goldens; read `parts().activeId` or `list_parts`.
- Destructive agent actions need `confirm: true` (the boolean; the string `"true"` is rejected).

## 5. Tests and goldens

- When updating a golden, keep its exact assertions (for example the commit file count). Loosening a check to make it pass hides bugs.
- An expected-fail check becomes a hard check in the same PR that fixes the bug.
- Git playtests run only against the fake GitHub or a throwaway repo, never a real vault.

## 6. Rebases and CI

- After every rebase, run `npm run lint` and `npm run build` locally before pushing. Duplicate imports from overlapping PRs break the build (#617).
- Verify all 9 `ci.yml` jobs on the exact head SHA; they aren't required checks, so GitHub won't block for you.
- `src/fea/sheetMetallica.test.js` used to time out or trip its tolerance when fTetWild produced a slow or unlucky mesh; since the TET10 side became a committed reference (`src/fea/fixtures/sheetMetallicaReference.json`) the file runs in about a minute. A red there is a real change: rerun the failed job with `gh run rerun <run-id> --failed` only if the log shows a runner problem.

## 7. Every git document carries `vaultLayout`

`handleGitCommit` routes on `isV2PlanSaveDoc(doc)`, which needs `vaultLayout: 'v2'`, and PartFeed enables Save from the same field. A git document without it fell through to the v1 writer: `git_save` on an assembly made with the Parts strip's **+ › Assembly** on a v2 vault landed `assemblies/<Name>/.surf.json` plus `assemblies/<Name>/<Part>.js`, which the v2 reader never lists, and the Save button read "Nothing to save" with every part unsaved (MVP-1 step 1, `golden:assembly-save-child-parts`).

- **Stamp at birth.** Every seed (`handleNewAssembly`, `seedOpenAssembly`, `seedAgentAssembly`) takes its layout from `newAssemblyVaultLayout(source, currentDoc)` in `src/utils/git/docVaultLayout.js`. Do not build a git document without it.
- **Heal the rest from the vault.** A document persisted before the stamp, or a local one that went git on connect, is stamped by `ensureDocVaultLayout` (`detectVaultLayout`; no repo yet is v2) on connect and again before Save. Save fails closed when the vault cannot be read; it never guesses the v1 writer.
- **Test:** make an assembly with + › Assembly, build parts, Save once; the commit is `assemblies/<id>.surf.json` plus `parts/<id>.js` for every part, and the strip is clean.

## 8. Count the round trips

Every adapter method is at least one HTTPS round trip to GitHub (`listTree` is three, `commitFiles` about a dozen), and the callers run them one after another, so wall time is the call count. `src/utils/git/gitTimings.js` counts them: `git_timings` (bridge and MCP) or `window.__SURFCAD_GIT_TIMINGS` after an Open or Save, `window.__SURFCAD_GIT_TIMING = true` for a line per call. `gitTimings.test.js` pins the adapter calls an Open and a one-part Save make on the mock. When you change the open or save path, run it: the number should go down, and the pin moves in the same PR with the reason.

Open reads every part script and every mesh blob in parallel, eight at a time (`mapLimit`, `VAULT_READ_CONCURRENCY` in `src/utils/git/mapLimit.js`; an uncapped burst trips GitHub's secondary rate limit). The tree listing already carries every blob sha, so a mesh cache miss is one `readBlob`, never a second `listTree`; and a 40-hex ref is a sha, so `listTree` does not ask `/branches` first. Open of N parts with M meshes is 3 + N + M adapter calls (was 3 + N + 2M) in about 3 + N/8 + M/8 round-trip-equivalents.

