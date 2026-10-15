/**
 * One checkout for the cart: lines, one address, one shipping quote,
 * one server re-price, one Stripe payment. Removing a line asks first.
 * A quantity change does not.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Loader2, Minus, Plus, X } from 'lucide-react';
import { useCartChrome } from '../../hooks/useCart';
import { useAuth } from '../../hooks/useAuth';
import { CART_QTY_MAX, CART_QTY_MIN, scriptHash, scriptsForOrder } from '../../utils/cart.js';
import {
  addressKey,
  boxesFromPackageInfo,
  buildCheckoutCreateBody,
  chargedLineIds,
  checkoutOverCap,
  checkoutPageNote,
  defaultAddressId,
  packageBoxCount,
  packagePreviewBody,
  planCheckout,
  sumBoxRateQuotes,
} from '../../utils/checkoutPage.js';
import { calculateQuote } from '../../utils/quoting.js';
import { generate3MFBlob } from '../../utils/exportModel.js';
import { blobToBase64 } from '../../utils/model-io.js';
import { readJsonSafe } from '../../utils/quoteMath.js';
import AddressPicker from './AddressPicker.jsx';
import CheckoutPay from './CheckoutPay.jsx';
import CartRemoveDialog from '../CartRemoveDialog.jsx';
import ModalFit from '../ModalFit.jsx';

const FALLBACK_METHODS = [
  { code: 'ground', name: 'UPS Ground', price: null, estimatedDays: '5-7 business days', carrier: 'UPS' },
  { code: '2day', name: 'UPS 2nd Day Air', price: null, estimatedDays: '2 business days', carrier: 'UPS' },
  { code: 'overnight', name: 'UPS Next Day Air', price: null, estimatedDays: '1 business day', carrier: 'UPS' },
];

function money(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '';
}

async function measureRow(row) {
  if (!row.script) return null;
  const quote = await calculateQuote(row.script, {
    process: row.options.process,
    material: row.options.material,
    infill: row.options.infill,
    quantity: row.qty,
    partId: row.partId,
    lineError: row.lineError || '',
  });
  if (!quote?.boundingBox || quote.materialGrams == null) return null;
  return {
    boundingBox: quote.boundingBox,
    materialGrams: quote.materialGrams,
    quantity: row.qty,
  };
}

async function exportModelFile(row) {
  const blob = await generate3MFBlob(row.script, {
    partId: row.partId,
    lineError: row.lineError || '',
  });
  const data = await blobToBase64(blob);
  return {
    contentType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    filename: `${row.partName || 'part'}.3mf`,
    data,
  };
}

export default function CheckoutPage({
  assemblyRef,
  partScriptsRef,
  liveScriptRef,
  partRunsRef,
  onClose,
  onPaid,
  onOpenAccount,
}) {
  const cart = useCartChrome();
  const { user, checkAuth } = useAuth();
  const [addresses, setAddresses] = useState(() => user?.addresses || []);
  const [selectedId, setSelectedId] = useState(() => defaultAddressId(user?.addresses));
  const [rates, setRates] = useState([]);
  const [boxCount, setBoxCount] = useState(1);
  const [methodCode, setMethodCode] = useState('ground');
  const [shippingError, setShippingError] = useState('');
  const [shippingBusy, setShippingBusy] = useState(false);
  const [pageError, setPageError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [serverSkipped, setServerSkipped] = useState([]);
  const [payment, setPayment] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const idempotencyKey = useRef('');
  const shipSeq = useRef(0);

  const plan = useMemo(() => planCheckout(
    assemblyRef?.current || null,
    scriptsForOrder(partScriptsRef?.current, liveScriptRef?.current),
    { lines: cart?.lines || [], tombstones: [], version: 0 },
    partRunsRef?.current,
  ), [assemblyRef, partScriptsRef, liveScriptRef, partRunsRef, cart?.lines]);

  const note = checkoutPageNote(plan);
  const overCap = checkoutOverCap(plan.payable);
  const selectedAddress = addresses.find((addr, index) => addressKey(addr, index) === selectedId) || null;
  const selectedRate = rates.find((rate) => rate.code === methodCode) || null;
  const locked = !!payment || !!confirmation;

  useEffect(() => {
    if (!selectedId && addresses.length) setSelectedId(defaultAddressId(addresses));
  }, [addresses, selectedId]);

  const shipKey = [
    selectedAddress?.zip || '',
    selectedAddress?.street || '',
    selectedAddress?.state || '',
    plan.payable.map((row) => `${row.lineId}:${row.qty}:${row.scriptHash}:${row.action}`).join(','),
  ].join('|');
  const payableRef = useRef(plan.payable);
  const addressRef = useRef(selectedAddress);
  payableRef.current = plan.payable;
  addressRef.current = selectedAddress;

  useEffect(() => {
    const address = addressRef.current;
    const payable = payableRef.current;
    if (locked || !address || payable.length < 1) return undefined;
    const seq = shipSeq.current + 1;
    shipSeq.current = seq;
    let cancelled = false;

    const load = async () => {
      setShippingBusy(true);
      setShippingError('');
      try {
        const measured = [];
        for (const row of payable) {
          try {
            const hit = await measureRow(row);
            if (hit) measured.push(hit);
          } catch (err) {
            if (row.lineError && /mesh asset|importMesh/i.test(err?.message || '')) {
              throw err;
            }
          }
        }
        if (cancelled || seq !== shipSeq.current) return;
        if (!measured.length) {
          setRates(FALLBACK_METHODS);
          setBoxCount(1);
          setShippingError('Shipping price is confirmed when the order is created.');
          return;
        }
        const packageResponse = await fetch('/api/shipping/calculate-package', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(packagePreviewBody(measured)),
        });
        const packageData = await readJsonSafe(packageResponse);
        if (!packageResponse.ok || !packageData.success) {
          throw new Error(packageData.error || 'Failed to calculate package dimensions');
        }
        const info = packageData.packageInfo || {};
        const boxes = boxesFromPackageInfo(info);
        const count = packageBoxCount(info);
        const perBox = [];
        for (const box of boxes) {
          const ratesResponse = await fetch('/api/shipping/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              address,
              packageInfo: { dimensions: box.dimensions, weight: box.weight },
            }),
          });
          const ratesData = await readJsonSafe(ratesResponse);
          if (!ratesResponse.ok || !ratesData.success) {
            throw new Error(ratesData.error || 'Failed to get shipping rates');
          }
          perBox.push(ratesData.rates || []);
        }
        if (cancelled || seq !== shipSeq.current) return;
        const summed = perBox.length > 1 ? sumBoxRateQuotes(perBox) : (perBox[0] || []).map((rate) => ({
          ...rate,
          boxCount: count,
        }));
        setBoxCount(count);
        setRates(summed.length ? summed : FALLBACK_METHODS);
        setMethodCode((current) => (
          summed.some((rate) => rate.code === current) ? current : (summed[0]?.code || 'ground')
        ));
      } catch (err) {
        if (cancelled || seq !== shipSeq.current) return;
        setShippingError(err?.message || 'Could not quote shipping');
        setRates(FALLBACK_METHODS);
        setBoxCount(1);
      } finally {
        if (!cancelled && seq === shipSeq.current) setShippingBusy(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [shipKey, locked]);

  const requoteRow = async (row) => {
    const hash = scriptHash(row.script || '');
    const modelFile = await exportModelFile(row);
    const response = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        scriptHash: hash,
        process: row.options.process,
        material: row.options.material,
        infill: row.options.infill,
        modelFile,
      }),
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data.quoteId) {
      throw new Error(data.error || `Could not re-quote ${row.partName}`);
    }
    cart?.noteQuote?.(row.lineId, {
      quoteId: data.quoteId,
      quotedAt: data.quotedAt,
      quotedUnitPrice: data.quotedUnitPrice,
      scriptHash: data.scriptHash || hash,
      process: data.process || row.options.process,
      material: data.material || row.options.material,
      infill: data.infill ?? row.options.infill,
    });
    return {
      ...row,
      action: 'pay',
      quoteId: data.quoteId,
      quotedAt: data.quotedAt,
      quotedUnitPrice: data.quotedUnitPrice,
      scriptHash: data.scriptHash || hash,
    };
  };

  const startPayment = async () => {
    if (preparing || payment || !selectedAddress || !selectedRate) return;
    if (overCap) {
      setPageError('An order can include at most 20 lines. Remove some and try again.');
      return;
    }
    const ready = plan.payable;
    if (!ready.length) {
      setPageError(note || 'Nothing in this cart can be checked out yet.');
      return;
    }
    setPreparing(true);
    setPageError('');
    setServerSkipped([]);
    try {
      const quoted = [];
      const localSkips = [];
      for (const row of ready) {
        if (row.action !== 'requote') {
          quoted.push(row);
          continue;
        }
        try {
          quoted.push(await requoteRow(row));
        } catch (err) {
          localSkips.push({
            lineId: row.lineId,
            partName: row.partName,
            reason: err?.message || 'stale',
          });
        }
      }
      if (!quoted.length) {
        throw new Error(localSkips[0]?.reason || 'No lines could be priced. Open the assembly and try again.');
      }
      if (!idempotencyKey.current) {
        idempotencyKey.current = (crypto.randomUUID && crypto.randomUUID()) || `checkout-${Date.now()}`;
      }
      const shipping = {
        method: selectedRate.code,
        service: selectedRate.name,
        price: selectedRate.price,
        estimatedDelivery: selectedRate.estimatedDelivery,
      };
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
        },
        credentials: 'include',
        body: JSON.stringify(buildCheckoutCreateBody({
          rows: quoted,
          address: selectedAddress,
          shipping,
        })),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) throw new Error(data.error || 'Failed to create order');
      const skipped = [...localSkips, ...(Array.isArray(data.skipped) ? data.skipped : [])];
      setServerSkipped(skipped);
      if (data.alreadyPaid) {
        const ids = chargedLineIds(data.order);
        onPaid?.(ids.length ? ids : quoted.map((row) => row.lineId));
        setConfirmation({
          orderNumber: data.order?.orderNumber,
          total: data.order?.total,
          status: data.order?.status || 'paid',
          lines: quoted,
        });
        return;
      }
      setPayment({
        order: { ...data.order, priceUpdated: data.priceUpdated === true },
        priceUpdated: data.priceUpdated === true,
        clientSecret: data.clientSecret,
        publishableKey: data.publishableKey,
        lineIds: chargedLineIds(data.order).length
          ? chargedLineIds(data.order)
          : quoted.map((row) => row.lineId),
      });
    } catch (err) {
      setPageError(err?.message || 'Could not start checkout');
    } finally {
      setPreparing(false);
    }
  };

  const handlePaid = (result) => {
    const ids = payment?.lineIds || [];
    onPaid?.(ids);
    setConfirmation({
      orderNumber: result?.orderNumber || payment?.order?.orderNumber,
      total: result?.total ?? payment?.order?.total,
      status: result?.status || 'paid',
      lines: plan.rows.filter((row) => ids.includes(row.lineId)),
    });
    setPayment(null);
  };

  if (typeof document === 'undefined') return null;

  const summary = payment?.order;

  return createPortal(
    <>
    <ModalFit
      className="modal-fit-sheet z-[90] flex items-end justify-center sm:items-center"
      cap="92vh"
      data-checkout-page=""
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close checkout"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Checkout"
        className="modal-fit-panel relative z-10 flex w-full flex-col rounded-t-2xl border border-chrome-border bg-chrome-surface shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-chrome-border px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Checkout</h2>
          <button type="button" data-checkout-close="" aria-label="Close checkout" onClick={onClose} className="rounded-md p-1 text-gray-300 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {confirmation ? (
            <div className="space-y-4 text-center" data-checkout-confirmation="">
              <CheckCircle className="mx-auto text-green-500" size={40} />
              <h3 className="text-xl font-semibold text-white">Order confirmed</h3>
              <p className="font-mono text-lg text-white" data-checkout-order-number="">{confirmation.orderNumber}</p>
              <p className="text-sm text-gray-300">Total {money(confirmation.total)}</p>
              <ul className="space-y-1 text-left text-sm text-gray-300">
                {(confirmation.lines || []).map((line) => (
                  <li key={line.lineId || line.partName} data-checkout-confirmed-line="">
                    {line.partName} · Qty {line.qty || line.quantity || 1}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                data-checkout-view-orders=""
                className="w-full rounded-xl bg-gray-200 py-2 text-sm font-medium text-black"
                onClick={() => onOpenAccount?.('orders')}
              >
                View orders
              </button>
            </div>
          ) : (
            <>
              <section className="space-y-2" data-checkout-lines="">
                {plan.rows.length === 0 && (
                  <p className="text-sm text-chrome-secondary">Your cart is empty.</p>
                )}
                {plan.rows.map((row) => (
                  <div
                    key={row.lineId}
                    data-checkout-line={row.lineId}
                    data-checkout-action={row.action}
                    className="flex items-center gap-3 border-b border-white/5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-chrome-text" data-checkout-line-name="">{row.partName}</p>
                      <p className="truncate text-[11px] text-gray-500">
                        {row.options.process} · {row.options.material}
                        {row.quotedUnitPrice != null ? ` · ${money(row.quotedUnitPrice)} each` : ''}
                      </p>
                      {row.options.assumed && row.action === 'requote' && (
                        <p className="text-[11px] text-gray-500">Quoted as FDM, PLA, 20% infill.</p>
                      )}
                      {row.hashStale && (
                        <p className="text-[11px] text-amber-200" data-checkout-stale="">Script changed</p>
                      )}
                      {row.quoteExpired && (
                        <p className="text-[11px] text-amber-200" data-checkout-expired="">
                          {row.quoteId ? 'Quote expired' : 'Needs a quote'}
                        </p>
                      )}
                      {row.action === 'skip' && (
                        <p className="text-[11px] text-chrome-secondary" data-checkout-skipped="">
                          Skipped until this assembly is open.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1" data-checkout-qty={row.qty}>
                      <button
                        type="button"
                        data-checkout-qty-dec=""
                        aria-label="Fewer"
                        disabled={locked || row.qty <= CART_QTY_MIN}
                        className="rounded-md p-1 text-gray-200 hover:bg-white/10 disabled:opacity-30"
                        onClick={() => cart?.changeQty?.(row.lineId, row.qty - 1)}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center text-xs tabular-nums text-chrome-text">{row.qty}</span>
                      <button
                        type="button"
                        data-checkout-qty-inc=""
                        aria-label="More"
                        disabled={locked || row.qty >= CART_QTY_MAX}
                        className="rounded-md p-1 text-gray-200 hover:bg-white/10 disabled:opacity-30"
                        onClick={() => cart?.changeQty?.(row.lineId, row.qty + 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      data-checkout-remove=""
                      disabled={locked}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/15 disabled:opacity-30"
                      onClick={() => setPendingRemove({
                        lineId: row.lineId,
                        name: row.partName || 'this part',
                      })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {note && (
                  <p className="text-[11px] text-chrome-secondary" data-checkout-skip="">{note}</p>
                )}
                {overCap && (
                  <p className="text-[11px] text-amber-200" data-checkout-cap="">
                    An order can include at most 20 lines. Remove some and try again.
                  </p>
                )}
              </section>

              <AddressPicker
                addresses={addresses}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onBookChange={(next) => {
                  setAddresses(next);
                  checkAuth?.();
                }}
              />

              <section className="space-y-2" data-shipping-quote="">
                <h3 className="text-sm font-medium text-gray-200">Shipping</h3>
                {shippingBusy && (
                  <p className="flex items-center gap-2 text-xs text-chrome-secondary" data-shipping-loading="">
                    <Loader2 className="animate-spin" size={14} />
                    Quoting UPS…
                  </p>
                )}
                {boxCount > 1 && (
                  <p className="text-xs text-gray-300" data-shipping-boxes={boxCount}>
                    Ships in {boxCount} boxes
                  </p>
                )}
                {shippingError && <p className="text-[11px] text-gray-500">{shippingError}</p>}
                <div className="space-y-2">
                  {rates.map((rate) => {
                    const selected = rate.code === methodCode;
                    return (
                      <button
                        key={rate.code}
                        type="button"
                        data-shipping-method={rate.code}
                        data-shipping-selected={selected ? 'true' : 'false'}
                        disabled={locked}
                        onClick={() => setMethodCode(rate.code)}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                          selected ? 'border-blue-400 bg-blue-500/10 text-white' : 'border-chrome-border text-gray-300'
                        }`}
                      >
                        <span>{rate.name}</span>
                        <span>{rate.price == null ? '' : money(rate.price)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {serverSkipped.length > 0 && (
                <p className="text-[11px] text-chrome-secondary" data-checkout-server-skip="">
                  {serverSkipped.map((row) => row.partName || row.lineId).filter(Boolean).join(', ')} skipped.
                </p>
              )}
              {pageError && <p className="text-sm text-red-300" data-checkout-error="">{pageError}</p>}

              {summary && (
                <div className="space-y-1 rounded-xl bg-gray-800/40 p-3 text-sm text-gray-300" data-checkout-summary="">
                  <div className="flex justify-between"><span>Subtotal</span><span>{money(summary.subtotal)}</span></div>
                  <div className="flex justify-between"><span>Shipping</span><span>{money(summary.shipping)}</span></div>
                  <div className="flex justify-between"><span>Tax</span><span>{money(summary.tax)}</span></div>
                  <div className="flex justify-between font-medium text-white">
                    <span>Total</span><span data-checkout-total="">{money(summary.total)}</span>
                  </div>
                </div>
              )}

              {!payment && (
                <button
                  type="button"
                  data-checkout-review=""
                  disabled={preparing || !selectedAddress || !selectedRate || plan.payable.length < 1 || overCap}
                  onClick={startPayment}
                  className="w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {preparing ? 'Preparing your order…' : 'Continue to payment'}
                </button>
              )}

              {payment && (
                <CheckoutPay
                  order={payment.order}
                  priceUpdated={payment.priceUpdated}
                  clientSecret={payment.clientSecret}
                  publishableKey={payment.publishableKey}
                  onPaid={handlePaid}
                  onError={setPageError}
                />
              )}
            </>
          )}
        </div>
      </div>
    </ModalFit>
    <CartRemoveDialog
      open={!!pendingRemove}
      name={pendingRemove?.name || ''}
      onCancel={() => setPendingRemove(null)}
      onConfirm={() => {
        const lineId = pendingRemove?.lineId;
        setPendingRemove(null);
        if (lineId) cart?.removeLine?.(lineId);
      }}
    />
    </>,
    document.body,
  );
}
