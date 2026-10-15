import * as bracket from './bracket-holes-fillet.mjs';
import * as shell from './enclosure-shell.mjs';
import * as sheet from './sheet-metal-flange.mjs';
import * as assembly from './multi-part-assembly.mjs';

/** Scripted end-to-end scenarios (bridge-only). */
export const scenarios = [bracket, shell, sheet, assembly];

export function getScenario(id) {
  return scenarios.find((row) => row.id === id) || null;
}
