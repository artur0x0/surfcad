/** Feature strip chip classes (shared by the strip and its goldens). */

/**
 * Chip colours. A feature that holds a frozen copy of another part's
 * geometry (externalBody) gets a yellow border, active or not. A feature
 * the last run failed in gets a red border (the error popup's red-400),
 * active or not; it wins over yellow.
 */
/**
 * Plain-CSS twin of `border-2 border-red-400` (src/index.css). The Tailwind
 * pair is kept; this class repeats it with explicit width, style and colour
 * so the red holds on WebKit even when a later `border` / `border-*`
 * utility or an iOS button style would win the cascade.
 */
export const FAILED_RING_CLASS = 'feature-failed-ring';

export function chipTone(active, external = false, failed = false, dimmed = false) {
  const showFailed = failed && !dimmed;
  let tone;
  if (showFailed) {
    tone = active
      ? `bg-cyan-600 text-white border-2 border-red-400 ${FAILED_RING_CLASS} shadow`
      : `bg-gray-800/70 text-gray-200 border-2 border-red-400 ${FAILED_RING_CLASS} hover:text-white`;
  } else if (active) {
    tone = external
      ? 'bg-cyan-600 text-white border-2 border-yellow-400 shadow'
      : 'bg-cyan-600 text-white border-cyan-400/70 shadow';
  } else {
    tone = external
      ? 'bg-gray-800/70 text-gray-200 border-2 border-yellow-400 hover:text-white'
      : 'bg-gray-800/70 text-gray-200 border-gray-500/40 hover:text-white';
  }
  // Past the bar: grey, not a faded copy of the live colour. opacity-40
  // stays so a rolled-back chip still reads as dimmed.
  return dimmed
    ? 'bg-gray-800/80 text-chrome-secondary border-gray-500/70 opacity-40 grayscale'
    : tone;
}

/**
 * Feature sheet identity icon border: red when the feature failed (wins over
 * the external yellow), yellow for an external copy, else cyan.
 */
export function sheetIdentityTone(external = false, failed = false) {
  if (failed) return `border-2 border-red-400 ${FAILED_RING_CLASS}`;
  return external ? 'border-2 border-yellow-400' : 'border border-cyan-500/40';
}

/** Feature sheet picker row: same red as the strip when that feature failed. */
export function sheetPickTone(editable = true, failed = false) {
  const base = editable ? 'bg-cyan-950/60 text-white' : 'bg-chrome-surface/60 text-gray-300';
  if (failed) return `${base} border-2 border-red-400 ${FAILED_RING_CLASS}`;
  return `${base} ${editable ? 'border border-cyan-600/50' : 'border border-gray-600/50'}`;
}
