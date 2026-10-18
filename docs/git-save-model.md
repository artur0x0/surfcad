# Git SAVE MODEL

Redesign of how SurfCAD writes the Git vault. This document is the write model **and** the new on-disk layout. [`vault-schema.md`](vault-schema.md) describes **today’s** folder layout; implementation PRs replace it. Pairing and consent envelopes stay [`agent/SKILL.md`](agent/SKILL.md).

**Standing rules:** git writes only on a requested action — never on load, reload, edit, connect, or `online`. Saving is never blocked by unsaved parts. No periodic auto-save. Destructive git actions need `confirm: true` for agents. Repo delete keeps its confirm. Repo creation happens on the first explicit Save only.

**Identity:** every part and every assembly has **one** permanent id, minted at creation (`mintSurfId`), unrelated to path, name, or local/git. Path is `f(id)` only. Names are labels: non-unique, never in paths, never in a README or other index. Switching source never remints an id. Copy mints a new part id and sets `copiedFrom`.

**#585.** Open hotfix [PR #585](https://github.com/artur0x0/surfcad/pull/585) stops implicit writers and lets `captureBaseline` tolerate path-less rows. After that, Save cannot reconstruct deletes or old names without extra flags. This redesign replaces that with a persisted last-commit record (shared per-branch tip + per-assembly file hashes) and one planner. There are **no moves**, so those flags go away.

---

## 1. Problems with the current design

The live model is an **outbox of file snapshots** plus a **baseline captured by re-serializing the working copy**. Paths are names. Identity is split (path vs UUID vs `surfId`; assemblies are a folder). That is why the same classes of bug keep coming back.

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
| `handleRenamePart` `:7378` + `stagePartRename` | Immediate rename commit (a **move**) |
| `handleRenameAssembly` `:7498` | Immediate folder move; rewrites other parents’ `groups[].source` |
| `window.addEventListener('online')` `:3283` | Flush leftover outbox |
| `collectTakenAssemblyNames` `:3131` | `ensureGitVault()` on New Assembly (creates the repo) |
| GitHub-connect flip `:5269` | `ensureGitVault()` |

`enqueueAssemblySave` (`:4354`) always runs `prepareAssemblySurfWrite` (assigns paths) then `flushGitOps`. Tonight’s playtest (T18): paint, group, rename, delete, copy, insert, `online`, and New Assembly all hit the vault with no Save.

### 1.2 Paths are names (bug class B)

`ensureAssemblyVaultPaths` (`src/utils/git/partVaultPath.js:148`) mints `assemblies/<Assembly>/<Name>.js` and, for non-stable ids, **replaces the row id with the path** (`partVaultPath.js:203`). Occupancy needs `-2` suffixes (`vaultPartFileStem`). `readParts` reports that path (`App.jsx:8575`). Agent T3: `parts[].path` appears while `dirty.unsaved` is true. Rename is a move (`planRenameVaultPartPath`, `gitRename`, `gitAssemblyRename`) and rewrites every other parent that stored the old path.

### 1.3 Two identities, no assembly id (bug class H)

A part may have a UUID row `id`, a `surfId` (`// @surf-id` / `.surf.json` `parts[].id`), and/or a vault path used as `id`. Assemblies have **only a folder name** (`vault-schema.md`: “Assemblies have no surf id”). Rename, last-opened, `open_assembly { name }`, and lastCommit keyed by segment fork across rename-then-reload. T19 retries mint another *name*.

### 1.4 Baseline is a serialize of the working copy (bug class C)

`captureBaseline` (`gitWorkspace.js:84`) calls `stringifySurfJson` → `validateSurfJson`, which requires `parts[N].path` (`surfJson.js:149`). A path-less working copy throws (T18 toast). Dirty (`isAssemblyDirty`, `:122`) takes the same path. The design is still “re-serialize WC to learn what git has.”

### 1.5 Stale-doc write-back (bug class D)

`adoptPreparedSurfWrite` → `rememberAssembly(prepared.doc)` (`App.jsx:4337`). `applyOverwriteFiles` replaces the open document from committed `.surf.json`, including `activeId` (`gitCommit.js:1241`). T17: Frame’s script became the new part’s seed cube.

### 1.6 Save cannot see deletes (bug class E)

`buildCommitFiles` (`gitCommit.js:413`) **does not delete** removed parts. Assembly rename only remaps if `baseline.assemblyName !== doc.name`. After #585, local delete/rename leave no outbox, so Save needs `pendingRepoDeletes` / `pendingOldAssemblyName`.

### 1.7 Many `commitFiles` call sites (bug class F)

`adapter.commitFiles` is used from `flushSyncQueue` (`syncWorker.js:116`), `commitPartToRepo` / `deletePartFromRepo` / `commitWorkspace` / `forceMergeCommit` / `saveLocalOnNewBranch` (`gitCommit.js`), `findOrCreateVault` seed (`vault.js:120`), `moveToGit` (`gitMoveToGit.js:183`), and `checkInMineToBranch` (`gitPull.js:342`).

### 1.8 `create_assembly` is not single-flight (bug class G)

`create_assembly` (`src/agent/commands/document.js:19`) always calls `handleNewAssembly` (`App.jsx:5456`) → `nextAssemblyName`. Retries leave Assembly (1)…(5) (T19). On main it also created/wrote the vault.

### 1.9 Conflict is tip-vs-tip, and `online` is a writer (bug class I)

Any remote commit after `lastSyncedSha` blocks the next Save, including an unrelated assembly or the user’s own previous Save of a sibling. `online` flushes the outbox (`App.jsx:3283`), which contradicts “git writes only on a requested action.”

### Failure classes

| Class | PRs | Recurrence |
| --- | --- | --- |
| Implicit write on load/reload | #573 | Kettle-MCP unrequested commit |
| Implicit write on edit / New Assembly / `online` | #585 (open) | T18 |
| Path assigned early; UUID replaced by path | #555, #573 | T3 |
| Dual part ids; assemblies named only by folder | #573 | T17/T19; rename-then-reload |
| Rename is a move; other parents rewritten | tonight | `gitRename` / `groups[].source` |
| Path-less serialize toast | #555, #585 | T18 |
| Stale snapshot / activeId clobber | tonight | T17 |
| Sibling `isSynced: false` / false dirty | #446, #576, #577, #579 | Yellow dot on untouched rows |
| Overwrite main did not write | #450 | Force path vs `lastSyncedSha` |
| Unrelated remote commit blocks Save | tonight | tip-vs-tip |
| `create_assembly` retries leave strays | tonight | T19 |
| `listTree` fail-open occupancy | #555 | `VAULT_TREE_UNAVAILABLE` |

---

## 2. New model

### 2.1 Vault layout (flat, id-named)

```
surfcad.json                            { "kind": "surfcad-vault", "version": 2 }
assemblies/<assembly-id>.surf.json
parts/<part-id>.js
parts/<part-id>.mesh                    sidecar; same stem as the script
```

| Path | Rule |
| --- | --- |
| `assemblies/<assembly-id>.surf.json` | Assembly id is a surf-id. File holds top-level `id` + `name` and the instance list. |
| `parts/<part-id>.js` | Part id is a surf-id. **The** script for that part. |
| `parts/<part-id>.<ext>` | Mesh (today `.mesh`) beside the script. Same id, not a second identity. |

**Path = `f(id)` only.** There is no occupancy, no `-2` suffix, no folder, no `vaultSegment` in a path. Two assemblies or two parts may share a display name.

**Names never appear in paths.** Rename is an edit of a name field, never a move. No other file duplicates names — no README index, no catalog, no `surfcad.json` name list. Save does **not** write or regenerate `README.md`. A leftover `README.md` is never a planned file; Upgrade deletes it only when its bytes match a known old seed (§4.3).

Pickers and the Parts list show **names as written**. Duplicate names are allowed and are **not** disambiguated (no short-id suffix).

**Part file header** — two lines; `@name` is its own line so the display name may contain spaces:

```
// @surf-id 2026-10-07-20-56-31-0423-a3f9
// @name Bracket
```

The id line stays `// @surf-id <id>` (`mintSurfId` / `isSurfId` in `src/utils/git/surfId.js`). Bytes after the header block are the script. Rename rewrites the `@name` line and this assembly’s `parts[].name`; the path does not change.

**Assembly file** (`version` **2**; incompatible with v1):

```
{
  "format": "surfcad.assembly",
  "version": 2,
  "id": "2026-10-18-02-50-00-0001-aa01",
  "name": "Gearbox",
  "activeId": "2026-10-07-20-56-31-0423-a3f9",
  "parts": [
    {
      "id": "2026-10-07-20-56-31-0423-a3f9",
      "name": "Bracket",
      "visible": true,
      "order": 0,
      "position": [0, 0, 0]
    }
  ],
  "groups": [],
  "colors": {},
  "joints": []
}
```

No `path` on parts. `activeId` is a part id. `groups[].source` is an **assembly id** (or `null`), not a folder path. Per-instance data stays: transform (`position` / `placement`), groups, joints, paint (`colors`). `name` is a non-empty label; it is **not** required to equal `vaultSegment(name)`.

**`validateSurfJson` (v2).** New writer, new reader.

| Rule | v2 (this model) | v1 (legacy reader only) |
| --- | --- | --- |
| `version` | Must be `2` | Must be `1` |
| Top-level `id` | Required, `isSurfId` | Absent (folder is the id) |
| `parts[].id` | Required, `isSurfId`, unique in the file | Optional |
| `parts[].path` | **Forbidden** (unknown key / explicit error) | Required |
| `name` | Non-empty after trim; not path-safe | Equals `vaultSegment(name)` |
| `activeId` | `null` or a `parts[].id` | `null` or a `parts[].path` |
| `TOP_KEYS` | `format`, `version`, `id`, `name`, `activeId`, `parts`, `groups`, `colors`, `joints` | Today’s set (no top-level `id`) |
| File location | `assemblies/<id>.surf.json` | `assemblies/<Name>/.surf.json` |

Old builds cannot open a v2 file (wrong path, `version must be 1`, unknown key `id`, missing `path`). There is no “older readers ignore it” path. The v2 reader lands before Upgrade vault writes v2 (PR 1 before PR 4).

**`surfcad.json`.** `{ "kind": "surfcad-vault", "version": 2 }` marks an upgraded / new-layout vault. Version `1` (or a v1 tree — see §4) is legacy.

**Why keep the surf-id format (not UUID).** Vault scripts already start with `// @surf-id <surf-id>`. `.surf.json` `parts[].id`, `groups[].partIds`, `colors` keys, and joint `a.part` / `b.part` already store that string. A UUID would rewrite every committed header. One mint, one validator, one field. The filename **is** that id.

### 2.2 One id, used everywhere

| Entity | Minted | Used as |
| --- | --- | --- |
| Part | UI +Part, `create_part`, seed, import, copy | Row `id`; IndexedDB script key; agent `part_id`; `// @surf-id`; `.surf.json` `parts[].id`; groups / colors / joints; lastCommit part key; `activeId` / `selection.cadPartId` / `status.partId`; filename `parts/<id>.js` |
| Assembly | New Assembly, `create_assembly`, import | IndexedDB doc `id`; agent `assembly_id`; `.surf.json` top-level `id`; lastCommit assembly key; last-opened; filename `assemblies/<id>.surf.json` |

No `surfId` field after WC migration. Same id in local and git. Rename, Save, reload, source flip never change it.

### 2.3 Working copy

IndexedDB `surfcad-assembly`, as today. No write queue. `rev` increments on every local mutation.

```
AssemblyDoc {
  id,                    // surf-id; always present after open/create
  name, source, rev,
  activeId,              // part id
  parts, groups, colors, joints,
  vaultLayout            // 'v2' | 'legacy' (see §4)
}
PartRow {
  id, name, visible, order,
  position?, placement?, copiedFrom?,
  missing?               // true when the vault file is absent (§2.10)
}
```

Scripts keyed by part `id`. The UI may derive `parts/<id>.js` locally for a subtitle; that string is not stored on the row and is **not** in agent results.

### 2.4 `lastCommit`

Two persisted records in `surfcad-sync` kv. Built from committed bytes, **never** by `stringifySurfJson(workingCopy)`.

```
BranchTip {
  schemaVersion: 1
  repo: { owner, name }
  branch: string
  tipSha: string | null     // last commit this client wrote or adopted
}

AssemblyCommit {
  schemaVersion: 1
  assemblyId: string
  files: {
    [path]: {               // f(id): assemblies/<id>.surf.json, parts/<id>.js, parts/<id>.mesh
      contentHash: string   // git blob sha
    }
  }
  json: object | null       // parsed committed v2 .surf.json
  capturedAt: number
}
```

`BranchTip` is **shared** for the repo+branch. After a successful Save of assembly A, `tipSha` becomes that commit. Saving B next does not conflict with A’s commit: remote tip equals `BranchTip.tipSha`. Per-assembly `files` still tell the planner what A vs B last wrote.

### 2.5 Planner (pure)

```
planSave(branchTip, assemblyCommit, workingCopy, remoteTip, compareFiles) →
  { files, nextBranchTip, nextAssemblyCommit } | { conflict, paths }
```

No occupancy. No `listTree` for name collisions. Offline Save does not invent files. Match assembly by `workingCopy.id`, parts by part id.

1. **Conflict gate** — if `branchTip.tipSha` is set and `remoteTip !== tipSha`, call `adapter.compare(repo, tipSha, remoteTip)`. **Conflict only when a file this Save would write appears in `compare.files`.** Unrelated commits (another assembly, someone else’s part) do not block. `README.md` is never planned. First Save (`tipSha == null`) uses current tip as `baseSha` without this check.
2. Working part with no `assemblyCommit.files[parts/<id>.js]` → **add** `parts/<id>.js` (header stamped). Mesh if present.
3. Working part with a lastCommit file: header name or script/mesh hash changed → **edit** that same path. Never a move.
4. lastCommit part missing from WC → drop the row from `.surf.json`. **Delete `parts/<id>.js` (+ mesh) only if no other assembly on this branch references that part id** (see §2.7).
5. Assembly name / groups / colors / joints / order / placement / activeId changed → **edit** `assemblies/<id>.surf.json` in place. Never a folder move. Other assemblies are **not** rewritten (no `groups[].source` path to fix).
6. Serialize v2 `.surf.json` from WC. `parts[].id` is the part id. No `path`. `activeId` is the part id. **Applying lastCommit never writes file `activeId` over WC `activeId`.**
7. One file list: adds, edits, deletes. Unsaved parts never refuse. One commit.

**Pushback.** `buildCommitFiles` “do not delete removed parts” is rejected. `planRenameVaultPartPath`, `gitRename`, `gitAssemblyRename`, and occupancy (`-2`) are deleted at the end of the series. `pendingRepoDeletes` / `pendingOldAssemblyName` are unnecessary.

### 2.6 Shared parts: reference vs copy

The existing copy-or-reference prompt stays.

**Insert as reference** (Open Part, Insert parts into current, “opens by reference”): the **same part id** is listed in several assemblies. There is one `parts/<id>.js`. Edits to the script and renames of that part **apply everywhere** — every parent shows the same header name and the same committed bytes. This Save writes the shared file (if dirty) and **this** assembly’s `.surf.json`. It does **not** rewrite other parents. Other open assemblies **adopt the new committed hash as their saved version** (update `AssemblyCommit.files[parts/<id>.js]`; if that assembly’s WC script still matched the old hash, refresh WC from the committed bytes so it stays clean). That is not a conflict.

**Copy** (“Copy to this assembly”): mint a **new** part id, set `copiedFrom` to the source id, clone script bytes with a new header. Independent file. Colors/joints on the old id are not copied (same as today).

A part id appears **at most once** per assembly. The same id in two assemblies is a reference, not two instances.

### 2.7 Delete from assembly vs Delete from repo

Removing a part from an assembly **drops the row** in the WC immediately (groups/colors/joints prune as today). Nothing hits git until Save.

On Save:

| User choice | Row | File `parts/<id>.js` (+ mesh) |
| --- | --- | --- |
| **Delete from assembly** | Dropped from this `.surf.json` | Deleted **only if** no other assembly on this branch references that part id |
| **Delete from assembly & repo** | Dropped | Same rule. Offered only when this client believes this is the last parent (open WC + tip `.surf.json` files on the branch). If another parent is found at Save → **keep the file**, return `part_still_referenced` (list the other assembly ids/names). Never delete a referenced file. |

A **reference** is another assembly on this branch: its tip `.surf.json` `parts[].id` / `groups[].partIds`, plus the open working copy. `copiedFrom` is provenance, not a reference.

**Delete assembly** (confirm stays):

| Choice | Commit |
| --- | --- |
| Keep parts | Delete `assemblies/<id>.surf.json`. Part files stay (`parts/<id>.js` already). |
| Delete parts | Delete the assembly file. Delete a part file only when no other assembly references that id. |

No folder, no “move copy into `parts/`”, no rewrite of other assemblies’ paths. A group on another assembly whose `source` was this assembly id is a **dangling label** (`source` stays the deleted id). That sibling is cleaned (`source` → `null`) on **its next Save**. Delete-assembly does not rewrite siblings. Upgrade does not rewrite siblings either (it migrates remote bytes only).

### 2.8 One write function

```
writeVaultCommit({ adapter, repo, branch, baseSha, message, files }) → { sha }
```

The **only** production caller of `adapter.commitFiles`. CI adapter spy fails if any other production module calls `commitFiles`.

First Save may `createRepo` and include seed files (`surfcad.json` v2, `assemblies/.gitkeep`, `parts/.gitkeep`) in the **same** commit when the repo does not exist. **Do not seed a README name index.** If `createRepo` succeeded and the seed commit failed, the next Save **retries the seed idempotently** (marker present → do not recreate; missing marker on an empty repo we created → write seed + this assembly again).

After success: set `BranchTip.tipSha` to the new sha; replace this `AssemblyCommit`; adopt shared part hashes into other `AssemblyCommit`s (§2.6); do **not** replace the WC document; refuse a write-back if `workingCopy.rev` moved except a hash-only adopt for unedited shared parts.

| Action | Who |
| --- | --- |
| User Save (`data-git-save`) | planner + `writeVaultCommit` |
| Agent `git_save` after consent | same |
| Overwrite (Save / main-moved conflict) | re-plan against current remote tip, then same write, `baseSha = remote tip` |
| Get latest | **not a git write** — replace WC conflicting files from the remote tip (§2.9) |
| Save mine to a new branch | create branch from `branchTip.tipSha` (or merge base), write planned files, switch |
| Upgrade vault | remote-bytes layout commit (§4.3); if WC is dirty, a normal Save follows under the same confirm (two commits) |
| Explicit branch create / switch / delete | branch APIs; dirty switch needs `confirm: true` |
| Explicit delete-assembly / delete-repo | own plan + `writeVaultCommit` / GitHub delete; confirms stay |
| Move to Git | first Save of a local assembly (creates vault if needed) |

**Not writers:** paint, group, create/rename/delete part, insert, copy, open, New Assembly, GitHub connect, load, reload, **`online`**, focus, layout/id migration, `git_add_to_repo` (alias of `git_save`).

Per-part Save / Add to Repo: same planner, same write (full diff of this assembly). No second commit API. **No per-part overwrite.**

### 2.9 Conflict (file-level; Save or “main moved”)

The four-button dialog opens when §2.5 step 1 finds an overlap **or** when the user opens the read-only **main moved** notice on focus. `online` never opens it and never flushes. The notice itself offers the same choices.

**Conflicting files.** On Save: `planned files ∩ compare.files`. On the main-moved notice: this assembly’s `.surf.json` and/or its part files that appear in `compare(branchTip.tipSha, remoteTip)`.

| Button | Meaning |
| --- | --- |
| **Overwrite** | “My changed files win.” Re-plan against the **current remote tip** just before the forced write (`baseSha = remote tip`). Local bytes for planned paths; other remote files stay. Not per-part. Agent: `git_force_overwrite` + `confirm: true`. |
| **Get latest** | Replace the WC’s **conflicting files** (assembly file and/or part files) from the remote tip. Rebuild `AssemblyCommit` and `BranchTip` from that tip. **Never writes git.** Destructive: agents need `confirm: true` (`git_behind_resolve { action: "reload" }`). The UI confirms if the WC has unsaved changes to those files; if those files are clean, no extra UI confirm. |
| **Save mine to a new branch** | Write the planned files on a new branch and switch. Agent: `git_behind_resolve { action: "branch" }` + `confirm: true`. |
| **Dismiss** | No write. Close the dialog. WC unchanged. |

No “Overwrite main” / “Keep mine” labels. No per-part overwrite chrome.

### 2.10 Offline, seed, missing part

**Offline Save.** Persist **one** planned write (`files`, message, expected `baseSha`) and show it as **pending**. Coming back `online` does **not** flush. The pending write **pushes only when Save is pressed again**. If WC `rev` moved, re-plan. If the tip moved and compare overlaps, conflict then. Not a FIFO of paint/group/delete ops.

**`online` is never a writer.** Remove the `online` → `flushGitOps` listener. Do not “flush pending when reconnecting.”

**Seed retry.** Repo created but seed commit failed → next Save retries seed idempotently (see §2.8). Do not leave the user on an unmarked empty repo without a retry path.

**Missing part file.** A v2 `.surf.json` row whose `parts/<id>.js` is absent is a **`missing` row state**. Never synthesize an empty script. Never auto-remove the row. The user can restore the file, delete the row, or leave it. Save of that assembly writes the `.surf.json` as-is (still listing the id) and does not add a blank `.js`.

### 2.11 Why this kills the rename/move class

No moves ⇒ a rename never rewrites other parents. Shared-part rename is an edit of `parts/<id>.js` (`// @name`) plus this assembly’s `parts[].name`. Other parents pick up the header on open / hash adopt. `groups[].source` is an id, so an assembly rename does not touch siblings.

---

## 3. Contract for agent/MCP tools

Self-contained. The MCP Lead can implement tools against this section alone. Vault bytes are §2.1. Pairing / consent stay [`agent/SKILL.md`](agent/SKILL.md).

### 3.1 Identity

**One part id. One assembly id.** Shape: `yyyy-mm-dd-hh-mm-ss-SSSS-xxxx`. Host assigns both at creation. They never change on Save, reload, rename, or source flip.

| Entity | Tool field | Who / when |
| --- | --- | --- |
| Part | `part_id` | Host on `create_part` / +Part / seed / import / copy |
| Assembly | `assembly_id` | Host on `create_assembly` / New Assembly / import |

There is no `surfId` and no UUID `id` after host open. Copy mints a new `part_id` and sets `copiedFrom`.

- **Uniqueness.** Part id is unique among part scripts in the vault (one file). Assembly id is unique among assemblies. **Names are not unique** and must not be used as keys.
- **Lookup.** Tools target `{ part_id }` and `{ assembly_id }` **only**. Missing or unknown → `{ code: "unknown_part" }` or `{ code: "unknown_assembly" }`. **Do not** accept a vault path, a display name, or a UUID. There is **no** `path` argument and **no** deprecation cycle (pre-release; do not take on that debt). **Do not** fall back to the active part when the caller passed a different `part_id`. **Do not** write the active part because `selection.cadPartId` moved.

Writers that mutate a part script or placement **MUST take `part_id`** and refuse a mismatch (`code: "part_mismatch"`). `create_part` atomically sets `parts.activeId` **and** `selection.cadPartId` to the new id before return.

`create_assembly` returns `{ assemblyId, assemblyName, activeId, partCount }`. `open_assembly` takes `assembly_id` only. `name` is not a lookup. `list_assemblies` / `rename_assembly` / `delete_assembly` use `assembly_id`.

`open_part` / `insert_part` take `part_id` and/or `assembly_id` (insert-as-reference = list that `part_id` in the open assembly).

### 3.2 No paths in the contract

Repo paths are `f(id)` (`parts/<part-id>.js`, `assemblies/<assembly-id>.surf.json`). Tools never send `path` and results never include a `path` field. `rename_part` / `rename_assembly` change **display name** only (WC). Response: `{ partId, name, moved: false }`. No git. The committed header / `.surf.json` name updates on the next Save.

`git_add_to_repo` is an alias of `git_save`.

### 3.3 What counts as a Save

A git write of vault content happens only when:

1. The user clicks Save, or
2. The agent calls `git_save { message }` after write consent, or
3. The user confirms **Upgrade vault** / the agent calls `git_upgrade_vault { confirm: true }` after consent (layout commit of remote bytes; a dirty WC then gets a normal Save under the same confirmation), or
4. The user confirms **Overwrite** / **Save mine to a new branch** from the Save-conflict or main-moved dialog (agent: `git_force_overwrite` / `git_behind_resolve { action: "branch" }` + `confirm: true`).

**Get latest** is not a git write. It still needs `confirm: true` for agents (`git_behind_resolve { action: "reload" }`).

No other tool may `commitFiles`, push, `createRepo`, seed, enqueue, or flush — including `create_assembly`, `create_part`, `rename_*`, `open_*`, `insert_part`, `paint_confirm`, groups, `set_script`, `insert_*`, `run`, and **coming back online**.

| Tool | Git? |
| --- | --- |
| `git_save` | Yes — planner + one commit. Message required. On a **legacy** vault: do not write v1; return `upgrade_required` and let the host prompt Upgrade vault. |
| `git_upgrade_vault` | Yes — one commit of **remote** bytes to v2 + deletes. `confirm: true`. Consent. If the WC is dirty, the host then runs a normal Save (second commit) under that same confirmation. |
| `git_add_to_repo` | Alias of `git_save`. Prefer `git_save`. |
| `git_list_branches` | Read only. |
| `git_branch_create` / `switch` / `delete` | Branch APIs only. Switch while dirty and delete need `confirm: true`. Create switches when clean (or with confirm if dirty). |
| `git_force_overwrite` | Destructive; `confirm: true`. Overwrite as §2.9. |
| `git_behind_resolve { action: "reload" }` | **Get latest.** Not a git write. Destructive; `confirm: true`. Replaces WC conflicting files from the remote tip; rebuilds lastCommit. |
| `git_behind_resolve { action: "branch" }` | Destructive; `confirm: true`. **Save mine to a new branch.** `action: "keep"` is **removed** (Dismiss is not a tool). |
| `git_move_to_repo` | First Save of a **local** assembly. Consent. |
| Everything else | Working copy only. |

Vault repo creation happens on the first explicit Save / `git_move_to_repo`, not on New Assembly, connect, or `create_assembly`.

### 3.4 What tools may mutate

| State | Tools may | Tools must not |
| --- | --- | --- |
| Working copy (doc + scripts + `rev`) | create/rename/delete part or assembly (local), paint, groups, joints, transforms, `set_script`, insert/open (local rows) | Remint ids; commit; replace the doc from a stale snapshot; invent an empty script for a missing part |
| `BranchTip` / `AssemblyCommit` | Get latest (rebuild from remote tip) | Any other tool; Save / Upgrade write the records after a commit |
| Git adapter | `git_*` listed above | Any other command |

```
parts: {
  assemblyId: string,
  assemblyName: string,
  vaultLayout: "v2" | "legacy",
  activeId: string,
  parts: [{ id, name, visible, missing?, group? }]
}
dirty: {
  unsaved: boolean,              // WC differs from AssemblyCommit (or commit is empty)
  pendingSave: boolean,          // offline planned write waiting for a second Save
  editedSinceLoad: string[],     // part ids
  workspaceDirty: boolean,
  partIds: string[],             // dirty part ids
  assemblyDirty: boolean,        // name / groups / colors / joints / order / placement
  upgradeRequired: boolean       // legacy vault; Save will prompt Upgrade
}
```

`editedSinceLoad` and `partIds` list **every** edited part (T5). A new part is dirty. A `missing` row is not “edited” unless the user changed instance data. Changing `activeId` does not set `assemblyDirty`.

`list_assemblies` (when shipped): `[{ id, name }]`.

### 3.5 Shared parts and delete (agent)

- Insert-as-reference: `insert_part { part_id }` or `insert_part { assembly_id }` (all parts of that assembly, same ids). Same `part_id` in several assemblies. `set_script` / `rename_part` on that id affects every parent’s WC view of the script/name.
- Copy: a dedicated copy tool or `insert_part { part_id, copy: true }` mints a new id + `copiedFrom`. Host may still show the copy-or-reference prompt for UI inserts.
- `delete_part { part_id, scope: "assembly" | "repo" }`. `repo` is **Delete from repo** (§2.7). If other parents exist, `scope: "repo"` → `part_still_referenced` (no file delete). Neither scope commits; Save does.
- `delete_assembly { assembly_id, confirm: true, delete_parts?: boolean }`.

### 3.6 Concurrency and idempotency

- **`create_assembly`.** Single-flight per tab. Overlapping calls join and return the same `{ assemblyId, assemblyName, activeId, partCount }`. A retry after success is a new assembly only if the previous call settled. **No git write.** Optional `name` is a label; do **not** invent `Assembly (N)` to satisfy path uniqueness (names may collide). Do not persist a second document until the first call returns.
- **Versioned writes.** WC `rev` is monotonic. A host write-back is rejected if `result.baseRev !== currentRev`, except adopting an unedited shared part’s new committed bytes. A stale `set_script` / `create_part` must not `rememberAssembly` over a newer doc (T17).
- **`create_part`.** One row, one `id`, `activeId` + `cadPartId` set, then return. No git.
- **`open_assembly`.** Requires `assembly_id`. Unknown → `unknown_assembly`. Read-only vs git.
- **Idempotent Save.** `git_save` when `dirty.unsaved === false` and not `pendingSave` → `{ status: "clean" }`, no commit. `pendingSave` + Save again → push (or re-plan / conflict).
- **Upgrade.** `git_upgrade_vault` without `confirm: true` → `confirm_required`. On v2 → `{ status: "already_upgraded" }`, no commit. The Upgrade commit is remote bytes only. A dirty WC then gets a normal `git_save` (or the host Save) as a second commit under that same confirmation.
- **Get latest.** Confirmed replace of conflicting WC files from the remote tip. Allowed even if `rev` moved for those files. Does not `commitFiles`.

### 3.7 Error contract

Bridge refusals stay `isError: true` with `code` + `message` (+ `details`).

| Code | When | Agent should |
| --- | --- | --- |
| `unknown_part` | `part_id` not in the open document | `parts`, then retry with a listed id |
| `unknown_assembly` | `assembly_id` not known | `list_assemblies` |
| `part_mismatch` | Tool implied active part ≠ `part_id` | Pass `part_id` |
| `no_assembly` | No open document | `create_assembly` or `open_assembly` |
| `unsupported_vault_version` | v1 / folder-layout vault after PR 10 removed the legacy module | Tell the user this app no longer opens that vault |
| `missing_part` | Row exists, vault file does not | Do not `set_script` an empty body; tell the user |
| `part_still_referenced` | Delete-from-repo but another assembly lists this id | `scope: "assembly"` or delete those parents first |
| `upgrade_required` | `git_save` on a legacy vault | `git_upgrade_vault { confirm: true }` after the user agrees |
| `already_upgraded` | Upgrade on v2 | Continue with `git_save` |
| `git_only` | Vault-only tool in local mode | `git_move_to_repo` or stay local |
| `consent_pending` | Real-repo write; Allow dialog up | Wait `retry_after_ms`, same call |
| `real_repo_blocked` | Headless or session Deny | Tell the user; do not loop |
| `confirm_required` | Destructive git without `confirm: true` | Ask the user; only then pass `confirm: true` |
| `conflict` / `repo-moved` | Save (or main-moved) and compare overlaps planned files | `git_force_overwrite`, `git_behind_resolve { action: "reload" }` (Get latest), or `{ action: "branch" }` with confirm; or stop (Dismiss) |
| `pending_save` | Offline plan waiting | Tell the user to Save again when online |
| `feature_failed` | Kernel/script error | Same text the UI shows (T16 — MCP batch; contract still requires it) |

Never return a generic `"Feature failed"` as the only message. Never pass `confirm: true` unless the user asked for that destructive action. **Do not** return `path_less_parts` or `vault_tree_unavailable` for occupancy (occupancy is gone). A `path` argument is `unknown_part` / `unknown_assembly` (or `bad_args` if the schema rejects it). `listTree` may still be used to scan references on delete; failure there is fail-closed (`part_still_referenced` / refuse delete), not “empty tree.”

### 3.8 Stop relying on these current behaviours

| Today | Stop |
| --- | --- |
| Dual `id` (UUID) + `surfId` | One part `id` (surf-id) |
| `part_id` that is a UUID or a vault path | Surf-id `part_id` only — no `path` alias |
| Assemblies identified by folder `name` | `assembly_id`; name is a non-unique label shown as written |
| `assemblies/<Name>/<Part>.js` and `-2` suffixes | `parts/<id>.js`; no occupancy |
| Rename as a git move | WC name edit; Save writes the same `f(id)` file |
| `parts[].path` in results or as identity | Omit `path` from results; ids only |
| Paint / rename / insert / copy / delete flushing git | WC only; Save later |
| `create_assembly` creating a vault or leaving strays | Local, single-flight, one `assemblyId` |
| `open_assembly` of a missing name returning success | `not_found` / `unknown_assembly` |
| `create_part` leaving active ids on the old part | Atomic activate |
| `set_script` / `insert_*` without `part_id` | Require `part_id` |
| `git_add_to_repo` as a second commit shape | `git_save` |
| `git_behind_resolve` keep; per-part overwrite | Overwrite / Get latest / Save mine to a new branch / Dismiss |
| `online` flushing | Never |
| Tip-vs-tip conflict | File-level compare of **this** Save’s paths |
| Auto layout/id migrate commits | Explicit Upgrade vault only |
| README / index of names | Names only in headers and `.surf.json` |

`T1` (create_part should run) and `T16` (real error text) stay on the MCP batch. The host must still expose `runState` / volume / bbox on create-if-run, and real error strings on `errors` / insert / run.

---

## 4. Migration

On first load after upgrade, **do not flush the outbox.** Never write git on open/reload.

### 4.1 Working-copy ids (local + git, no vault write)

For each IDB row, pick one part id and rekey scripts once: `// @surf-id` if valid → else existing `surfId` / surf-id-shaped `id` → else mint. Drop `surfId`. UUID-only and path-as-id rows take this once. Same id after a source flip. Stamp `// @name` (and the id header if missing) on the next **explicit** Save or on Upgrade vault — not on load.

New Assembly / `create_assembly` / import already mint an assembly id onto the IDB document.

### 4.2 Legacy vault = read-only git (legacy reader)

**Temporary.** The legacy reader and Upgrade vault live in **one isolated module**, `src/utils/git/legacyVault/`, with a **single entry point** (`index.js`). Every file in that folder starts with:

```
// TEMPORARY: remove after Artur's vault is upgraded
```

Nothing outside that folder parses v1 paths or plans a v1→v2 commit. Callers import only the entry point (detect / open / plan-upgrade). PR 10 deletes the folder and those call sites (§6).

A vault is **legacy** when `surfcad.json` is version `1`, or the tree still has `assemblies/<Name>/.surf.json`, `assemblies/<Name>/<Part>.js`, or `parts/<Name>.js` whose stem is not a surf-id.

Until PR 10, the app **opens** it through that module (today’s path-keyed parse). Map into the WC by id (`// @surf-id` / backfill). The WC is editable. **No v1 write.** `dirty.upgradeRequired` is true.

A missing legacy blob is a `missing` row, not an empty script, not auto-removed.

**After PR 10** (Artur has confirmed his vault is upgraded): a v1 / folder-layout tree is **not** opened. The host shows **unsupported vault version** and tools return `{ code: "unsupported_vault_version" }`. No Upgrade button, no `git_upgrade_vault`.

### 4.3 Upgrade vault (the only v1→v2 writer)

One-time, explicit, user-confirmed. Agents: `git_upgrade_vault { confirm: true }` after consent. **Never** runs on load, reload, connect, or a quiet Save.

**Save on a legacy vault** does not write v1. It **prompts Upgrade vault**. Dismiss → no write. Confirm → the split below.

**Split (two commits when the WC is dirty):**

1. **Upgrade** is a **pure layout migration of the remote / tip bytes** in one commit. It does not fold WC edits into that commit.
2. If the WC has edits, a **normal Save** runs right after, under the **same** confirmation (second commit: WC vs the new v2 `AssemblyCommit`). If the WC is clean, stop after the Upgrade commit.

Upgrade commit:

1. Keep part ids from `// @surf-id` headers in the **remote** blobs. Mint where missing (no header, no `parts[].id`). Assembly ids: mint one per legacy folder; persist on IDB.
2. Write `surfcad.json` version `2`.
3. Write every `parts/<part-id>.js` (header id + `@name` from the remote row/header) and sidecar `parts/<part-id>.mesh` from the remote blob.
4. Write every `assemblies/<assembly-id>.surf.json` (v2, no paths, `groups[].source` → minted assembly id when that folder still exists).
5. **Delete** every legacy path in the same commit: `assemblies/<Name>/…`, name-based `parts/<Name>.js`, leftover `.gitkeep` optional. Do not invent a README index. **Delete `README.md` only if it is byte-identical to a known old seed text**; otherwise leave it. Save never writes README.
6. Build `BranchTip` + every `AssemblyCommit` from the new tree.

A second Upgrade is a no-op (`already_upgraded`). Partial failure: do not adopt v2 lastCommit; WC stays; user retries Upgrade (idempotent: writing the same `f(id)` bytes, deletes of already-gone paths are fine). If Upgrade succeeded and the follow-up Save conflicts, show §2.9 on that second commit only.

### 4.4 leftover outbox / #585 flags

Leave queued save/rename/delete **unflushed**. Do not replay stale snapshots. If `pendingRepoDeletes` exist, the WC already lacks those rows; after Upgrade / first v2 Save the planner deletes unreferenced files. `pendingOldAssemblyName` is meaningless (no moves); drop it.

---

## 5. What gets deleted

After the sequence below is green:

- `enqueueAssemblySave` as a git writer; `online` listener; outbox as the paint/group/insert/copy/delete/rename path
- `commitPartToRepo` / `deletePartFromRepo` / `commitWorkspace` as separate commit APIs
- `prepareAssemblySurfWrite` promoting paths; `adoptPreparedSurfWrite` full-doc write-back
- `ensureAssemblyVaultPaths`, occupancy, `vaultPartFileStem` `-2`
- **`planRenameVaultPartPath`, `gitRename`, `gitAssemblyRename`**, `baselineAfterAssemblyRename`
- `captureBaseline` via `stringifySurfJson(WC)`; incremental `baselineAfterPartSave` / `baselineAfterPartRename`
- Auto `migrate-layout` / `migrate-ids`; `vaultImplicitWrite` skip list
- Dual `part.surfId` vs `part.id`; UUID mint for parts (`newLocalPartId` for parts)
- lastCommit / last-opened keyed by folder name
- Per-part overwrite chrome; `git_behind_resolve` `keep`
- README name index (never added)

**Keep:** `mintSurfId` / `isSurfId` as **the** id; adapter (`compare` used for conflict); v2 list/open; consent modal; conflict UI (Overwrite / Get latest / Save mine to a new branch / Dismiss); delete-assembly / delete-repo confirms; reference-counting on delete; copy-or-reference prompt.

**Keep only until PR 10:** `src/utils/git/legacyVault/` (reader + Upgrade). Then delete it.

---

## 6. PR sequence

Each PR has tests, keeps CI green, does not touch `src/fea/**` or `surfcad-fea/**`. #585 may merge first (implicit-write stop). Later PRs ignore its pending-name flag and consume pending deletes via lastCommit. **Small PRs. Reader and Upgrade early. Path planning / rename / outbox last.**

| PR | What | Size | Done when |
| --- | --- | --- | --- |
| **0** (this) | `docs/git-save-model.md` | S | Reviewable contract + 12-case table |
| **1** | v2 `validateSurfJson` + `f(id)` path helpers + header `@name`. No git write. Catalog / `assembly.schema.json` grows a v2 branch. | S | v2 fixtures validate; v1 fixtures still validate in the legacy parser; v2 file rejected by v1 parser |
| **2** | Isolated `src/utils/git/legacyVault/` (entry `index.js`, banner `TEMPORARY: remove after Artur's vault is upgraded`). Legacy reader: open v1 tree into WC by id; `missing` row; `vaultLayout: "legacy"`; **no write**. IDB identity collapse (UUID/path → surf-id). | M | Open Gearbox-style vault; ids stable across reload; no `commitFiles`; no v1 parse outside `legacyVault/` |
| **3** | Persist `BranchTip` + `AssemblyCommit`; capture from open/tip. No write-path change. | S | Reload restores hashes; path-less capture does not throw |
| **4** | **Upgrade vault** inside `legacyVault/` + `git_upgrade_vault` (confirm). One commit of **remote** bytes → v2 + deletes. Dirty WC → normal Save as a second commit under the same confirm. Delete README only if it matches a known old seed. Idempotent retry. Save on legacy **prompts** Upgrade (no v1 write). | M | Remote tree is v2; WC edits land only in commit 2; no write on load; upgrade plan only exported from `legacyVault/` |
| **5** | `writeVaultCommit` + adapter spy (allowlist shrinks). Seed without README index; seed-retry if createRepo succeeded. | S | Harness exists; seed retry unit |
| **6** | Pure `planSave` + unit tests for the **12 cases** (§7). No moves. Shared-part adopt. Delete-from-repo reference rule. File-level compare input. | M | Tests pass; not wired |
| **7** | Wire user Save + `git_save` on **v2** vaults. Conflict UI: Overwrite / Get latest / Save mine to a new branch / Dismiss (Save and main-moved). Offline pending (second Save pushes). `online` not a writer. No repo create before first Save. | L | One commit; rename is not a move; sibling Save does not conflict; Get latest writes no git |
| **8** | Agent contract: `part_id` / `assembly_id` only — **no `path` field or alias**; `unknown_*`; `upgrade_required`; writers require `part_id`; single-flight `create_assembly`; versioned writes; `open_part` by id. | M | Agent goldens; T3/T17/T19 host-side; `parts` / `list_assemblies` have no `path` |
| **9** | Delete dead APIs: path planning, `planRenameVaultPartPath`, `gitRename`, `gitAssemblyRename`, outbox write path, dual-id helpers. Goldens expect WC-only then `git_save`. | M | Spy allowlist = `writeVaultCommit` + tests + Upgrade |
| **10** | **Delete legacy reader + Upgrade vault once Artur confirms his vault is upgraded.** Remove the isolated module and every call site. After this, a v1 vault shows **unsupported vault version**. | S | `legacyVault/` gone; v1 open → `unsupported_vault_version`; no Upgrade UI or `git_upgrade_vault` |

**PR 10 — exact removals** (landed by PRs 2 and 4; do not scatter v1 code elsewhere):

| Remove | Why |
| --- | --- |
| `src/utils/git/legacyVault/` (entire dir: `index.js` entry, `reader.js`, `upgrade.js`, known-seed README bytes) | Temporary v1 reader + Upgrade planner |
| `src/utils/git/upgradeVaultEnabled.js` | Upgrade feature flag; unused once Upgrade is gone |
| `lastCommitBlobSources` import in `src/utils/git/lastCommit.js` | Drop the `legacyVault/reader.js` import (`lastCommitBlobSources`); keep `lastCommit.js` (core v2 §2.4) |
| Imports of `legacyVault` from `src/App.jsx` (open vault, Save-on-legacy prompt) | Only callers of detect / open / plan-upgrade |
| `git_upgrade_vault` in `src/agent/commands/git.js`, `src/agent/commands.json`, `src/agent/export/commandMeta.js` | Agent Upgrade |
| `upgradeRequired` / `vaultLayout: "legacy"` on `parts` / `dirty` (`src/agent/state/dirty.js` and `readParts` in `src/App.jsx`) | Agent flags for the temporary path |
| Upgrade-vault UI in `src/components/PartFeed.jsx` (or the Save prompt that calls it) | User confirm for Upgrade |
| Tests that import `legacyVault` (`test/legacy-vault*.js`, `test/git-upgrade-vault*.js`, and any goldens that Upgrade) | Dead with the module |

Do not combine 7+8. Host contract (8) can start once 7 is on a branch. PR 1+2 must precede Upgrade (4). Do not write v2 until 1 is in. PR 10 waits on Artur’s confirmation; it is not bundled with 9.

---

## 7. Twelve cases

`A`, `B` = assemblies. `P` = a part. Remote = commits after `BranchTip.tipSha`. Planned files never include `README.md`.

| # | Case | Planner writes | Conflict? | Notes |
| --- | --- | --- | --- | --- |
| 1 | **New assembly** | `assemblies/<A>.surf.json` + `parts/<P>.js` (+ mesh) for seed parts | Only if those exact new paths already changed on the remote (id collision — should not happen) | First Save may also seed `surfcad.json` v2. Names are labels. |
| 2 | **Assembly rename** | `assemblies/<A>.surf.json` only (`name` field) | If remote also changed `assemblies/<A>.surf.json` | **No move.** Other parents not rewritten. |
| 3 | **New part** | `parts/<P>.js` (+ mesh) + `assemblies/<A>.surf.json` | If remote changed either of those files | Unsaved parts never block. Path is `parts/<P>.js` from mint. |
| 4 | **Part rename, one parent** | `parts/<P>.js` (`// @name`) + `assemblies/<A>.surf.json` (`parts[].name`) | If remote changed either | Same path. Not a move. |
| 5 | **Part rename, several parents** | Same as #4 for the Save of `A`. **Do not** write `assemblies/<B>.surf.json` | If remote changed `parts/<P>.js` or `A`’s file | Rename applies everywhere via the shared file. `B` adopts the new part hash (not a conflict). `B`’s committed `parts[].name` catches up on `B`’s next Save. |
| 6 | **Existing part added** (reference) | `assemblies/<A>.surf.json` only (new row, same `P`) | If remote changed `A`’s file | No new part file. Copy instead → case #3 with new id + `copiedFrom`. |
| 7 | **Remote changed part-only** | If this Save touches `parts/<P>.js` → **conflict**. If this Save is assembly-only (paint, group, add other part) → **no conflict** | File-level | Unrelated part edits do not block an assembly-only Save. Get latest on a part overlap replaces that part in the WC only. |
| 8 | **Remote changed assembly** | If this Save writes `assemblies/<A>.surf.json` → **conflict**. Save of `B` → **no conflict** | File-level | Saving `A` never makes `B` conflict with `A`’s own commit (`BranchTip` advanced). Get latest on an assembly overlap replaces `A`’s `.surf.json` in the WC only. |
| 9 | **Overwrite assembly** | Re-plan vs current remote tip; write **my** `assemblies/<A>.surf.json` | n/a (forced) | Remote part files stay if not in the plan. Get latest is the no-write counterpart (WC takes remote `A`). |
| 10 | **Overwrite part** | Re-plan; write **my** `parts/<P>.js` | n/a | Remote assembly file stays if not in the plan. No per-part overwrite UI. Get latest replaces that part in the WC. |
| 11 | **Overwrite both** | Re-plan; write my assembly file **and** my part file(s) | n/a | Other remote files stay. Get latest replaces both in the WC; no git write. |
| 12 | **Normal save** | Union of dirty assembly file + dirty part files + deletes (§2.7) | No — tip matches, or compare has no overlap | One commit. Advance `BranchTip` + this `AssemblyCommit` + adopt shared part hashes. |

---

## 8. Test plan

- **Harness.** Test adapter records `commitFiles` / `createRepo` / `compare`. Production import graph: only `writeVaultCommit` (plus test seed). CI fails on a new call site.
- **Planner units.** All 12 cases. Delete last parent vs still-referenced. Shared-part adopt (B clean vs B dirty). Offline pending (no `online` flush). Seed retry. Missing part (no empty script). Legacy Save → no v1 write.
- **Upgrade.** Remote bytes only in commit 1; dirty WC → commit 2 is a normal Save. Header ids kept; minted where missing; README deleted only when it matches a known old seed; second Upgrade no-op; no write on open.
- **Get latest.** Replaces only conflicting WC files; rebuilds `AssemblyCommit` + `BranchTip`; `commitFiles` count unchanged. UI confirm when those files are dirty; agent always `confirm: true`.
- **Identity.** UUID/path rows → one surf-id on open, no git write. Source flip keeps ids. Copy mints + `copiedFrom`. v2 validator rejects `path` and missing `id`.
- **Host.** Paint / group / create_* / `online` / reload: `commitFiles` count unchanged. Save: one commit. `create_assembly` overlap: one document. Stale `rev` write-back rejected.
- **Goldens.** `smoke_face_paint`, `smoke_agent_part_rename_commit`, `golden:agent-bridge-h12`: rename is local; `git_save` is the commit; **no move**. Keep `git-vault-reload-no-write`.
- **Rebase.** `test/git-assembly-save-unsaved-parts.test.js`, `git-stable-part-id`, `git-stray-promote`, `agent-git-path-less`, `part-rename-commit`, `vault-rename`, `assembly-rename-commit` onto planner + `f(id)` (rename tests become “same path, new `@name`”).

---

## 9. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Old app cannot open a v2 vault | Upgrade is explicit; v1 bytes stay until the user confirms. Old app on a v2 remote is unsupported (same as any breaking vault bump). |
| Two clients mint the same surf-id | 1 ms + 4 hex; treat as a compare conflict on that path if it ever happens. |
| Shared part: B had local edits while A saved | B stays dirty; `BranchTip` advanced so B does not “conflict” with A; B’s next Save overwrites the shared file (last Save wins). |
| Compare API truncated file list | If `compare.files` is incomplete, fail-closed: treat as conflict. |
| Offline pending then remote overlap | Second Save re-plans / conflicts; `online` does not push. |
| Upgrade crash mid-commit | Git commit is atomic. If the request failed, tree is still v1; retry Upgrade. |
| MCP team still sends paths as ids | Schema rejects `path`; host returns `unknown_part` / `unknown_assembly` / `bad_args`. |
| leftover README from old seed | Delete on Upgrade only if byte-identical to a known old seed; otherwise leave it. Save never touches it. |

Rollback: revert PRs 9→4 in reverse (PR 10 only after Artur’s vault is v2). lastCommit in IDB is advisory. A vault that never ran Upgrade is still v1 and needs `legacyVault/` (or, after PR 10, shows **unsupported vault version**). A vault that ran Upgrade is v2; rolling back the app without the v2 reader cannot open it — say so in the Upgrade confirm.

Feature flag optional (`SAVE_MODEL_V2`) around PR 7; default is sequential green PRs.

---

## 10. MCP feedback (T1, T3, T5, T16–T19)

| Item | This redesign |
| --- | --- |
| **T1** create_part doesn’t run | **Out of scope** (host run-on-create). |
| **T3** vault paths without `git_save`; UUID replaced by path | **Fixed.** One part id; no `path` in tool args or results. |
| **T5** `dirty.editedSinceLoad` incomplete | **Fixed** if dirty is AssemblyCommit vs WC by part id. |
| **T16** error text not exposed | **Out of scope.** §3.7 still requires the UI string. |
| **T17** active part desync / overwrite | **Host-side fixed** by one part id, atomic `create_part`, required `part_id`, versioned writes. |
| **T18** Overwrite-main / paths / invalid `.surf.json` with no git_* | **Fixed / moot.** No implicit writers; no path-less serialize of WC; conflict only on Save (file-level). |
| **T19** stray assemblies | **Fixed** by single-flight `create_assembly`, no vault write on create, stable `assemblyId`. |

T7 / T8 / T9 are MCP-batch product work; §3 already requires `assembly_id`, `unknown_assembly` / `not_found`, and single-flight.

---

## 11. Open questions

**Resolved.** Surf-id format (not UUID). `.surf.json` **version 2** (v1 cannot express “no path”). `surfcad.json` version 2 is the upgrade marker. `groups[].source` is an assembly id. Mesh sidecar stays `.mesh`. One row per part id per assembly. Save never writes or regenerates `README.md`. `online` never writes. Conflict dialog (Save and the main-moved notice) is **Overwrite / Get latest / Save mine to a new branch / Dismiss**; Get latest never writes git; no per-part overwrite. MCP: `part_id` / `assembly_id` only — no `path` arg or result field. Names shown as written. Legacy reader + Upgrade are temporary (`src/utils/git/legacyVault/`); after PR 10 a v1 vault is **unsupported vault version**.

1. Header is a separate `// @name <display>` line under `// @surf-id`.
2. Upgrade is a pure layout migration of the **remote** bytes in one commit. If the WC has edits, a normal Save runs right after under the same confirmation (two commits).
3. A deleted assembly’s id in a sibling’s `groups[].source` is a dangling label, cleaned on that sibling’s next Save.
4. On Upgrade, delete `README.md` only if it is byte-identical to a known old seed text; otherwise leave it.
5. **No `path` alias** and no `path` in results. Tools accept only `part_id` / `assembly_id` (pre-release; no deprecation cycle).
6. Duplicate names are shown **as written**, with no short-id suffix or other disambiguation.

**Still open:** none.
