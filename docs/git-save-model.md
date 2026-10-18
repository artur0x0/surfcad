# Git SAVE MODEL

Redesign of how SurfCAD writes the Git vault. On-disk layout stays [`vault-schema.md`](vault-schema.md). This document is the write model: when git is touched, what is compared, and what the agent/MCP team can rely on.

**Standing rules (unchanged):** git writes only on a requested action — never on load, reload, edit, or autosync. Saving is never blocked by unsaved parts (they land at `assemblies/<Assembly>/<name>.js` in that one commit). No periodic auto-save. Destructive git actions need `confirm: true` for agents. Repo delete keeps its confirm.

**#585.** Open hotfix [PR #585](https://github.com/artur0x0/surfcad/pull/585) stops tonight’s implicit writers (paint, group, insert, copy, delete, rename, New Assembly, GitHub connect, `online` flush) and lets `captureBaseline` tolerate path-less rows. After that, a later Save cannot reconstruct “delete this vault file” or “this assembly used to be named X” unless extra per-action flags (`pendingRepoDeletes`, `pendingOldAssemblyName`) are piled on. Those flags are the symptom: the working copy and the last committed tree are not a clean pair, so every action has to remember what Save should do. This redesign replaces that with one persisted last-commit record and one planner.

---

## 1. Problems with the current design

The live model is an **outbox of file snapshots** plus a **baseline captured by re-serializing the working copy**. Many App handlers assign vault paths, enqueue files, and flush. That is why the same classes of bug keep coming back.

### 1.1 Implicit writers (bug class A)

Anything that calls `enqueueAssemblySave` / `enqueueGit` + `flushGitOps` commits and pushes without Save.

| Site | What it writes |
| --- | --- |
| `handleCommitPaint` `src/App.jsx:6570` | Paint → `enqueueAssemblySave` |
| `handleRenameGroup` / `handleUngroup` / `handleCopyGroup` / `handleRemoveGroup` `:4376`–`:4500` | Group ops |
| `handleInsertVaultAssemblyParts` `:4108` | Insert → `prepareAssemblySurfWrite` + flush |
| `handleOpenVaultPart` `:4196` | Open vault part |
| `handleCopyPartToAssembly` `:4275` | Copy |
| `handleDeletePart` `:5583` | Delete + optional file delete |
| `handleRenamePart` `:7378` + `stagePartRename` | Immediate rename commit |
| `handleRenameAssembly` `:7498` | Immediate folder move |
| `window.addEventListener('online')` `:3283` | Flush leftover outbox |
| `collectTakenAssemblyNames` `:3131` | `ensureGitVault()` on New Assembly (creates the repo) |
| GitHub-connect flip `:5269` | `ensureGitVault()` |

`enqueueAssemblySave` (`:4354`) always runs `prepareAssemblySurfWrite` (assigns paths) then `flushGitOps`. #573 stopped load/reload `migrate-layout` / `migrate-ids` commits; it did not stop these. Tonight’s playtest (T18): paint, group, rename, delete, copy, insert, `online`, and New Assembly all hit the vault with no Save.

### 1.2 Paths assigned before Save (bug class B)

`ensureAssemblyVaultPaths` (`src/utils/git/partVaultPath.js:148`) and `prepareAssemblySurfWrite` (`gitCommit.js:102`) mint `assemblies/<Assembly>/<Name>.js` and, for non-stable ids, **replace the row id with the path** (`partVaultPath.js:198`). `readParts` then reports that path (`App.jsx:8575`). Agent T3: `parts[].path` appears while `dirty.unsaved` is true. #555 / #573 / SKILL already say “no path until `git_save`”; the write helpers still assign early.

### 1.3 Baseline is a serialize of the working copy (bug class C)

`captureBaseline` (`gitWorkspace.js:84`) calls `stringifySurfJson` → `toSurfJson` → `validateSurfJson`, which requires `parts[N].path` (`surfJson.js:148`). A path-less working copy throws `Invalid .surf.json: parts[N].path must be a repo-relative path` (T18 toast). Dirty (`isAssemblyDirty`, `:122`) takes the same path. After #585 the throw is patched; the design is still “re-serialize WC to learn what git has.”

### 1.4 Stale-doc write-back (bug class D)

`enqueueAssemblySave(next)` snapshots `next`, then `adoptPreparedSurfWrite` → `rememberAssembly(prepared.doc)` (`App.jsx:4337`). `applyOverwriteFiles` replaces the open document from committed `.surf.json`, including `activeId` (`gitCommit.js:1241`). A later `create_part` / `set_active_part` is overwritten. T17: Frame’s script became the new part’s seed cube; `activeId` and `status.partId` desynced from `selection.cadPartId`.

### 1.5 Save planner cannot see deletes or old names (bug class E)

`buildCommitFiles` (`gitCommit.js:413`) **does not delete** parts removed from the document. Assembly rename only remaps if `baseline.assemblyName !== doc.name`. After #585, local delete/rename leave no outbox, so Save cannot emit the file delete or the folder move unless extra pending flags are stored. That is the design hole.

### 1.6 Many `commitFiles` call sites (bug class F)

`adapter.commitFiles` is used from `flushSyncQueue` (`syncWorker.js:116`), `commitPartToRepo` / `deletePartFromRepo` / `commitWorkspace` / `forceMergeCommit` / `saveLocalOnNewBranch` (`gitCommit.js`), `findOrCreateVault` seed (`vault.js:120`), `moveToGit` (`gitMoveToGit.js:183`), and `checkInMineToBranch` (`gitPull.js:342`). “The worker is the only writer” is not true.

### 1.7 `create_assembly` is not single-flight (bug class G)

`create_assembly` (`src/agent/commands/document.js:19`) always calls `handleNewAssembly` (`App.jsx:5456`), which always mints a new name via `nextAssemblyName`. Retries leave Assembly (1)…(5) (T19). Each call is a new IndexedDB document; on main it also created/wrote the vault.

### Failure classes from the last ~3 weeks of fixes

| Class | PRs | Recurrence |
| --- | --- | --- |
| Implicit write on load/reload (`migrate-layout` / ids) | #573 | Kettle-MCP unrequested commit (ed445bd) |
| Implicit write on edit / New Assembly / `online` | #585 (open), tonight | T18 |
| Path assigned early; UUID replaced by path | #555, #573 | T3; SKILL already forbids this |
| Path-less serialize / invalid `.surf.json` toast | #555, #585 | T18 |
| Stale snapshot write-back / activeId / part clobber | tonight | T17 |
| Partial save / sibling `isSynced: false` / false dirty | #446, #576, #577, #579 | Yellow dot on untouched rows; wrap-on-Save |
| Overwrite main did not write | #450 | Force path vs `lastSyncedSha` guard |
| Per-part add left invalid `.surf.json` | #555 | `git_add_to_repo` loop |
| Consent vs MCP 60s timeout | #555 | `consent_pending` |
| `git_branch_create` did not switch | #571 | Agent stayed on main |
| `create_assembly` retries leave strays | tonight | T19 |
| `listTree` fail-open occupancy | #555 | `VAULT_TREE_UNAVAILABLE` |

---

## 2. New model

### 2.1 Two stores

**Working copy** (IndexedDB `surfcad-assembly`, as today): the open assembly and part scripts. Plain local state. **No write queue.** Paths are not assigned here. Scripts are keyed by stable part `id`. `rev` increments on every local mutation (`rememberAssembly`, script write).

**`lastCommit` record** (new, persisted in `surfcad-sync` kv, keyed by `repo + branch + assembly segment`): the last commit this client knows for that assembly. Survives reload. Built from committed bytes (or empty for a never-saved assembly), **never** by `stringifySurfJson(workingCopy)`.

```
LastCommitRecord {
  schemaVersion: 1
  repo: { owner, name }
  branch: string
  tipSha: string | null          // null = this assembly never committed
  assembly: {
    name: string                 // '' if never saved
    path: string | null          // assemblies/<Name>/.surf.json
    json: object | null          // parsed committed .surf.json
    blobSha: string | null       // git blob sha of those bytes
  }
  parts: {
    [surfId]: {
      path: string
      name: string
      contentHash: string        // git blob sha of the .js
      meshHash: string | null
    }
  }
  capturedAt: number
}
```

After a successful write, `lastCommit` is replaced wholesale from the files just committed + the new tip sha. Incremental `baselineAfterPartSave` / `baselineAfterPartRename` go away.

**Working-copy row** (always, local and git):

```
PartRow { id, surfId, name, visible, order, position?, placement?, copiedFrom?,
          linkPath? }
```

- `id` — stable UUID (`newLocalPartId` / `crypto.randomUUID`). Agent `part_id`. Never a vault path. Never rewritten on Save.
- `surfId` — always present (`mintSurfId` on create in both modes). Vault identity: `// @surf-id`, `.surf.json` `parts[].id`, groups / colors / joints.
- `linkPath` — only when the row is a **reference** to an already-committed vault file (insert / open). Not an assignment; the planner copies it into `.surf.json`.
- New and copied parts have **no path** until Save.

Display path (Parts subtitle, `parts[].path`) is a **projection of `lastCommit.parts[surfId].path`**. After Save, lastCommit updates and the path appears. Tools must not treat it as identity (see §3).

**Pushback vs the one-line target.** “Working copy has no repo paths” means no *assigned* paths. A link may remember the existing vault file. After Save the UI may show the committed path; the source of truth is lastCommit.

### 2.2 Planner (pure)

`planSave(lastCommit, workingCopy, occupancy) → { files, assignedPaths, nextRecord }`

Occupancy is `listTree` on Save (fail-closed: `VAULT_TREE_UNAVAILABLE`, do not treat failure as empty). Offline Save uses lastCommit paths + WC `linkPath`s only; never invents occupancy.

Match by **surfId**, never by path or name.

1. If `lastCommit.tipSha` is set and remote tip ≠ that sha → **conflict**, no files (see §2.4). First Save (`tipSha == null`) uses current tip as `baseSha` without conflict.
2. Working part with no lastCommit entry → **add**. Allocate `assemblies/<Assembly>/<Name>.js` (`-2`, `-3`, …). Stamp `// @surf-id`.
3. Working part with lastCommit entry: name/folder changed → **rename/move** (same occupancy rules as today’s `planRenameVaultPartPath`); content hash changed → **edit**; mesh hash changed → write/delete `.mesh`.
4. lastCommit part missing from WC → drop from `.surf.json`. **Delete the file** only if it is an assembly-local copy and no other assembly on this branch references that surfId (same rule as `planDeleteAssembly`). Shared `parts/` and linked files stay.
5. `workingCopy.name !== lastCommit.assembly.name` → move `.surf.json` and assembly-owned files; delete leftover blobs under the old folder.
6. Serialize `.surf.json` from WC + assigned paths. `parts[].id` is surfId. `activeId` in the file is the assigned path of the active row (vault-schema today); **applying lastCommit never writes that `activeId` back over WC `activeId`**.
7. One file list: adds, edits, moves, deletes, meshes, `.surf.json`.

Unsaved parts are never a reason to refuse. One commit.

**Pushback.** Today’s `buildCommitFiles` “do not delete removed parts” is rejected. Deletes belong in the Save commit. That is what makes `pendingRepoDeletes` / `pendingOldAssemblyName` unnecessary: lastCommit still has the old path and old assembly name.

### 2.3 One write function

```
writeVaultCommit({ adapter, repo, branch, baseSha, message, files }) → { sha }
```

The **only** production caller of `adapter.commitFiles`. First Save may `createRepo` + include `vaultSeedFiles` in this same commit when the repo does not exist. After success: replace `lastCommit`; project `assignedPaths` onto WC rows **by surfId** (path field only); do not replace the document; refuse the projection if `workingCopy.rev` moved and the change is not a path-only merge.

Allowed git writes (all go through this function, or adapter branch/repo APIs that are not `commitFiles`):

| Action | Who |
| --- | --- |
| User Save (`data-git-save`) | planner + `writeVaultCommit` |
| Agent `git_save` after consent | same |
| Overwrite main / keep-mine branch (on that Save conflict) | same files, different `baseSha` / branch |
| Explicit user/agent branch create, switch, delete | branch APIs; dirty switch needs `confirm: true` |
| Explicit delete-assembly / delete-repo | own plan + `writeVaultCommit` / GitHub delete; confirms stay |
| Move to Git | first Save of a local assembly (creates vault if needed) |

**Not writers:** paint, group, create/rename/delete part, insert, copy, open, New Assembly, GitHub connect, load, reload, `online`, focus, layout/id migration, `git_add_to_repo` (becomes an alias of `git_save`).

Per-part Save / Add to Repo: same planner, same write (full diff). No second commit API.

Offline Save: persist **one** planned write (`files`, message, expected `baseSha`). Flush that one write when online. If the tip moved, conflict then — not a FIFO of paint/group/delete ops.

### 2.4 Conflict (only on explicit Save)

If `lastCommit.tipSha` and remote tip differ at Save:

- **Overwrite main** — `writeVaultCommit` with `baseSha = remote tip`. Local bytes for planned paths; other remote files stay. (`git_force_overwrite` needs `confirm: true`.)
- **Get latest** — replace WC from remote for the behind paths (existing behind dialog); rebuild lastCommit from that tip. Destructive; agent needs `confirm: true`.
- **Keep mine** — create `surfcad/<asm>-YYYY-MM-DD` from `lastCommit.tipSha`, write the planned files there, switch.

Open, reload, and `online` never open this write UI. A read-only “main moved” toast on focus may stay; it must not flush.

---

## 3. Contract for agent/MCP tools

Self-contained. Another team can implement tools against this section without the rest of the doc. Vault file format is still [`vault-schema.md`](vault-schema.md). Pairing and consent envelopes stay [`agent/SKILL.md`](agent/SKILL.md).

### 3.1 Part identity

Every part, local and git, always has both:

| Field | Shape | Who assigns | When | Never |
| --- | --- | --- | --- | --- |
| `id` | UUID (`[0-9a-f-]{36}`) | Host, `crypto.randomUUID` | `create_part` / UI +Part / New Assembly seed | Rewritten on Save, reload, rename, or copy |
| `surfId` | `yyyy-mm-dd-hh-mm-ss-SSSS-xxxx` | Host, `mintSurfId` | Same moment as `id` | Omitted; used as `part_id` |

- **Uniqueness.** `id` is unique in the open working copy. `surfId` is unique in the open working copy and, once Saved, unique among committed part scripts in that vault (header + `.surf.json` `parts[].id`). Copy-to-assembly mints a **new** `id` and **new** `surfId`; `copiedFrom` records the source surfId.
- **Legacy.** A row whose `id` is already a surfId (git parts from #573) keeps that `id`; `surfId` equals it. Tools must accept `part_id` as either UUID or surfId (`findAssemblyPart`: `id` \| `surfId`). Tools must **not** accept a vault path as `part_id`.
- **Lookup.** `parts`, `set_active_part`, `set_script`, `insert_*`, `rename_part`, transforms, paint, joints: target `{ part_id }` (the UUID / stable `id`). If `part_id` is missing or not in the document → `{ code: "unknown_part" }`. **Do not** fall back to the active part when the caller passed a different id. **Do not** write the active part because `selection.cadPartId` moved.

**Writers that mutate a part script or placement MUST take `part_id` and refuse a mismatch** (`code: "part_mismatch"` if the tool also has an implicit active target). `create_part` must atomically set `parts.activeId` **and** `selection.cadPartId` to the new `id` before the call returns.

### 3.2 Paths are not identity

- New `create_part` / UI +Part rows have **no** `path`. `parts[].path` is omitted or `null`.
- The host assigns `assemblies/<Assembly>/<Name>.js` **only inside Save** (user Save or `git_save` after consent). After that, `parts[].path` is the lastCommit projection for that surfId.
- `rename_part` changes **display name** only. The committed file moves on the next Save. Response: `{ partId, name, path: <last committed or null>, moved: false }` until Save.
- Insert/open of an existing vault file may show that file’s path as a **link** (`path` present, same surfId as the source). That is a reference, not an assignment. Copy-to-assembly clears it until Save.

**Tools must never** send `path` as `part_id`, persist a guessed path, or treat a missing path as an error. `git_add_to_repo` must not assign a path itself; it is an alias of `git_save`.

### 3.3 What counts as a Save

A git write of assembly content happens only when:

1. The user clicks Save (`data-git-save` / commit dialog), or
2. The agent calls `git_save { message }` **after** write consent (`consent_pending` → user Allow → retry).

No other tool may `commitFiles`, push, `createRepo`, seed the vault, enqueue an outbox op, or flush. That includes `create_assembly`, `create_part`, `rename_part`, `open_assembly`, `open_part`, `insert_part`, `paint_confirm`, group ops, `set_script`, `insert_*`, `run`, and coming back online.

| Tool | Git? |
| --- | --- |
| `git_save` | Yes — planner + one commit. Message required. |
| `git_add_to_repo` | Alias of `git_save` (same commit of the full dirty diff). Prefer `git_save`. |
| `git_list_branches` | Read only. |
| `git_branch_create` / `git_branch_switch` / `git_branch_delete` | Branch APIs only. Switch while dirty needs `confirm: true`. Delete needs `confirm: true`. Create switches when clean (or with confirm if dirty). |
| `git_force_overwrite` / `git_behind_resolve` `{ reload \| branch }` | Destructive; `confirm: true`. Only after a Save conflict (or an existing behind marker). |
| `git_move_to_repo` | First Save of a **local** assembly (creates vault if needed). Consent. |
| Everything else | Working copy only. |

Vault repo creation happens on the first explicit Save / `git_move_to_repo`, not on New Assembly, GitHub connect, or `create_assembly`.

### 3.4 What tools may mutate

| State | Tools may | Tools must not |
| --- | --- | --- |
| Working copy (doc + scripts + `rev`) | create/rename/delete part, paint, groups, joints, transforms, `set_script`, insert/open (local rows) | Assign paths; commit; replace the doc from a stale snapshot |
| `lastCommit` | — | Any tool except the Save write path |
| Git adapter | `git_*` listed above | Any other command |

`dirty` after this model:

```
{
  unsaved: boolean,              // WC differs from lastCommit (or lastCommit is empty)
  editedSinceLoad: string[],     // part ids (UUID/surfId) whose script differs from last open/Save snapshot
  workspaceDirty: boolean,       // same as unsaved for git assemblies
  partIds: string[],             // dirty part ids (stable ids, never paths)
  assemblyDirty: boolean,        // name / groups / colors / joints / order / placement vs lastCommit
  path: string | null            // on each parts[] row: lastCommit path or null
}
```

`editedSinceLoad` and `partIds` must list **every** edited part (T5), keyed by stable `id`. A path-less new part is dirty. `activeId` is view state and does not by itself set `assemblyDirty`.

### 3.5 Concurrency and idempotency

- **`create_assembly`.** Single-flight per tab. Overlapping calls join the in-flight promise and return the **same** `{ assemblyName, activeId, partCount }`. A retry after success is a new assembly only if the previous call settled (no in-flight). **No git write.** Optional `name` (when added) must not create `Assembly (N)` if that exact name is free. Do not persist a second document until the first call returns.
- **Versioned writes.** WC has monotonic `rev`. A host write-back (Save projection, overwrite, open) that would replace the document is rejected if `result.baseRev !== currentRev`, except a **path-only merge** by surfId. A stale `set_script` / `create_part` snapshot must not `rememberAssembly` over a newer doc (T17).
- **`create_part`.** One row, one `id`, one `surfId`, `activeId` + `cadPartId` set, then return. No path. No git.
- **`open_assembly`.** Missing name → `{ code: "not_found" }`, not a fake success (T9). Read-only vs git (loads WC from vault; no commit).
- **Idempotent Save.** `git_save` when `dirty.unsaved === false` → `{ status: "clean" }`, no commit.

### 3.6 Error contract

Bridge refusals stay `isError: true` with `code` + `message` (+ `details`). Git/content tools must be **specific and actionable**:

| Code | When | Agent should |
| --- | --- | --- |
| `unknown_part` | `part_id` not in the open document | `parts`, then retry with a listed id |
| `part_mismatch` | Tool implied active part ≠ `part_id` | Pass `part_id` explicitly |
| `no_assembly` | No open document | `create_assembly` or `open_assembly` |
| `not_found` | `open_assembly` name missing | `list` / do not invent |
| `git_only` | Vault-only tool in local mode | `git_move_to_repo` or stay local |
| `consent_pending` | Real-repo write; Allow dialog up | Wait `retry_after_ms`, same call |
| `real_repo_blocked` | Headless or session Deny | Tell the user; do not loop |
| `confirm_required` | Destructive git without `confirm: true` | Ask the user; only then pass `confirm: true` |
| `conflict` / `repo-moved` | Save and remote tip ≠ lastCommit | `git_behind_resolve` or `git_force_overwrite` with confirm |
| `vault_tree_unavailable` | Occupancy list failed | Retry Save; do not assume empty tree |
| `path_less_parts` | **Must not be returned** for Save | Host assigns paths in the planner |
| `feature_failed` | Kernel/script error | Include the **same text the UI shows**, feature type/label, index; persist until next successful run (T16 — not implemented by this git PR; contract still requires it) |

Never return a generic `"Feature failed"` as the only message. Never pass `confirm: true` unless the user asked for that destructive action.

### 3.7 Stop relying on these current behaviours

| Today | Stop |
| --- | --- |
| `parts[].path` after `create_part` / paint / edit | Path only after `git_save` |
| `part_id` that is a vault path | UUID / surfId only |
| Paint / rename / insert / copy / delete flushing git | WC only; Save later |
| `create_assembly` creating a vault or leaving strays on retry | Local, single-flight |
| `open_assembly` of a missing name returning success | `not_found` |
| `create_part` leaving `parts.activeId` / `status.partId` on the old part | Atomic activate |
| `set_script` / `insert_*` without `part_id` writing the active part | Require `part_id` |
| `git_add_to_repo` as a second commit shape | Use `git_save` |
| `git_branch_create` leaving the session on the old branch | Switch when allowed (#571) |
| `dirty.editedSinceLoad` missing new parts | Every edited stable id |
| Implicit “Overwrite main” toasts with no `git_*` call | Conflict only on Save |
| Reload / `online` committing | Never |

`T1` (create_part should run the script) and `T16` (real error text) are **not** git-write bugs; they stay on the MCP batch. The host must still expose `runState` / volume / bbox on create-if-run, and real error strings on `errors` / insert / run.

---

## 4. Migration (no data loss)

On first load after upgrade, **do not flush the outbox.**

1. **Build `lastCommit` from what git actually has.** If `lastSyncedSha` / current `gitBaseline` exist, convert: `tipSha ← headSha`, `assembly.json ← parse(baseline.assemblyText)` when valid, `parts[surfId] ← { path, contentHash }` from baseline scripts (hash the committed text, not the live buffer). If baseline serialize would throw (path-less), those rows are **adds** (omit from `lastCommit.parts`).
2. **UUID / surfId.** Keep existing `id`. Mint `surfId` locally if missing; stamp `// @surf-id` on the next Save (do not push). Path-as-id rows: keep script bytes; set `id` to header/pathIndex/minted surfId; `path` lives only on lastCommit until Save.
3. **#585 pending flags.** If `pendingRepoDeletes` / `pendingOldAssemblyName` exist: **do not drop them from lastCommit**. lastCommit still lists those paths / the old assembly name; WC already has the new name / missing rows; first Save plans the delete/move; then delete the flags.
4. **Leftover outbox.** Retire `migrate-layout` / `migrate-ids` (already). Leave queued save/rename/delete **unflushed**. WC already has the local state; lastCommit is the tip; user Save replans. Do not replay stale file snapshots.
5. **Vault files.** No format bump. Next Save writes `parts[].id` (surfId) on every row. Existing path-only rows stay readable (`parseSurfJson`).
6. **IndexedDB.** `surfcad-assembly` scripts rekey from path → stable `id` using header / pathIndex / lastCommit. No script bytes dropped. `isSynced` becomes derived (`contentHash` match); can keep the flag until UI cleanup.

---

## 5. What gets deleted

After the sequence below is green:

- `enqueueAssemblySave` as a git writer; `online` listener; outbox as the paint/group/insert/copy/delete/rename path
- `commitPartToRepo` / `deletePartFromRepo` / `commitWorkspace` as separate commit APIs
- `prepareAssemblySurfWrite` promoting paths into WC; `adoptPreparedSurfWrite` full-doc write-back
- `ensureAssemblyVaultPaths` on every action (planner only)
- `baselineAfterPartSave` / `baselineAfterPartRename` / `baselineAfterAssemblyRename` / `captureBaseline` via `stringifySurfJson(WC)`
- Auto `migrate-layout` / `migrate-ids` enqueue; `vaultImplicitWrite` skip list (nothing implicit left)
- Incremental `isSynced` flipping on siblings
- `seedEmptyVaultAssembly` path-as-id

**Keep:** vault layout, `surfJson` (commit serialize still validates paths), `surfId`, `partIdentity` (refined), adapter, list/open (read-only), consent modal, conflict UI (Save only), delete-assembly / delete-repo confirms, `planDeleteAssembly` rules.

---

## 6. PR sequence

Each PR has tests, keeps CI green, does not touch `src/fea/**` or `surfcad-fea/**`. #585 may merge first; later PRs assume its implicit-write stop and must consume its pending flags if present.

| PR | What | Size | Done when |
| --- | --- | --- | --- |
| **0** (this) | `docs/git-save-model.md` | S | Reviewable contract + plan |
| **1** | Persist `LastCommitRecord`; capture from open/tip / existing baseline; no write-path change | M | Reload restores lastCommit; path-less capture does not throw |
| **2** | Pure `planSave` + unit tests (add, edit, rename, move, delete, rename-then-reload, offline occupancy, conflict input, #585 pending flags) | M | Tests pass; not wired |
| **3** | `writeVaultCommit` + adapter spy: **fail if any production module except that file calls `commitFiles`** (temporary allowlist shrinks each PR) | S | Harness exists; callers temporarily import the wrapper |
| **4** | Wire user Save + `git_save` through planner + write; path projection by surfId; conflict only here | L | One commit; paths only after Save; no WC replace |
| **5** | Remaining implicit writers off (if #585 not in); no `ensureGitVault({ create: true })` except first Save; no `online` flush | M | Source-assert (see #585 `test/implicit-vault-write.test.js`) |
| **6** | Planner emits deletes + assembly-folder moves; drop pending flags; per-part Save = same planner | M | Delete then Save removes the file; rename then Save moves the folder |
| **7** | Identity + agent contract: always surfId; `parts.path` from lastCommit; `part_id` required on writers; versioned writes; single-flight `create_assembly`; `open_assembly` `not_found` | M | Agent goldens; T3/T17/T19 host-side |
| **8** | Delete dead APIs / outbox write path; goldens (`smoke_face_paint`, rename, git-vault-flow) expect WC-only then `git_save` | M | Harness allowlist empty except `writeVaultCommit` + tests |

Do not combine 4+7. Host contract (7) can start in parallel once 4 is on a branch, so the MCP team is not blocked.

---

## 7. Test plan

- **Harness.** Test adapter records `commitFiles` / `createRepo`. Production import graph: only `writeVaultCommit` (plus the test seed helper). CI fails on a new call site.
- **Planner units.** Add path-less part; rename; rename-then-reload (lastCommit still has old path, WC has new name); delete unreferenced assembly-local file; delete linked/shared keeps file; assembly rename folder move; first Save empty lastCommit; occupancy collision `Name-2`; `listTree` failure → no files; remote tip ≠ lastCommit → conflict, no files; #585 `pendingRepoDeletes` / old name fold into lastCommit.
- **Host.** Paint / group / create_part / create_assembly / `online` / reload: `commitFiles` count unchanged. Save: one commit, all dirty parts + `.surf.json`. `create_assembly` overlap: one document. Stale `rev` write-back rejected. `parts.path` null until Save.
- **Goldens.** `smoke_face_paint`, `smoke_agent_part_rename_commit`, `golden:agent-bridge-h12`: confirm/rename local; `git_save` is the commit. Keep `git-vault-reload-no-write`.
- **Existing.** Rebase `test/git-assembly-save-unsaved-parts.test.js`, `git-stable-part-id`, `git-stray-promote`, `agent-git-path-less`, `part-rename-commit` onto planner assertions.

---

## 8. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Planner occupancy vs a remote file added since lastCommit | Save lists the tree; fail-closed |
| User deletes a part that another assembly links | Same reference rule as delete-assembly; file stays |
| Offline Save then remote moved | One pending write; conflict at flush |
| lastCommit missing after crash mid-write | Rebuild from tip on next open (read-only); WC scripts stay in IDB |
| #585 and this series race | #585 first is OK; PR 6 deletes its flags |
| MCP team builds on old path-as-id | §3 is the contract; host PR 7 lands the enforcement |

Rollback: revert PRs 8→4 in reverse. lastCommit in IDB is advisory; an old build ignores it. Vault bytes stay valid v1 `.surf.json`. Feature flag optional (`SAVE_MODEL_V2`) around PR 4 if we want a one-release kill switch; default is sequential green PRs.

---

## 9. MCP feedback (T1, T3, T5, T16–T19)

| Item | This redesign |
| --- | --- |
| **T1** create_part doesn’t run | **Out of scope** (host run-on-create). Not a git write. |
| **T3** vault paths without `git_save` | **Fixed.** Paths only in the planner; `parts.path` from lastCommit. |
| **T5** `dirty.editedSinceLoad` incomplete | **Fixed** if dirty is lastCommit vs WC by stable id (every new/edited part). Snapshot keyed by path is what dropped rows. |
| **T16** error text not exposed | **Out of scope** (errors/insert/run payload). §3.6 still requires the UI string; git PRs do not implement it. |
| **T17** active part desync / overwrite | **Host-side fixed** by atomic `create_part`, required `part_id`, versioned writes (no stale doc write-back). Remaining “always pass `part_id`” is the MCP batch. |
| **T18** Overwrite-main / paths / invalid `.surf.json` with no git_* | **Fixed / moot.** No implicit writers; no path-less serialize of WC; conflict only on Save. |
| **T19** stray assemblies | **Fixed** by single-flight `create_assembly` and no vault write on create. |

T7 (`create_assembly { name }`), T8 (list/delete/rename assembly tools), T9 (`not_found`) are MCP-batch product work; §3.5 already requires `not_found` and single-flight so retries do not fork documents.
