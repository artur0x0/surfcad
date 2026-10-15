import * as bracket from './bracket-holes-fillet.mjs';
import * as shell from './enclosure-shell.mjs';
import * as sheet from './sheet-metal-flange.mjs';
import * as assembly from './multi-part-assembly.mjs';
import * as sketchH7 from './sketch-dim-constrain-extrude.mjs';
import * as plateHoles from './plate-holes-offset.mjs';
import * as partsJoints from './parts-joints-assembly.mjs';

/** Scripted end-to-end scenarios (bridge-only). */
export const scenarios = [bracket, shell, sheet, assembly, sketchH7, plateHoles, partsJoints];

export function getScenario(id) {
  return scenarios.find((row) => row.id === id) || null;
}
