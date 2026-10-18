#!/usr/bin/env node
/**
 * Quote-then-add: Order opens the quote. Add to cart posts /api/quotes,
 * then writes the line and flies. A 404 does not write. Checkout stepper stays.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addPartLine, emptyCart, scriptHash } from '../../src/utils/cart.js';
import { QuoteRequestError, requestPartQuote } from '../../src/utils/quoteApi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('quote-then-add — order opens a quote');
{
  const hook = read('src/hooks/useCart.jsx');
  const quote = read('src/components/QuoteModal.jsx');
  const sheet = read('src/components/CartSheet.jsx');
  const app = read('src/App.jsx');
  const api = read('src/utils/quoteApi.js');
  const cart = read('src/utils/cart.js');
  const sync = read('src/utils/cartSync.js');
  const ui = read('docs/ui-map.md');
  const orderStart = hook.indexOf('const orderPart = useCallback');
  const orderEnd = hook.indexOf('const closePartQuote');
  const orderBody = hook.slice(orderStart, orderEnd);
  const commitStart = hook.indexOf('const commitQuotedLine');
  const commitEnd = hook.indexOf('const changeQty');
  const commitBody = hook.slice(commitStart, commitEnd);
  const addStart = quote.indexOf('const handleAddToCart');
  const addEnd = quote.indexOf('return (', addStart);
  const addBody = quote.slice(addStart, addEnd);

  ok('signed-out order opens login and does not write a line',
    /onNeedLoginRef/.test(orderBody)
    && /setPartQuote\(/.test(orderBody)
    && !/addPartLine/.test(orderBody)
    && !/measureFlight/.test(orderBody));
  ok('the line is written only after a quote, and then the thumbnail flies',
    /addPartLine/.test(commitBody)
    && /measureFlight/.test(commitBody)
    && commitBody.indexOf('addPartLine') < commitBody.indexOf('measureFlight'));
  ok('add to cart posts /api/quotes before writing the line',
    /await requestPartQuote/.test(addBody)
    && /await onAddToCart/.test(addBody)
    && addBody.indexOf('await requestPartQuote') < addBody.indexOf('await onAddToCart')
    && /Add to cart/.test(quote)
    && /data-quote-add/.test(quote)
    && /data-quote-mode/.test(quote));
  ok('checkout still says Order and keeps the stepper',
    /: 'Order'/.test(quote)
    && /handleCheckoutNext/.test(app)
    && /checkoutStep=\{checkoutStep\}/.test(app)
    && /mode="add"/.test(app));
  ok('a 404 is an error and returns no quote',
    /status === 404/.test(api)
    && /Nothing was added to the cart/.test(api)
    && /\/api\/quotes/.test(api)
    && /quotedUnitPrice/.test(api)
    && /modelFile/.test(api));
  ok('samePart requires the script hash and the locked options',
    /scriptHash/.test(cart.slice(cart.indexOf('function samePart'), cart.indexOf('function pruneCartTombstones')))
    && /optionIdentity/.test(cart.slice(cart.indexOf('function samePart'), cart.indexOf('function pruneCartTombstones'))));
  ok('the sheet shows the unit price and a stale badge',
    /data-cart-unit-price/.test(sheet)
    && /data-cart-stale/.test(sheet)
    && /cartLineIsStale/.test(sheet));
  ok('the sync payload carries the quote fields',
    /export function cartSyncPayload/.test(sync)
    && /quotedUnitPrice: line\.quotedUnitPrice/.test(sync)
    && /quoteId: line\.quoteId/.test(sync)
    && /quotedAt: line\.quotedAt/.test(sync)
    && /cartSyncPayload\(local/.test(sync));
  ok('the UI map describes add to cart and the stale badge',
    /data-quote-add/.test(ui) && /data-cart-stale/.test(ui) && /\/api\/quotes/.test(ui));
}

console.log('\nquote-then-add — 404 does not become a line');
{
  let wrote = false;
  try {
    await requestPartQuote({
      scriptHash: 'hash-1',
      process: 'FDM',
      material: 'PLA',
      infill: 20,
      modelFile: { data: 'abc', filename: 'part.3mf' },
      fetchImpl: async () => ({ status: 404, ok: false, json: async () => ({}) }),
    });
    wrote = true;
  } catch (err) {
    ok('404 throws', err instanceof QuoteRequestError && err.status === 404);
  }
  ok('404 did not return a quote', wrote === false);
  const accepted = await requestPartQuote({
    scriptHash: scriptHash('return 1;'),
    process: 'FDM',
    material: 'PLA',
    infill: 20,
    modelFile: { data: 'abc', filename: 'part.3mf' },
    fetchImpl: async () => ({
      status: 201,
      ok: true,
      json: async () => ({
        success: true,
        quoteId: 'quote-1',
        quotedAt: '2026-10-09T12:00:00.000Z',
        quotedUnitPrice: 6.5,
        scriptHash: scriptHash('return 1;'),
        process: 'FDM',
        material: 'PLA',
        infill: 20,
      }),
    }),
  });
  const added = addPartLine(emptyCart(), {
    lineId: '00000000-0000-4000-8000-0000000000aa',
    source: 'local',
    assemblyName: 'Box',
    partId: 'part-1',
    surfId: null,
    partName: 'Bracket',
    scriptHash: accepted.scriptHash,
    thumbDataUrl: null,
    qty: 1,
    options: { process: accepted.process, material: accepted.material, infill: accepted.infill },
    quotedUnitPrice: accepted.quotedUnitPrice,
    quoteId: accepted.quoteId,
    quotedAt: accepted.quotedAt,
    addedAt: '2026-10-09T12:00:00.000Z',
    updatedAt: '2026-10-09T12:00:00.000Z',
  });
  ok('a stored quote keeps the server price and the script hash',
    added.ok
    && added.cart.lines[0].quoteId === 'quote-1'
    && added.cart.lines[0].quotedUnitPrice === 6.5
    && added.cart.lines[0].scriptHash === scriptHash('return 1;'));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
