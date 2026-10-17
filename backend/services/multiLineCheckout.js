/**
 * Price a multi-line checkout. Does not write Mongo or Stripe.
 * Each line is re-measured. Client money is not an input to the charge.
 * A missing, expired, or hash-mismatched quote is re-quoted from the fresh
 * 3MF on the request. A stale line with no fresh file is skipped. A mesh
 * that is present but unreadable fails the whole order.
 */
import crypto from 'crypto';
import { clampQuantity, quoteFromGeometry } from '../../src/utils/quoteMath.js';
import { measureExportedPart } from './measurePart.js';
import { priceMultiLineOrder } from './orderPrice.js';
import { isQuoteExpired } from './cartMerge.js';
import { lineProcessOk, validateOrderLineCount } from './orderLines.js';
import { packOrderBoxes } from './packOrder.js';
import { ratePackedBoxes } from './combinedShipping.js';

export async function checkoutLines({
  lines,
  shipping,
  userId,
  loadQuote = async () => null,
  measure = measureExportedPart,
  rateFn,
  now = Date.now(),
  clientShipping,
}) {
  const count = validateOrderLineCount(lines);
  if (!count.ok) return fail(400, count.error);

  if (!shipping?.address || !shipping?.method) {
    return fail(400, 'Shipping info is required');
  }

  const state = shipping.address.state || shipping.address['state'];
  const country = shipping.address.country || shipping.address['country'] || 'US';
  const skipped = [];
  const priced = [];
  const quotesToSave = [];

  for (const line of lines) {
    const qty = clampQuantity(line?.quantity, { missing: 1 });
    if (!qty) return fail(400, 'Quantity must be an integer from 1 to 999');
    if (!line?.process || !line?.material) {
      return fail(400, 'Each line needs a process and a material');
    }
    if (!lineProcessOk(line.process)) {
      return fail(400, `Unknown process ${line.process}`);
    }
    const infill = normalizeInfill(line.infill);
    if (infill == null) return fail(400, 'Infill must be between 10 and 100');

    const resolved = await resolveLineFile({
      line,
      userId,
      loadQuote,
      now,
    });
    if (!resolved.ok) return fail(resolved.status || 400, resolved.error);
    if (resolved.skipped) {
      skipped.push({ lineId: line.lineId || null, reason: resolved.reason });
      continue;
    }

    const measured = await measure({ modelFile: resolved.modelFile });
    if (!measured?.ok) {
      return fail(measured?.status || 400, measured?.error || 'We couldn\'t measure this part. Please re-export and try again');
    }

    let extended;
    let unit;
    try {
      unit = quoteFromGeometry({
        volume: measured.geometry.volume,
        boundingBox: measured.geometry.boundingBox,
        process: line.process,
        material: line.material,
        infill,
        quantity: 1,
      });
      extended = quoteFromGeometry({
        volume: measured.geometry.volume,
        boundingBox: measured.geometry.boundingBox,
        process: line.process,
        material: line.material,
        infill,
        quantity: qty,
      });
    } catch (err) {
      return fail(400, err.message);
    }

    let quoteId = resolved.quoteId;
    let quotedAt = resolved.quotedAt;
    let scriptHash = line.scriptHash || resolved.scriptHash || '';
    if (resolved.requoted) {
      const created = new Date(now);
      quoteId = crypto.randomUUID();
      quotedAt = created;
      const draft = quoteDraft({
        userId,
        quoteId,
        scriptHash,
        process: line.process,
        material: line.material,
        infill,
        geometry: measured.geometry,
        unit,
        modelFile: resolved.modelFile,
        created,
      });
      quotesToSave.push(draft);
    }

    priced.push({
      line,
      quantity: qty,
      infill,
      geometry: measured.geometry,
      unit,
      extended,
      modelFile: normalizeStoredFile(resolved.modelFile),
      quoteId,
      quotedAt,
      scriptHash,
      requoted: resolved.requoted,
    });
  }

  if (priced.length < 1) {
    return fail(400, 'No lines could be priced. Open the assembly and try again.');
  }

  const boxes = packOrderBoxes(priced.map((row) => ({
    boundingBox: row.geometry.boundingBox,
    quantity: row.quantity,
    grams: row.extended.materialGrams,
  })));
  const rates = await ratePackedBoxes(shipping.address, boxes, rateFn);
  const selected = rates.find((rate) => rate.code === shipping.method);
  if (!selected || !Number.isFinite(selected.price)) {
    return fail(400, 'Could not price the selected shipping method');
  }

  const money = priceMultiLineOrder({
    lineQuotes: priced.map((row) => row.extended),
    shippingCost: selected.price,
    state,
    country,
    clientLines: priced.map((row) => row.line),
    clientShipping: clientShipping ?? clientShipFrom(shipping),
  });
  if (!money.ok) return fail(400, money.error);

  const orderLines = priced.map((row) => ({
    lineId: String(row.line.lineId || ''),
    partName: row.line.partName || 'Part',
    assemblyName: row.line.assemblyName || '',
    partId: row.line.partId || '',
    source: row.line.source || '',
    surfId: row.line.surfId || '',
    scriptHash: row.scriptHash,
    quoteId: row.quoteId,
    process: row.line.process,
    material: row.line.material,
    infill: row.infill,
    quantity: row.quantity,
    'volume-mm3': row.unit.volume,
    'bounding-box': {
      'width-mm': row.geometry.boundingBox.width,
      'height-mm': row.geometry.boundingBox.height,
      'depth-mm': row.geometry.boundingBox.depth,
    },
    'unit-subtotal': row.unit.unitSubtotal,
    'material-cost': row.unit.unitMaterial,
    'machine-cost': row.unit.unitMachine,
    'model-file': row.modelFile,
    requoted: row.requoted,
    quotedAt: row.quotedAt,
  }));

  return {
    ok: true,
    priceUpdated: money.priceUpdated,
    priced: money,
    orderLines,
    skipped,
    quotesToSave,
    boxes,
    selectedRate: selected,
    rates,
    state,
    country,
  };
}

/**
 * Paid replay returns the order and no new PaymentIntent.
 * Pending replay returns the existing PaymentIntent id so the caller can
 * hand back its client secret.
 */
export function idempotentReplay(existing) {
  if (!existing) return null;
  const status = existing.status;
  const paidAt = existing.payment?.['paid-at'] || existing.payment?.paidAt;
  if (paidAt || (status && status !== 'pending')) {
    return { kind: 'paid' };
  }
  return {
    kind: 'pending',
    paymentIntentId: existing.payment?.['stripe-payment-intent-id'] || null,
  };
}

async function resolveLineFile({ line, userId, loadQuote, now }) {
  const fresh = asModelFile(line.modelFile || line['model-file']);
  let stored = null;
  if (line.quoteId) {
    stored = await loadQuote(line.quoteId);
  }
  const owned = stored && sameUser(stored, userId);
  const hashOk = owned && String(stored.scriptHash || '') === String(line.scriptHash || '');
  const idsMatch = owned && stored.quoteId === line.quoteId;
  // Cart quotedAt and the stored quote use the same QUOTE_TTL_MS check.
  const lineFresh = !isQuoteExpired(line, now);
  const docFresh = idsMatch && hashOk && !isQuoteExpired(stored, now);
  const storedFile = lineFresh && docFresh
    ? asModelFile(stored['model-file'] || stored.modelFile)
    : null;

  if (storedFile) {
    return {
      ok: true,
      skipped: false,
      requoted: false,
      modelFile: storedFile,
      quoteId: stored.quoteId,
      quotedAt: stored.quotedAt,
      scriptHash: stored.scriptHash,
    };
  }

  if (!fresh) {
    if (!line.quoteId) {
      return { ok: false, status: 400, error: 'Model file is required' };
    }
    return { ok: true, skipped: true, reason: 'stale' };
  }

  return {
    ok: true,
    skipped: false,
    requoted: true,
    modelFile: fresh,
    quoteId: null,
    quotedAt: null,
    scriptHash: line.scriptHash || '',
  };
}

function quoteDraft({
  userId,
  quoteId,
  scriptHash,
  process,
  material,
  infill,
  geometry,
  unit,
  modelFile,
  created,
}) {
  return {
    'user-id': userId,
    quoteId,
    quotedAt: created,
    quotedUnitPrice: unit.unitSubtotal,
    scriptHash,
    process,
    material,
    infill,
    'volume-mm3': unit.volume,
    'bounding-box': {
      width: geometry.boundingBox.width,
      height: geometry.boundingBox.height,
      depth: geometry.boundingBox.depth,
    },
    'unit-material': unit.unitMaterial,
    'unit-machine': unit.unitMachine,
    'unit-grams': unit.unitGrams,
    'model-file': normalizeStoredFile(modelFile),
  };
}

function normalizeStoredFile(file) {
  const data = file?.data ?? file?.['data'];
  return {
    filename: file?.filename || file?.['filename'] || 'part.3mf',
    'content-type': file?.contentType || file?.['content-type'] || 'model/3mf',
    'storage-type': 'inline',
    data,
  };
}

function asModelFile(file) {
  const data = file?.data ?? file?.['data'];
  if (!data) return null;
  return {
    data,
    filename: file.filename || file['filename'],
    contentType: file.contentType || file['content-type'],
    'content-type': file['content-type'] || file.contentType,
  };
}

function sameUser(quote, userId) {
  if (!userId) return false;
  const id = quote?.['user-id']?.toString?.() || quote?.['user-id'];
  return id && String(id) === String(userId);
}

function normalizeInfill(value) {
  const n = value == null || value === '' ? 20 : Number(value);
  if (!Number.isFinite(n) || n < 10 || n > 100) return null;
  return n;
}

function clientShipFrom(shipping) {
  if (!shipping) return undefined;
  return shipping.price ?? shipping.cost ?? shipping['shipping-cost'];
}

function fail(status, error) {
  return { ok: false, status, error };
}
