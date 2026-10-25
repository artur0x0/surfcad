# UI Map — where every piece is on screen, and where its code lives

SurfCAD is a **single-page, two-pane app**: a Monaco script editor and a
Three.js viewport. There is no in-app router and no page list inside the CAD
shell. Everything the user sees in the editor is either one of those two panes,
a floating overlay inside the viewport, or a full-screen modal.

**Path-based routes** (`src/main.jsx`, outside the CAD shell):

| Path | Screen | Code |
|------|--------|------|
| `/git/callback` | GitHub OAuth hand-off (no sign-in) | `GitCallback.jsx` |
| `/partners` | Become a partner form + thank-you (no sign-in) | `src/pages/PartnersPage.jsx` (`data-partners-page`) |
| `/privacy` | Privacy policy and Change privacy choices | `src/pages/PrivacyPage.jsx` (`data-privacy-page`) |
| `/admin` | Operator stats (7/30/120-day charts). Lazy-loaded. Signed-out and non-admin users see the 404 page. **Admin** in the profile menu (`data-profile-admin`) only when `/api/auth/me` has `isAdmin`. | `src/pages/AdminPage.jsx` (`data-admin-page`), `src/pages/NotFoundPage.jsx` (`data-not-found-page`) |

`golden:partners-page` screenshots the form and thank-you state at 390 and 1280.
`golden:privacy-consent` checks the first-visit popup at 1280 and 390: it appears with no stored choice, sits above the CAD toolbar / home pill, and **Accept all** hides it and persists. The privacy page always shows that Global Privacy Control is honored and **Change privacy choices** re-opens the same popup.

Read this file to answer "where is X on screen?" and "which file do I edit?".
For text, color, and popup chrome read [docs/ui-style-guide.md](./ui-style-guide.md).
For blend/fillet internals read `.claude/skills/fillets/SKILL.md`; for the
script API read `docs/helper-functions.md`.

- **Mount:** `src/main.jsx` → `AuthProvider` → `App`
- **Shell + all layout decisions:** `src/App.jsx`
- **Global CSS / Monaco overrides / touch fixes:** `src/index.css`
- **Everything inside the 3D pane:** `src/components/Viewport.jsx` (15,822 lines)
- **Script execution sandbox:** `src/workers/sandboxWorker.js` (8 lines) loads `bindWorker` from `src/lib/surfcad/runtime.js` (10,461 lines), which holds the helpers and the message protocol
- **Browser agent:** `window.surfcad` is not a control on screen. Version 1. When the bridge is on (dev, `?agent=1`, or `surfcadAgent`), **Connect Agent** (`data-agent-bridge-connect`, `src/components/AgentBridgePairing.jsx` hosted once on App via `AgentBridgeHost`, above the 768px split) is opened from the **profile** chip (`data-profile-chip`): the menu closes and a standalone pairing dialog (`data-agent-bridge-dialog`) shows the setup prompt until a relay is found, then the pairing code, then Allow/Deny in that same dialog. **Disconnect** (`data-agent-bridge-disconnect`) drops the local agent relay and is shown in the profile menu and pairing dialog only while an agent is paired or connected; a green connected toast / profile-chip ring for the M1 loopback WebSocket relay (`ws://127.0.0.1:17341` by default).
  In desktop Safari on https the dialog adds a line about the bridge window (`data-agent-bridge-popup-intro`), **Connect Agent** opens the **SurfCAD local agent bridge** popup, **Waiting for the local agent…** (`data-agent-bridge-waiting-relay`) shows until the window reaches the relay (it retries with no time limit; reconnects reuse the same window), then the pairing code appears, and closing the window re-opens the dialog with **Disconnected** (`data-agent-bridge-error="bridge_closed"`) and **Reconnect** (`data-agent-bridge-reconnect`). `data-agent-bridge-panel` carries `data-agent-bridge-transport` (`direct` / `popup` / `unsupported`). iPhone / iPad and blocked pop-ups keep **Pairing works in Chrome for now** (`data-agent-bridge-unsupported`, `data-agent-bridge-error="popup_blocked"`). Local clients use `npm run agent-bridge:client -- --token CODE --command list_faces`. The stable entry is `call(name, argsJson)`.
  `App.jsx` installs it on the main window in dev, or when the URL has `?agent=1`, or when localStorage `surfcadAgent` is `1`. Flag off, the object is absent and both shells stay as drawn.
  Commands are the registry in `src/agent/commands/` (script mutate tools, `history` / `undo` / `redo` on `data-feature-bar-undo` and `data-feature-bar-redo` (same sketch / assembly / part routing as the strip), `list_commands`, H2 state readers: `feature_tree`, `selection`, `mode`, `dirty`, `toasts`, `parts`, `camera`; pick catalogs `list_faces`, `list_edges` (raw default), and `list_feature_edges`; H4 helper inserts (`invoke_helper` and `insert_<id>` per `HELPER_PALETTE_ITEMS`); H5 feature strip (`open_feature`, `activate_feature`, `edit_feature`, `confirm_feature`, `cancel_feature`, `delete_feature`, `rollback_to` on `data-feature-chip`, `data-feature-sheet-accept`, `data-feature-sheet-delete`, `data-rollback-bar`); H3 writers: `select_clear`, `select_faces`, `select_edges`, `select_parts`, `set_active_part`, `camera_set`, `camera_fit`, `zoom_to_selection`; H6 sketch and H8 slot writers;
  H9 pick sessions `pick_begin` / `pick_next` / `pick_undo` / `pick_clear` / `pick_done` / `pick_cancel` / `pick_state` / `pick_faces` / `pick_edges`, which feed the Face / Edge selection or the open Fillet, Chamfer, Shell, Draft, Move Face, or Delete Face card (`data-*-mode-chip`) exactly as taps would, and press that card's Accept on `pick_done { accept: true }`; and H10 hole card and centres (`hole_open`, `hole_set_params`, `hole_begin_centres`, `hole_commit`, `hole_cancel` on `data-hole-card` / `data-contour-confirm`), workplane (`plane_set`, `workplane_select`, `set_active_workplane`, `data-overlay-toggle-plane`), `list_sketch_entities`, and `pick_points` on contour gestures or hole-centre sketches with `kind` point/line/arc/ref or UV `{ at: [u,v] }` keys); H11 parts ribbon and joints (`create_assembly`, `create_part`, `open_assembly`, `open_part`, `insert_part` on `data-part-add-kind-*` / `data-part-open-action-*` / `data-git-open-insert`;
  `joint_open`, `joint_set_params`, `joint_pick`, `joint_commit`, `joint_cancel` on `data-joints-button` / `data-joint-card`; H14 sheet metal (`sheet_open`, `sheet_start`, `sheet_set_tool`, `sheet_set_params`, `sheet_pick`, `sheet_commit`, `sheet_cancel`, `sheet_exit`, `sheet_check`, `sheet_refold`, `sheet_done`, `sheet_edit`, `sheet_begin_hole` on `data-sheet-metal-button`, picker/start, check/done, base/bend cards); H12 git vault on `data-git-save`, `data-git-move-open`, `data-git-behind-*`, `data-git-branches`, branch create/switch/delete confirms, `data-git-conflict-overwrite` — `git_move_to_repo`, `git_save`, `git_add_to_repo`, `git_behind_resolve`, `git_branch_create`, `git_branch_switch`, `git_branch_delete`, `git_force_overwrite`, `git_list_branches`).
  App and Viewport fill one host ref with the handlers the buttons already call (`src/agent/host.js`); the bridge resolves that ref at call time. Viewport publishes selection, mode, camera, and pick/camera writers; App publishes part switch and `cadPartId` picks. Quote, order, cart, and checkout are permanently exempt. `src/utils/agentBridge.js`. See `docs/agent-export.md`.
- **Agent coverage (R1+R2).** Harness controls carry `data-ui-action`. CI `coverage:agent` maps each id to a registry `uiEntry` or a shrinking row in `src/agent/coverageAllowlist.js`; ESLint (R2) requires the same attribute on every harness-surface `button` with `onClick` (see `eslint.config.js`). `npm run export:agent` writes `src/agent/commands.json` for MCP.
- **Agent git write consent (real adapter).** Full-screen scrim + `VaultPickerDialog` shell (`data-git-dialog="agent-git-consent"`, `src/components/AgentGitConsentModal.jsx`). Shown from `App.jsx` when an agent git **write** hits the real GitHub adapter and the tab has not opted in. Body copy (`data-agent-git-consent-prompt`) names the command target (`owner/repo/branch`); command id (`data-agent-git-consent-command`). Footer: **Deny** (`data-ui-action="data-agent-git-consent-deny"`) and **Allow for this session** (`data-ui-action="data-agent-git-consent-allow"`). Esc and scrim tap deny. `?agentGitConsentDemo=1` pins the modal for goldens. `golden:agent-git-consent` at 390 and 1280.

---

## 1. The two shells

`App.jsx` renders **one of two completely separate JSX trees**, chosen by
`isMobile` state (`src/App.jsx:468`), set from `matchMedia("(max-width: 768px)")`
(`src/App.jsx:2078`). `AgentBridgeHost` wraps both so a 768px resize does not
drop the pairing socket. Other chrome is not shared — if you change it in
one shell you must change the other.

### Desktop shell (`src/App.jsx:11703`+) — side by side

```
┌────────────────────────────┬───┬──────────────────────────────┐
│ CodeEditor (splitPct)      │▓▓▓│ Viewport (rest)              │
│                            │ ║ │  top-center: [part] in [asm] │
│ ┌────────────────────────┐ │ ║ │  under title: FeatureStrip   │
│ │ mid-strip: [Toolbar]   │ │ ║ │    (horizontal CAD bar)      │
│ ├────────────────────────┤ │ ║ │  left: HelperInsertPalette   │
│ │ Monaco (vs-dark, 12px) │ │ ║ │  right: CrossSection cluster │
│ └────────────────────────┘ │ ║ │  info chips bottom-left      │
│                            │ ║ │  profile chip top-right      │
│                            │ ║ │  PromptInput (paired only)   │
└────────────────────────────┴───┴──────────────────────────────┘
  Parts feed sits left of the CAD view. The script editor is a right drawer, closed
  by default. Desktop hides its profile chip.
```

- **Default CAD layout:** the parts feed and the viewport. Monaco is mounted but hidden (`data-script-editor-open="false"`).
- **Pencil** (`data-part-edit-script`) on each part row, blue, same size as the eye. It activates that part if needed and opens Monaco for it only.
- **Desktop drawer** (`data-script-drawer-side="right"`): under the feature ribbon (`top: 8rem`), inset so the left rail stays clear, drag the left edge to resize, Escape or Back closes it.
- **Phone sheet** (`data-script-sheet`, 390px): full-screen over the home pill. Back is an ArrowLeft icon only (`data-script-editor-close`, `aria-label="Back to parts"`, 44×44) and returns to Parts with the same close-save. A stored or linked Script stage opens Parts.
- **CAD corner.** There is no `data-cad-io-tray`. Upload and Download are on the Parts ribbon. Order is the part-row cart button (`data-part-order`). Run, Select all, Undo, and Redo stay in the editor.
- **Puzzle easter egg** (`data-puzzle-unlock`, 44×44, viewport top-left): five taps in three seconds while `useAuthState().signedIn` (grey reauth counts) call `handleStartGame` and show `data-puzzle-unlock-toast` ("Puzzle unlocked"). The taps are not stored. Signed-out and pending sessions have no target and no toast. Nothing covers that corner.
- **Identity.** Brand colors and splash copy: [docs/ui-style-guide.md](./ui-style-guide.md#brand). The CAD viewport header row (`data-viewer-header-row`, `top-4`, `left-2` / `lg:left-4`, same inset as the helper rail) shows the paper-tile mark (`data-brand-mark="paper"`) and the outlined SurfCAD wordmark at 16px on a transparent lockup (`data-brand-header`, `data-brand-wordmark`), then a muted lowercase beta tag (`data-brand-beta`) that does not take taps. The assembly title pills sit centred on the same row (`data-viewer-title`), with truncation so long names stay readable and the row clears the AR profile chip (`pr-11`). Parts and Script stages do not draw the brand. The loading gate (`data-app-loading`) is wall-clock light/dark (`data-app-loading-theme`) and has no Privacy choices link. `golden:brand-identity` checks 360, 390, and 1280.

**The seam between the two panes is draggable** in both shells
(`SplitDivider.jsx`, pointer-capture based): left/right on desktop
(`splitPct`, clamped 20-80%), up/down on mobile (`mobileEditorPxOverride`,
clamped so neither pane collapses; an open keyboard still overrides it).

**Floating agent prompt** (`PromptInput`, `data-agent-prompt`) sits in the
mode-chip slot at the bottom of the CAD viewer, between the rails — max 640px
on desktop, rail-capped on a 390px phone. It shows only while an agent is
paired (the same `shouldShowAgentBridgeDisconnect({ paired, link })` test as
Disconnect) or when a DEV build pins `?agentPromptDemo=1` for goldens / screenshots.
It is not mounted in game mode. After Connect Agent, `AgentBridgeHost` builds
`createAgentPromptTransport(bridge)` from `window.surfcadAgentPrompt.getBridge()`
and passes it to the card. Unpair tears that transport down and hides the card.
The typing dots, Stop, and the "Agent is working..." hint follow one pending
prompt (`src/agent/agentPromptTyping.js`): the one the tab sent last and has not
seen closed. It closes on the final reply, on `agent.status { working: false }`,
on a failed delivery, on Stop, on disconnect, and on the 120 s idle timeout; a
late, duplicate, or out-of-order `working: true` for a closed prompt is ignored,
so the dots cannot stay on next to a finished reply.
The pane above the input is the conversation for this connection
(`src/agent/agentPromptConversation.js`): the user's messages right-aligned in a
`surface-quiet` bubble (with a thumbnail when a screenshot went along), the
agent's replies left as before, the dots at the bottom while a prompt is in
progress. It grows to `--agent-prompt-max-reply` (200px desktop, 160px phone,
about six lines of reply) and scrolls inside; the input never moves. It follows
new messages unless the user scrolled up, then a sticky arrow
(`data-agent-prompt-jump`) offers the way back down. Disconnect clears the
history.
**Two agent states** (`data-agent-prompt-state`, from `state` on the MCP
status message, `src/agent/agentPromptTyping.js`): **typing** keeps the chat
open with the dots as the next agent bubble and a normal input; **working**
collapses the chat so the viewport is visible and shows the spinner with
"Agent is working..." in the field. A sent prompt waits as typing; the first
model-changing tool call switches to working; a streamed reply or an explicit
`set_status { state: "typing" }` switches back and reopens the chat; the final
reply, Stop, or the idle timer goes to idle. Stop is available in both.
**Fold (desktop):** there is no X. A chevron-down (`data-agent-prompt-fold`,
"Hide agent prompt") hangs from the prompt's bottom edge as a 44 × 28 pill tab,
centred, drawn behind the prompt (`z-index` 19 under the prompt's 20) with its
top tucked 8 px under the border so the corner radius occludes it, in every
state; it slides the prompt away. A chevron-up (`data-agent-prompt-unfold`,
"Show agent prompt"), the same pill, then sits centred at the
bottom of the viewer pane with a badge for the state (`data-agent-prompt-badge`:
typing dots, working spinner, or an unread dot once a reply landed) and brings
the prompt back exactly as it was: draft, scroll, and indicator, because the
component stays mounted. Folding never cancels a run. Esc folds when the prompt
has focus; both chevrons are focusable and Enter toggles; a polite live region
(`data-agent-prompt-live`) announces "Agent is typing", "Agent is working", and
"Agent replied". The folded choice is remembered per agent session in
localStorage (`surfcadAgentPromptFolded`, `src/agent/agentPromptFold.js`) and
cleared on disconnect. `agent_prompt { action: "fold" | "unfold" }` drives it;
`dismiss` folds on desktop. On the phone the fold has not landed: the compact
prompt keeps the X that hides the pane. Nothing else is stored.
A production build with no paired agent stays hidden and never uses the echo
stub. The stub and `?agentPromptDemo=1` are DEV-only (DEV with no pairing may
still echo). The camera toggle (`data-agent-prompt-screenshot`) captures the
viewer canvas only and attaches a PNG to the next send. Replies are plain text. While the agent is working, the input hint is a spinner and
"Agent is working..." and Send becomes Stop. Stop clears that working hint in the
UI. A reply that is still streaming shows three bouncing dots in front of the
text (`prefers-reduced-motion` holds them still). Opening any feature card slides
the prompt down off the viewer; closing the card slides it back. The typed draft
and the camera toggle stay. The viewer stays interactive while the agent works.
Agent-driven feature cards do not auto-open during that work.
The `agent_prompt` bridge command stays on the page (`action: 'screenshot'`
turns the camera on); it is not copied into `packages/surfcad-mcp/data/commands.json`.

**The CAD title reads "part in assembly".** Part name, the word in, then the
assembly name (`data-viewer-title`, `data-title-in`, `data-viewer-title-text`).
Example: part1 in Assembly. In contour mode that row stays laid out and the
chips hide (`data-viewer-title-hidden` on `data-viewer-title`, `visibility:
hidden` on `data-viewer-title-chips`). The status legend
(`data-contour-status-legend`: Free, Locked, Conflict, Repeated) is centred
on that box, horizontally and vertically. Leaving contour mode shows the
chips again. `golden:contour-legend`. With no part selected the part pill is not
rendered (`data-title-role="part"` absent); only the assembly name shows.
Opening an assembly starts in that state: the active part's script loads into
the editor, but no part is selected until a row tap, a body tap, or an agent
`set_active_part` picks one (`golden:empty-part-pill`, `golden:joints-blocks`).
An empty name does not leave a blank rounded chip. The assembly name is the document `name`. A new
assembly starts as Assembly, then Assembly (1), Assembly (2) when that name
is taken. A copy, import, or colliding rename uses the part rule (`Name`, or
`Name (2)` when `Name` is taken). The repo folder is `assemblies/<Name>/`;
on the GitHub Contents API a space in that name is `%20` and parentheses are
left as-is. A blank or whitespace name is saved as Assembly when the document
is loaded. A custom name already saved is kept. A file name is used only
when the saved document has none. The part chip selects all bodies in that
part on a single tap (`onTitlePartActivate` → `showCadBodyHighlight`). A
double-click opens rename (`onRenameFile` → `handleRenamePart` on
`renameTargetId`). Enter or blur commits, Escape reverts, empty commits
nothing. Part names are sanitised (`sanitizePartName`) because they end up in
`${name}.js` downloads. The assembly chip enters assembly mode on a single tap
(`onTitleAssemblyActivate`: clears `cadPartId`, keeps the last part's mesh and
body highlight for joints). Assembly rename is only on the Parts ribbon center
title (`RibbonAssemblyName` in `PartFeed.jsx`, click to edit). The viewer
assembly chip does not rename. Title chips use `gap-3` on the shared header row
(`data-viewer-header-row`) beside the inline wordmark. `golden:viewer-title-actions`
checks spacing at 390 and 1280. Game keeps a single puzzle-name chip. A
signed-in, GitHub-connected reload shows the last opened assembly.
Signed out, both chips are absent (`data-viewer-title-empty`, `showCadTitle`
off); reload does not load or create `Part (1)` in `Assembly`. Signed in
without a usable GitHub token reopens a real cached assembly read-only, or
shows an empty reconnect prompt. It does not plant the demo.

Desktop specifics:
- **Feature strip (desktop CAD viewer):** `FeatureStrip.jsx` mounts as a
  **horizontal** bar on the CAD viewport under the title
  (`data-desktop-feature-strip`, `data-cad-feature-strip="desktop"`,
  `data-feature-strip-placement="viewer-under-title-horizontal"`). Same chip
  set as mobile CAD. A sheet-metal chip uses the blue bent-plate glyph
  (`SheetMetalPlate`, `text-blue-400`), the same plate as the Shape rail.
  Tap jumps the Monaco caret and reopens the creation dialog
  for that feature (`handleDesktopFeatureStripJump` → `beginFeatureEdit`).
  A named contour chip (`data-feature-chip="contour"`, `data-contour-id`)
  opens the contour editor instead (`beginContourEdit`). A contour no
  feature names stays on that strip with an unused dot
  (`data-contour-unused-dot`).
  After Select plane the pressed contour tool is Cursor
  (`data-contour-tool="cursor"`, `aria-pressed`). The fresh sketch is empty:
  no preview circle on the plane card, and no circle chip. Polyline stays
  unpressed until it is tapped. The same bar lists the open sketch (`aria-label="Sketch"`,
  `data-sketch-entities`): icon chips in creation order, with a per-kind index
  and the positive size in the title. An empty sketch, including the fresh
  Cursor sketch, reads **No sketch entities** (`data-sketch-entities-empty`).   A tap selects a line,
  arc, circle, polyline, or reference, and the canvas uses that same pick highlight. A
  dimension or constraint chip opens its edit card. A perpendicular
  constraint chip uses Lucide `angle` (`svg.lucide-angle`, vendored at
  `src/components/icons/Angle.jsx` because lucide-react 0.469 does not
  export `angle`). Undo is the sketch
  history. Redo stays disabled. Cursor keeps these chips; it does not
  replace the sketch with an empty profile. Double-tap removal of a
  polyline dot keeps the one Polyline chip. A dimension or constraint that
  named the point stays, and its chip takes the failed red border
  (`data-sketch-broken`). A line, arc, circle, polyline, unpromoted shape, or reference
  chip opens a short card whose only action is Delete. The polyline chip deletes the whole chain
  (`data-contour-card="entity"`, `data-contour-entity-delete`). Nothing that
  names it deletes at once, and the toast Undo is the sketch history
  (`data-sketch-delete-toast`). Dimensions or constraints that name it open
  the same scrim and glass card, Cancel focused, red button **Delete along
  with N** dimensions, constraints, or items (`data-sketch-entity-delete-dialog`).
  Confirm removes the entity and those dependents as one sketch undo. Cancel,
  Escape, and the scrim leave the sketch. The plane card leaves this bar on the hidden
  part-strip placeholder. `golden:contour-strip`.
  Sheet metal and regular features share that bar, in script order. A sheet
  block expands in place to Base (`data-feature-chip="sheetBase"`), each bend
  (`sheetBend`), and each tab (`sheetTab`). There is no separate sheet list.
  The script-stage rail (`data-script-feature-strip`) shows the same chips.
  The rollback bar stays. A gap after a sheet chip evaluates the sheet through
  that chip and blanks later features; insert lands at the end of the sheet
  block, before `return part;`. Plane and base on a flange-only script show
  Base only. Bend and Tab toggle edges into one chip: one Confirm, one undo.
  A tap opens that chip's card. Delete never refuses: nothing else
  goes with it deletes now, and children ask **Delete along with N features**.
  The toast is one line, `Deleted.` (`data-delete-undo-toast`). The card is
  twice the previous one-line height. Undo and dismiss stay
  44px wide, and the gap between them stays. Undo is the one editor step. A sketch still takes the bar.
  `golden:sheet-ribbon`. `golden:sheet-feature-mix`.
  When no part is selected the same bar shows assembly joints
  (`data-assembly-joints`), or **No assembly joints**
  (`data-feature-strip-empty`), and Undo is titled **Undo joint**.
  The bar is `--feature-strip-height` (46px) in assembly, part, and empty.
  Left and right tool rails stay `--feature-strip-rail-gap` (10px) below it.
  A chip tap reopens that joint in the card, with its picks highlighted,
  its type, and its value. That edit card has Confirm, a red Delete
  opposite it, and X. Confirm saves and closes. X writes nothing. Create
  still says Add. There is no floating joint tag.
  The create card is `StickyPickApply`. It opens
  from Joints (Lucide `Blocks`, `data-joints-button`), the last button in
  Move. While it is open the parts shift up like every other feature card.
  Add writes the joint, clears the picks, and leaves the card open. X exits.
  Picks group by part in any order. Parallel and Perpendicular sit in the
  same type-button group and write an angle joint at 0° or 90° in one tap. Two faces on each part suggest
  symmetric. A third part asks **Change one of the parts?**
  A tap with nothing selected selects the part. Joint picking starts
  only while that card is open. Face picks stay highlighted until Add or X.
  Distance (`data-joint-value`) is a signed length slider in the global
  display unit. Angle (`data-joint-angle`) is a ±90° slider at 1°. Degrees
  stay in the value field and are not converted as a length. Both boxes use
  `formatDisplayNumber` (at most four decimals, trailing zeros removed). Flip toggles
  sense.
  Adding a joint does not make the page scroll: `html`, `body`, and `#root`
  stay `overflow: hidden`, and the left rail remains the scroller
  (`golden:joints-page-scroll`).
  The old vertical seam strip
  between editor and viewer is gone. Hidden in game mode. SplitDivider sits
  directly between editor and viewer.
- **Profile chip:** desktop (above the 768px mobile breakpoint) shows only
  the CAD viewport chip, top-right. Mobile shows that chip plus one on the
  Parts ribbon and one on the Script toolbar (same `ProfileChip`). Signed-out
  = grey User icon; signed-in and GitHub-connected = green initials. Signed in
  without a GitHub token = grey initials plus an exclamation badge
  (`data-profile-badge="reauth"`). Tap spins, tries a quiet refresh, then a
  silent GitHub popup; **Reconnect** is the full-page flow after that fails.
  Open follows the same phase and does not open local files in that state.
  Other features call `useAuthState()` (`src/hooks/useAuthState.js`): `signedIn`
  is that live session, `githubConnected` is the vault.
  Signed-in menu (`data-profile-panel`): username + copyable id, **Connect agent**
  (plug icon, `data-agent-bridge-connect`) when the bridge is on, **Cart**,
  **Account** (`data-profile-account`, user icon), **Admin** (`data-profile-admin`,
  only when `/api/auth/me` has `isAdmin`), **Sign out**, then **Privacy choices**
  (`data-profile-privacy-choices`, same Accept all / Required only popup as
  first visit). **Disconnect** (`data-agent-bridge-disconnect`, unplug icon) is the local
  agent relay and appears only while an agent is paired or connected — not
  GitHub write-grant (that stays the sr-only Parts **Disconnect GitHub**
  control). **Account** opens a scrollable pane (`data-profile-account-pane`,
  VaultPickerDialog `account`) with read-only user info, **Privacy choices**,
  **Clear local cache** (`data-clear-cache`), and Danger zone → **Delete
  account**. The CAD viewer has no footer Privacy choices link on desktop or
  mobile. The signed-out menu Privacy row stays, and public pages keep theirs.
  GitHub Sign-in uses the runtime Client ID cache from `/api/config`.
- **The Toolbar is portaled into the editor mid-strip, exactly like mobile.**
  There is no floating overlay bar and no collapse chevron for CAD any more;
  `Toolbar.jsx` renders only the dark `variant="strip"` markup for CAD.
- Both viewport rails are **vertical** in this shell too (`verticalRail` is passed
  unconditionally), and both use the same size as each other: 20px icons,
  `p-2` buttons, `p-2` shell.
- Measure is the shared feature card (`data-measure-mode` on `FeatureSheet`),
  not a bottom-left readout. The header mm|in toggle is the global display
  unit (`surfcad.displayUnit`). Length captions end with mm or in. Scripts
  stay millimetres. Clear drops the picks. X closes and writes nothing.
  Game mode mounts no card. Characteristic length
  (`src/utils/characteristicLength.js`) is the longest side of the part box,
  100 mm when the part is empty, cached with the edge graph and on a viewport
  map. It is not written into the assembly file. Feature-card and helper-sheet
  length sliders use that length, the curve, and the global unit. A helper
  sheet scales its L=100 seeds when it opens. Sheet-metal length sliders
  do too, and the cross-section thumb continues past the box. Fillet and chamfer
  do not use L. Their size defaults to 2 mm in every display unit (0.0787 in)
  and the slider runs from 0.5 mm to 25 mm on a log curve (`src/utils/blendSize.js`).
  A typed size outside that range is kept and the thumb sits on the nearer end.
  Other length sliders use the curve and the thumb snap in
  `src/utils/sliderMap.js` (0.1 mm, or 1/16 in). See `docs/architecture.md`
  (**Characteristic length**, **Slider curve and snap**).
- CAD title is the same "part in assembly" line as mobile. No toolbar carries it.
- **Parts feed:** the same list as the mobile Parts stage, mounted to the left
  of the editor (`data-parts-feed-placement="desktop-left"`). The ribbon's
  left cluster is folder, **+**, then Upload (`data-part-upload`) and
  Download (`data-part-download`, agent `export_part` / `export_download`).
  Upload adds a new part from STL, OBJ,
  3MF, or STEP. Download saves the selected part as 3MF (agent may also
  request STL or STEP bytes). Each row's Order
  button (`data-part-order`) opens a quote for that part. Add to cart
  (`data-quote-add`) stores the locked options, server unit price, and
  script hash, then the thumbnail flies. A signed-in row
  whose mesh is not in the vault yet shows `local only`
  (`data-part-mesh-local`). Save on a connected vault commits that `.mesh`
  and clears the badge. Signed out, the badge is hidden and the mesh stays
  on this device. Without GitHub the badge stays (reconnect title) and Save
  does not commit. The assembly
  name sits in the middle of the ribbon (`data-parts-ribbon-center`) on
  mobile. Desktop git puts the branch chip there instead
  (`data-parts-ribbon-branch`, class `parts-branch-chip`, same pane as
  `data-git-branches`); the assembly name stays off the desktop ribbon.
  The chip is a 1px `currentColor` outline, `rounded-lg`, with the same
  `text-blue-400` as the Parts header icons. Truncate a long branch name
  so the header does not wrap.
  Desktop git Save (`data-git-save`) is a split button; the chevron
  (`data-assembly-save-menu`) opens **Rename assembly** and, when the open
  vault is legacy, **Upgrade vault** (`data-assembly-upgrade-menu`). That
  item is hidden on a v2 vault, when no git vault is connected, and on
  mobile (the phone ribbon has Save without this menu). Clicking it opens
  the existing Upgrade vault confirm (`data-git-upgrade-prompt`).
  Signed out (local, no GitHub token), the **+** menu (`data-part-add-dropdown`)
  and the folder menu (`data-part-open-dropdown`) both offer **Part** and
  **Assembly**. Part opens the name dialog and creates a local-only part
  (bare id, no repo path) — the same `startNewPart` path as a signed-in local
  part. Folder → Assembly still opens a `.json` file. Git mode folder → Part
  still opens the repo part list.
  On mobile the profile chip is right-justified in `data-parts-ribbon-end`;
  desktop leaves that slot empty. Each row thumbnail
  (`data-part-thumbnail`, `data-part-preview="manifold"`) is a snapshot of
  that part's solid and stays up when the eye hides the part, including a
  hidden part that has never been in the CAD view. The bitmap is stored in
  IndexedDB by part id and script hash and paints on load
  (`data-part-thumb-source="cache"`). A missing hash is rebuilt off the CAD
  view. Only the viewport drops a hidden row. No solid and no stored bitmap
  is `data-part-preview="empty"`.
  `golden:part-hide-thumbnail` and `golden:part-thumb-cache`. The trash control
  opens **Delete part** (`data-part-delete-dialog`). Cancel leaves the part.
  **Delete from assembly** removes that part only and does not ask again.
  **Delete from assembly & repo**, when the row is a vault path, sits 14px
  below that button. It opens a second confirm that names the file
  (`Delete FilletKilla.js from the repo? This can't be undone from SurfCAD.`,
  `data-part-delete-repo-message`) with Cancel and Delete. Cancel still leaves
  the part. Delete removes the row and commits the file delete. That second
  confirm is the exception for a repo delete the Undo toast does not cover.
  `golden:part-delete-dialog` checks both steps at 390 and 1280. In git mode,
  **Open from repo** (folder): **Part** lists every part in the repo grouped
  by source assembly (loose `parts/` included); **Assembly** lists assemblies
  only, by name (a v2 row carries its id in `data-git-open-item-id` and opens
  and inserts by it). *No assemblies in the repo yet.* shows only when the
  read succeeded and found none; a failed read shows its error in the same
  slot (`data-git-dialog-empty`). Picking one opens **Open assembly?** (`OpenAssemblyChoiceDialog`,
  `data-git-dialog="open-choice"`). **Cancel**, **Insert parts into current**,
  and **Open assembly** sit on one right-aligned row
  (`data-git-open-choice-stage`, no wrap) down to a 375px phone; the blue
  **Open assembly** button stays the primary. The folder Assembly list and
  the git open search both use that dialog. Each assembly row has a trash
  control (`data-assembly-delete`, the same gray trash as a branch row).
  It opens **Delete assembly?** (`data-git-dialog="delete-assembly"`): the
  assembly name, its part count, and **These parts are used elsewhere and
  will be kept in /parts** when another assembly references a part (part
  name and those assemblies). **Delete assembly, keep parts** is the
  primary: it deletes the folder and leaves `parts/` files in place, and an
  assembly-local copy moves into `parts/`. **Delete assembly and its parts**
  is the danger button and stays disabled until the name is typed. It removes
  a script only when no other assembly cites it (`parts[].id`, a path when the
  id is missing, or `groups[].partIds`, including the open document and this
  branch's queued outbox). A cited copy moves into `parts/`. Cancel leaves
  the assembly. While the dialog says Checking parts
  (`data-git-dialog-loading`), a small border spinner
  (`data-assembly-delete-checking-spinner`, the same `border-b-2 animate-spin`
  ring as the assembly-open spinner, 16px) sits under that line and leaves
  when the check finishes. While the delete runs, the clicked button shows a spinner
  (`data-assembly-delete-spinner`) and keeps its width. Both delete buttons
  and Cancel stay disabled, the scrim and Escape do not dismiss, and a
  second tap does not start another delete. Success closes the popup. A
  failure leaves it open with the message in `data-assembly-delete-error`
  and enables the buttons again. That wait includes the local IndexedDB
  update and the queued git sync. An assembly that is still opening
  (`assemblyOpenLockRef`) refuses the delete until that open finishes. Folder →
  Assembly and the open search share that list on desktop and on the phone.
  Live search is `data-git-open-search` / `filterVaultOpenIndex`; empty
  query shows the full list, no hits show *No matches*. Vault files,
  groups, and delete semantics are [`vault-schema.md`](vault-schema.md).
  On a v2 vault every Open Part row is titled with the part's display name
  (from the assembly files, else the script's `// @name` header, else
  **Untitled part**), never its id; the id stays the key
  (`data-git-open-part-id`) and the subtitle (`data-git-open-part-subtitle`)
  reads *in this assembly*, *in A, B* (the assemblies that list it), or
  *not in any assembly*. Rows group under the open assembly, then other
  assemblies A→Z, then Loose parts. On a v1 tree a part from this
  assembly, and a part in `parts/`, opens by reference with no subtitle. A part from another assembly's folder
  links in (`links from …`). The row then shows **Caution: external part!**
  (`data-part-external`) and **Copy to this assembly**
  (`data-part-copy-to-assembly`). Every row's action strip has **Add
  instance** (`data-part-add-instance`, `data-ui-action="data-part-add-instance"`,
  lucide `CopyPlus`, disabled on a missing part): it adds another placement
  of that part through the same host as `insert_part { instance: true }`,
  so the new row shares the script, run and undo history and gets its own
  name, pose and visibility. An instance row shows the gray caption
  *instance of <name>* under its name (`data-part-instance-of`, the
  definition's row id); the primary row of a part placed more than once
  shows a `×N` pill (`data-part-instance-count`). Rename edits the row
  label only. The delete dialog's first line (`data-part-delete-message`)
  comes from `partDeleteDialogCopy`: while other rows still place the same
  part it says *Remove this placement of <name>? The part stays in the
  assembly as N other instances, and its script is kept.* and the
  **Delete from assembly & repo** button is not offered; the last row keeps
  today's copy and the repo option. Parts inserted from another assembly sit
  under a group row (`data-part-group`, `data-part-group-row`): chevron
  (`data-part-group-chevron`), name, and count (`data-part-group-count`).
  Expanded parts are indented under a vertical thread
  (`data-part-group-thread`). Collapse stays in this list. The overflow
  button (`data-part-group-menu`) and a 450ms long-press open the same menu
  (`data-part-group-actions`): **Rename** (inline,
  `data-part-group-name-input`), **Ungroup**, **Copy all to this assembly**,
  **Remove group** (confirm `data-part-group-remove-dialog`; linked parts
  are unlinked, not deleted from the repo). Grouped part rows keep the
  caution label and the same select, rename, and delete controls. On a legacy or local document the gray
  subtitle under the name (`data-part-subtitle`) is the repo path, or the path Add to Repo would write
  (`parts/<Name>.js`); it never shows a `local:` id. On a v2 vault (`vaultLayout: 'v2'`, parts stored by id)
  there is no subtitle: the real id-based path, when the row has one, is the name's tooltip
  (`data-part-path`). The rows container (`data-parts-rows`), the Open assembly and part lists and the branch
  list carry `rail-scroll list-scroll`, which reserves the scroll-bar gutter so the bar never covers the
  trash icons. Add to Repo (`data-part-add-to-repo`) shows when `isSynced` is false, and when the flag
  is unset and the row id is not a repo path. Text inputs on Parts/git
  use `partsChrome.js` `PARTS_TEXT_INPUT_CLASS` (≥16px) to block iOS Safari focus-zoom.
  Git create, Save, rename, copy, and delete show `data-part-pending` spinner in place of the Save icon while that branch's outbox op is queued or sending. A failed sync shows a red mark (`data-part-sync-failed`). A failed rename or assembly delete shows a toast with Retry and Revert (`data-rename-toast`). The delete popup also keeps that failure inline (`data-assembly-delete-error`) until the user retries or cancels. A Save (part row or assembly) that finds the working ref moved shows one yellow warning (`data-repo-moved-toast`) with **Make a new branch** (`data-repo-moved-branch`). That button saves the local files on `surfcad/<assembly>-YYYY-MM-DD` and switches the working ref; a success toast names the branch (`data-repo-saved-toast`). It does not open the conflict popup and it does not show a red Upload Error. Opening or reloading while the outbox is already behind the remote tip still opens only the conflict popup (`data-git-conflict-popup`) and does not show that warning.
  **Overwrite main** (`data-git-conflict-overwrite`) writes the queued local files over that tip (other remote files stay), then clears the conflict and the dirty dots. It does not ask again. Stay on branch leaves those local changes queued. When main is ahead, a yellow toast (`data-git-behind-toast`) offers **Get latest** and **Keep mine**. Get latest opens the same marker dialog (`data-git-behind-ask`). Keep mine runs that dialog's keep action and dismisses the toast.
- `PromptInput` is passed `isMobile` from the shell and floats on the viewer
  pane (`{agentPromptNode}`), not inside the script drawer.

### Mobile shell (`src/App.jsx` mobile branch) — CAD stages + game stack

**CAD (Slice Mobile A + B + C):** dual stage, not a cramped split. Default = CAD stage.
Toggle is session-sticky (`sessionStorage` key `3dculos.mobileStage`). Slice B
replaced the top text chrome with a bottom home-indicator pill + Script feature strip.
Slice C adds CAD-stage feature sheets (default edit path without Monaco).

```
CAD stage                          Script stage
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ [part] in [assembly]        │   ││feat│ mid-strip: Toolbar    │
│ [Undo | features… | Redo]   │   ││strip mid: Monaco (full)   │
│ Viewport + rails            │   ││vert  (viewport mounted)   │
│ PromptInput (paired only)   │   ││      pager icons          │
│ feature sheet (glass)       │   ││                          │
└─────────────────────────────┘   └─────────────────────────────┘
```

**Game:** still the old stacked split (viewport on top, Monaco bottom budget +
draggable seam). Stages do not apply in puzzle mode.

```
┌─────────────────────────────────┐
│ Viewport (flex-1)               │  top-center: ViewportTitleChip
│   left-2 bottom-4: helper rail  │  (puzzle name)
│   right-2 bottom-4: cluster     │
╞═════════════════════════════════╡  ← draggable seam
│ mid-strip: [Toolbar strip]      │
│ Monaco (16px font)              │  height = 32–38% of viewport
└─────────────────────────────────┘
```

Mobile specifics:
- **Page zoom lock:** a pinch in the CAD view zooms the camera, not the browser page (iOS Safari and the installed PWA). Viewport meta locks scale (`maximum-scale=1`, `user-scalable=no`; `viewport-fit=cover` stays). The canvas and the right rail are `touch-action: none`; the left rail is `pan-y` so the tool list still scrolls, with `overscroll-behavior: contain` so a drag at the end of the list does not chain to the page. `html`, `body`, and `#root` are `overflow: hidden`, so the document itself does not scroll. Buttons are `manipulation` so a double-tap does not zoom. Off-canvas two-finger moves and Safari `gesture*` events are cancelled. One-finger scroll in Parts, Script, and scrolling popups stays. Inputs stay ≥16px so focus does not zoom.
- **Stage toggle (Slice Mobile B):** `MobileStageToggle.jsx` is a bottom-centered
  iPhone Home Screen–style glass pill (`data-mobile-stage-home-indicator`,
  `data-home-indicator-pill`) with two Lucide icons: CAD (`Box`) and Parts
  (`LayoutList`). There is no Script button. A part-row pencil opens the editor.
  Desktop has no mode toggle. The parts list sits left of the CAD view. The script
  editor is closed until the pencil or Edit script opens the right-hand drawer.
  The Parts stage is the part list, including group rows and the thread
  (same markup as desktop). Each row shows the same cached solid
  snapshot as desktop. Delete uses that same dialog: assembly delete does not
  ask again, and a repo delete names the file and asks once more. Cancel
  leaves the part. Folder → Assembly
  uses the same Open assembly list and **Delete assembly?** dialog as desktop.
  The ribbon centers
  the assembly name (Assembly when the document has none) and keeps Local or
  Git on the right. Mobile also keeps a profile chip on the Parts ribbon and
  the Script toolbar; desktop keeps only the CAD viewer chip. **Clear local
  cache** is on that chip's Account pane when signed in, and on the signed-out
  menu.
  Session-sticky via `3dculos.mobileStage`.
  Top CAD|Script text chrome is gone. Inert `data-ai-prompt-hook` marks a
  future AI-on-tap site (not wired). Contour/Fillet chips use `bottom-14` on
  mobile so they clear the pill. Shell exposes `data-mobile-stage="cad"|"script"`.
- **Feature strip (Slice Mobile B → B.1 → C → C.1 → C.4 + UI polish):** `FeatureStrip.jsx`.
  **Script stage:** vertical right rail (`data-feature-strip-side="right"`), starting
  below the top ribbon. Icon chips **jump caret only** (`handleFeatureStripJump`
  → `revealRange`; no FeatureSheet). Rail scroll uses `rail-scroll` and auto-scrolls
  to the **last** chip when the feature list grows.
  **CAD stage (mobile feature bar):** full width of its row (`inset-x-0`, strip
  `w-full`, `data-feature-bar-row="full"`, `data-feature-bar-layout="undo-features-redo"`).
  Three sections: fixed **Undo** at the start (`data-feature-bar-section="undo"`),
  a middle section (`data-feature-bar-section="features"`, `px-3` on both sides so
  chips do not collide with the history buttons), and fixed **Redo** at the end
  (`data-feature-bar-section="redo"`). While the chips fit they are centered in
  the middle (`justify-center`, `data-feature-bar-window="fit"`). When they
  overflow, the visible window is the **tail** (`data-feature-bar-window="tail"`):
  the latest chips stay on screen and earlier ones sit outside that window.
  Undo and Redo stay visible, call the same `handleUndo` / `handleRedo` as the
  editor toolbar, and do not change which chips appear.   Strip taps / long-press
  reopen that feature's **creation dialog** (same path on mobile and desktop).
  A named contour is its own chip on that strip (`data-contour-id`, no type
  badge). The CAD strip opens it in the contour editor. The script-stage
  strip only jumps the caret. A contour no feature names shows an unused dot
  (`data-contour-unused-dot`) on that chip.
  After Select plane this bar switches to the sketch chips described under
  the desktop feature strip (`data-sketch-entities`, **No sketch entities**,
  sketch Undo, Redo disabled). The script-stage strip stays hidden for that
  session.
  A contour chip comes back with the saved profile: a `solveContour` call restores
  dimensions, names, and constraints, and a point-list polygon restores its points
  without becoming a constrained contour.
  Sheet-metal chips use `SheetMetalPlate` (blue), same as desktop.
  `hideWhenEmpty` skips the "No features" caption. It does not skip
  **No assembly joints**, which the CAD bar shows when no part is selected.
  The script-stage strip never shows joints. A joint chip tap reopens that
  joint in the card, with Confirm, a red Delete, and X. There is no
  floating joint tag.
  Contour tags stay. After a joint is added the page stays put
  (`scrollHeight` ≤ `innerHeight`, `scrollY` 0) and the left rail still scrolls.
  the bar itself stays mounted so Undo and Redo remain. A chip whose block holds a
  frozen copy of another part's geometry (`externalBody`) has a 2px yellow border
  (`data-feature-external="1"`), active or not; its feature sheet says External copy.
  A feature the last run failed in keeps the red chip (`data-feature-failed`,
  `featureFailure.js`). The run blanks that block and its hard dependents in
  an evaluation copy (`featureSkip.js`) and rebuilds the rest. A dependent
  chip is the same red, titled with the feature it depends on
  (`data-feature-depends`).
  The rollback bar (`data-rollback-bar`) sits in a gap between feature chips.
  Its line runs the full strip height, centred in that gap, clear of the count
  badges that hang off each icon. The gap after the last chip sits past that
  badge. The upside-down triangle sits just above the strip with its tip on
  the top edge. The rail uses the same control. The drawn triangle stays small.
  Dragging uses an invisible 44×44 box on that triangle (`data-rollback-hit`)
  on the strip and on the rail. When the bar is before the first feature, a
  lead spacer (`data-rollback-lead`) opens padding so that box clears the first
  chip, and the chip still opens on tap.
  Releasing the bar keeps the part selected. Only a tap that starts and ends
  on empty canvas, away from the bar, clears the part and shows assembly joints.
  Release greys every chip after it on the strip and on the rail
  (`data-feature-rolled-back`, titled rolled back) and rebuilds up to that
  gap. The run names those features in `rolledBack` instead of reporting
  them as a success. Dragging the bar back to the end runs the whole script.
  Sketch and joint chips hide the bar.
  A palette insert, and every feature Accept, lands at that gap, and the bar
  moves onto the new chip so the tail stays grey. An edit of an existing
  feature does not move the bar. The strip and the run share
  `resolveRollback`: a missing id is the end for both, never the start, and
  the handle is that anchor rather than a gap index turned back into an id.
  A contour chip (`contour:<id>`) is an anchor. The bar can sit between that
  contour and the feature that uses it: the contour stays live and the feature
  is rolled back. A centres contour (`role=centers`) is that same chip and
  anchor. The bar can sit before it, between it and a Hole chip, or between
  two Hole chips that name it. A contour id that is gone from the script is the end.
  Undo, redo, and delete keep the stored id. When the anchor feature is
  gone the bar sits at the end and the full remaining solid runs; when that
  feature comes back the bar returns to it. File open and reload
  drop it and run the full script. Dragging the bar to the very start shows an
  empty part and no error: the evaluation copy no longer declares `part`, so
  the dangling `return part;` is blanked and the viewport clears instead of
  running it. The Extrude card labels Out / In / Both
  as Direction.
  Chip highlight (`featureStripActiveId`)
  clears on sheet cancel/accept/delete (and after script jump). C.4+: Script-stage
  editor stack is full-bleed (`absolute inset-0`) so the top ribbon
  (`data-editor-ribbon`, `w-full`) spans the viewport; the vertical strip overlays
  `right-0` with `top: ribbonPx` (`data-feature-strip-ribbon-spacer-h="measured"`),
  `z-20`, and Monaco uses `pr-11` so chips stay below the ribbon without covering code.
  Per-type index badges (`data-feature-type-badge`,
  1…n per kind) sit bottom-right on each icon. The horizontal bar pads its
  scroller, so those badges stay inside the strip on mobile and desktop.
  Icons match the CAD toolbar
  (Contour/`NotebookPen`, Extrude/`ArrowUpFromLine`, Revolve/`Rotate3d`,
  Loft/`Pyramid`, Sweep/`Route`, Fillet/`SquareRoundCorner`,
  Chamfer/`TriangleRight`). Markers from `parseFeatureMarkers` (`typeIndex`).
  Desktop's strip is the horizontal bar under the title (see Desktop
  specifics above); mobile CAD/Script mounts stay as documented here.
- **Feature sheets (Slice Mobile C → the feature card):** `FeatureEditSheet.jsx`
  sits on the shared bottom card (`data-feature-card`,
  `data-feature-sheet-layout="feature-card"`). On a phone it docks to the CAD
  pane bottom and hides the stage switcher, and the feature-sheet camera slide
  lifts the part clear of it. Desktop uses the same card in the viewer and
  never slides the camera (`featureSheetCamera.js` `enabled`, gated on
  `isMobile`). The Script stage does not float a second card over the editor.
  The CAD strip, the desktop strip, and long-press reopen the **creation dialog**
  for that feature (`beginFeatureEdit`), pre-filled from the block. Confirm
  rewrites that block in place (`confirmFeatureEdit`). Fillet and chamfer Confirm does not rebuild the edge list; it runs the same Accept composer as a new blend (`replaceEditedBlend`) and splices that block over the old one, so disconnected edges stay separate blends. New consts are unique in the whole script, not only in the prefix. One write, one undo. X and Esc write nothing.
  The red Delete button sits opposite Confirm. Delete removes that one block
  and rebuilds immediately. When a later feature uses this feature's edges,
  faces, or variables, a toast names it and offers Undo. No dependents means
  no toast. Undo restores the script in one step. A stored edge or face the
  prefix graph cannot resolve stays listed (`N edges not found`) with Clear.
  The edit card remains for a failed-chip read and for kinds with no creation
  dialog, and the picker uses the same card. Edit script and Delete stay.
  Game mounts no card (`featureSheetEnabled` is the phone long-press gate).
- **Viewport backdrop:** `viewport-shell` + Three.js clear/background use Monaco
  gray `#1e1e1e` (not Tailwind `gray-900` / `#111827`).
- **Face description popup:** removed in Slice Mobile C.1 (was under-title B.1
  `data-face-info-popup`). Selection still drives the left palette;
  no empty reserved band.
- **Edge-pick chip (C.1):** horizontally centered + raised
  (`left-1/2 -translate-x-1/2`, `bottom-20` mobile / `bottom-14` desktop) so it
  clears the right rail and home-indicator / CAD|Script dots. Buttons: Tangent / Undo / Clear. Undo removes the last selected edge only.
- **Left ↔ right rail height (C.1 → content-max):** helper / contour left rail
  uses the same bottom inset as the right cluster (`bottom-2.5` / 10px) and
  `rail-max-below-strip` (shared `RAIL_PAIR_HEIGHT_CLASS`) — content-height up
  to 10px below the CAD feature ribbon; scrolls when the window is too short;
  when buttons fit, width yields to `w-14` (`data-rail-fit`). Desktop CAD
  stretches the left rail with `rail-full-below-strip` (`RAIL_FULL_LENGTH_CLASS`).
  The right rail uses `rail-right-below-strip` (same 10px ribbon clearance, no
  26rem cap).
  Edge-pick **Tangent on** (C.3): seed-plane G1 + same-face parallel bridge so a
  `roundedBox` top rim floods the full coherent loop (not 1 leftover segment).
  C.4: `buildCoherentEdges` traces tagged vs untagged sharp pools separately so
  post-fillet rounded rails (untagged open arcs) stay pickable for Tangent-on.
  Overflow scrolls inside (`data-rail-pair="left"|"right"`).
- **Ribbon / top chrome bg (C.1):** editor mid-strip is `bg-chrome-surface`
  (`data-ribbon-bg="editor"`), the gray-900 token `#111827`, matching the code
  editor shell.
- **Default view snaps (Slice Mobile B.1):** `VIEW_SNAP_MARGIN = 1.35` (was
  implicit 1.15) for top / right / front / iso (and other `VIEW_PRESETS`).
  Zoom-to-Fit (`data-zoom-to-fit`) keeps `fitView` margin 1.15 and frames the
  union box of every visible part. A hidden row is left out. One visible part
  is that part alone. Parts far apart stay inside the frame. View snaps still
  frame the active part. Game puzzle enter keeps 1.55. Normal to sketch
  (`data-normal-to-sketch`, Lucide `CornerDownRight` — lucide-react 0.469 has
  no `RightAngle`) sits directly under Zoom to Fit and only in contour mode.
  It aims along the current sketch plane and zoom-fits the part's world box,
  so a placed part stays centred and in frame (`golden:contour-normal`,
  `golden:contour-normal-fit`).
- **Both panes stay mounted** across stages (WebGL + Monaco + editor refs /
  portal host). Off-stage pane is `invisible pointer-events-none`.
- **Editor budget** (`mobileEditorPx`) still applies to the **game** stack as a
  clamped fraction of `visualViewport` height.
- **Keyboard handling:** `keyboardOverlap` / `keyboardOpen`. Closed → `h-dvh`.
  Open → the shell becomes `position: fixed` pinned to `visualViewport`
  (`mobileShellStyle`). iOS refuses Monaco focus inside a fixed+overflow shell
  until the keyboard is already open.
- **The Toolbar is portaled.** `CodeEditor` renders an empty host div
  (`src/components/CodeEditor.jsx:563`, `data-cad-toolbar-host`) and hands the
  node up via `onCadToolbarHost` → `cadToolbarHost` state (`src/App.jsx:1080`) →
  down into `Viewport`, which `createPortal`s a `variant="strip"` Toolbar into it
  (`src/components/Viewport.jsx:14456`). So CAD chrome is **rendered by Viewport
  but displayed in the editor header** — the most surprising wiring in the app,
  done so download/export busy state can stay in Viewport, and so the green Run
  button can call Viewport's own `executeScript()` on the live buffer without a
  round trip through App (`runCadScript`). Game's Run is a different handler
  (`onRun`); CAD's is `onRunScript`. Select-all sits beside Run at the same
  18px: the button is in the strip, the editor is in `App`, so it routes
  `onSelectAll` → `codeEditorRef.current.selectAll()`. Both shells do this.
- The `CrossSectionPanel` cluster is a **vertical** rail (`verticalRail`,
  `src/components/Viewport.jsx:14877`) — in both shells.
- Overlays still take `compact={isMobile}`, but it no longer changes rail button
  size: the two rails are locked to one size (see Conventions).

---

## 2. Two app modes, orthogonal to the two shells

`appMode` (`src/App.jsx:1065`) is `'cad'` or `'game'` (match-the-part puzzle).
That yields **four** layout combinations; check both flags when editing chrome.

| | `mode === 'cad'` | `mode === 'game'` |
| --- | --- | --- |
| Toolbar contents | **run + select-all** (green run first, own section) then upload/download/undo/redo/quote (Account is the profile chip). The puzzle is not on this strip | back, undo/redo, run, picker, hint (`src/components/Toolbar.jsx`) |
| Toolbar placement | portaled strip above the editor, both shells | strip inside CodeEditor, both shells |
| Title chip | always (filename) | always (puzzle title) |
| Helper rail | `layout="cad"` — Block, Build, Shape, Polish, Move | `layout="game"` — the same five sections |
| Info chips | bottom-left on desktop | always bottom-right (dodges the palette) |
| PromptInput | floating on the CAD viewer while paired (or `?agentPromptDemo=1`). Slides away while a feature card is open | not mounted (`appMode !== 'game'`) |
| Extras | — | ghost mesh, timer, confetti, "Match!" banner (`src/components/Viewport.jsx:14567`) |

Game logic: `src/utils/gamePuzzle.js`, `gamePuzzles.js`, `gameWins.js`;
best times persist via `POST /api/wins`.

---

## 3. Viewport overlay inventory (in render order)

All of these are absolutely positioned inside the shell at
`src/components/Viewport.jsx:14410` (`relative w-full h-full`), with the
`<canvas>` rendered last.

| Screen position | What | Component | Site in Viewport.jsx |
| --- | --- | --- | --- |
| *editor header* (portal) | Toolbar, all CAD | `Toolbar.jsx` `variant="strip"` | `:14456` |
| top-center | CAD: part, the word in, assembly. No part selected: assembly name only, no empty part pill. In contour mode those chips hide and the status legend (`data-contour-status-legend`) is centred on that box; the chips return when contour mode closes. Game: puzzle name | `data-viewer-title` / `ViewportTitleChip` / `ContourStatusLegend` | Viewport |
| top-left, 44×44, under the IO tray | puzzle easter egg, signed-in only (`useAuthState().signedIn`) | `data-puzzle-unlock` | `PuzzleUnlock` |
| below the feature bar, centered | "Puzzle unlocked" toast after the fifth tap | `data-puzzle-unlock-toast` | `PuzzleUnlock` |
| bottom of the pane, 10px from the left edge (`fullLeft`) and 10px clear of the right rail. On a phone the stage switcher hides and the card sits on that switcher's bottom edge (`data-feature-card`) | Paint: 8 swatches (grid padded so the selection ring is not clipped), custom `#rrggbb`, Part, Undo, Clear, Remove unmatched colors. The color preview sits in the note. Confirm saves the session. X and Esc revert it. No swipe. The left helper rail is hidden, so the card passes `fullLeft` | `PaintModeChip` `data-paint-mode` on `FeatureSheet` | Viewport |
| bottom of the pane, 10px from the left edge (`fullLeft`) and 10px clear of the right rail. On a phone the stage switcher hides and the card sits on that switcher's bottom edge (`data-feature-card`, `data-fea-sheet`) | Analyze: material (library or custom E/ν/yield, assumed badge), Fix / Force / Pressure, fixture and load list, Run. After a successful solve, Results shows Stress / Displacement tabs and Back to Setup. The legend, those tabs, and Stage times scroll in the body. Legend is a viridis bar with ticks, min/p95/max MPa, and safety factor or n/a. Displacement is min/max in mm. A real TET10 result has no STUB badge. Re-run when the result is stale. The footer is Run or Back to Setup, never Confirm. Opening Analyze closes the other cards | `FeaStudyChip` and `FeaStudySheet` on `FeatureSheet`, `FeaLegend` `data-fea-legend` | Viewport |
| centered | "Match!" success banner | inline | `:14567` |
| left-2/4 bottom-2.5 | helper insert rail (height paired to right). Block, Build, Shape, Polish, Move. Shape includes Sheet Metal (blue plate with a bent flange, `data-sheet-metal-button`) with the other shape tools. Move ends with Joints (Lucide `Blocks`, `data-joints-button`), which opens the joint create card | `HelperInsertPalette.jsx` | Viewport |
| left-2/4 bottom-2.5 | contour tool rail (replaces the helper rail). Cursor (Lucide `mouse-pointer-2`), Circle, Rectangle, Polygon (regular, 3 to 8 sides: triangle, square, pentagon, hexagon, heptagon, octagon; `data-polygon-preset`), Polyline (Lucide `waypoints`; `vector-polygon` is not in lucide-react 0.469), Arc (Lucide `spline`), Dimension, Constraints, then the divider. Cursor drags a point and does not add a point. Grabbing an edge or the interior of a hexagon, circle, rectangle, or polyline translates the whole shape. A free shape moves, a fully locked shape does not, and a partly constrained shape moves along the directions the solver still allows. Each drag is one undo. `golden:contour-shape-drag`. In the Polyline tool, a tap on a segment inserts a point, a second tap within 300ms removes a point, and a drag on a point moves it. Double-tap a polyline dot to remove it in one undo step. A constraint that named it stays and is marked broken. | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | Fewer than three points deletes the shape, and a saved shape with feature users uses Delete along with N features. Dimension and Constrain pick a part vertex, edge, or face outline on this part after the sketch misses at 12 px. The face outline is the boundary loop, and the constraint binds the edge under the cursor. References draw dashed and muted under the sketch, with no handles. The selected reference stays dashed in the picked-edge colour. `golden:contour-refs`. A broken reference stays dashed in red and carries a broken tag (`data-contour-ref-broken`). `golden:contour-ref-resolve`. Entering a sketch opens the plane card (title Contour). Offset is under the angle fields, the same signed length control as Workplane (`Offset mm` or `Offset in`), along the normal for a Face and for X, Y, and Z. The preview moves with the value. | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | Confirm writes the shifted frame center and stores `offset=` on the `@contour` comment so a reopen shows the same number (`golden:contour-plane-offset`). Insert Extrude, Revolve, Loft, or Sweep opens a feature card titled with that name (`data-feature-slot-card`), and so does reopening that chip on the feature strip. Each profile slot and the Sweep path slot shows a reference chip, a picker of saved contours (hover or tap highlights the ghost), and New contour. Pick a contour is plain text (`data-slot-prompt`, and `data-slot-empty` while the slot is empty), not a button. The contour buttons follow it, and only the picked button is orange. The picker has no No contour row. The card's button is Confirm. Select plane stays on the plane card. Free sketch points stay draggable after a tool change; only a solver-locked point stays fixed (`golden:contour-keep-edit`). | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | A dimension shows a positive size, and a positive edit keeps the side of a reference edge. New contour opens the plane card. The rail checkmark saves the named contour and returns to that feature card with the slot filled. X returns without filling the slot. A filled chip (`data-slot-edit`) opens that contour in this editor, and so does the CAD strip's contour chip. The banner (`data-contour-edit`, `data-contour-used-by`) reads Used by and the feature names, or Unused. The name field is `data-contour-name`. The checkmark rewrites that contour by id and rebuilds every feature that names it. X discards. A rename updates every reference. Saving from a chip returns to that card. An unused contour shows unused on its strip chip and in the picker. | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | Delete on the contour editor (`data-contour-delete`) removes an unused statement immediately, including one that sits inside the sheet-metal block, and shows an Undo toast (`Deleted contour.`). A referenced contour opens a confirm (`data-contour-delete-dialog`) whose red button reads Delete along with N features and removes the contour plus those feature blocks. Delete does not refuse. Cancel leaves the script. Deleting a feature leaves its contours. Undo restores that step. Extrude distance and sense, revolve angle, axis, segments, and sense, sweep reverse and closed, and loft offsets stay on the card. Confirm writes the solid with those values. The part slides up with the other feature cards. Select plane accepts the plane, aims the camera normal to it, zoom-fits, and closes the card. The rail stays, and the pressed tool is Cursor (`data-contour-tool="cursor"`, `aria-pressed`). | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | The sketch is empty: no preview circle, and no circle chip. Polyline stays unpressed until it is tapped. Back (`data-contour-back`, Lucide ArrowLeft) undoes one contour edit. With nothing left to undo, Back opens the plane card again. Confirm (`data-contour-confirm`, Lucide Check) finishes the contour. Grey X (`data-contour-exit`) exits. Arc, Dimension, and Constraints do not reset the contour. A promoted contour is grey, dark, or red by status. Right-drag or one-finger drag moves a free polyline point and does not orbit. While drawing or dragging, the point snaps to a part reference edge or a sketch line or arc inside 12 px. An endpoint inside that radius wins over an edge. An amber ring (`data-contour-snap`) marks it, and release adds a two-target coincident (on the edge, or point-to-point at an endpoint). Dimension, Constraints, Arc, and Cursor do not snap. `golden:contour-snap`. | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | Rotate and pan stay off from that pointerdown until release. A drag that starts on empty space still orbits. Dimension and Constrain keep the 12px tap-slop rotate hold. A dimension value re-solves the polyline as it is typed. A distance between two points keeps the first and moves the second. The tag is portaled onto the page so it stays visible. Sketch lines are 3px and point dots are 8px. A dimension draws extension lines from both picked points, filled arrowheads whose tips meet those lines, the extension slightly past the tip, and the value chip centered on the arrow. An angle draws an arc that stops at the arrow base. Dimension and Constrain say Add, leave the card open, and slide the part up. A tag tap reopens with red Delete and Confirm. Picks stay highlighted until Add. Sketch hits are 12px and beat the part. | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | A perpendicular constraint is a plus bubble, hidden while it would cover a dimension chip, and stacked pluses collapse to one. The sketch-plane square is not drawn. Workplane quads show with the plane card and hide once Select plane accepts the plane. Back shows them again. A plane toggle the user set stays. Dragging a dimension value chip moves a length, distance, offset, or radius along its normal and an angle along its radius. A move under 6px still opens edit. The placement is stored on the dimension and kept on reopen. Agent (H7): rail Dimension (`data-ui-action="dimension"`) → `sketch_dimension`; Constraints → `sketch_constrain`; the pick card is `data-contour-gesture-card` on `ContourGestureCard` | `ContourModeRail.jsx` | Viewport |
| left-2/4 bottom-2.5 | sheet-metal rail (replaces the helper rail while `sheetMetalMode`): **Shape** section, SCS tools for the SKU, Tab first, ✕ exit | `sheetMetal/SheetMetalRail.jsx` | Viewport |
| bottom center feature card (`data-feature-card`). Material line truncates, hint wraps. Does not cover either toolbar. Hidden in game | sheet-metal chip: bound SKU + step hint, **Check** and **Done** (edit), X exits without writing | `sheetMetal/SheetMetalModeChip.jsx` | Viewport |
| same feature card | Sheet Metal picker: material + gauge (out-of-stock gauges disabled, “out of stock”), Start designing. X cancels | `sheetMetal/SheetMetalPicker.jsx` | Viewport |
| same feature card | Base flange: X / Y, mm\|in toggle in the header, Back, Confirm. X exits without writing | `sheetMetal/SheetMetalFlow.jsx` | Viewport |
| same feature card | Bend: Angle, Flange length, Flip, R·K·BD, Back / Confirm / Delete. X exits without writing | `sheetMetal/SheetMetalFlow.jsx` | Viewport |
| same feature card | Tab (Width, Depth, Centered, Offset) / Hole, countersink, tapped (Ø or Thread, Csk Ø, U, V) | `sheetMetal/SheetMetalFlow.jsx` | Viewport |
| same feature card | Check: DFM fails (red) / warnings (amber) scroll in the body, flat size, where STEP came from, X closes. No download or SendCutSend button. Done writes when the spec differs, then closes | `sheetMetal/SheetMetalFlow.jsx` | Viewport |
| scene | plane quads / sheet preview / bendable-edge lines (2.5px core, opacity 0.65; undrawn pick box; taps route here first) | `utils/sheetMetal/sheetOverlay.js` | Viewport |
| right-2/4 bottom-4 | view / pick / paint / inspection cluster. Paint (`data-paint-chip`) is in the plane and contour group, green only while paint mode is on, hidden in game. Analyze (`data-analyze-chip`, Lucide `Gauge`) is the first inspection button, next to Paint, same blue, green only while the study is open, hidden in game. Normal to sketch (`data-normal-to-sketch`, title and aria-label `Normal to sketch`, Lucide `CornerDownRight`) is directly under zoom-to-fit and only in contour mode | `CrossSectionPanel.jsx` collapsed rail | Viewport |
| inside that cluster | Front/Right/Top/**Iso** snap popup | `ViewSnapControl.jsx` | `CrossSectionPanel.jsx:360` |
| top-16, portaled `z-50`, `inset-x-3` (most of the viewport width, same card on desktop) | execution error toast: fixed card, label "Error", Undo and dismiss on the right, description on the next line (`ErrorPopup` `layout="stacked"`), glass `rounded-lg` | `ErrorPopup.jsx` | Viewport |
| centered on the viewport pane (desktop) and the phone shell | assembly-open spinner: ring + `Opening <name>…`, optional `part 3 of 7`. Hidden for the first 150ms. `pointer-events-none`, `z-[45]`, under the toasts | `AssemblyOpenSpinner.jsx` `data-assembly-open-spinner` | App |
| *(removed C.1)* | Selected Face readout | — | — |
| bottom of the pane (`data-feature-card`). On a phone the stage switcher hides and the card sits on that switcher's bottom edge. Desktop stays 10px off the pane | contour plane card (circle, rectangle, polygon, polyline, workplane), the Hole card, and the Extrude, Revolve, Loft, and Sweep slot cards, fillet, chamfer, the standalone edge card, shell, draft, move face, delete face, cut, boolean, move, rotate, paint, the CAD helper card (cube, round box, cylinder, sphere, tube, hex, hole, mirror, center, align, array, path, refuse). | `FeatureSheet.jsx`, `ContourModeChip.jsx`, `FilletModeChip.jsx`, `ShellModeChip.jsx`, `DraftModeChip.jsx`, `MoveFaceModeChip.jsx`, `DeleteFaceModeChip.jsx`, `CutModeChip.jsx`, `BooleanModeChip.jsx`, `MoveModeChip.jsx`, `RotateModeChip.jsx`, `PaintModeChip.jsx`, `MeasureModeChip.jsx`, `fea/FeaStudyChip.jsx`, `fea/FeaStudySheet.jsx`, `HelperParamModal.jsx`, `HoleCard.jsx`, `sheetMetal/SmControls.jsx` | Viewport |
| bottom of the pane (`data-feature-card`). On a phone the stage switcher hides and the card sits on that switcher's bottom edge. Desktop stays 10px off the pane | Cube **Centered** clears as soon as Pos or Rot changes so it does not fight the pose fields (distinct from the **Center** transform). Block feature edit writes pose back into the script. Move on overlapping bodies stores mesh `tri` with `{ at }`. Sheet metal (picker, plane and edit chip, base, bend, tab, hole, countersink, tapped, export). Grey shell, cyan Confirm. | `FeatureSheet.jsx`, `ContourModeChip.jsx`, `FilletModeChip.jsx`, `ShellModeChip.jsx`, `DraftModeChip.jsx`, `MoveFaceModeChip.jsx`, `DeleteFaceModeChip.jsx`, `CutModeChip.jsx`, `BooleanModeChip.jsx`, `MoveModeChip.jsx`, `RotateModeChip.jsx`, `PaintModeChip.jsx`, `MeasureModeChip.jsx`, `fea/FeaStudyChip.jsx`, `fea/FeaStudySheet.jsx`, `HelperParamModal.jsx`, `HoleCard.jsx`, `sheetMetal/SmControls.jsx` | Viewport |
| bottom of the pane (`data-feature-card`). On a phone the stage switcher hides and the card sits on that switcher's bottom edge. Desktop stays 10px off the pane | The footer top padding (`pt-4` on `data-feature-sheet-footer`) is the gap between the body and Delete/Confirm, so Fillet's Tangent / Clear / Undo row and every other card on this shell share it. On a phone, Dimension and Constrain Done or Enter in the compact field commits and then Adds, or Confirms when editing. Blur only commits. The edge card has X and no Confirm. | `FeatureSheet.jsx`, `ContourModeChip.jsx`, `FilletModeChip.jsx`, `ShellModeChip.jsx`, `DraftModeChip.jsx`, `MoveFaceModeChip.jsx`, `DeleteFaceModeChip.jsx`, `CutModeChip.jsx`, `BooleanModeChip.jsx`, `MoveModeChip.jsx`, `RotateModeChip.jsx`, `PaintModeChip.jsx`, `MeasureModeChip.jsx`, `fea/FeaStudyChip.jsx`, `fea/FeaStudySheet.jsx`, `HelperParamModal.jsx`, `HoleCard.jsx`, `sheetMetal/SmControls.jsx` | Viewport |
| bottom of the pane (`data-feature-card`). On a phone the stage switcher hides and the card sits on that switcher's bottom edge. Desktop stays 10px off the pane | Measure has X and no Confirm: Clear is in the body, and the mm\|in toggle is in the header. Measure keeps the left rail, so it stays between both rails. Analyze's footer is Run or Back to Setup, never Confirm. Fillet, chamfer, shell, draft, move face, delete face, cut, move, rotate, boolean, and paint use `fullLeft` (10px from the pane's left edge, clear of the right rail) because the left helper rail is hidden. | `FeatureSheet.jsx`, `ContourModeChip.jsx`, `FilletModeChip.jsx`, `ShellModeChip.jsx`, `DraftModeChip.jsx`, `MoveFaceModeChip.jsx`, `DeleteFaceModeChip.jsx`, `CutModeChip.jsx`, `BooleanModeChip.jsx`, `MoveModeChip.jsx`, `RotateModeChip.jsx`, `PaintModeChip.jsx`, `MeasureModeChip.jsx`, `fea/FeaStudyChip.jsx`, `fea/FeaStudySheet.jsx`, `HelperParamModal.jsx`, `HoleCard.jsx`, `sheetMetal/SmControls.jsx` | Viewport |
| bottom of the pane (`data-feature-card`). On a phone the stage switcher hides and the card sits on that switcher's bottom edge. Desktop stays 10px off the pane | The sheet metal picker and feature edit stay centered between both rails. Contour, the edge card, and the helper card stay between both rails too. Refuse's footer says OK. Sheet metal Confirm is 44px. Boolean stays `z-20`, under the section rail. The view-snap flyout (`z-40`) may cover a `fullLeft` card's right end and stays above it. Hidden in game. Game keeps the old helper sheet | `FeatureSheet.jsx`, `ContourModeChip.jsx`, `FilletModeChip.jsx`, `ShellModeChip.jsx`, `DraftModeChip.jsx`, `MoveFaceModeChip.jsx`, `DeleteFaceModeChip.jsx`, `CutModeChip.jsx`, `BooleanModeChip.jsx`, `MoveModeChip.jsx`, `RotateModeChip.jsx`, `PaintModeChip.jsx`, `MeasureModeChip.jsx`, `fea/FeaStudyChip.jsx`, `fea/FeaStudySheet.jsx`, `HelperParamModal.jsx`, `HoleCard.jsx`, `sheetMetal/SmControls.jsx` | Viewport |
| top-16 center, portaled `z-50` | toasts: edge-mode, contour, fillet-scrap, fillet, shell — same `ErrorPopup` card | `ErrorPopup.jsx` | Viewport |
| bottom center feature card (`data-feature-card`, `data-measure-mode`). On a phone the stage switcher hides. Hidden in game | Measure: sticky point / edge / face / part picks, distance, angle, radius, diameter, ΔX ΔY ΔZ. Header mm\|in is the global `surfcad.displayUnit`. Joint distance and the contour loft offset read it too. Scripts stay mm. Length captions end with mm or in. Clear drops the picks. No Confirm. X closes and restores the camera. Characteristic length feeds the feature-card length sliders and does not change this card | `MeasureModeChip.jsx` | Viewport |
| bottom center of the viewer pane, between the rails (`data-agent-prompt`). Desktop bottom 48px / max 640px; phone bottom 56px / rail-capped. Hidden until an agent is paired (or DEV `?agentPromptDemo=1`). Not mounted in game. Camera toggle attaches a viewer-only PNG to the next send. Slides down while any feature card is open and slides back when it closes. Working collapses the chat, replaces the hint with a spinner and "Agent is working...", and turns Send into Stop; typing keeps the chat open with the dots. Desktop: a chevron-down on the bottom edge folds the prompt behind a chevron-up at the bottom of the pane (`data-agent-prompt-fold` / `data-agent-prompt-unfold`, badge for the state) | floating agent prompt | `PromptInput.jsx` | App (sibling of Viewport, both shells) |
| fills the pane | WebGL canvas | `<canvas ref={canvasRef}>` | `:15817` |

Unpainted faces are one off-white, `DEFAULT_PART_COLOR` (`#ECEAE4`, `src/utils/partMaterial.js`). Face paint, the stress skin, selection and hover, and piece-preview colors draw over it. The canvas draws a face-color skin on top of a part when that assembly has `colors` (`src/utils/faceColorSkin.js`). The skin is under crease lines and pick highlights. `?debugFaces=1` or `localStorage` key `surfcad.debugFaces` = `1` paints each face patch a different color. The flag is off unless set, and it is not a rail button. The right rail has no patch-colour toggle.

**Analyze.** The Analyze button is on the right rail, in the inspection group, immediately after the divider that follows Paint. The icon is Lucide `Gauge` at 20px, blue like the axis, measure, and section buttons, and green only while the study is open. It is not on the left rail. Game mode hides it. Phone and desktop open the shared feature card (`data-feature-card`, `data-fea-sheet`) with `fullLeft`: the left tool rail is hidden, so the left edge is 10px from the pane and the right edge stays clear of the right rail. On a phone the card docks at the pane bottom and the stage switcher hides. Opening Analyze closes the other cards, and opening another card closes Analyze. The footer is Run, or Back to Setup after a solve. It does not say Confirm. X and Esc close Analyze. Run meshes the solid and draws the TET10 von Mises field. The legend in the chip or sheet is a viridis bar, five ticks, min / p95 / max in MPa, and the safety factor or n/a. The STUB badge is absent on that result.
The button reads Meshing, Solving, or Post-processing, and Cancel is next to it while the solve is in flight. The paint skin is hidden while that overlay is visible and comes back when Analyze closes or Paint opens. A geometry, material, fixture, or load edit greys the legend and shows Re-run. The overlay does not keep the old colours.

- A finished solve switches the chip and the sheet to Results (`data-fea-view="results"`). The material picker, Tap adds, and setup hints hide.
- Stress and Displacement use the same tabs as Fix / Force / Pressure. Stress keeps the viridis von Mises legend. Displacement colours magnitude in millimetres (min / max). The part is not deformed.
- Timing and Stage times scroll in the card body, under the plot. Back to Setup (`data-fea-back`) stays in the footer and remains on screen when Stage times is open. It returns to the setup and takes the result overlay off. A failed or stopped run stays in setup with its error.
**Paint.** The paint button is on the right rail and is CAD-only. A tap paints that face immediately on the skin, in the selected color. There is no selection step. A second tap on the same face within 300 ms paints every face of that body and stays one undo entry. Part paints the whole part (`colors[surfId].part`), which is every body, so it stays next to double-tap. Confirm writes the session once through the assembly save (local document, and one git outbox op in Git mode) and closes. X and Esc revert every paint from this session and write nothing. The card is the shared feature card. Undo steps back one paint. Clear restores the colors from when the popup opened. The swatch grid is padded so the selection ring stays inside the scroller. Game mode hides the button. The helper rail hides while the popup is open, same as Shell.

**Opening an assembly.** `data-assembly-open-spinner` sits centered over the
viewport (the viewport pane on desktop, the full shell on a phone) while a
document loads. Paths: the Open assembly dialog (Cancel, Insert parts into
current, and Open assembly on one right-aligned row), the folder menu's Assembly
action, git open search, a branch switch, and the initial restore of the last
assembly. The wait is the `.surf.json` and part-script fetch (IndexedDB
cache-first, and GitHub when the vault is open; see [`vault-schema.md`](vault-schema.md)) plus the worker build that
refresh paints. A sibling `<Part>.mesh` is fetched with that part through the Git
blob API (not Contents GET) and stored in IndexedDB `surfcad-assets`, keyed by
blob sha, for a later mesh import. The label is `Opening <name>…` (`data-assembly-open-label`).
While a part is in flight it also reads `part 3 of 7`
(`data-assembly-open-progress`). The ring is the same border spinner as the
boot loader. It stays hidden for 150ms so a fast open does not flash, and it
clears on success, failure, or cancel. Silence for 45s clears it and shows
the failure toast (`data-assembly-open-toast`, same `ErrorPopup` card) with
Retry (`data-assembly-open-retry`). The overlay does not take clicks
(`pointer-events-none`, `z-[45]`), so those toasts (`z-50`) stay usable.
`prefers-reduced-motion` stops the ring (`data-assembly-open-ring`).

**Mutual-exclusion rules.** The helper rail hides while `contourMode`,
`filletMode`, paint mode, or Analyze is set (and the other feature modes). Opening Analyze closes the other cards, and opening another card closes Analyze. The Edge-pick chip needs `pickMode === 'edge'`, no active mode, **and at
least one selected edge**. Break these and overlays stack in the same corner.

**View snaps.** `ViewSnapControl`'s button only opens and closes its popup —
Front / Right / Top / Iso all live *inside* the popup. The popup flies out **to
the left** of the trigger (`absolute right-full`, vertically centred on it),
because the cluster hugs the right edge of the viewport. While it is open the
button shows an `ArrowLeft`, pointing the same way the menu unfurled. There is
no alignment prop — both call sites render `<ViewSnapControl onSnap={…} />`.

---

## 4. Modals (full-screen, mounted from `App.jsx` in both shells)

All use `fixed inset-0 z-50 flex items-end sm:items-center` — **bottom sheet on
phones, centered dialog on desktop**.

Order-flow sheets share `ModalFit` (`modal-fit`): max-height is `100dvh` or `visualViewport.height`, minus safe-area insets and a small margin, so the popup stays above the iOS Safari toolbar.

| Modal | Opened by | File | Notes |
| --- | --- | --- | --- |
| Login | Profile chip → Sign in (signed out / guest) | `LoginModal.jsx` / `ProfileChip.jsx` | `/api/auth/login`, `/register` |
| Account | Profile menu → Account (`data-profile-account`) | `AccountPane.jsx` / `ProfileChip.jsx` | read-only user info, Privacy choices, Clear local cache, Delete account; scrolls on 390 |
| Account (orders) | order-flow return / `handleAccount` when already authenticated | `AccountModal.jsx` | tabs `info` / `orders` |
| Cart | part row Order (`data-part-order`); profile menu Cart (`data-profile-cart`); chip count (`data-cart-badge`) | `CartSheet.jsx` | signed-in lines only. Each quoted line shows its server unit price (`data-cart-unit-price`) and a stale badge (`data-cart-stale`) when the script hash changed or the quote expired (7 days, or no quote id). Remove (`data-cart-remove`) asks first (`data-cart-remove-dialog`) and names the part. Cancel is the default. Remove is destructive. Quantity does not ask. Checkout (`data-cart-checkout`) opens one page. Part missing and Not in this assembly stay in the cart. |
| Checkout | cart Checkout | `checkout/CheckoutPage.jsx` | one page (`data-checkout-page`): qty, remove (same confirm as the cart sheet), stale / expired badges, address picker, one shipping quote (box count when more than one box), one pay. It charges the quote Add to cart stored. `priceUpdated` (`data-price-updated`) disables Pay until confirm. Paid lines are tombstoned. |
| Quote | part-row Order (`data-quote-mode="add"`) | `QuoteModal.jsx` | process / material / infill. Add to cart qty is editable; the button is Add to cart (`data-quote-add`). That path POSTs `/api/quotes` and stores `quoteId`, `quotedAt`, and `quotedUnitPrice`. A 404 shows an error and does not write a line. The browser `calculateQuote` fills the modal; the line stores the server unit price. A part that is only sheet metal and passes the SCS checks (`data-scs-handoff`) shows Download DXF, Download STEP, and Order on SendCutSend instead of this form, and does not write a line. **Quote with SurfCAD instead** (`data-scs-surf-quote`) opens this form. Mixed parts and hard DFM fails stay on this form. An existing cart line is left in place. Cart Checkout opens the one page and does not open this modal. The in-flight stepper still uses checkout mode (`data-quote-qty`, button Order), and an eligible sheet script stays on this form there. |
| Quote | part-row Order (`data-quote-mode="add"`) | `QuoteModal.jsx` | An `importMesh` line reads the asset cache; a miss shows that line's error. |
| Order | in-flight checkout, including an OAuth return | `OrderModal.jsx` + `components/order/*` | six steps, `STEPS` at `OrderModal.jsx`: Auth → Address → Shipping → Payment → Confirmation → Convert. Singular `modelData` create stays. Pay uses the server total; a mismatch shows “Price updated to $X” and disables Pay until confirmed. The account Orders tab lists each line (`model-data` when an old order has no `lines`). An unmeasurable export shows “We couldn't measure this part. Please re-export and try again.” A server that rejects `quantity` shows that instead of crashing. |
| Helper params | any helper-rail button | `HelperParamModal.jsx` | CAD uses the feature card (`data-feature-card`): X and Esc write nothing, Confirm saves and closes, no click-outside. Length fields are shaped thumbs in the global unit, seeded from the static L=100 defaults times L/100. Counts and angles stay linear. Hole U/V, cylinder axial, array spacing, and move-face distance are signed. Cylinder angle is ±90° at 1°. The pose preview stays. Game keeps the docked sheet (`absolute inset-0`, click-through, no scrim, no card, no slide). Also the refuse/explain dialog |
| Puzzle picker | Toolbar → List (game) | `PuzzlePickerModal.jsx` | |
| Hints | Toolbar → BookOpen (game) | `GameHintsModal.jsx` | |
| Terms | order flow | `TermsModal.jsx` | |
| Confetti | puzzle win | `GameConfetti.jsx` | full-viewport canvas, not a modal |

Error banners (`gameError`, `uploadError`) and viewport soft-fail / scrap /
execution cards all use `ErrorPopup.jsx` (always includes an **Undo** button
wired to App undo history). App banners sit at `absolute top-4 left-1/2 …
z-50`, duplicated in both shells.

---

## 5. Feature → code index

### Shell, layout, responsiveness
`src/App.jsx` — both shells, `isMobile`, keyboard/visualViewport math, modal
mounting, and every top-level handler: `handleExecute`, `handleSave`,
`handleOpen`, `handleImport`, `handleQuote`, `handleStartOrder`, undo/redo
history, `handleInsertHelper`, `handleCommitContourProfile`,
`handleCommitFillet`.

### Code editing
`src/components/CodeEditor.jsx` — Monaco wrapper, mid-strip, the Select All
context-menu action (`registerSelectAllMenu`, `:16`), and the imperative ref API
(`getContent`, `loadContent`, `setTextOnly`, `insertAtCursor`). New parts
start empty (`newPartStarterScript` in `src/utils/helperPaletteSnippets.js`,
`blankPartStarter` in `src/utils/defaultScript.js`). `DEFAULT_SCRIPT` in that
file is the demo restored when leaving the puzzle with no CAD backup. Draft
persistence: `src/utils/editorStorage.js`.

### Running a script
`src/components/PromptInput.jsx` (paired-agent prompt → `createAgentPromptTransport`; DEV unpaired may still use the echo stub) is not on the run path.
Run still goes `src/utils/scriptValidator.js` → `src/utils/scriptExecutor.js` →
`src/workers/sandboxWorker.js`, which calls `bindWorker` in
`src/lib/surfcad/runtime.js` (the helpers and the message protocol), with
Manifold booted by `src/utils/ManifoldWorker.js`. Timeout/memory
caps: `EXECUTION_LIMITS`, `src/components/Viewport.jsx:1050`. The evaluation
copy for a failed feature, and for a later rollback anchor, is
`src/utils/featureSkip.js` (`hardSkipIds`, `evaluationScript`,
`resolveRollback`). The worker `execute` message runs that copy.
`resolveRollback` is the anchor for both the bar and the rollback blank,
including a `rollbackAnchor` from the feature-strip bar. A missing id
blanks nothing. The buffer stays unchanged.

### Selection
Faces: `src/utils/selectFace.js`, `src/utils/faceFeaturePlacement.js`.
One face tap is the PartGraph patch (`src/utils/partGraphPatches.js`). A fillet
band is the G1 chain: the walk crosses separate fillet calls when the dihedral
is within both gates, and it stops at a flat, the loft, a hole, a chamfer, or
a crease above the gate.
Edges: `src/utils/selectEdge.js` (`pickNearestEdgeScreen`,
`buildCoherentEdges`, `toggleEdgeSelectionPropagated`),
`src/utils/boundaryEdgeIds.js`, `src/utils/edgeTangencyField.js`. Pick mode is
one `pickMode` state (`src/components/Viewport.jsx:1294`), toggled from the
`CrossSectionPanel` cluster. Fillet and chamfer use that same pick. A short
edge's hit segment grows to 44px (22px past each end); the drawn stroke stays
the real edge. Inside that radius the nearest screen distance wins, so a long
edge that is closer still picks. `golden:fillet-edge-hit` taps within about
15px of a short corner on a sheet and on a filleted box at 390 and 1280.

### The "in-mode" pattern
Contour / Extrude / Revolve / Loft / Sweep: `src/utils/contourMode.js` +
`src/utils/featureSlotCard.js` + `ContourModeRail.jsx` + `ContourModeChip.jsx` +
`FeatureSlotCard.jsx`; enter/exit/confirm are
`enterContourMode` (`src/components/Viewport.jsx:4288`),
`exitContourMode` (`:4125`), and `confirmContourProfile` (`:4562`).
Fillet / Chamfer: `src/utils/filletMode.js` + `FilletModeChip.jsx` (same
edge-pick card on `FeatureSheet`; both commit path sweeps — Fillet → `filletAlongPath`,
Chamfer → `filletAlongPath({ profile: 'chamfer' })`). Size defaults to 2 mm
(`blendSize.js`); the slider is a log from 0.5 mm to 25 mm, and a typed size
outside that range is kept. Card: Tangent / Clear / Undo / Confirm. That link row sits above Delete and Confirm with the shared feature-card footer gap. Undo undoes the last edge pick only; X / Escape / dismiss without Confirm clears all picks and exits; no hard-edge warning; no
strategy helper line. Confirm is the card footer. The standalone edge card has no Confirm.
Enter/exit/accept at `src/components/Viewport.jsx` `enterFilletMode` /
`acceptFillet`. Disjoint edge picks split via `splitEdgePathComponents` and
Accept emits one `makeSweepPath` + `filletAlongPath` pair per contiguous
component inside the same mode markers (connected chains unchanged).
Kernels in `src/utils/fillet*.js` and
`src/utils/edgeSweepPath.js` — read `.claude/skills/fillets/SKILL.md` first.
New parts start empty (no seed cube). A Create-contour Confirm on a script
with no `part` writes a plane literal, so the following Extrude is
`let part = placeInFrame`, the same shape as Workplane-then-Extrude.
Both modes share the shape: tool rail on the left, param chip on the right,
commit writes script text back through `App.jsx`.
Sheet metal (SendCutSend): left rail **Shape** → Sheet Metal (no separate
Sheet section) → `SheetMetalPicker`. Start designing binds the SKU on the
open part (`part.sheetMetal`). A fresh part (empty, comments-only, or only `return part;`)
gets the default base flange (`sheetStarterScript` → `sheetMetalSolid`, Top
plane, SKU thickness) and enters `sheetMetalMode` still on the plane step.
A part that already has features stays put: Start does not rewrite it and
does not create `Sheet (n)`. Plane Confirm appends one sheet block
(`part = part.add(sheetMetalSolid(sheetSpec))`, chosen plane, SKU thickness)
after the existing blocks. `Sheet (n)` is created only when an assembly is open and no part is active. With no assembly, Start seeds `Assembly` / `Part (1)` from the editor buffer and then follows those same rules. Run of a non-empty script seeds that assembly before it builds.
The rail then lists
Tab / Bend / Hole / Tap under **Shape**. The chip (material, hint, Check and
Done) is the shared feature card, centered between the rails. An mm|in
toggle in the card header writes the global `surfcad.displayUnit` (stored lengths stay mm). A leftover `surfcad.sheetMetal.displayUnit` does not override it. Gauge numbers stay on the picker.
Out-of-stock gauges stay visible and disabled. Catalog/cache in `src/utils/scs/`.
The committed script is the sheet block plus `return part;`. The worker and
`runScript` unwrap a sheet wrapper (`solid` + spec or flat pattern) and still
reject any other non-Manifold. Tapping Base, a bend, or a tab on the feature strip
reopens that flow at the edit step with the saved blank, bends, and features.
Done writes the spec when it differs, then closes. The card X writes nothing.
The strip Undo is the editor step. Check shows DFM only. Part-row Order on a sheet-only part that passes those checks opens the SendCutSend handoff (DXF, STEP, redirect) instead of the quote. Quote with SurfCAD instead can still add a cart line. The Sheet Metal button stays under Shape.

### Viewport furniture
Camera and snaps `src/utils/viewCamera.js`; cutting plane
`src/utils/cuttingPlaneWidget.js`, `crossSection.js`,
`crossSectionSubstrate.js`; measurement `src/utils/measurementTool.js`, `src/utils/measurePicks.js`, `src/utils/displayUnit.js`; characteristic length `src/utils/characteristicLength.js`; slider curve and snap `src/utils/sliderMap.js`; fillet and chamfer size `src/utils/blendSize.js`; feature-card ranges `src/utils/sliderRange.js`; helper-sheet ranges `src/utils/helperSheetRange.js`; saved
wires `src/utils/savedContours.js`.

### Files and commerce
Import `src/utils/importModel.js` (+ `POST /api/convert/step`); export
`src/utils/exportModel.js`, `src/utils/model-io.js`. Quoting
`src/utils/quoting.js`; checkout resume `src/utils/checkoutStorage.js`; auth
`src/hooks/useAuth.jsx`. Backend: `backend/server.js`,
`backend/routes/{auth,cart,convert,orders,shipping,webhooks,wins}.js`,
`backend/services/{stripe,email,ups}.js`, `backend/systemPrompt.js`.

---

## 6. Conventions to keep

- **Layout in Tailwind; color and type from** [docs/ui-style-guide.md](./ui-style-guide.md).
  No CSS modules. Light-rail overlay idiom:
  `absolute … bg-white/60 backdrop-blur-sm rounded-lg shadow-lg z-10`
  (light surface — pair with `text-on-light`, never on dark chrome).
- **Inserting a solid merges with the part.** Add unions. Subtract cuts. Every build that creates a
  new solid — the six Block solids and Extrude / Revolve / Loft / Sweep — goes
  through `emitPartPlace(names, expr, partDeclared, true, op)`, which emits
  `part = part.add(expr)` when a part already exists and Mode is Add, and
  `part = part.subtract(expr)` when Mode is Subtract. `let part = expr` is
  still the first solid, including Subtract on an empty script. Default Mode
  is Add. Emitting a bare `part = <newSolid>` strands whatever was there as
  dead code; that was a real bug in all six Block solids until it was fixed.
  A Block pop previews that solid before Confirm (flat normal shading, the CAD mesh). Position and rotation are fields on the sheet; Subtract keeps the cutter translucent. Cancel clears the preview.
  Sweep's one-shot fallback stays a replace when Mode is Add. Mutating
  an existing body (holes, shell, transforms, Boolean) is different — that keeps
  `syncPartLines`, which points `part` at the body you edited. Array (grid and
  polar) is the exception: the copies keep the original instance, so it re-applies
  the body's own combine op (`reapplyBodyToPart`: `part = part.subtract(box2)` for
  a cutter, `part = part.add(box2)` otherwise). `part = box2` replaced the lid with
  its six cutters.
- **Mode-chip popup style** (placement, cyan/amber glass, mobile
  `max-h-[calc(100dvh-12rem)]` + `rail-scroll`, Confirm/X): see
  [`docs/ui-style-guide.md`](./ui-style-guide.md#popups). References: `ContourModeChip` (incl.
  Loft / Workplane), `FilletModeChip`, `ShellModeChip` (face-pick opening —
  not axis X/Y/Z), `DraftModeChip` (neutral-plane draft, not a world-axis guess),
  `CutModeChip` (plane cut — a face plane or an explicit XY/YZ/ZX, offset along
  the normal, Shell sticky picker for bodies and pieces, one `cut()`),
  `BooleanModeChip` (Union / Difference / Intersect, same sticky body picker,
  Intersect pieces, one `booleanBodies()`; picks may span parts and tools from
  another part are copied into the target). Contour Extrude / Revolve / Sweep /
  Loft and every Block solid share an Add / Subtract mode on that same feature.
  Subtract also cuts every other visible part the cutter overlaps (a yellow
  chip on each of those parts).
- **Feature popups all use `src/components/controls/popupUI.jsx`** — one type
  scale (`POPUP_TEXT`), one set of fields, accents per surface (`cyan` contour,
  `amber` fillet, `slate` helper sheets). **Every number renders a slider AND a
  typed box**: `NumberField` never gives you one without the other, so don't
  hand-roll an `<input type="range">` in a popup. The typed box and the other
  numeric readouts use `formatDisplayNumber` (`src/utils/displayUnit.js`): at
  most four decimals, trailing zeros removed. The stored value stays at full
  precision until the user types a different number. Displaying a field does
  not rewrite the script. Accent classes are spelled out
  in `ACCENTS` because Tailwind purges computed class names — extend the map,
  never interpolate.
- **Circle segments default to 64** everywhere (palette items, contour profiles,
  starter snippets). The contour slider goes to 128 so the default is not pinned
  at the top of its range.
- **Everything over the 3D view is translucent.** Surfaces, text-on-dark, and
  the no-slab rule: [docs/ui-style-guide.md](./ui-style-guide.md#surfaces-over-the-3d-view).
- **Cross-section buttons name their action**: the collapsed rail opens the
  options with the section-cut glyph (`TrianglesCenterlineDashedVertical`), and
  the expanded panel closes with a green `Check`. No chevrons — they said
  "up/down", not what would happen.
- **Bottom-centre is for mode chips and the param popup**; the bottom corners
  belong to the rails. Contour, Fillet, Chamfer, the standalone edge card, Shell,
  Draft, Move Face, Delete Face, Cut, Boolean, Move, Paint, and Analyze share the feature card (bottom center, between the rails). Analyze's footer is Run or Back to Setup. Boolean stays `z-20`, under the section rail. The right-hand cluster is
  `bottom-2.5 right-2.5` (10px off both edges), and the helper rail keeps
  `left-2 lg:left-4`.
- **Responsive insets** are written `left-2 lg:left-4` / `right-2 lg:right-4`
  (phone-tight, desktop-roomy). Match this rather than inventing values.
- **z-index ladder:** overlays `z-10`; edge chip, feature card, and success banner `z-20`;
  toasts + mobile stage pill `z-30`; **cross-section panel/popup `z-40`** (above
  the CAD↔Script home-indicator so expanded options win); modals and error
  banners `z-50`. Error cards (`ErrorPopup`) are the glass `rounded-lg` chip
  from [docs/ui-style-guide.md](./ui-style-guide.md#error-toasts), not a rounded pill. They are portaled to `document.body`
  at `z-50` so the full message sits above the feature strip and the left rail. Cross-section popup **Dismiss** is a grey lucide `X` (not the
  red FlipHorizontal); the collapsed rail still uses FlipHorizontal to
  enable/disable. Contour-mode rail dismiss is the same grey `X`. Check stays
  green Done.
- **Feature-entry toasts:** Contour / Extrude / Revolve / Loft / Sweep / Fillet /
  Chamfer / Shell open **without** an informational toast. Soft-fail / enterRefuse /
  validation / workplane-miss toasts stay.
- **Icons** are `lucide-react` only, with vendored exceptions in
  `src/components/icons/`: `SquareRoundCorner.jsx` (Fillet), `Angle.jsx`
  (Draft), `TrianglesCenterlineDashedVertical.jsx` (cross-section options),
  and `SquareText.jsx` (unused; the phone pill no longer has a Script glyph). They postdate lucide 0.469, which this
  project pins. Delete them and import from `lucide-react` once the dep moves.
  `SheetMetalPlate.jsx` is the bent-plate glyph (not a lucide icon). The Shape
  rail and every sheet-metal feature badge use it.
  Overlay buttons carry `title` *and*
  `aria-label`; toggles carry `aria-pressed`. **No two buttons in the same rail
  share a glyph** — the right rail's selectors are deliberately distinct:
  `RectangleHorizontal` = Face pick, `Layers3` = plane overlays,
  `NotebookPen` = sketch (contour) overlays, `Spline` = Edge pick,
  `Palette` = Paint. In the left
  rail, Sheet Metal is `SheetMetalPlate` (a plate with a bend line and a bent flange, Shape, after Loft, same blue as the other rail icons; feature badges use the same glyph in `text-blue-400`), Loft is `Pyramid` (a tapered stack of profiles), not `Layers`, and
  Fillet is `SquareRoundCorner` — so `Squircle` now means roundedBox alone.
  Chamfer is `TriangleRight`.
  **Two left-rail tools deliberately share a glyph with a right-rail toggle:**
  Create contour = `NotebookPen` (= sketch overlays) and Workplane = `Layers3`
  (= plane overlays). The tool that makes a thing wears the icon that shows it;
  the no-duplicates rule is per rail, so this is intended, not a slip.
- **Rail sections are Block / Build / Shape / Polish / Move**, in that order
  (`CAD_RAIL_ORDER` in `helperPaletteSnippets.js` for the order,
  `GROUP_SHORT_LABEL` in `HelperInsertPalette.jsx` for the captions). Shape is
  the old Model section, same buttons. Build is hole, cut, boolean, shell, draft, pattern
  (the Array button; Type is Grid, Polar, or Points). Points (`patternPoints`, `railHidden`:
  one instance at every point, turned along each point's axis; `patternOnPoints`) is Array
  Type=Points, not its own rail button. Script (`codeSnippet`, `railHidden`: a script snippet
  feature with its `// FEATURE-GAP: … | …` line, `src/utils/featureGaps.js`) stays
  composable for `insert_code_snippet` and the feature strip; it has no rail button.
  Boolean (`RectangleCircle`, lucide `rectangle-circle`, vendored in `icons/`) is the body boolean: Union, Difference, or
  Intersect, then leftover pieces on Intersect. It is not a second glyph of Cut.
  Polish is fillet, chamfer, move face, delete face. Move is every
  remaining button. The first button in Move is Move (`Move` glyph, directly
  above Rotate): it opens the delta X/Y/Z chip and translates one body. Rotate
  (Lucide `RotateCw`, directly below Move and above Center) opens the axis /
  angle / center chip and turns one body about an axis through a point
  (`rotateAbout`; `src/utils/rotateMode.js`, `RotateModeChip.jsx`). The
  last button in Move is Joints (Lucide `Blocks`, `data-joints-button`). It
  opens the joint create card and does not insert a helper. Move
  Face (`SquareArrowOutUpRight`) offsets the picked faces along their normals.
  Delete Face (`SquareX`) is the next Polish button: a tap only adds or removes
  a face. Confirm writes one `deleteFace()` for every picked face. A heal that
  cannot stay a closed solid throws on Confirm, not on the tap.
  The right-rail axis helper (`Move3d`) only
  shows the `AxesHelper`. It does not move a body and it does not grow
  viewport arrows.
- **Previews all share one recipe** (`src/utils/previewStyle.js`): unlit
  translucent cyan skin + brighter outline. **Never paint a preview with a lit
  material** — MeshLambert/MeshStandard take the scene lights, so faces angled
  away go dark, which is exactly the bug that made Extrude look muddy next to
  Loft. Add a preview → call `makePreviewSkinMaterial` /
  `makePreviewOutlineMaterial`.
  Sheet-metal parts are the exception: faces are light gray brushed metal
  (`#c8ccd2`, both sides), not the off-white default. Bendable edges are unlit
  screen-space lines (2.5 CSS px core, opacity 0.65, 5px halo at 0.16) on top.
- **`railHidden` items** are palette entries with no button:
  `paletteRailSections` filters them, `itemsByGroup` does not. `sweepPath`
  (Path) stays so Sweep can still compose an edge wire. `clearanceHole`,
  `tapDrillHole`, `cboreHole`, and `cskHole` stay so older scripts and goldens
  can still emit them. The Hole button opens the Hole card (`data-hole-card`):
  type, fastener size, fit, raw diameter, through or a depth, side, near end,
  and far end. No U/V and no n×m. Next opens the contour plane card
  (`data-plane-editor`) and the XY, YZ, and ZX quads, plus Offset along the
  normal (the same field as Workplane, shown with `formatDisplayNumber`). Select plane stores that
  frame, aims the camera, and leaves the rail on Cursor, Rectangle, Polyline,
  Arc, Dimension, and Constraints. Rectangle puts a hole at each corner and
  keeps that tool's dimensions and constraints. Circle and Polygon stay off
  this rail. Sketch lines are dashed and keep the status colour. Accept writes the centres contour (`role=centers`) and the Hole
  block in one undo and parks the bar on the new hole chip. No centres writes
  nothing. X and Esc write nothing. An old hole block still opens the helper
  sheet. This button does not convert it.
  Tapping a contour hole chip (`data-feature-id="hole1"`) opens the same card
  with that spec. Confirm (`data-feature-card-confirm`) rewrites the spec and
  leaves the contour. Edit centres (`data-hole-edit-centres`) reopens the
  dashed sketch on the baked plane. The plane card stays closed. The offset
  stays on the frame. Back opens the plane card on that same value, and
  Confirm keeps or updates it. Confirm
  (`data-contour-confirm`) rewrites the one `solveContour` call, including a
  sketch with no centres, and leaves every hole block. Each confirm is one
  undo and does not move the bar. Delete (`data-feature-edit-delete`) removes
  that hole block only. The centres chip stays. An old `hole()` block still
  opens the helper sheet.
  On a sheet, Hole, Csk, and Tap tap a panel, then Next (`data-sm-next`) opens
  that same dashed sketch on the panel. The plane card stays closed. Accept
  writes one `sheetSpec.holes` row per centre (`panel`, `u`, `v`, and the
  type fields that list already has). No centres writes nothing. The contour
  is not stored. A bar that drops a flange still drops the holes on that
  flange. Tapping an existing hole still edits that one hole, including U and V.
  `polarArray` and `patternPoints` stay the same way: one Array button whose Type
  param is Grid, Polar, or Points, and the `array3D` build delegates to
  `polarArray`'s for Polar and `patternPoints`'s for Points.
  `holePattern` stays so an old script still runs. The Hole button does not emit it.
  The kernel helper `holesOnContour` cuts one hole at every centre of a shared
  contour (each sketch point, including an arc centre), through or to a depth,
  on `side` 1 or -1. `composeHoleOnContour` writes that call in a Hole block
  (`id=hole1`) and, the first time, the centres statement (`role=centers`).
  A second Hole block names the same contour. Deleting the contour chip asks
  **Delete along with N features** and removes those Hole blocks with it.
  Deleting one Hole chip leaves the contour.
  Hide a tool this way rather than deleting an item other code builds with.
- **The right rail is content-height**, not paired: view-snap then zoom-to-fit (`Maximize2`) at the top, then Normal to sketch (`CornerDownRight`, `data-normal-to-sketch`, contour mode only), then Face, Edge, plane overlays, contour overlays, and Paint, then a divider, then Analyze (`Gauge`), the XYZ triad (`Move3d` / `AxesHelper`), measure, and cross-section. There is no patch-colour toggle. The green Lucide `Frame` (`#` / auto-fit-on-run) was removed — it duplicated zoom-to-fit. A shared 26rem cap used to crop Cross-section off the bottom,
  where — being bottom-anchored 10px above the viewport edge — it was out of
  reach. It keeps `overflow-visible` plus a `max-h` that respects the pane.
- **Plane and sketch overlays default off.** `Layers3` (planes) and `NotebookPen` (sketches) start unpressed. A contour tool turns on the ones it picks — plane and sketch for circle, rectangle, polygon, polyline, extrude, revolve, loft, and sweep; plane only for workplane — until Confirm, X, Esc, or another tool. The buttons show on for that span. A tap during the tool is kept. The choice is session-only. The Plane tool (`Insert Workplane`, entry `workplane`) also draws the XY, YZ, and ZX reference planes with the existing user planes for that span. A selected face hides the three reference planes until the face is deselected (World X, Y, or Z, or another plane); user planes stay, and the rail is unchanged. Closing the tool without a tap puts the rail back, so the reference planes return to the visibility they had before the tool opened.
  A face tap or an X, Y, or Z pick (`title` `World X plane` and the Y and Z twins, inside `data-plane-editor`) draws a translucent preview mesh of the new plane at the confirmed quad size, and offset plus the angle fields move it. Add plane writes that frame and closes the card. There is no helper line and no left Plane rail. X closes without writing. `golden:plane-tool` checks the open, the face-selected hide, the deselect show, and the preview at 390×844 and 1280×800. `golden:workplane-add` checks Add plane at those sizes.
- **The view-snap flyout must never `flex-wrap`.** It is absolutely positioned
  with only `right` set inside a ~36px-wide parent, so its shrink-to-fit width
  is near zero; wrapping collapses the row into a vertical stack. `w-max` +
  `flex-nowrap` keep it the horizontal row it is meant to be.
- **Rail height and rail scrolling are separate classes** (`utils/railPair.js`).
  Left rails share `RAIL_PAIR_HEIGHT_CLASS` as a **max-height** (content-sized,
  capped just below the part name); only the LEFT rails add `RAIL_SCROLL_CLASS`.
  When buttons fit without scroll, `useLeftRailFit` switches to
  `RAIL_PAIR_WIDTH_FIT_CLASS` (`w-14`). The right rail takes
  `RAIL_NO_CLIP_CLASS` (`overflow-visible`) because the view-snap flyout is
  positioned **outside** the rail box (`absolute right-full`) — any `overflow`
  on that rail deletes the flyout from the screen and adds a scrollbar it does
  not need. Merging the two classes caused exactly that regression once.
- **Scrolling rails** carry `rail-scroll` alongside `overflow-y-auto`
  (`src/index.css`, bottom). Desktop Chrome's default gutter is square and cuts
  the corners off the rail's `rounded-lg` shell; `rail-scroll` gives a thin
  pill thumb over a transparent track, plus the Firefox equivalents. Add it to
  any new rail that scrolls.
- **Rail size is shared.** `HelperInsertPalette`, `ContourModeRail` and
  `CrossSectionPanel` all use 20px icons, `p-2` buttons and a `p-2` shell, in
  both shells. Left rails also share `RAIL_PAIR_WIDTH_CLASS` (`w-16`) so the
  Contour caption cannot widen ContourModeRail past the helper rail. If you
  change one, change all three (`golden:ui-polish` fails otherwise) and
  re-check the bottom-left chip insets that clear the left rail.
- **Test hooks** — golden smoke tests select by data attributes:
  `data-toolbar-variant`, `data-cad-toolbar-host`, `data-palette-layout`,
  `data-palette-section`, `data-selector-group`, `data-edge-selector`,
  `data-fillet-scrap`. Do not rename them without updating `scripts/golden/`.
- Chrome changes must be checked on **both shells and both modes**. Relevant
  goldens: `npm run golden:cad-mobile-chrome`, `golden:cad-palette`,
  `golden:polish-adv-ux`.
