/**
 * Right-rail tool toggle. Idle is blue; on is a green icon on a light green
 * wash. Cross section (`data-cross-section-toggle`) is the reference.
 *
 * The colours are the utilities that button already used, named here so a
 * new toggle does not invent a fill. See `.tool-toggle` in `src/index.css`
 * and docs/ui-style-guide.md. No new colour token.
 */
export const TOOL_TOGGLE = 'tool-toggle';
export const TOOL_TOGGLE_ON = 'tool-toggle-on';

export function toolToggleClass(on) {
  return on ? `${TOOL_TOGGLE} ${TOOL_TOGGLE_ON}` : TOOL_TOGGLE;
}
