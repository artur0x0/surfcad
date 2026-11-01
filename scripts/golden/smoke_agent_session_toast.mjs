#!/usr/bin/env node
/* global window */
/**
 * Agent connected / Agent disconnected toasts at 390px.
 *
 * Every single-line card matches the Deleted toast: same height, text
 * inset, and X inset. A multi-line error keeps its second line, and its
 * first row uses the Deleted pill, pill-to-X gap, X size, right inset,
 * and top inset. The 44px hit hangs off .toast-glass so the blur does
 * not clip it.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/local/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('agent session toast golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const html = `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderAgentSessionToastShot } from '/scripts/golden/agent_session_toast_shot.jsx';
renderAgentSessionToastShot(document.getElementById('root'));
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
});

function nearly(a, b, tol = 1.25) {
  return Math.abs(a - b) <= tol;
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const popup = window.document.querySelector('[data-toast-sample="roomy"] [data-error-popup]');
    return popup && parseFloat(popup.style.minHeight) > 0;
  }, null, { timeout: 5000 });

  const metrics = await page.evaluate(() => {
    const box = (node) => {
      const rect = node?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
    };
    const hitOf = (button) => {
      const cs = button ? window.getComputedStyle(button, '::before') : null;
      return {
        w: parseFloat(cs?.width) || 0,
        h: parseFloat(cs?.height) || 0,
        left: cs?.left || '',
      };
    };
    const agent = (selector) => {
      const root = window.document.querySelector(selector);
      const popup = root?.querySelector('[data-error-popup]');
      const text = popup?.querySelector('[data-error-popup-text]');
      const action = popup?.querySelector('[data-error-actions] button[data-ui-action]');
      const dismiss = popup?.querySelector('[data-error-dismiss]');
      const glass = popup?.querySelector('[data-toast-glass]');
      const pb = box(popup);
      const tb = box(text);
      const ab = box(action);
      const db = box(dismiss);
      const cs = popup ? window.getComputedStyle(popup) : null;
      const borderTop = parseFloat(cs?.borderTopWidth) || 0;
      const borderRight = parseFloat(cs?.borderRightWidth) || 0;
      const borderBottom = parseFloat(cs?.borderBottomWidth) || 0;
      const borderLeft = parseFloat(cs?.borderLeftWidth) || 0;
      const padLeft = parseFloat(cs?.paddingLeft) || 0;
      const inset = (rect) => rect && pb ? {
        top: rect.y - (pb.y + borderTop),
        bottom: (pb.y + pb.h - borderBottom) - (rect.y + rect.h),
        right: (pb.x + pb.w - borderRight) - (rect.x + rect.w),
      } : null;
      const glassCs = glass ? window.getComputedStyle(glass) : null;
      const popupFilter = popup ? window.getComputedStyle(popup).backdropFilter || window.getComputedStyle(popup).webkitBackdropFilter : '';
      return {
        copy: (text?.textContent || '').trim(),
        popupH: pb?.h || 0,
        textLeft: tb && pb ? tb.x - (pb.x + borderLeft) : -1,
        padLeft,
        textMid: tb ? tb.y + tb.h / 2 : 0,
        popMid: pb ? pb.y + pb.h / 2 : 0,
        lines: text?.getClientRects().length || 0,
        actionH: ab?.h || 0,
        dismissH: db?.h || 0,
        dismissW: db?.w || 0,
        actionInset: inset(ab),
        dismissInset: inset(db),
        gap: ab && db ? db.x - (ab.x + ab.w) : -1,
        actionHit: hitOf(action),
        dismissHit: hitOf(dismiss),
        glassHoldsButtons: !!(glass && (glass.contains(action) || glass.contains(dismiss))),
        glassBlur: glassCs ? (glassCs.backdropFilter || glassCs.webkitBackdropFilter || '') : '',
        popupBlur: popupFilter || '',
        points: ab && db ? {
          actionAbove: { x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 - 20 },
          actionCenter: { x: ab.x + Math.min(24, ab.w / 2), y: ab.y + ab.h / 2 },
          dismissRight: { x: db.x + db.w - 4, y: db.y + db.h / 2 },
          dismissLeftOf: { x: db.x - 2, y: db.y + db.h / 2 },
        } : null,
      };
    };
    const sample = (name) => {
      const root = window.document.querySelector(`[data-toast-sample="${name}"]`);
      const popup = root?.querySelector('[data-error-popup]');
      const cs = popup ? window.getComputedStyle(popup) : null;
      const row = popup?.querySelector('[data-error-popup-row]');
      const text = popup?.querySelector('[data-error-popup-text]') || popup?.querySelector('.font-bold');
      const body = popup?.querySelector('[data-error-popup-body]');
      const undo = root?.querySelector('[data-error-undo]');
      const dismiss = root?.querySelector('[data-error-dismiss]');
      const actions = popup?.querySelector('[data-error-actions]');
      const ub = box(undo);
      const db = box(dismiss);
      const pb = box(popup);
      const rb = box(row);
      const tb = box(text);
      const bb = box(body);
      const borderTop = parseFloat(cs?.borderTopWidth) || 0;
      const borderRight = parseFloat(cs?.borderRightWidth) || 0;
      const borderV = borderTop + (parseFloat(cs?.borderBottomWidth) || 0);
      const padV = (parseFloat(cs?.paddingTop) || 0) + (parseFloat(cs?.paddingBottom) || 0);
      const base = (rb?.h || 0) + borderV + padV;
      const borderLeft = parseFloat(cs?.borderLeftWidth) || 0;
      return {
        padTop: parseFloat(cs?.paddingTop) || 0,
        padLeft: parseFloat(cs?.paddingLeft) || 0,
        popupH: pb?.h || 0,
        textLeft: tb && pb ? tb.x - (pb.x + borderLeft) : -1,
        textMid: tb ? tb.y + tb.h / 2 : 0,
        popMid: pb ? pb.y + pb.h / 2 : 0,
        lines: text?.getClientRects().length || 0,
        layout: popup?.getAttribute('data-error-layout') || '',
        roomy: popup?.getAttribute('data-error-roomy') != null,
        ratio: base > 0 ? (pb?.h || 0) / base : 0,
        undoW: ub?.w || 0,
        undoH: ub?.h || 0,
        undoTop: ub && pb ? ub.y - pb.y : -1,
        dismissW: db?.w || 0,
        dismissH: db?.h || 0,
        dismissTop: db && pb ? db.y - pb.y : -1,
        xRight: db && pb ? (pb.x + pb.w - borderRight) - (db.x + db.w) : -1,
        pillToX: ub && db ? db.x - (ub.x + ub.w) : -1,
        gap: parseFloat(actions ? window.getComputedStyle(actions).columnGap : '') || 0,
        bodyBelow: !!(bb && rb && bb.y >= rb.y + rb.h - 1),
        desc: (popup?.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    };
    const owns = (button, point) => {
      if (!button || !point) return false;
      const el = window.document.elementFromPoint(point.x, point.y);
      return el === button || (!!el && button.contains(el));
    };
    const connected = agent('[data-agent-bridge-connected-toast]');
    const disconnected = agent('[data-agent-bridge-disconnected-toast]');
    return {
      connected,
      disconnected,
      hits: {
        connectedAbove: owns(window.document.querySelector('[data-agent-bridge-connected-toast] [data-ui-action]'), connected.points?.actionAbove),
        connectedCenter: owns(window.document.querySelector('[data-agent-bridge-connected-toast] [data-ui-action]'), connected.points?.actionCenter),
        connectedRight: owns(window.document.querySelector('[data-agent-bridge-connected-toast] [data-error-dismiss]'), connected.points?.dismissRight),
        connectedNotDismiss: !owns(window.document.querySelector('[data-agent-bridge-connected-toast] [data-error-dismiss]'), connected.points?.dismissLeftOf),
        disconnectedAbove: owns(window.document.querySelector('[data-agent-bridge-disconnected-toast] [data-ui-action]'), disconnected.points?.actionAbove),
        disconnectedRight: owns(window.document.querySelector('[data-agent-bridge-disconnected-toast] [data-error-dismiss]'), disconnected.points?.dismissRight),
      },
      notice: sample('notice'),
      soft: sample('soft'),
      roomy: sample('roomy'),
      stacked: sample('stacked'),
      tokens: {
        height: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-height')) || 0,
        inset: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-inset-x')) || 0,
        textGap: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-text-gap')) || 0,
        pillH: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-pill-height')) || 0,
        pillPad: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-pill-pad-x')) || 0,
        actionGap: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-action-gap')) || 0,
        xSize: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-x-size')) || 0,
        xBox: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-x-box')) || 0,
        hit: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-hit')) || 0,
      },
    };
  });

  const deleted = metrics.roomy;
  console.log(`  card height connected=${metrics.connected.popupH} disconnected=${metrics.disconnected.popupH} deleted=${deleted.popupH}`);
  for (const [label, card] of [['connected', metrics.connected], ['disconnected', metrics.disconnected]]) {
    check(`${label}: copy`,
      card.copy === (label === 'connected' ? 'Agent connected' : 'Agent disconnected'),
      card.copy);
    check(`${label}: one line, inset from the left, vertically centred`,
      card.lines === 1
        && nearly(card.textLeft, deleted.textLeft)
        && nearly(card.textMid, card.popMid),
      JSON.stringify({ textLeft: card.textLeft, deletedTextLeft: deleted.textLeft, textMid: card.textMid, popMid: card.popMid, lines: card.lines }));
    check(`${label}: same height and X inset as Deleted`,
      nearly(card.popupH, deleted.popupH)
        && card.dismissInset
        && nearly(card.dismissInset.right, deleted.xRight)
        && nearly(card.dismissW, deleted.dismissW)
        && nearly(card.dismissH, deleted.dismissH)
        && nearly(card.dismissInset.top, deleted.dismissTop - 1),
      JSON.stringify({
        h: card.popupH,
        deletedH: deleted.popupH,
        xRight: card.dismissInset?.right,
        deletedXRight: deleted.xRight,
        dismiss: [card.dismissW, card.dismissH, card.dismissInset?.top],
        deletedDismiss: [deleted.dismissW, deleted.dismissH, deleted.dismissTop],
      }));
    check(`${label}: pill matches Deleted height and the pill-to-X gap`,
      nearly(card.actionH, deleted.undoH) && nearly(card.gap, deleted.pillToX),
      JSON.stringify({ actionH: card.actionH, deletedPillH: deleted.undoH, gap: card.gap, deletedGap: deleted.pillToX }));
    check(`${label}: hit target is 44px and grows outward`,
      card.actionHit.h === 44 && card.actionHit.w >= 44
        && card.dismissHit.h === 44 && card.dismissHit.w === 44
        && card.dismissHit.left === '0px'
        && !card.glassHoldsButtons
        && card.popupBlur === 'none'
        && card.glassBlur !== '' && card.glassBlur !== 'none',
      JSON.stringify({ actionHit: card.actionHit, dismissHit: card.dismissHit, glassBlur: card.glassBlur, popupBlur: card.popupBlur, holds: card.glassHoldsButtons }));
  }
  check('390: hit above Disconnect reaches the button', metrics.hits.connectedAbove, JSON.stringify(metrics.connected.points));
  check('390: Disconnect label still hits Disconnect', metrics.hits.connectedCenter);
  check('390: the right side of the 44px X reaches X', metrics.hits.connectedRight && metrics.hits.disconnectedRight);
  check('390: X hit does not cover the gap beside Disconnect', metrics.hits.connectedNotDismiss);
  check('390: hit above Reconnect reaches the button', metrics.hits.disconnectedAbove);

  const above = metrics.connected.points.actionAbove;
  await page.mouse.click(above.x, above.y);
  const right = metrics.disconnected.points.dismissRight;
  await page.mouse.click(right.x, right.y);
  const clicks = await page.evaluate(() => window.__CLICKS__ || []);
  check('390: the expanded hit fires Disconnect and the disconnected X',
    clicks.includes('disconnect') && clicks.includes('disconnected-dismiss'),
    JSON.stringify(clicks));

  const likeDeleted = (card, { pill = true } = {}) => nearly(card.popupH, deleted.popupH)
    && nearly(card.textLeft, deleted.textLeft)
    && nearly(card.xRight, deleted.xRight)
    && nearly(card.dismissW, deleted.dismissW)
    && nearly(card.dismissH, deleted.dismissH)
    && nearly(card.dismissTop, deleted.dismissTop)
    && (!pill || (
      nearly(card.undoH, deleted.undoH)
      && nearly(card.undoW, deleted.undoW)
      && nearly(card.pillToX, deleted.pillToX)
      && nearly(card.undoTop, deleted.undoTop)
    ));
  check('Deleted toast is the 40px reference',
    deleted.roomy
      && deleted.popupH === 40
      && deleted.textLeft === 12
      && deleted.xRight === 12
      && deleted.undoH === 16
      && deleted.dismissW === 44
      && deleted.dismissH === 18
      && deleted.dismissTop === 11
      && deleted.pillToX === 16
      && Math.abs(deleted.ratio - 2) < 0.05,
    JSON.stringify(deleted));
  check('Saved Branch matches Deleted height, text inset, and X',
    likeDeleted(metrics.notice, { pill: false }) && metrics.notice.lines === 1,
    JSON.stringify(metrics.notice));
  check('Pick at least one edge matches Deleted, including the Undo pill',
    likeDeleted(metrics.soft) && metrics.soft.lines === 1,
    JSON.stringify(metrics.soft));
  check('stacked error keeps its body, and the first row matches Deleted',
    metrics.stacked.layout === 'stacked'
      && metrics.stacked.desc.includes('Error')
      && metrics.stacked.desc.includes('The script failed')
      && metrics.stacked.bodyBelow
      && metrics.stacked.popupH > deleted.popupH
      && nearly(metrics.stacked.undoH, deleted.undoH)
      && nearly(metrics.stacked.undoW, deleted.undoW)
      && nearly(metrics.stacked.pillToX, deleted.pillToX)
      && nearly(metrics.stacked.dismissW, deleted.dismissW)
      && nearly(metrics.stacked.dismissH, deleted.dismissH)
      && nearly(metrics.stacked.xRight, deleted.xRight)
      && nearly(metrics.stacked.dismissTop, deleted.dismissTop)
      && nearly(metrics.stacked.undoTop, deleted.undoTop),
    JSON.stringify(metrics.stacked));
  check('toast tokens',
    metrics.tokens.height === 40
      && metrics.tokens.inset === 12
      && metrics.tokens.textGap === 8
      && metrics.tokens.pillH === 16
      && metrics.tokens.pillPad === 12
      && metrics.tokens.actionGap === 16
      && metrics.tokens.xSize === 18
      && metrics.tokens.xBox === 44
      && metrics.tokens.hit === 44,
    JSON.stringify(metrics.tokens));

  const shot = join(shotDir, 'agent-session-toast-390.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`  shot ${shot}`);
  check('390: no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nagent session toast golden: ok');
process.exit(0);
