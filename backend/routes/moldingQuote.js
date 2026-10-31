/**
 * POST /api/molding/quote. Recomputes a budgetary quote from the catalog.
 * No session required. Nothing is stored. Real partner names stay in the database.
 * A client price is not a field this route accepts.
 */

import { Router } from 'express';
import MoldingPartner from '../db/models/MoldingPartner.js';
import MoldingMachine from '../db/models/MoldingMachine.js';
import MoldingResinPrice from '../db/models/MoldingResinPrice.js';
import MoldingToolingRate from '../db/models/MoldingToolingRate.js';
import { quoteMolding } from '../services/moldingQuote.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';
import { TOOLING_CONSTANTS } from '../../src/molding/toolingEstimate.js';

const QUOTE_RATE = 'Too many molding quotes. Try again in a few minutes.';
const TOP_KEYS = new Set(['part', 'quantity', 'cavityCount', 'grade']);
const PART_KEYS = new Set([
  'footprint',
  'volumeCm3',
  'maxWallMm',
  'partingLengthMm',
  'slideCount',
  'lifterCount',
  'pinCount',
  'sleeveCount',
  'flowLengthMm',
]);
const FOOT_KEYS = new Set(['lengthMm', 'widthMm', 'heightMm']);

function bad(message) {
  return { error: { code: 'bad_args', message } };
}

function extraKey(value, allowed) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).find((key) => !allowed.has(key)) || null;
}

export function readQuoteRequest(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('quote body must be an object');
  }
  const extra = extraKey(body, TOP_KEYS);
  if (extra) return bad(`unknown field ${extra}`);
  if (body.part == null || typeof body.part !== 'object' || Array.isArray(body.part)) {
    return bad('part must be an object');
  }
  const extraPart = extraKey(body.part, PART_KEYS);
  if (extraPart) return bad(`unknown field ${extraPart}`);
  const foot = body.part.footprint;
  if (foot != null) {
    if (typeof foot !== 'object' || Array.isArray(foot)) return bad('footprint must be an object');
    const extraFoot = extraKey(foot, FOOT_KEYS);
    if (extraFoot) return bad(`unknown field ${extraFoot}`);
  }
  if (body.grade != null && typeof body.grade !== 'string') return bad('grade must be a string');
  if (typeof body.grade === 'string' && body.grade.length > 120) return bad('grade is too long');
  if (body.cavityCount != null) {
    const cavity = Number(body.cavityCount);
    if (!Number.isInteger(cavity) || cavity < 1 || cavity > TOOLING_CONSTANTS.maxCavities) {
      return bad(`cavityCount must be an integer from 1 to ${TOOLING_CONSTANTS.maxCavities}`);
    }
  }
  return {
    part: body.part,
    quantity: body.quantity,
    cavityCount: body.cavityCount,
    ...(typeof body.grade === 'string' && body.grade ? { grade: body.grade } : {}),
  };
}

/**
 * @param {{
 *   limiter?: ReturnType<typeof createRateLimiter>,
 *   models?: object,
 *   quoteMolding?: typeof quoteMolding,
 * }} [deps]
 */
export function createMoldingQuoteRouter(deps = {}) {
  const limiter = deps.limiter || createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });
  const models = deps.models || {
    MoldingPartner,
    MoldingMachine,
    MoldingResinPrice,
    MoldingToolingRate,
  };
  const quote = deps.quoteMolding || quoteMolding;
  const router = Router();
  router.post(
    '/quote',
    rateLimitMiddleware(limiter, userKey, QUOTE_RATE),
    async (req, res) => {
      const input = readQuoteRequest(req.body);
      if (input.error) return res.status(400).json(input);
      const result = await quote(models, input);
      if (result?.error) return res.status(400).json(result);
      return res.json(result);
    },
  );
  return router;
}

export default createMoldingQuoteRouter();
