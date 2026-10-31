/** Close the molding flyout, then open or toggle that tool's pane. */
export function pressMoldTool(setOpen, toggle) {
  setOpen(false);
  if (typeof toggle === 'function') toggle();
}
