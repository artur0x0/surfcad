/**
 * Recompute a budgetary molding quote from the catalog.
 * The caller does not send a price. Real partner names stay in the database.
 * Nothing here writes Quote or a molding quote collection.
 */

import { rankMoldingQuotes } from '../../src/molding/partQuote.js';

function plain(row) {
  if (row && typeof row.toObject === 'function') {
    return row.toObject({ depopulate: true, virtuals: false, getters: false });
  }
  return row;
}

export async function quoteMolding(models, input = {}) {
  const [partners, machines, resins, rates] = await Promise.all([
    models.MoldingPartner.find({ active: true }),
    models.MoldingMachine.find({ active: true }),
    models.MoldingResinPrice.find({ active: true }),
    models.MoldingToolingRate.find({ active: true }),
  ]);
  return rankMoldingQuotes({
    partners: partners.map(plain),
    machines: machines.map(plain),
    resins: resins.map(plain),
    rates: rates.map(plain),
    part: input.part,
    quantity: input.quantity,
    cavityCount: input.cavityCount,
    grade: input.grade,
    includeHotRunner: input.includeHotRunner,
  });
}
