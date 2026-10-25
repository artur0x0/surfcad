/**
 * Cart sheet. Checkout still walks the lines that can be quoted from this
 * assembly. Missing parts and parts in another assembly stay in the cart.
 * A line shows its server unit price and a stale badge when the script
 * hash changed or the quote expired. Removing a line asks first.
 * A quantity change does not.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { useCartChrome } from '../hooks/useCart';
import { CART_QTY_MAX, CART_QTY_MIN, cartLineIsStale } from '../utils/cart.js';
import CartRemoveDialog from './CartRemoveDialog';
import ModalFit from './ModalFit';

function staleLabel(line) {
  if (line.hashStale && line.quoteExpired) return 'Stale';
  if (line.hashStale) return 'Script changed';
  return 'Quote expired';
}

export default function CartSheet() {
  const cart = useCartChrome();
  const open = !!cart?.open;
  const [pendingRemove, setPendingRemove] = useState(null);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  useEffect(() => {
    if (!open) return undefined;
    // Once per open. Depending on the cart object refills again after every
    // qty or remove, and that reschedules sync so the edit never goes out.
    cartRef.current.refill?.();
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-cart-remove-dialog]')) return;
      cartRef.current.closeCart?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const lines = cart.lines || [];
  const canCheckout = (cart.checkoutLines || []).length > 0;
  const skipNote = cart.checkoutNote || '';

  return createPortal(
    <>
    <ModalFit
      className="modal-fit-sheet z-[80] flex items-end justify-center sm:items-center"
      cap="85vh"
      data-cart-root=""
    >
      <button
        type="button"
        data-cart-backdrop=""
        className="absolute inset-0 surface-scrim"
        aria-label="Close cart"
        onClick={() => cart.closeCart?.()}
      />
      <div
        role="dialog"
        aria-label="Cart"
        data-cart-sheet=""
        data-cart-count={cart.count || 0}
        className="modal-fit-panel relative z-10 flex w-full flex-col rounded-t-xl border border-gray-600
          bg-chrome-surface shadow-2xl sm:max-w-md sm:rounded-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-chrome-border px-4 py-3">
          <h2 className="text-sm font-semibold text-chrome-text">Cart</h2>
          <button
            type="button"
            data-cart-close=""
            className="rounded-md p-1 text-gray-300 hover:bg-white/10"
            aria-label="Close cart"
            onClick={() => cart.closeCart?.()}
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {lines.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-chrome-secondary" data-cart-empty="">
              Nothing ordered yet.
            </p>
          ) : lines.map((line) => (
            <div
              key={line.lineId}
              data-cart-line={line.lineId}
              data-cart-line-missing={line.missing ? 'true' : 'false'}
              className="flex items-center gap-3 border-b border-white/5 py-2"
            >
              {line.thumbDataUrl ? (
                <img
                  src={line.thumbDataUrl}
                  alt=""
                  data-cart-thumb="image"
                  className="h-12 w-12 shrink-0 rounded-md bg-chrome-background object-cover"
                />
              ) : (
                <div
                  data-cart-thumb="empty"
                  className="h-12 w-12 shrink-0 rounded-md bg-chrome-background"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-chrome-text" data-cart-line-name="">
                  {line.liveName || line.partName}
                </p>
                <p className="truncate text-[11px] text-gray-500" data-cart-line-assembly="">
                  {line.assemblyName}
                </p>
                {line.missing ? (
                  <p className="text-[11px] font-medium text-amber-300" data-cart-missing="">
                    Part missing
                  </p>
                ) : null}
                {line.elsewhere ? (
                  <p className="text-[11px] text-chrome-secondary" data-cart-elsewhere="">
                    Not in this assembly
                  </p>
                ) : null}
                {Number.isFinite(line.quotedUnitPrice) ? (
                  <p className="text-[11px] tabular-nums text-gray-300" data-cart-unit-price="">
                    ${Number(line.quotedUnitPrice).toFixed(2)} each
                  </p>
                ) : null}
                {cartLineIsStale(line) ? (
                  <p
                    className="mt-0.5 inline-flex rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200"
                    data-cart-stale=""
                    data-cart-hash-stale={line.hashStale ? '' : undefined}
                    data-cart-quote-expired={line.quoteExpired ? '' : undefined}
                  >
                    {staleLabel(line)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1" data-cart-qty={line.qty}>
                <button
                  type="button"
                  data-cart-qty-dec=""
                  className="rounded-md p-1 text-gray-200 hover:bg-white/10 disabled:opacity-30"
                  aria-label="Fewer"
                  disabled={line.qty <= CART_QTY_MIN}
                  onClick={() => cart.changeQty?.(line.lineId, line.qty - 1)}
                >
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center text-xs tabular-nums text-chrome-text">{line.qty}</span>
                <button
                  type="button"
                  data-cart-qty-inc=""
                  className="rounded-md p-1 text-gray-200 hover:bg-white/10 disabled:opacity-30"
                  aria-label="More"
                  disabled={line.qty >= CART_QTY_MAX}
                  onClick={() => cart.changeQty?.(line.lineId, line.qty + 1)}
                >
                  <Plus size={14} />
                </button>
              </div>
              <button
                type="button"
                data-cart-remove=""
                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/15"
                onClick={() => setPendingRemove({
                  lineId: line.lineId,
                  name: line.liveName || line.partName || 'this part',
                })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-chrome-border px-4 py-3">
          <button
            type="button"
            data-cart-checkout=""
            disabled={!canCheckout}
            className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white
              disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => cart.startCheckout?.()}
          >
            Checkout
          </button>
          {skipNote ? (
            <p className="mt-2 text-center text-[11px] text-chrome-secondary" data-cart-checkout-skip="">
              {skipNote}
            </p>
          ) : null}
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
        if (lineId) cart.removeLine?.(lineId);
      }}
    />
    </>,
    document.body,
  );
}
