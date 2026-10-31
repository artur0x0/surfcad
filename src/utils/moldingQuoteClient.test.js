import assert from 'node:assert/strict';
import test from 'node:test';
import { postMoldingQuote, quoteBodyFromAnalysis } from './moldingQuoteClient.js';

function boxGeometry() {
  const positions = [
    0, 0, 0, 20, 0, 0, 20, 10, 0, 0, 10, 0,
    0, 0, 5, 20, 0, 5, 20, 10, 5, 0, 10, 5,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  return {
    attributes: { position: { array: positions } },
    index: { array: indices },
  };
}

const ANALYSIS = {
  kind: 'mold-analysis',
  pull: [0, 0, 1],
  wall: { max: 2 },
  parting: { lines: [{ length: 60 }] },
  sideActions: { slideCount: 1, lifterCount: 0 },
  moldDraft: { ejectors: { pinCount: 2, sleeveCount: 0 } },
};

test('the quote body measures the mesh and does not send a price', () => {
  const body = quoteBodyFromAnalysis(boxGeometry(), ANALYSIS, { quantity: 1000, cavityCount: 1, grade: 'ABS' });
  assert.equal(body.error, undefined);
  assert.equal(body.part.volumeCm3, 1);
  assert.deepEqual(body.part.footprint, { lengthMm: 20, widthMm: 10, heightMm: 5 });
  assert.equal(body.part.maxWallMm, 2);
  assert.equal(body.part.partingLengthMm, 60);
  assert.equal(body.part.slideCount, 1);
  assert.equal(body.part.pinCount, 2);
  assert.equal(body.part.flowLengthMm, null);
  assert.equal(body.grade, 'ABS');
  assert.equal(JSON.stringify(body).includes('usd'), false);
});

test('a missing wall is the same bad_args the quote API returns', () => {
  const body = quoteBodyFromAnalysis(boxGeometry(), { ...ANALYSIS, wall: { max: null } });
  assert.equal(body.error.code, 'bad_args');
  assert.match(body.error.message, /maxWallMm/);
});

test('postMoldingQuote posts JSON and surfaces a rate limit', async () => {
  const seen = [];
  const ok = await postMoldingQuote({ quantity: 1 }, async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ disclaimer: 'Budgetary, not binding.', vendors: [] }) };
  });
  assert.equal(seen[0].url, '/api/molding/quote');
  assert.equal(seen[0].body.quantity, 1);
  assert.equal(ok.disclaimer, 'Budgetary, not binding.');
  const limited = await postMoldingQuote({}, async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'Too many molding quotes. Try again in a few minutes.' }),
  }));
  assert.equal(limited.error.code, 'rate_limited');
});
