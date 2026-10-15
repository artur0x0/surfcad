/**
 * One-page checkout. Pure helpers: which lines can be paid, the create
 * body, the summed shipping preview, and how an old order is listed.
 * The server remeasures and is the charge. This module does not import
 * mongoose or the Manifold worker.
 */
import {
  clampQty,
  isQuoteExpired,
  presentCartLines,
  resolveCartLine,
  scriptHash,
} from './cart.js';
import { roundMoney } from './quoteMath.js';

/**
 * 20 lines per order keeps N inline 3MFs inside the 10mb JSON body.
 * Expand in future. Matches MAX_ORDER_LINES on the server.
 */
export const MAX_CHECKOUT_LINES = 20;

const PROCESSES = new Set(['FDM', 'SLA', 'SLS', 'MJF']);
const METHODS = ['ground', '2day', 'overnight'];

function runErrorFor(runs, ids) {
  for (const id of ids) {
    if (!id) continue;
    const run = runs?.[id];
    if (!run || run.ok !== false || run.empty || run.skipped) continue;
    const text = typeof run.error === 'string' ? run.error.trim() : '';
    if (text && text !== 'failed') return text;
  }
  return '';
}

/**
 * Options locked on the line. An old line with `options: null` is quoted
 * as FDM / PLA / 20% so checkout can still re-measure it. `assumed` is
 * true when those defaults filled a gap.
 */
export function lockedOptions(options) {
  const process = options?.process == null ? '' : String(options.process).trim();
  const material = options?.material == null ? '' : String(options.material).trim();
  const infill = Number(options?.infill);
  const infillOk = Number.isFinite(infill) && infill >= 10 && infill <= 100;
  const processOk = PROCESSES.has(process);
  const assumed = !processOk || material === '' || !infillOk;
  return {
    process: processOk ? process : 'FDM',
    material: material || 'PLA',
    infill: infillOk ? infill : 20,
    assumed,
  };
}

function lineStale(line, now) {
  return !!(line.hashStale || line.quoteExpired || isQuoteExpired(line, now));
}

/**
 * Payable lines are charged together. A fresh quote (hash matches, inside
 * the 7-day TTL) is payable even when the assembly is closed — the server
 * still has the 3MF. A stale or expired line is re-quoted only when that
 * part's script is open. Otherwise it is skipped. Expiry uses this
 * function's `now`, not a second read of the wall clock.
 */
export function planCheckout(doc, scripts, cart, runs = null, now = new Date()) {
  const view = presentCartLines(doc, scripts, cart, now);
  const rows = [];
  for (const line of view) {
    const partName = line.liveName || line.partName;
    const resolved = doc ? resolveCartLine(doc, scripts, line) : {
      script: null,
      part: null,
    };
    const script = resolved.script || null;
    const partId = resolved.part?.id || line.partId;
    const open = !!(doc && script && !line.missing && !line.elsewhere);
    const options = lockedOptions(line.options);
    const stale = lineStale(line, now);
    const row = {
      lineId: line.lineId,
      partId,
      partName: resolved.part?.name || partName,
      assemblyName: line.assemblyName,
      source: line.source,
      surfId: line.surfId || null,
      qty: clampQty(line.qty),
      options,
      script,
      scriptHash: stale && script ? scriptHash(script) : line.scriptHash,
      quotedUnitPrice: line.quotedUnitPrice,
      quoteId: line.quoteId,
      quotedAt: line.quotedAt,
      hashStale: !!line.hashStale,
      quoteExpired: !!line.quoteExpired || isQuoteExpired(line, now),
      thumbDataUrl: line.thumbDataUrl || null,
      lineError: runErrorFor(runs, [partId, line.partId]),
      action: 'skip',
      reason: null,
    };
    if (!stale) {
      row.action = 'pay';
    } else if (open) {
      row.action = 'requote';
    } else if (!doc) {
      row.reason = 'closed';
    } else if (line.elsewhere) {
      row.reason = 'elsewhere';
    } else if (line.missing || !script) {
      row.reason = 'missing';
    } else {
      row.reason = 'stale';
    }
    rows.push(row);
  }
  const payable = rows.filter((row) => row.action !== 'skip');
  const skipped = rows
    .filter((row) => row.action === 'skip')
    .map((row) => ({
      lineId: row.lineId,
      reason: row.reason,
      assemblyName: row.assemblyName,
      partName: row.partName,
    }));
  return { rows, payable, skipped };
}

/** Short note under Checkout and on the page. Empty when every line can be paid. */
export function checkoutPageNote(plan) {
  const skipped = plan?.skipped || [];
  const eligible = plan?.payable?.length || 0;
  if (!skipped.length) return '';
  const reasons = new Set(skipped.map((row) => row.reason));
  if (eligible === 0) {
    if (reasons.has('closed')) return 'Open an assembly to check out.';
    if (reasons.has('elsewhere') && !reasons.has('missing')) {
      const name = skipped.find((row) => row.reason === 'elsewhere')?.assemblyName;
      return name
        ? `Open ${name} to check out these parts.`
        : 'Open that assembly to check out these parts.';
    }
    if (reasons.has('missing') && !reasons.has('elsewhere')) {
      return 'Missing parts stay in the cart.';
    }
    return 'Nothing in this assembly can be checked out yet.';
  }
  const notes = [];
  if (reasons.has('missing')) notes.push('Missing parts are skipped.');
  if (reasons.has('elsewhere')) notes.push('Parts in another assembly stay in the cart.');
  if (reasons.has('closed') || reasons.has('stale')) {
    notes.push('Expired quotes need the assembly open.');
  }
  return notes.join(' ');
}

export function checkoutOverCap(payable) {
  return (payable?.length || 0) > MAX_CHECKOUT_LINES;
}

export function addressKey(address, index = 0) {
  if (!address || typeof address !== 'object') return `addr-${index}`;
  if (address._id != null && String(address._id) !== '') return String(address._id);
  if (address.id != null && String(address.id) !== '') return String(address.id);
  return `addr-${index}`;
}

export function defaultAddressId(addresses) {
  const list = Array.isArray(addresses) ? addresses : [];
  const chosen = list.find((addr) => addr?.isDefault) || list[0];
  return chosen ? addressKey(chosen, 0) : '';
}

/**
 * Preview body for `POST /api/shipping/calculate-package`.
 * `materialGrams` is already extended (unit × qty). Do not multiply again.
 */
export function packagePreviewBody(measured) {
  return {
    lines: (measured || []).map((row) => ({
      boundingBox: row.boundingBox,
      materialGrams: row.materialGrams,
      quantity: row.quantity,
    })),
  };
}

/**
 * Sum one rate card per box. Same rule as the server: a method is kept
 * only when every box priced it. The displayed price is the sum.
 */
export function sumBoxRateQuotes(perBox) {
  const rates = [];
  const groups = Array.isArray(perBox) ? perBox : [];
  for (const code of METHODS) {
    let price = 0;
    let sample = null;
    let complete = groups.length > 0;
    for (const boxRates of groups) {
      const hit = (boxRates || []).find((rate) => rate?.code === code);
      if (!hit || !Number.isFinite(Number(hit.price))) {
        complete = false;
        break;
      }
      price += Number(hit.price);
      sample = hit;
    }
    if (!complete || !sample) continue;
    rates.push({
      code: sample.code,
      name: sample.name,
      price: roundMoney(price),
      currency: sample.currency || 'USD',
      estimatedDays: sample.estimatedDays,
      estimatedDelivery: sample.estimatedDelivery,
      carrier: sample.carrier || 'UPS',
      boxCount: groups.length,
    });
  }
  return rates;
}

export function boxesFromPackageInfo(packageInfo) {
  if (!packageInfo || typeof packageInfo !== 'object') return [];
  if (Array.isArray(packageInfo.boxes) && packageInfo.boxes.length > 0) {
    return packageInfo.boxes;
  }
  if (packageInfo.dimensions && packageInfo.weight != null) return [packageInfo];
  return [];
}

export function packageBoxCount(packageInfo) {
  const n = Number(packageInfo?.boxCount);
  if (Number.isInteger(n) && n > 0) return n;
  const boxes = boxesFromPackageInfo(packageInfo);
  return boxes.length || 1;
}

/**
 * Create body for `POST /api/orders/create` with `lines`.
 * Client money is comparison only. Shipping `price` is the preview.
 */
export function buildCheckoutCreateBody({ rows, address, shipping }) {
  return {
    lines: (rows || []).map((row) => ({
      lineId: row.lineId,
      partName: row.partName,
      assemblyName: row.assemblyName || '',
      partId: row.partId || '',
      source: row.source || '',
      surfId: row.surfId || '',
      scriptHash: row.scriptHash || '',
      quoteId: row.quoteId,
      quotedUnitPrice: row.quotedUnitPrice,
      quotedAt: row.quotedAt,
      process: row.options?.process,
      material: row.options?.material,
      infill: row.options?.infill,
      quantity: row.qty,
    })),
    shipping: {
      address: {
        name: address?.name || '',
        street: address?.street || address?.['address-1'] || '',
        street2: address?.street2 || address?.['address-2'] || '',
        city: address?.city || '',
        state: address?.state || '',
        zip: address?.zip || '',
        country: address?.country || 'US',
        phone: address?.phone || '',
      },
      method: shipping?.method,
      service: shipping?.service,
      price: shipping?.price,
      estimatedDelivery: shipping?.estimatedDelivery,
    },
    quote: {
      shipping: shipping?.price,
    },
  };
}

/**
 * lines of an order = order.lines if length > 0
 *                     else one synthesized line from model-data
 *                          (qty = Number(quantity) || 1)
 */
export function displayOrderLines(order) {
  const stored = order?.lines;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.map((line) => ({
      lineId: line?.lineId || (line?._id != null ? String(line._id) : null),
      partName: line?.partName || 'Part',
      process: line?.process,
      material: line?.material,
      infill: line?.infill,
      quantity: Number(line?.quantity) || 1,
      unit: line?.['unit-subtotal'] ?? line?.quotedUnitPrice ?? null,
      synthesized: false,
    }));
  }
  const model = order?.['model-data'] || order?.modelData || {};
  const file = model['model-file'] || model.modelFile || null;
  const qty = Number(model.quantity) || 1;
  return [{
    lineId: null,
    partName: file?.filename || 'Part',
    process: model.process,
    material: model.material,
    infill: model.infill,
    quantity: qty,
    unit: null,
    synthesized: true,
  }];
}

export function chargedLineIds(order) {
  const lines = order?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => line?.lineId).filter(Boolean);
}
