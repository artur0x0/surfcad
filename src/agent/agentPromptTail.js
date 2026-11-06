/**
 * Phone agent-chat tail. One obtuse triangle on the bottom edge, aimed at
 * the stage pill's Bot button. The path walks out to the tip and back, so
 * the outline does not draw a seam across the base.
 */

export const AGENT_PROMPT_TAIL_HEIGHT = 10;
export const AGENT_PROMPT_TAIL_BASE = 32;
export const AGENT_PROMPT_TAIL_GAP = 6;
export const AGENT_PROMPT_TAIL_RADIUS = 16;
/** Shorter than this and the triangle stops reading as a tail. The box stays. */
export const AGENT_PROMPT_TAIL_MIN = 4;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Tip angle in degrees. Greater than 90 means the triangle is obtuse.
 * @param {number} base
 * @param {number} height
 */
export function agentPromptTailTipAngle(base, height) {
  if (!(height > 0) || !(base > 0)) return 180;
  return (2 * Math.atan((base / 2) / height) * 180) / Math.PI;
}

/**
 * @param {{
 *   prompt: { left: number, top: number, bottom: number, width: number, height: number, visualWidth?: number, visualHeight?: number },
 *   button: { left: number, top: number, width: number, height?: number },
 *   radius?: number,
 *   tailHeight?: number,
 *   tailBase?: number,
 *   gap?: number,
 * }} args
 * `width` / `height` are the prompt's local box (offsetWidth / offsetHeight).
 * `left` / `top` / `bottom` and `visualWidth` are viewport pixels from
 * getBoundingClientRect, so a transform still lines the tip up with the button.
 * When the tail cannot be placed (no button, a gap under 4px, a narrow box),
 * the result is the rounded box with `hasTail: false` and `tailH: 0`. The
 * glass fill stays. Null is only a prompt with no positive size.
 */
export function agentPromptTailLayout({
  prompt,
  button,
  radius = AGENT_PROMPT_TAIL_RADIUS,
  tailHeight = AGENT_PROMPT_TAIL_HEIGHT,
  tailBase = AGENT_PROMPT_TAIL_BASE,
  gap = AGENT_PROMPT_TAIL_GAP,
} = {}) {
  if (!prompt) return null;
  const width = prompt.width;
  const height = prompt.height;
  const visualWidth = prompt.visualWidth > 0 ? prompt.visualWidth : width;
  const visualHeight = prompt.visualHeight > 0 ? prompt.visualHeight : height;
  if (!(width > 0) || !(height > 0) || !(visualWidth > 0) || !(visualHeight > 0)) {
    return null;
  }

  const box = {
    hasTail: false,
    tipX: round2(width / 2),
    tipY: round2(height),
    tailH: 0,
    baseLeft: round2(width / 2),
    baseRight: round2(width / 2),
    width: round2(width),
    height: round2(height),
    totalHeight: round2(height),
    radius,
    gap: null,
    tipViewportX: prompt.left + visualWidth / 2,
    tipViewportY: prompt.bottom,
    buttonCx: null,
  };

  if (!button || !(button.width > 0)) return box;

  const room = button.top - prompt.bottom;
  const tailVisual = Math.min(tailHeight, room - gap);
  const tailH = round2(tailVisual * (height / visualHeight));
  if (!(tailH >= AGENT_PROMPT_TAIL_MIN)) return box;

  const buttonCx = button.left + button.width / 2;
  let tipX = ((buttonCx - prompt.left) / visualWidth) * width;
  const minCenter = radius + 2 + tailBase / 2;
  const maxCenter = width - radius - 2 - tailBase / 2;
  if (!(maxCenter > minCenter)) return box;
  tipX = Math.min(maxCenter, Math.max(minCenter, tipX));
  tipX = round2(tipX);

  const baseLeft = round2(tipX - tailBase / 2);
  const baseRight = round2(tipX + tailBase / 2);
  const tipY = round2(height + tailH);
  const tipViewportX = prompt.left + (tipX / width) * visualWidth;
  const tipViewportY = prompt.bottom + tailH * (visualHeight / height);

  return {
    hasTail: true,
    tipX,
    tipY,
    tailH,
    baseLeft,
    baseRight,
    width: round2(width),
    height: round2(height),
    totalHeight: tipY,
    radius,
    gap: button.top - tipViewportY,
    tipViewportX,
    tipViewportY,
    buttonCx,
  };
}

/**
 * Rounded box with the tail cut into the bottom edge. One subpath: the
 * bottom stroke leaves the edge, touches the tip, and returns. It does not
 * close the base. `hasTail: false` (or a tip that sits on the bottom edge)
 * is the rounded box alone.
 * @param {{ width: number, height: number, tipX: number, tipY: number, baseLeft: number, baseRight: number, radius: number, hasTail?: boolean }} box
 */
export function agentPromptBubblePath(box) {
  const w = box.width;
  const h = box.height;
  const r = Math.min(box.radius, w / 2, h / 2);
  const n = (v) => round2(v);
  const tail = box.hasTail === true || (box.hasTail !== false && box.tipY > h);
  const bottom = tail
    ? [`H ${n(box.baseRight)}`, `L ${n(box.tipX)} ${n(box.tipY)}`, `L ${n(box.baseLeft)} ${n(h)}`, `H ${n(r)}`]
    : [`H ${n(r)}`];
  return [
    `M ${n(r)} 0`,
    `H ${n(w - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)}`,
    `V ${n(h - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)}`,
    ...bottom,
    `A ${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)}`,
    `V ${n(r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(r)} 0`,
    'Z',
  ].join(' ');
}
