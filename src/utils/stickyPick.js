/**
 * Sticky pick, shared by contours and (later) joints.
 *
 * Tap an object to keep it. Tap it again to drop it. A tap past `max`
 * drops the oldest pick and keeps the newest. The list is 1 or 2 for a
 * joint or a dimension. An arc corner passes 3, because the corner can
 * span three segments. The component that paints the list is
 * `StickyPickApply`. A card that owns the list uses `useStickyPick`.
 * Contour mode keeps the list on the mode state, because the canvas and
 * the card both write it. The rule is this function either way.
 */

export function stickyPickKey(pick) {
  return `${pick?.kind || ''}:${pick?.id || ''}`;
}

export function stickyPickToggle(picks, item, max = 2) {
  const list = Array.isArray(picks) ? picks.slice() : [];
  const cap = Math.max(1, max | 0);
  if (!item?.id || !item?.kind) return list;
  const key = stickyPickKey(item);
  const index = list.findIndex((pick) => stickyPickKey(pick) === key);
  if (index >= 0) {
    list.splice(index, 1);
    return list;
  }
  const next = {
    id: String(item.id),
    kind: String(item.kind),
    label: item.label ? String(item.label) : String(item.id),
  };
  // The dimension figure anchors on this UV. Joints do not set it.
  if (Array.isArray(item.at) && item.at.length >= 2) {
    const u = Number(item.at[0]);
    const v = Number(item.at[1]);
    if (Number.isFinite(u) && Number.isFinite(v)) next.at = [u, v];
  }
  if (item.geomKind) next.geomKind = String(item.geomKind);
  list.push(next);
  if (list.length > cap) list.splice(0, list.length - cap);
  return list;
}

export function stickyPickRemove(picks, item) {
  const key = stickyPickKey(item);
  return (Array.isArray(picks) ? picks : []).filter((pick) => stickyPickKey(pick) !== key);
}
