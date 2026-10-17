/**
 * Line rows for order mail. Download links are fulfillment-only.
 */
import config from '../config/index.js';
import { readOrderLines } from './orderLines.js';
import { buildModelDownloadUrl } from './modelLink.js';
import { roundMoney } from '../../src/utils/quoteMath.js';
import { escapeHtml } from './htmlSafe.js';

export function mailLines(order) {
  return readOrderLines(order).map((line) => {
    const qty = Number(line.quantity) || 1;
    let unit = Number(line['unit-subtotal']);
    let extended = Number.isFinite(unit) ? roundMoney(unit * qty) : null;
    if (line.synthesized) {
      const subtotal = Number(order?.quote?.subtotal);
      if (Number.isFinite(subtotal)) {
        extended = roundMoney(subtotal);
        unit = qty > 0 ? roundMoney(extended / qty) : extended;
      }
    }
    return {
      lineId: line.lineId || '',
      synthesized: line.synthesized === true,
      partName: line.partName || 'Part',
      process: line.process || '',
      material: line.material || '',
      infill: line.infill,
      quantity: qty,
      unit,
      extended,
    };
  });
}

export function lineTableHtml(order, { downloads = false, secret, now, origin } = {}) {
  const rows = mailLines(order);
  const body = rows.map((line) => {
    const link = downloads ? downloadCell(order, line, { secret, now, origin }) : '';
    return `<tr>
      <td>${escapeHtml(line.partName)}</td>
      <td>${escapeHtml(line.process)}</td>
      <td>${escapeHtml(line.material)}</td>
      <td>${escapeHtml(line.infill ?? '')}</td>
      <td>Qty ${escapeHtml(line.quantity)}</td>
      <td>${money(line.unit)}</td>
      <td>${money(line.extended)}</td>
      ${downloads ? `<td>${link}</td>` : ''}
    </tr>`;
  }).join('\n');
  const linkHead = downloads ? '<th>3MF</th>' : '';
  return `<table>
    <tr>
      <th>Part</th><th>Process</th><th>Material</th><th>Infill</th>
      <th>Qty</th><th>Unit</th><th>Subtotal</th>${linkHead}
    </tr>
    ${body}
  </table>`;
}

export function lineTableText(order) {
  return mailLines(order).map((line) => (
    `- ${line.partName}: ${line.process} ${line.material}, infill ${line.infill ?? ''}%, Qty ${line.quantity}, unit ${money(line.unit)}, subtotal ${money(line.extended)}`
  )).join('\n');
}

export function fulfillmentDownloads(order, { secret, now = Date.now(), origin } = {}) {
  const orderNumber = order?.['order-number'] || order?.orderNumber;
  const key = secret ?? config.session.secret ?? '';
  const base = origin ?? config.backendUrl ?? '';
  if (!key || !orderNumber) return [];
  return mailLines(order).map((line) => {
    const lineId = line.synthesized ? '' : line.lineId;
    const built = buildModelDownloadUrl({
      orderNumber,
      lineId,
      secret: key,
      now,
      origin: base,
    });
    return { ...line, ...built };
  });
}

function downloadCell(order, line, opts) {
  const links = fulfillmentDownloads(order, opts);
  const hit = links.find((item) => item.lineId === line.lineId && item.synthesized === line.synthesized);
  if (!hit?.url) return 'download-model.js';
  return `<a href="${escapeHtml(hit.url)}">Download 3MF</a>`;
}

function money(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—';
}
