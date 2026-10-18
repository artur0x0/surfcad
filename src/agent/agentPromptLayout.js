/**
 * Placement and overlap math for the floating agent prompt.
 * Matches the approved mockup CSS (TOKENS.md / overlap-report.json).
 */

export const AGENT_PROMPT_DESKTOP_BOTTOM_PX = 48;
export const AGENT_PROMPT_MOBILE_BOTTOM_PX = 56;
export const AGENT_PROMPT_DESKTOP_MAX_W = 640;
export const AGENT_PROMPT_DESKTOP_RAIL_GUTTER = 192; // 2 × 96px
export const AGENT_PROMPT_MOBILE_MAX_W = 16 * 16; // 16rem at 16px
export const AGENT_PROMPT_MOBILE_RAIL_GUTTER = 9.5 * 16; // 9.5rem at 16px
export const AGENT_PROMPT_IDLE_H = 50;
export const AGENT_PROMPT_INPUT_MIN = 36;
export const AGENT_PROMPT_INPUT_MAX = 144;
export const AGENT_PROMPT_REPLY_DESKTOP_MAX = 360;
export const AGENT_PROMPT_REPLY_MOBILE_MAX = 320;

export function agentPromptWidth(viewportWidth, { compact = false } = {}) {
  const w = Number(viewportWidth) || 0;
  if (compact) return Math.min(AGENT_PROMPT_MOBILE_MAX_W, w - AGENT_PROMPT_MOBILE_RAIL_GUTTER);
  return Math.min(AGENT_PROMPT_DESKTOP_MAX_W, w - AGENT_PROMPT_DESKTOP_RAIL_GUTTER);
}

/**
 * @param {{
 *   viewport: { x: number, y: number, w: number, h: number },
 *   compact?: boolean,
 *   height?: number,
 *   vh?: number,
 * }} args
 */
export function agentPromptBox({
  viewport,
  compact = false,
  height = AGENT_PROMPT_IDLE_H,
  vh = viewport?.h,
} = {}) {
  const width = agentPromptWidth(viewport.w, { compact });
  const bottomInset = compact ? AGENT_PROMPT_MOBILE_BOTTOM_PX : AGENT_PROMPT_DESKTOP_BOTTOM_PX;
  const inputCap = Math.min(AGENT_PROMPT_INPUT_MAX, (vh || viewport.h) * 0.4);
  const replyCap = compact
    ? Math.min(AGENT_PROMPT_REPLY_MOBILE_MAX, (vh || viewport.h) * 0.4)
    : Math.min(AGENT_PROMPT_REPLY_DESKTOP_MAX, (vh || viewport.h) * 0.4);
  const h = Math.min(height, inputCap + replyCap + 80);
  const left = viewport.x + (viewport.w - width) / 2;
  const bottom = viewport.y + viewport.h - bottomInset;
  const top = bottom - h;
  return {
    x: left,
    y: top,
    r: left + width,
    b: bottom,
    w: width,
    h,
    inputCap,
    replyCap,
  };
}

export function boxesOverlap(a, b, eps = 0.5) {
  if (!a || !b) return false;
  return !(a.r <= b.x + eps || a.x >= b.r - eps || a.b <= b.y + eps || a.y >= b.b - eps);
}

/**
 * Chrome boxes from the approved mock measurements (page coords).
 * Desktop 1440×900 viewer; iPhone 390×844.
 */
export const OVERLAP_FIXTURES = Object.freeze({
  desktop: {
    viewport: { x: 288, y: 0, w: 1152, h: 900 },
    strip: [{ x: 288, y: 56, r: 1440, b: 102 }],
    railL: [{ x: 304, y: 112, r: 368, b: 852 }],
    railR: [{ x: 1378, y: 112, r: 1430, b: 852 }],
    pill: [],
  },
  iphone: {
    viewport: { x: 0, y: 0, w: 390, h: 844 },
    strip: [{ x: 0, y: 80, r: 390, b: 126 }],
    railL: [{ x: 8, y: 418, r: 72, b: 788 }],
    railR: [{ x: 328, y: 364, r: 380, b: 788 }],
    pill: [{ x: 139, y: 806, r: 251, b: 844 }],
  },
});

export function agentPromptHits(box, chrome) {
  const hit = [];
  const check = (name, list) => {
    for (const el of list || []) {
      if (boxesOverlap(box, el)) hit.push(name);
    }
  };
  check('strip', chrome.strip);
  check('railL', chrome.railL);
  check('railR', chrome.railR);
  check('pill', chrome.pill);
  return hit;
}

/** Live DOM overlap — used by playtest / unit tests in a real viewport. */
export function measureAgentPromptOverlap(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelector !== 'function') {
    return { ok: false, reason: 'no-document', hit: [] };
  }
  const prompt = root.querySelector('[data-agent-prompt]');
  if (!prompt) return { ok: true, hidden: true, hit: [] };
  const box = rectBox(prompt.getBoundingClientRect());
  const chrome = {
    strip: rects(root, '[data-desktop-feature-strip], [data-cad-feature-strip]'),
    railL: rects(root, '[data-rail-pair="left"]'),
    railR: rects(root, '[data-rail-pair="right"]'),
    pill: rects(root, '[data-home-indicator-pill]'),
  };
  const hit = agentPromptHits(box, chrome);
  return { ok: hit.length === 0, hit, box, chrome };
}

function rectBox(r) {
  return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
}

function rects(root, selector) {
  return Array.from(root.querySelectorAll(selector)).map((el) => rectBox(el.getBoundingClientRect()));
}
