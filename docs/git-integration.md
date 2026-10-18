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
- The `src/fea/sheetMetallica.test.js` timeout is a known flake. Retrigger with an empty commit (rerunning the failed job returns 403).
