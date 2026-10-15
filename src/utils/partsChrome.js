/**
 * Shared Parts / git text-field chrome.
 * font-size ≥16px so iOS Safari never auto-zooms on focus.
 */
export const PARTS_TEXT_INPUT_CLASS =
  'w-full rounded-md border border-gray-600 bg-black/30 px-2 py-1.5 text-base text-chrome-text outline-none focus:border-blue-500';
export const PARTS_TEXT_INPUT_STYLE = { fontSize: '16px' };

/**
 * Vault dialog actions. Ghost, bordered secondary, and blue primary are the
 * same three looks as every other picker button.
 */
export const PARTS_DIALOG_BTN_GHOST =
  'rounded-md text-xs text-gray-200 hover:bg-white/10';
export const PARTS_DIALOG_BTN_SECONDARY =
  'rounded-md border border-gray-600 text-xs text-chrome-text hover:bg-white/10';
export const PARTS_DIALOG_BTN_PRIMARY =
  'rounded-md bg-blue-600 text-xs font-medium text-white hover:bg-blue-500';

/**
 * Phone-width action. Tighter than the default px-3 py-1.5, still a 40px
 * target, and the label stays on one line. It may shrink and ellipsize so
 * the three Open-assembly actions fit inside a 375px card on wider Linux
 * fonts, with a few pixels of slack before the label clips.
 */
export const PARTS_DIALOG_BTN_COMPACT =
  'inline-flex h-10 min-w-0 shrink items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap px-1.5';
