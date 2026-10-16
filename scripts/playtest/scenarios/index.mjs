import * as bracket from './bracket-holes-fillet.mjs';
import * as shell from './enclosure-shell.mjs';
import * as sheet from './sheet-metal-flange.mjs';
import * as sheetBracket from './sheet-metal-bracket.mjs';
import * as assembly from './multi-part-assembly.mjs';
import * as sketchH7 from './sketch-dim-constrain-extrude.mjs';
import * as plateHoles from './plate-holes-offset.mjs';
import * as partsJoints from './parts-joints-assembly.mjs';
import * as gitVault from './git-vault-flow.mjs';

/** Scripted end-to-end scenarios (bridge-only). */
export const scenarios = [bracket, shell, sheet, sheetBracket, assembly, sketchH7, plateHoles, partsJoints, gitVault];

export function getScenario(id) {
  return scenarios.find((row) => row.id === id) || null;
}
