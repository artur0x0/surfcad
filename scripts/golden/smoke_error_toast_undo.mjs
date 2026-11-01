#!/usr/bin/env node
/**
 * Error toasts carry an Undo button, and the fillet scrap message says what
 * to do about it.
 *
 * Before: the scrap notice read "Fillet left zero-area faces. Undo restores
 * the solid." — it *told* the user to undo and then left them to go find the
 * button. Now it reads "Unable to generate clean fillet, please try a different
 * size." and the toast itself carries the Undo. A larger radius is sometimes
 * the one that comes out clean.
 *
 * Toast payloads are `{ text, undo }`. `undo` defaults ON because almost every
 * toast in the viewport is a refusal; purely informational hints opt out with
 * `{ undo: false }`. Shared ErrorPopup renders Undo when onUndo is passed and
 * canUndo is true, so it never offers a no-op.
 *
 * Static source assertions — these are render-path/JSX concerns that the mesh
 * goldens cannot reach.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const VP = join(here, '..', '..', 'src', 'components', 'Viewport.jsx');
const POPUP = join(here, '..', '..', 'src', 'components', 'ErrorPopup.jsx');
const src = readFileSync(VP, 'utf8');
const popup = readFileSync(POPUP, 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('error toasts — Undo button + fillet scrap copy');

// ---- the copy ----
check(
  'fillet scrap notice uses the new wording',
  src.includes('Unable to generate clean fillet, please try a different size.'),
  'new string not found',
);
check(
  'fillet scrap notice does not demand a smaller size',
  !src.includes('try smaller size') && !src.includes('try a smaller size'),
);
check(
  'old zero-area wording is gone',
  !src.includes('Fillet left zero-area faces'),
  'old string still present',
);

// ---- the payload shape ----
check('toastPayload helper exists', src.includes('const toastPayload = (msg, opts)'));
check(
  'undo defaults ON (errors are the common case)',
  src.includes('undo: opts?.undo !== false'),
  'default is not opt-out',
);

// ---- shared ErrorPopup Undo ----
check('ErrorPopup exposes data-error-undo', popup.includes('data-error-undo=""'));
check(
  'ErrorPopup Undo is gated on canUndo so it is never a no-op',
  popup.includes('disabled={!canUndo}'),
  'canUndo gate missing',
);
check(
  'ErrorPopup Undo calls onUndo',
  popup.includes('onUndo?.()'),
  'onUndo not wired',
);
check(
  'stacked execution layout keeps Undo and dismiss on the first line',
  /data-error-layout="stacked"/.test(popup)
    && /toast-first-row/.test(popup)
    && /justify-between/.test(popup)
    && !/gap-5/.test(popup),
  'stacked header missing',
);

const execStart = src.indexOf('{executionError && createPortal(');
const execBlock = execStart >= 0 ? src.slice(execStart, execStart + 700) : '';
check(
  'execution error is one wide card, not a shrink-wrapped title',
  /inset-x-3/.test(execBlock)
    && /layout="stacked"/.test(execBlock)
    && /title="Error"/.test(execBlock)
    && !/max-w-/.test(execBlock)
    && !src.includes('Execution Error'),
  'execution toast still sizes to the message or still says Execution Error',
);

// ---- every toast renders text + conditional Undo via ErrorPopup ----
for (const t of ['edgeModeToast', 'contourToast', 'filletToast', 'shellToast']) {
  check(
    `${t} renders text via ErrorPopup`,
    src.includes(`{${t}.text}`),
    'not wired',
  );
  check(
    `${t} passes onUndo only when undo flag is set`,
    src.includes(`onUndo={${t}.undo ? onUndo : undefined}`),
    'undo opt-out not wired',
  );
  check(
    `${t} no longer renders a bare string child`,
    !new RegExp(`>\\s*\\{${t}\\}\\s*<`).test(src),
    'still rendered as a raw string — would print [object Object]',
  );
}
check(
  'fillet scrap notice always offers Undo',
  /data-fillet-scrap="1"[\s\S]*?onUndo=\{onUndo\}/.test(src),
  'scrap notice has no Undo',
);
check(
  'Viewport soft-fail sites use ErrorPopup',
  (src.match(/<ErrorPopup\b/g) || []).length >= 6,
  'expected ≥6 ErrorPopup sites',
);

// ---- informational toasts opt out ----
check(
  'the edge-pick hint opts out of Undo',
  src.includes("Edge pick on — tap near an edge (tangent loops on)', { undo: false }"),
  'informational hint would offer a confusing Undo',
);
check(
  'the point-drag hint opts out of Undo',
  /Right-drag this point to move it[^)]*\{ undo: false \}/.test(src),
  'informational hint would offer a confusing Undo',
);

// ---- no setter left passing a raw string ----
const rawSetters = [...src.matchAll(/set(?:EdgeMode|Contour|Fillet|Shell)Toast\(([^)]*)\)/g)]
  .map((m) => m[1].trim())
  .filter((a) => a !== 'null' && !a.startsWith('toastPayload'));
check(
  'every toast setter goes through toastPayload (or clears with null)',
  rawSetters.length === 0,
  rawSetters.join(' | '),
);

if (failed) {
  console.error(`\n${failed} error-toast check(s) failed.`);
  process.exit(1);
}
console.log('\nAll error-toast Undo checks passed.');
