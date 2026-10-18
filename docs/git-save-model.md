# Git SAVE MODEL

Redesign of how SurfCAD writes the Git vault. On-disk layout stays [`vault-schema.md`](vault-schema.md) except for the optional assembly `id` in §2.1. This document is the write model: when git is touched, what is compared, and what the agent/MCP team can rely on.

**Standing rules (unchanged):** git writes only on a requested action — never on load, reload, edit, or autosync. Saving is never blocked by unsaved parts (they land at `assemblies/<Assembly>/<name>.js` in that one commit). No periodic auto-save. Destructive git actions need `confirm: true` for agents. Repo delete keeps its confirm.

**Identity (Artur):** every part and every assembly has **one** permanent id, assigned at creation, unrelated to path, name, or local/git. The same id is used in the working copy, the agent contract, script headers, `.surf.json`, and `lastCommit`. Switching source never remints it.

**#585.** Open hotfix [PR #585](https://github.com/artur0x0/surfcad/pull/585) stops tonight’s implicit writers (paint, group, insert, copy, delete, rename, New Assembly, GitHub connect, `online` flush) and lets `captureBaseline` tolerate path-less rows. After that, a later Save cannot reconstruct “delete this vault file” or “this assembly used to be named X” unless extra per-action flags (`pendingRepoDeletes`, `pendingOldAssemblyName`) are piled on. Those flags are the symptom: the working copy and the last committed tree are not a clean pair, so every action has to remember what Save should do. This redesign replaces that with one persisted last-commit record (keyed by assembly id) and one planner.

---

## 1. Problems with the current design

The live model is an **outbox of file snapshots** plus a **baseline captured by re-serializing the working copy**. Many App handlers assign vault paths, enqueue files, and flush. Identity is split (path vs UUID vs `surfId`; assemblies have only a folder name). That is why the same classes of bug keep coming back.

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

`ensureAssemblyVaultPaths` (`src/utils/git/partVaultPath.js:148`) and `prepareAssemblySurfWrite` (`gitCommit.js:102`) mint `assemblies/<Assembly>/<Name>.js` and, for non-stable ids, **replace the row id with the path** (`partVaultPath.js:203`). `readParts` then reports that path (`App.jsx:8575`). Agent T3: `parts[].path` appears while `dirty.unsaved` is true. #555 / #573 / SKILL already say “no path until `git_save`”; the write helpers still assign early.

### 1.3 Two identities, no assembly id (bug class H)

A part today may have a UUID row `id` (local / agent `#573`), a `surfId` (`// @surf-id` / `.surf.json` `parts[].id`), and/or a vault path used as `id`. `findAssemblyPart` looks up all three. Assemblies have **only a folder name** (`vault-schema.md`: “Assemblies have no surf id”). Rename, last-opened (`surfcad.lastAssembly`), `open_assembly { name }`, and `lastCommit` keyed by segment all break or fork across rename-then-reload. T19 retries mint another *name*, not another id.

### 1.4 Baseline is a serialize of the working copy (bug class C)

`captureBaseline` (`gitWorkspace.js:84`) calls `stringifySurfJson` → `toSurfJson` → `validateSurfJson`, which requires `parts[N].path` (`surfJson.js:149`). A path-less working copy throws `Invalid .surf.json: parts[N].path must be a repo-relative path` (T18 toast). Dirty (`isAssemblyDirty`, `:122`) takes the same path. After #585 the throw is patched; the design is still “re-serialize WC to learn what git has.”

### 1.5 Stale-doc write-back (bug class D)

`enqueueAssemblySave(next)` snapshots `next`, then `adoptPreparedSurfWrite` → `rememberAssembly(prepared.doc)` (`App.jsx:4337`). `applyOverwriteFiles` replaces the open document from committed `.surf.json`, including `activeId` (`gitCommit.js:1241`). A later `create_part` / `set_active_part` is overwritten. T17: Frame’s script became the new part’s seed cube; `activeId` and `status.partId` desynced from `selection.cadPartId`.

### 1.6 Save planner cannot see deletes or old names (bug class E)

`buildCommitFiles` (`gitCommit.js:413`) **does not delete** parts removed from the document. Assembly rename only remaps if `baseline.assemblyName !== doc.name`. After #585, local delete/rename leave no outbox, so Save cannot emit the file delete or the folder move unless extra pending flags are stored. That is the design hole.

### 1.7 Many `commitFiles` call sites (bug class F)

`adapter.commitFiles` is used from `flushSyncQueue` (`syncWorker.js:116`), `commitPartToRepo` / `deletePartFromRepo` / `commitWorkspace` / `forceMergeCommit` / `saveLocalOnNewBranch` (`gitCommit.js`), `findOrCreateVault` seed (`vault.js:120`), `moveToGit` (`gitMoveToGit.js:183`), and `checkInMineToBranch` (`gitPull.js:342`). “The worker is the only writer” is not true.

### 1.8 `create_assembly` is not single-flight (bug class G)

`create_assembly` (`src/agent/commands/document.js:19`) always calls `handleNewAssembly` (`App.jsx:5456`), which always mints a new name via `nextAssemblyName`. Retries leave Assembly (1)…(5) (T19). Each call is a new IndexedDB document; on main it also created/wrote the vault.

### Failure classes from the last ~3 weeks of fixes

| Class | PRs | Recurrence |
| --- | --- | --- |
| Implicit write on load/reload (`migrate-layout` / ids) | #573 | Kettle-MCP unrequested commit (ed445bd) |
| Implicit write on edit / New Assembly / `online` | #585 (open), tonight | T18 |
| Path assigned early; UUID replaced by path | #555, #573 | T3; SKILL already forbids this |
| Dual part ids; assemblies named only by folder | #573, tonight | T17/T19; rename-then-reload |
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

### 2.1 One id per part, one id per assembly

**Format.** Keep the existing surf-id: `yyyy-mm-dd-hh-mm-ss-SSSS-xxxx` (`mintSurfId` / `isSurfId` in `src/utils/git/surfId.js`).

**Why not UUID.** Vault scripts already start with `// @surf-id <surf-id>`. `.surf.json` `parts[].id`, `groups[].partIds`, `colors` keys, and joint `a.part` / `b.part` already store that string. A UUID row `id` beside it (#573 local/agent) is the two-id model Artur rejected. Switching the vault to UUID would rewrite every committed header and every `.surf.json` on Save. One mint, one validator, one field.

**Part `id`** is that surf-id. It is assigned once at creation (UI +Part, `create_part`, New Assembly seed, import, copy). It is used as:

- in-app row `id` and IndexedDB script key
- agent `part_id`
- `// @surf-id` header
- `.surf.json` `parts[].id`
- `groups[].partIds`, `colors` keys, joint part refs
- `lastCommit.parts` keys
- WC `activeId` / `selection.cadPartId` / `status.partId`

There is **no** separate `surfId` field after migration. Copy mints a **new** id and sets `copiedFrom` to the source id. Rename, Save, reload, and local↔git never change it.

**Assembly `id`** is the same surf-id shape, minted at New Assembly, `create_assembly`, or import. It is stored on the IndexedDB document and, after the next explicit Save, as a new top-level `.surf.json` field:

```
{ "format": "surfcad.assembly", "version": 1, "id": "2026-10-18-02-50-00-0001-aa01", "name": "Gearbox", … }
```

`lastCommit`, the planner, rename/move, last-opened, and agent tools key assemblies by this id, not by folder name. Until a legacy vault assembly is Saved, the host matches it **by folder** and holds the minted id only in IndexedDB (see §4).

**`.surf.json` / `validateSurfJson` (compatibility).** Do **not** bump `version` to 2. Today `version` must be `1` (`surfJson.js:132`) and unknown top-level keys are errors (`:130`). Bumping version *and* adding `id` would each break old readers; one optional field is enough.

| Change | Detail |
| --- | --- |
| `TOP_KEYS` | Add `id` (today: `format`, `version`, `name`, `activeId`, `parts`, `groups`, `colors`, `joints`). |
| `id` present | Must pass `isSurfId`. Duplicate ids across assemblies are a vault concern, not this file’s validator. |
| `id` absent | Valid (legacy). Host mints locally on open; does not write git. |
| `version` | Stays `1` on read and write. |
| Catalog | `assembly.schema.json`: optional `id` (surf-id pattern); `additionalProperties` still false. |

**Old builds.** A file that includes `id` is rejected by today’s validator (`unknown key "id"`). The reader change (add `id` to `TOP_KEYS`) must land **before** the first Save that writes `id`. Builds older than that PR cannot open a post-Save file. There is no “older readers ignore it” path: unknown keys are already hard errors. Shipping the reader in PR 1, and writing `id` only from Save (PR 4+), keeps the window to one release.

**Working-copy document:**

```
AssemblyDoc {
  id,                    // surf-id; always present in memory after open/create
  name, source, rev,     // rev increments on every local mutation
  activeId,              // part id (surf-id), never a path
  parts, groups, colors, joints
}
PartRow { id, name, visible, order, position?, placement?, copiedFrom?, linkPath? }
```

- `linkPath` — only when the row is a **reference** to an already-committed vault file (insert / open). Not an assignment; the planner copies it into `.surf.json`.
- New and copied parts have **no path** until Save.
- Scripts keyed by part `id`.

Display path (Parts subtitle, `parts[].path`) is a **projection of `lastCommit.parts[id].path`**. After Save, lastCommit updates and the path appears. Tools must not treat it as identity (see §3).

**Pushback vs the earlier one-line target.** “Working copy has no repo paths” means no *assigned* paths. A link may remember the existing vault file. After Save the UI may show the committed path; the source of truth is lastCommit. The earlier UUID+`surfId` pair is rejected: one part id.

### 2.2 `lastCommit` record

Persisted in `surfcad-sync` kv, keyed by `repo + branch + assemblyId` (legacy rows may also be keyed by folder until first Save — see §4). Survives reload. Built from committed bytes (or empty for a never-saved assembly), **never** by `stringifySurfJson(workingCopy)`.

```
LastCommitRecord {
  schemaVersion: 1
  repo: { owner, name }
  branch: string
  assemblyId: string             // surf-id; required in memory
  tipSha: string | null          // null = this assembly never committed
  matchedByFolder: boolean       // true until the vault file has top-level id
  assembly: {
    name: string                 // '' if never saved
    path: string | null          // assemblies/<Name>/.surf.json
    json: object | null          // parsed committed .surf.json
    blobSha: string | null
  }
  parts: {
    [partId]: {                  // same id as // @surf-id
      path: string
      name: string
      contentHash: string        // git blob sha of the .js
      meshHash: string | null
    }
  }
  capturedAt: number
}
```

After a successful write, `lastCommit` is replaced wholesale from the files just committed + the new tip sha. Incremental `baselineAfterPartSave` / `baselineAfterPartRename` / `baselineAfterAssemblyRename` go away.

### 2.3 Planner (pure)

`planSave(lastCommit, workingCopy, occupancy) → { files, assignedPaths, nextRecord }`

Occupancy is `listTree` on Save (fail-closed: `VAULT_TREE_UNAVAILABLE`, do not treat failure as empty). Offline Save uses lastCommit paths + WC `linkPath`s only; never invents occupancy.

Match the assembly by **`workingCopy.id === lastCommit.assemblyId`**, never by name or folder. Match parts by **part id**, never by path or name.

1. If `lastCommit.tipSha` is set and remote tip ≠ that sha → **conflict**, no files (see §2.5). First Save (`tipSha == null`) uses current tip as `baseSha` without conflict.
2. Working part with no lastCommit entry → **add**. Allocate `assemblies/<Assembly>/<Name>.js` (`-2`, `-3`, …). Stamp `// @surf-id <part.id>`.
3. Working part with lastCommit entry: name/folder changed → **rename/move** (same occupancy rules as today’s `planRenameVaultPartPath`); content hash changed → **edit**; mesh hash changed → write/delete `.mesh`.
4. lastCommit part missing from WC → drop from `.surf.json`. **Delete the file** only if it is an assembly-local copy and no other assembly on this branch references that part id (same rule as `planDeleteAssembly`). Shared `parts/` and linked files stay.
5. `workingCopy.name !== lastCommit.assembly.name` (same `assemblyId`) → move `.surf.json` and assembly-owned files to `assemblies/<new>/`; delete leftover blobs under the old folder. Rename-then-reload is this case: lastCommit still has the old path; WC has the new name and the same id.
6. Serialize `.surf.json` from WC + assigned paths. Write top-level `id` (assembly id). `parts[].id` is the part id. `activeId` in the file is the assigned path of the active row (vault-schema today); **applying lastCommit never writes that `activeId` back over WC `activeId`** (WC `activeId` stays the part id).
7. One file list: adds, edits, moves, deletes, meshes, `.surf.json`.

Unsaved parts are never a reason to refuse. One commit.

**Pushback.** Today’s `buildCommitFiles` “do not delete removed parts” is rejected. Deletes belong in the Save commit. `pendingRepoDeletes` / `pendingOldAssemblyName` are unnecessary: lastCommit still has the old part paths and the old folder, keyed by ids that did not change.

### 2.4 One write function

```
writeVaultCommit({ adapter, repo, branch, baseSha, message, files }) → { sha }
```

The **only** production caller of `adapter.commitFiles`. First Save may `createRepo` + include `vaultSeedFiles` in this same commit when the repo does not exist. After success: replace `lastCommit` (key = assembly id); project `assignedPaths` onto WC rows **by part id** (path field only); do not replace the document; refuse the projection if `workingCopy.rev` moved and the change is not a path-only merge.

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

### 2.5 Conflict (only on explicit Save)

If `lastCommit.tipSha` and remote tip differ at Save:

- **Overwrite main** — `writeVaultCommit` with `baseSha = remote tip`. Local bytes for planned paths; other remote files stay. (`git_force_overwrite` needs `confirm: true`.)
- **Get latest** — replace WC from remote for the behind paths (existing behind dialog); rebuild lastCommit from that tip. Destructive; agent needs `confirm: true`.
- **Keep mine** — create `surfcad/<asm>-YYYY-MM-DD` from `lastCommit.tipSha`, write the planned files there, switch.

Open, reload, and `online` never open this write UI. A read-only “main moved” toast on focus may stay; it must not flush.

---

## 3. Contract for agent/MCP tools

Self-contained. Another team can implement tools against this section without the rest of the doc. Vault file format is still [`vault-schema.md`](vault-schema.md) plus optional assembly `id` (§2.1). Pairing and consent envelopes stay [`agent/SKILL.md`](agent/SKILL.md).

### 3.1 Identity

**One part id. One assembly id.** Same surf-id shape: `yyyy-mm-dd-hh-mm-ss-SSSS-xxxx`. Host assigns both at creation (`mintSurfId`). They are unrelated to path, name, and local/git. They never change on Save, reload, rename, or source flip.

| Entity | Field | Who / when | Used as |
| --- | --- | --- | --- |
| Part | `id` | Host on `create_part` / UI +Part / seed / import / copy | `part_id`; row id; `// @surf-id`; `.surf.json` `parts[].id`; groups/colors/joints; lastCommit part key |
| Assembly | `id` | Host on `create_assembly` / New Assembly / import | `assembly_id`; IndexedDB doc id; `.surf.json` top-level `id` after Save; lastCommit key |

There is **no** `surfId` property and **no** UUID `id` after migration. Copy-to-assembly mints a new part `id` and sets `copiedFrom` to the source part `id`.

- **Uniqueness.** Part `id` is unique in the open working copy and, once Saved, unique among committed part scripts in that vault. Assembly `id` is unique among assemblies this client knows (IndexedDB + lastCommit). Folder names can collide in the UI numbering sense (`Gearbox (2)`); ids cannot.
- **Lookup.** Tools target `{ part_id }` and `{ assembly_id }`. If the id is missing or unknown → `{ code: "unknown_part" }` or `{ code: "unknown_assembly" }`. **Do not** accept a vault path, a display name, or a UUID as `part_id` / `assembly_id` (legacy UUID rows are rewritten on host open before tools see them). **Do not** fall back to the active part when the caller passed a different `part_id`. **Do not** write the active part because `selection.cadPartId` moved.

**Writers that mutate a part script or placement MUST take `part_id` and refuse a mismatch** (`code: "part_mismatch"` if the tool also has an implicit active target). `create_part` must atomically set `parts.activeId` **and** `selection.cadPartId` to the new `id` before the call returns.

`create_assembly` returns `{ assemblyId, assemblyName, activeId, partCount }`. `open_assembly` takes `assembly_id` (preferred). `name` is accepted only as a **legacy** lookup while that vault assembly still has no top-level `id` (match folder); once Saved with an `id`, name-only open of a renamed assembly is `not_found` — pass `assembly_id`. Future `list_assemblies` / `rename_assembly` / `delete_assembly` use `assembly_id`.

### 3.2 Paths are not identity

- New `create_part` / UI +Part rows have **no** `path`. `parts[].path` is omitted or `null`.
- The host assigns `assemblies/<Assembly>/<Name>.js` **only inside Save** (user Save or `git_save` after consent). After that, `parts[].path` is the lastCommit projection for that part `id`.
- `rename_part` / `rename_assembly` change **display name** only. The committed file/folder moves on the next Save. Part rename response: `{ partId, name, path: <last committed or null>, moved: false }` until Save.
- Insert/open of an existing vault file may show that file’s path as a **link** (`path` present, **same part `id`** as the source). That is a reference, not an assignment. Copy-to-assembly mints a new id and clears path until Save.

**Tools must never** send `path` or `name` as `part_id` / `assembly_id`, persist a guessed path, or treat a missing path as an error. `git_add_to_repo` must not assign a path itself; it is an alias of `git_save`.

### 3.3 What counts as a Save

A git write of assembly content happens only when:

1. The user clicks Save (`data-git-save` / commit dialog), or
2. The agent calls `git_save { message }` **after** write consent (`consent_pending` → user Allow → retry).

No other tool may `commitFiles`, push, `createRepo`, seed the vault, enqueue an outbox op, or flush. That includes `create_assembly`, `create_part`, `rename_part`, `rename_assembly`, `open_assembly`, `open_part`, `insert_part`, `paint_confirm`, group ops, `set_script`, `insert_*`, `run`, and coming back online.

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
| Working copy (doc + scripts + `rev`) | create/rename/delete part or assembly (local), paint, groups, joints, transforms, `set_script`, insert/open (local rows) | Assign paths; remint ids; commit; replace the doc from a stale snapshot |
| `lastCommit` | — | Any tool except the Save write path |
| Git adapter | `git_*` listed above | Any other command |

`parts` / `dirty` after this model:

```
parts: {
  assemblyId: string,
  assemblyName: string,
  activeId: string,              // part id
  parts: [{ id, name, visible, path: string | null, group? }]
}
dirty: {
  unsaved: boolean,              // WC differs from lastCommit (or lastCommit is empty)
  editedSinceLoad: string[],     // part ids whose script differs from last open/Save snapshot
  workspaceDirty: boolean,
  partIds: string[],             // dirty part ids (never paths)
  assemblyDirty: boolean,        // name / groups / colors / joints / order / placement vs lastCommit
}
```

`editedSinceLoad` and `partIds` must list **every** edited part (T5), keyed by the one part `id`. A path-less new part is dirty. Changing `activeId` does not set `assemblyDirty`.

### 3.5 Concurrency and idempotency

- **`create_assembly`.** Single-flight per tab. Overlapping calls join the in-flight promise and return the **same** `{ assemblyId, assemblyName, activeId, partCount }`. A retry after success is a new assembly only if the previous call settled (no in-flight). **No git write.** Optional `name` (when added) must not create `Assembly (N)` if that exact name is free. Do not persist a second document until the first call returns.
- **Versioned writes.** WC has monotonic `rev`. A host write-back (Save projection, overwrite, open) that would replace the document is rejected if `result.baseRev !== currentRev`, except a **path-only merge** by part id. A stale `set_script` / `create_part` snapshot must not `rememberAssembly` over a newer doc (T17).
- **`create_part`.** One row, one `id`, `activeId` + `cadPartId` set, then return. No path. No git.
- **`open_assembly`.** Prefer `assembly_id`. Unknown id → `{ code: "unknown_assembly" }`. Legacy `name` when that vault file still has no `id`: missing folder → `{ code: "not_found" }` (T9), not a fake success. Read-only vs git (loads WC; no commit).
- **Idempotent Save.** `git_save` when `dirty.unsaved === false` → `{ status: "clean" }`, no commit.

### 3.6 Error contract

Bridge refusals stay `isError: true` with `code` + `message` (+ `details`). Git/content tools must be **specific and actionable**:

| Code | When | Agent should |
| --- | --- | --- |
| `unknown_part` | `part_id` not in the open document | `parts`, then retry with a listed id |
| `unknown_assembly` | `assembly_id` not known | `list_assemblies` (when it exists) |
| `part_mismatch` | Tool implied active part ≠ `part_id` | Pass `part_id` explicitly |
| `no_assembly` | No open document | `create_assembly` or `open_assembly` |
| `not_found` | Legacy `open_assembly { name }` missing | Do not invent; use `assembly_id` |
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
| Dual `id` (UUID) + `surfId` | One part `id` (surf-id format) |
| `part_id` that is a vault path or a UUID | Surf-id `part_id` only |
| Assemblies identified only by folder `name` | `assembly_id`; name is a label |
| `parts[].path` after `create_part` / paint / edit | Path only after `git_save` |
| Paint / rename / insert / copy / delete flushing git | WC only; Save later |
| `create_assembly` creating a vault or leaving strays on retry | Local, single-flight, one `assemblyId` |
| `open_assembly` of a missing name returning success | `not_found` / `unknown_assembly` |
| `create_part` leaving `parts.activeId` / `status.partId` on the old part | Atomic activate |
| `set_script` / `insert_*` without `part_id` writing the active part | Require `part_id` |
| `git_add_to_repo` as a second commit shape | Use `git_save` |
| `git_branch_create` leaving the session on the old branch | Switch when allowed (#571) |
| `dirty.editedSinceLoad` missing new parts | Every edited part id |
| Implicit “Overwrite main” toasts with no `git_*` call | Conflict only on Save |
| Reload / `online` committing | Never |

`T1` (create_part should run the script) and `T16` (real error text) are **not** git-write bugs; they stay on the MCP batch. The host must still expose `runState` / volume / bbox on create-if-run, and real error strings on `errors` / insert / run.

---

## 4. Migration (no data loss)

On first load after upgrade, **do not flush the outbox.** Never write git on open/reload.

1. **Part id → one surf-id.** For each WC / IDB row, pick one id and rekey scripts once:
   - `// @surf-id` header if valid → that id
   - else existing `surfId` or a surf-id-shaped `id`
   - else pathIndex / lastCommit match by path
   - else mint (`mintSurfId`)
   UUID-only local rows and path-as-id rows take this once. Drop the extra `surfId` property. Stamp the header on the **next explicit Save** (do not push). Bytes after the header stay. Same id in local and git; source flip does not remint.
2. **Assembly id.** New Assembly / `create_assembly` / import already mint one. A vault `.surf.json` **with** top-level `id`: that is the id. A vault assembly **without** `id`: mint locally on open, store on the IndexedDB document and on lastCommit (`matchedByFolder: true`). Match that assembly by **folder name** until the next explicit Save writes `id` into `.surf.json`. Then `matchedByFolder` becomes false and rename/reload follow the id.
3. **Build `lastCommit` from what git actually has.** Key by assembly id (step 2). `tipSha ← headSha`, `assembly.json ← parse(baseline.assemblyText)` when valid, `parts[partId] ← { path, contentHash }` from committed text (not the live buffer). Path-less WC rows are **adds** (omit from `lastCommit.parts`).
4. **#585 pending flags.** If `pendingRepoDeletes` / `pendingOldAssemblyName` exist: do not drop those paths / the old folder from lastCommit. WC already has the new name / missing rows; first Save plans the delete/move (same assembly id); then delete the flags.
5. **Leftover outbox.** Retire `migrate-layout` / `migrate-ids` (already). Leave queued save/rename/delete **unflushed**. WC already has the local state; lastCommit is the tip; user Save replans. Do not replay stale file snapshots.
6. **Vault files.** `version` stays `1`. Reader accepts optional top-level `id` before any writer emits it (PR 1). Next Save writes assembly `id` and every `parts[].id`. Existing path-only part rows stay readable.
7. **IndexedDB.** Rekey `surfcad-assembly` scripts path/UUID → part id. Persist assembly `id` on the document. No script bytes dropped. `isSynced` becomes derived (`contentHash` match); can keep the flag until UI cleanup.

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
- Dual `part.surfId` vs `part.id`; UUID mint for new git/local parts (`newLocalPartId` for parts)
- lastCommit / last-opened keyed by assembly folder name (after legacy assemblies have been Saved once)

**Keep:** vault layout, `surfJson` (commit serialize still validates part paths; `TOP_KEYS` includes optional assembly `id`), `mintSurfId` / `isSurfId` as **the** id, `partIdentity` (one id), adapter, list/open (read-only), consent modal, conflict UI (Save only), delete-assembly / delete-repo confirms, `planDeleteAssembly` rules.

---

## 6. PR sequence

Each PR has tests, keeps CI green, does not touch `src/fea/**` or `surfcad-fea/**`. #585 may merge first; later PRs assume its implicit-write stop and must consume its pending flags if present.

| PR | What | Size | Done when |
| --- | --- | --- | --- |
| **0** (this) | `docs/git-save-model.md` | S | Reviewable contract + plan |
| **1** | `validateSurfJson` accepts optional assembly `id` (no write yet). Collapse part identity in IDB (header / surf-id / mint). Mint assembly id on create/open (local only; folder match for legacy vault files). Persist `LastCommitRecord` keyed by assembly id; capture from open/tip / existing baseline. No git write-path change. | M→L | Reload restores lastCommit by assembly id; path-less capture does not throw; `parts[].id` is the one surf-id in memory; old `.surf.json` still validates |
| **2** | Pure `planSave` + unit tests (add, edit, rename, move, delete, **rename-then-reload by assembly id**, offline occupancy, conflict input, #585 pending flags, folder-match legacy) | M | Tests pass; not wired |
| **3** | `writeVaultCommit` + adapter spy: **fail if any production module except that file calls `commitFiles`** (temporary allowlist shrinks each PR) | S | Harness exists; callers temporarily import the wrapper |
| **4** | Wire user Save + `git_save` through planner + write; write assembly `id` + part ids; path projection by part id; conflict only here | L | One commit; paths only after Save; no WC replace; vault file now has top-level `id` |
| **5** | Remaining implicit writers off (if #585 not in); no `ensureGitVault({ create: true })` except first Save; no `online` flush | M | Source-assert (see #585 `test/implicit-vault-write.test.js`) |
| **6** | Planner emits deletes + assembly-folder moves **keyed by assembly id** (not `pendingOldAssemblyName`); drop pending flags; per-part Save = same planner | M | Delete then Save removes the file; rename then reload then Save moves the folder |
| **7** | Agent contract: one `part_id`; `assembly_id` on create/open/list; `parts.path` from lastCommit; `part_id` required on writers; versioned writes; single-flight `create_assembly`; `open_assembly` `not_found` / `unknown_assembly` | M | Agent goldens; T3/T17/T19 host-side; no `surfId` field in `parts` |
| **8** | Delete dead APIs / outbox write path / dual-id helpers; goldens (`smoke_face_paint`, rename, git-vault-flow) expect WC-only then `git_save` | M | Harness allowlist empty except `writeVaultCommit` + tests |

Do not combine 4+7. Host contract (7) can start in parallel once 4 is on a branch, so the MCP team is not blocked. PR 1 must precede any Save that writes assembly `id` (old validators).

---

## 7. Test plan

- **Harness.** Test adapter records `commitFiles` / `createRepo`. Production import graph: only `writeVaultCommit` (plus the test seed helper). CI fails on a new call site.
- **Planner units.** Add path-less part; part rename; assembly rename-then-reload (**same `assemblyId`**, lastCommit still has old folder); delete unreferenced assembly-local file; delete linked/shared keeps file; first Save empty lastCommit; occupancy collision `Name-2`; `listTree` failure → no files; remote tip ≠ lastCommit → conflict, no files; #585 `pendingRepoDeletes` / old name fold into lastCommit; legacy folder match until `id` is written.
- **Identity.** UUID-only and path-as-id rows become one surf-id on open, no git write. Source flip keeps ids. Copy mints a new part id + `copiedFrom`. `validateSurfJson` accepts optional assembly `id` and still accepts files without it; rejects a non-surf-id `id`.
- **Host.** Paint / group / create_part / create_assembly / `online` / reload: `commitFiles` count unchanged. Save: one commit, all dirty parts + `.surf.json` including assembly `id`. `create_assembly` overlap: one document, one `assemblyId`. Stale `rev` write-back rejected. `parts.path` null until Save.
- **Goldens.** `smoke_face_paint`, `smoke_agent_part_rename_commit`, `golden:agent-bridge-h12`: confirm/rename local; `git_save` is the commit. Keep `git-vault-reload-no-write`.
- **Existing.** Rebase `test/git-assembly-save-unsaved-parts.test.js`, `git-stable-part-id`, `git-stray-promote`, `agent-git-path-less`, `part-rename-commit` onto planner + one-id assertions.

---

## 8. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Old app cannot open a `.surf.json` that has `id` | Reader (`TOP_KEYS`) in PR 1; first write of `id` in PR 4 |
| Planner occupancy vs a remote file added since lastCommit | Save lists the tree; fail-closed |
| User deletes a part that another assembly links | Same reference rule as delete-assembly; file stays |
| Offline Save then remote moved | One pending write; conflict at flush |
| lastCommit missing after crash mid-write | Rebuild from tip on next open (read-only); WC scripts stay in IDB |
| Legacy assembly matched by the wrong folder after a remote rename | Folder match only until first Save writes `id`; then id wins |
| #585 and this series race | #585 first is OK; PR 6 deletes its flags |
| MCP team builds on UUID / path-as-id | §3 is the contract; host PR 1 migrates IDB; PR 7 enforces |

Rollback: revert PRs 8→4 in reverse. lastCommit in IDB is advisory; an old build ignores it. Vault bytes without `id` stay valid v1; files *with* `id` need the PR 1 reader. Feature flag optional (`SAVE_MODEL_V2`) around PR 4 if we want a one-release kill switch; default is sequential green PRs.

---

## 9. MCP feedback (T1, T3, T5, T16–T19)

| Item | This redesign |
| --- | --- |
| **T1** create_part doesn’t run | **Out of scope** (host run-on-create). Not a git write. |
| **T3** vault paths without `git_save`; UUID replaced by path | **Fixed.** One part id (surf-id); paths only in the planner; `parts.path` from lastCommit. |
| **T5** `dirty.editedSinceLoad` incomplete | **Fixed** if dirty is lastCommit vs WC by the one part id (every new/edited part). Snapshot keyed by path/UUID is what dropped rows. |
| **T16** error text not exposed | **Out of scope** (errors/insert/run payload). §3.6 still requires the UI string; git PRs do not implement it. |
| **T17** active part desync / overwrite | **Host-side fixed** by one part id (activeId / cadPartId / status.partId / part_id are the same field), atomic `create_part`, required `part_id`, versioned writes. Remaining “always pass `part_id`” is the MCP batch. |
| **T18** Overwrite-main / paths / invalid `.surf.json` with no git_* | **Fixed / moot.** No implicit writers; no path-less serialize of WC; conflict only on Save. |
| **T19** stray assemblies | **Fixed** by single-flight `create_assembly`, no vault write on create, and a stable `assemblyId` so retries join instead of forking names. |

T7 (`create_assembly { name }`), T8 (list/delete/rename assembly tools), T9 (`not_found`) are MCP-batch product work; §3.1 / §3.5 already require `assembly_id`, `unknown_assembly` / `not_found`, and single-flight so retries do not fork documents.
