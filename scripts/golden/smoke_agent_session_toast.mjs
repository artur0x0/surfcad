#!/usr/bin/env node
/* global window */
/**
 * Agent connected / Agent disconnected toasts at 390px.
 *
 * The #832 card grew to the 44px Disconnect / Reconnect button (46px with
 * the border). The shared card is one text line plus --toast-pad, about
 * half that. The message is inset and vertically centred. The buttons sit
 * the same distance from the top, right, and bottom edges. Their hit
 * target stays 44px and hangs off .toast-glass so the blur does not clip it.
 *
 * Notice, soft-fail, roomy delete, and stacked execution cards keep the
 * padding their callers pass.
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
          dismissRight: { x: db.x + db.w + 10, y: db.y + db.h / 2 },
          dismissLeftOf: { x: db.x - 2, y: db.y + db.h / 2 },
        } : null,
      };
    };
    const sample = (name) => {
      const root = window.document.querySelector(`[data-toast-sample="${name}"]`);
      const popup = root?.querySelector('[data-error-popup]');
      const cs = popup ? window.getComputedStyle(popup) : null;
      const row = popup?.querySelector('[data-error-popup-row]');
      const undo = root?.querySelector('[data-error-undo]');
      const dismiss = root?.querySelector('[data-error-dismiss]');
      const actions = popup?.querySelector('[data-error-actions]');
      const ub = box(undo);
      const db = box(dismiss);
      const pb = box(popup);
      const rb = box(row);
      const borderV = (parseFloat(cs?.borderTopWidth) || 0) + (parseFloat(cs?.borderBottomWidth) || 0);
      const padV = (parseFloat(cs?.paddingTop) || 0) + (parseFloat(cs?.paddingBottom) || 0);
      const base = (rb?.h || 0) + borderV + padV;
      return {
        padTop: parseFloat(cs?.paddingTop) || 0,
        padLeft: parseFloat(cs?.paddingLeft) || 0,
        popupH: pb?.h || 0,
        layout: popup?.getAttribute('data-error-layout') || '',
        roomy: popup?.getAttribute('data-error-roomy') != null,
        ratio: base > 0 ? (pb?.h || 0) / base : 0,
        undoW: ub?.w || 0,
        dismissW: db?.w || 0,
        undoPadTop: undo ? parseFloat(window.getComputedStyle(undo).paddingTop) || 0 : 0,
        gap: parseFloat(actions ? window.getComputedStyle(actions).columnGap : '') || 0,
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
      padToken: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-pad')) || 0,
      hitToken: parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--toast-hit')) || 0,
    };
  });

  // 44px button + 1px border on each side. Half of that is 23px.
  const previousH = 46;
  console.log(`  card height connected=${metrics.connected.popupH} disconnected=${metrics.disconnected.popupH} (previous ${previousH})`);
  for (const [label, card] of [['connected', metrics.connected], ['disconnected', metrics.disconnected]]) {
    check(`${label}: copy`,
      card.copy === (label === 'connected' ? 'Agent connected' : 'Agent disconnected'),
      card.copy);
    check(`${label}: about half the previous card`,
      card.popupH > previousH * 0.4 && card.popupH < previousH * 0.65,
      `h=${card.popupH} previous=${previousH}`);
    check(`${label}: one line, inset from the left, vertically centred`,
      card.lines === 1
        && card.textLeft > 2
        && nearly(card.textLeft, card.padLeft)
        && nearly(card.textMid, card.popMid),
      JSON.stringify({ textLeft: card.textLeft, padLeft: card.padLeft, textMid: card.textMid, popMid: card.popMid, lines: card.lines }));
    const inset = card.dismissInset;
    const actionInset = card.actionInset;
    check(`${label}: buttons have even padding to the toast edges`,
      !!inset && !!actionInset
        && nearly(inset.top, card.padLeft)
        && nearly(inset.bottom, inset.top)
        && nearly(inset.right, inset.top)
        && nearly(actionInset.top, inset.top)
        && nearly(actionInset.bottom, inset.top)
        && nearly(card.gap, inset.top),
      JSON.stringify({ inset, actionInset, gap: card.gap, pad: card.padLeft }));
    check(`${label}: visual buttons are shorter than 44px`,
      card.actionH > 0 && card.actionH < 44 && card.dismissH < 44 && card.dismissW < 44,
      JSON.stringify({ actionH: card.actionH, dismissH: card.dismissH, dismissW: card.dismissW }));
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
  check('390: hit to the right of X reaches X', metrics.hits.connectedRight && metrics.hits.disconnectedRight);
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

  check('notice toast keeps px-4 py-2',
    metrics.notice.padLeft === 16 && metrics.notice.padTop === 8
      && metrics.notice.popupH > metrics.connected.popupH,
    JSON.stringify(metrics.notice));
  check('soft-fail toast keeps px-3 py-2 and its Undo padding',
    metrics.soft.padLeft === 12 && metrics.soft.padTop === 8
      && metrics.soft.undoPadTop > 0
      && metrics.soft.popupH > metrics.connected.popupH,
    JSON.stringify(metrics.soft));
  check('roomy delete toast stays 2× with 44px controls',
    metrics.roomy.roomy
      && Math.abs(metrics.roomy.ratio - 2) < 0.05
      && metrics.roomy.undoW >= 44
      && metrics.roomy.dismissW >= 44
      && Math.abs(metrics.roomy.gap - 16) < 0.5,
    JSON.stringify(metrics.roomy));
  check('stacked execution toast keeps p-3 and two lines',
    metrics.stacked.layout === 'stacked'
      && metrics.stacked.padTop === 12
      && metrics.stacked.padLeft === 12
      && metrics.stacked.desc.includes('Error')
      && metrics.stacked.desc.includes('The script failed')
      && metrics.stacked.popupH > metrics.connected.popupH,
    JSON.stringify(metrics.stacked));
  check('toast tokens', metrics.padToken === 4 && metrics.hitToken === 44,
    JSON.stringify({ pad: metrics.padToken, hit: metrics.hitToken }));

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
