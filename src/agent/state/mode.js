/**
 * Summarize viewport / app mode for the agent harness.
 *
 * @param {{
 *   appMode?: string,
 *   viewportMode?: string,
 *   contour?: object | null,
 *   fillet?: object | null,
 *   featureEdit?: object | null,
 *   sheetMetal?: object | null,
 *   holeCard?: boolean,
 *   measure?: boolean,
 *   paint?: boolean,
 *   fea?: boolean,
 *   jointPicking?: boolean,
 * }} input
 */
export function buildAgentMode(input = {}) {
  const appMode = input.appMode === 'game' ? 'game' : 'cad';
  let viewport = input.viewportMode || 'idle';
  if (!input.viewportMode) {
    if (input.contour) viewport = 'contour';
    else if (input.fillet?.entry === 'chamferEdges') viewport = 'chamfer';
    else if (input.fillet) viewport = 'fillet';
    else if (input.shell) viewport = 'shell';
    else if (input.draft) viewport = 'draft';
    else if (input.cut) viewport = 'cut';
    else if (input.boolean) viewport = 'boolean';
    else if (input.move) viewport = 'move';
    else if (input.moveFace) viewport = 'moveFace';
    else if (input.deleteFace) viewport = 'deleteFace';
    else if (input.paint) viewport = 'paint';
    else if (input.measure) viewport = 'measure';
    else if (input.fea) viewport = 'fea';
    else if (input.sheetMetal || input.sheetMetalPicker) viewport = 'sheetMetal';
    else if (input.holeCard) viewport = 'hole';
    else if (input.jointPicking) viewport = 'joints';
    else if (input.featureEdit) viewport = 'featureEdit';
  }

  const contour = input.contour
    ? {
      entry: input.contour.entry || null,
      gesture: input.contour.gesture || null,
      planeTool: input.contour.planeTool === true,
      planeOpen: input.contour.planeOpen === true,
      tool: input.contour.tool || null,
      // The saved contour this sketch edits (open_feature on a contour chip
      // or the strip chip), null for a new sketch.
      contourId: input.contour.contourId || null,
      contourName: input.contour.contourName || null,
    }
    : null;

  const fillet = input.fillet
    ? {
      entry: input.fillet.entry || 'filletEdges',
      edgeCount: Number.isFinite(input.fillet.edgeCount) ? input.fillet.edgeCount : undefined,
    }
    : null;

  const featureEdit = input.featureEdit
    ? {
      mode: input.featureEdit.mode || null,
      featureId: input.featureEdit.feature?.id || input.featureEdit.featureId || null,
      kind: input.featureEdit.feature?.kind || input.featureEdit.kind || null,
      dialog: input.featureEdit.dialog || null,
    }
    : null;

  const sheetMetal = (input.sheetMetal || input.sheetMetalPicker)
    ? {
      stage: input.sheetMetal?.stage || (input.sheetMetalPicker ? 'picker' : 'edit'),
      picker: !!input.sheetMetalPicker,
    }
    : null;

  const featureSlot = input.featureSlots?.kind
    ? { kind: input.featureSlots.kind }
    : null;

  return {
    app: appMode,
    viewport,
    contour,
    fillet,
    featureEdit,
    sheetMetal,
    featureSlot,
  };
}
