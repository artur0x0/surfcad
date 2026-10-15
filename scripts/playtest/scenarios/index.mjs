import * as bracket from './bracket-holes-fillet.mjs';
import * as shell from './enclosure-shell.mjs';
import * as sheet from './sheet-metal-flange.mjs';
import * as assembly from './multi-part-assembly.mjs';
import * as sketchH7 from './sketch-dim-constrain-extrude.mjs';

/** Scripted end-to-end scenarios (bridge-only). */
export const scenarios = [bracket, shell, sheet, assembly, sketchH7];

export function getScenario(id) {
  return scenarios.find((row) => row.id === id) || null;
}
