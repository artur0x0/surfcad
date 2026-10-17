/**
 * Script the CAD feature ribbon parses for chips.
 *
 * Joints mode (`showJoints`) uses an empty buffer so the strip shows joint
 * chips instead of features. A highlighted part that is not the editor part
 * reads its stored script. The editor part prefers the live buffer and falls
 * back to the stored script — reload, vault open, and agent create_part can
 * leave `currentScript` empty for a frame even though the part file is marked.
 */

export function featureRibbonScript({
  cadPartId = null,
  activeId = null,
  currentScript = '',
  partScripts = {},
  sketchOpen = false,
  showJoints = false,
} = {}) {
  if (sketchOpen || showJoints) return '';
  const highlight = cadPartId || activeId || null;
  if (!highlight) return typeof currentScript === 'string' ? currentScript : '';
  if (activeId && highlight !== activeId) {
    const stored = partScripts?.[highlight];
    return typeof stored === 'string' ? stored : '';
  }
  if (typeof currentScript === 'string' && currentScript) return currentScript;
  const stored = partScripts?.[highlight];
  return typeof stored === 'string' ? stored : (typeof currentScript === 'string' ? currentScript : '');
}
