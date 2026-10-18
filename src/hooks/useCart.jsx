/**
 * Signed-in cart for the part row, the profile chip, and the sheet.
 * Signed-out taps open LoginModal and do not write `surfcad_cart`.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  addPartLine,
  cartChipSelector,
  cartCount,
  cartUserId,
  emptyCart,
  makeCartDraft,
  normalizeCart,
  noteLineQuote,
  orderIntent,
  presentCartLines,
  refillThumbs,
  removeCartLine,
  scriptsForOrder,
  setCartQty,
} from '../utils/cart.js';
import { checkoutPageNote, planCheckout } from '../utils/checkoutPage.js';
import { useAuthState } from './useAuthState';
import { readCart, writeCart } from '../utils/cartStorage.js';
import {
  acceptCartExchange,
  cartSyncIsLocalOnly,
  exchangeCart,
  noteCartSignIn,
} from '../utils/cartSync.js';
import { scriptForRow } from '../utils/assembly.js';
import { partSurfId } from '../utils/git/surfId.js';

const CartChromeContext = createContext(null);

export function CartChromeProvider({ value, children }) {
  return (
    <CartChromeContext.Provider value={value}>
      {children}
    </CartChromeContext.Provider>
  );
}

export function useCartChrome() {
  return useContext(CartChromeContext);
}

function cssEscape(value) {
  const text = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
}

function thumbForPart(partId) {
  if (typeof document === 'undefined') return null;
  const canvas = document.querySelector(
    `[data-part-row="${cssEscape(partId)}"] [data-part-thumbnail]`,
  );
  if (!canvas || typeof canvas.toDataURL !== 'function') return null;
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function measureFlight(partId) {
  if (typeof document === 'undefined') return null;
  const thumb = document.querySelector(
    `[data-part-row="${cssEscape(partId)}"] [data-part-thumbnail]`,
  );
  const width = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const chip = document.querySelector(cartChipSelector(width));
  if (!thumb || !chip) return null;
  const from = thumb.getBoundingClientRect();
  const to = chip.getBoundingClientRect();
  if (from.width < 1 || to.width < 1) return null;
  return {
    from: { left: from.left, top: from.top, width: from.width, height: from.height },
    to: { left: to.left, top: to.top, width: to.width, height: to.height },
    image: thumbForPart(partId),
  };
}

function thumbsFromFeed() {
  if (typeof document === 'undefined') return {};
  const map = {};
  document.querySelectorAll('[data-part-row]').forEach((row) => {
    const id = row.getAttribute('data-part-row');
    const canvas = row.querySelector('[data-part-thumbnail]');
    if (!id || !canvas || typeof canvas.toDataURL !== 'function') return;
    try {
      const url = canvas.toDataURL('image/png');
      if (url) map[id] = url;
    } catch {
      /* a tainted canvas stays empty; the line keeps its stored thumb */
    }
  });
  return map;
}

export function useCart({
  user,
  onNeedLogin,
  onCheckout,
  assemblyRef,
  partScriptsRef,
  liveScriptRef,
  partRunsRef,
}) {
  const auth = useAuthState();
  const signedIn = auth.signedIn;
  const pending = auth.pending;
  const userId = cartUserId(user);
  const [cart, setCart] = useState(emptyCart);
  const [open, setOpen] = useState(false);
  const [flight, setFlight] = useState(null);
  const [partQuote, setPartQuoteState] = useState(null);
  const partQuoteRef = useRef(null);
  const rev = useRef(0);
  const flightSeq = useRef(0);
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  const syncTimer = useRef(null);
  const userIdRef = useRef(userId);
  const signedInRef = useRef(signedIn);
  const pendingRef = useRef(pending);
  const onNeedLoginRef = useRef(onNeedLogin);
  const onCheckoutRef = useRef(onCheckout);
  onCheckoutRef.current = onCheckout;
  const seenUser = useRef('');
  userIdRef.current = userId;
  signedInRef.current = signedIn;
  pendingRef.current = pending;
  onNeedLoginRef.current = onNeedLogin;

  const setPartQuote = useCallback((next) => {
    partQuoteRef.current = next;
    setPartQuoteState(next);
  }, []);

  const persist = useCallback((next) => {
    rev.current += 1;
    const id = userIdRef.current;
    if (id && signedInRef.current) writeCart(localStorage, id, next);
    setCart(next);
  }, []);

  const runSync = useCallback(async () => {
    const id = userIdRef.current;
    if (!signedInRef.current || !id) return;
    if (cartSyncIsLocalOnly(id)) return;
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    const seen = rev.current;
    try {
      const result = await exchangeCart({
        userId: id,
        storage: localStorage,
        onNeedLogin: () => onNeedLoginRef.current?.(),
      });
      if (!signedInRef.current || userIdRef.current !== id) return;
      if (rev.current !== seen) return;
      if (result.status === 'ok') {
        acceptCartExchange(localStorage, id, result);
        setCart(readCart(localStorage, id));
      }
    } finally {
      syncing.current = false;
      if (syncAgain.current || rev.current !== seen) {
        syncAgain.current = false;
        if (signedInRef.current && userIdRef.current === id) void runSync();
      }
    }
  }, []);

  useEffect(() => {
    if (!signedIn || !userId) {
      setCart(emptyCart());
      setOpen(false);
      setPartQuote(null);
      seenUser.current = '';
      return undefined;
    }
    if (seenUser.current !== userId) {
      seenUser.current = userId;
      noteCartSignIn();
      rev.current += 1;
      setCart(readCart(localStorage, userId));
    }
    void runSync();
    const onWake = () => { void runSync(); };
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [signedIn, userId, runSync, setPartQuote]);

  const scheduleSync = useCallback(() => {
    const id = userIdRef.current;
    if (!id || cartSyncIsLocalOnly(id)) return;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => { void runSync(); }, 400);
  }, [runSync]);

  const openCart = useCallback(() => {
    const intent = orderIntent({
      signedIn: signedInRef.current,
      pending: pendingRef.current,
    });
    if (intent === 'login') {
      onNeedLoginRef.current?.();
      return;
    }
    if (intent !== 'add') return;
    setOpen(true);
  }, []);

  const closeCart = useCallback(() => setOpen(false), []);

  const clearFlight = useCallback((id) => {
    setFlight((current) => (current && current.id === id ? null : current));
  }, []);

  const orderPart = useCallback((partId) => {
    const intent = orderIntent({
      signedIn: signedInRef.current,
      pending: pendingRef.current,
    });
    if (intent === 'login') {
      onNeedLoginRef.current?.();
      return { ok: false, reason: 'signed-out' };
    }
    if (intent !== 'add') return { ok: false, reason: 'pending' };
    const doc = assemblyRef?.current;
    const scripts = scriptsForOrder(partScriptsRef?.current, liveScriptRef?.current);
    const picked = scriptForRow(doc, scripts, partId);
    if (!picked.ok || !picked.part) {
      return { ok: false, reason: picked.reason || 'missing' };
    }
    const name = String(picked.part.name || '').trim() || 'Part';
    setPartQuote({
      partId: String(picked.part.id),
      part: {
        id: picked.part.id,
        name: picked.part.name,
        surfId: partSurfId(picked.part),
      },
      script: picked.script,
      filename: `${name}.js`,
    });
    return { ok: true, quoting: true };
  }, [assemblyRef, liveScriptRef, partScriptsRef, setPartQuote]);

  const closePartQuote = useCallback(() => setPartQuote(null), [setPartQuote]);

  const commitQuotedLine = useCallback((payload) => {
    const session = partQuoteRef.current;
    if (!signedInRef.current || !userIdRef.current) {
      return { ok: false, reason: 'signed-out' };
    }
    if (!session) return { ok: false, reason: 'closed' };
    const quote = payload?.quote;
    if (!quote?.quoteId || quote.quotedUnitPrice == null || !quote.quotedAt) {
      return { ok: false, reason: 'incomplete-quote' };
    }
    const doc = assemblyRef?.current;
    const script = typeof payload.script === 'string' && payload.script.length
      ? payload.script
      : session.script;
    const options = {
      process: quote.process || payload.process,
      material: quote.material || payload.material,
      infill: quote.infill == null ? payload.infill : quote.infill,
    };
    const draft = makeCartDraft({
      doc,
      part: session.part,
      script,
      thumbDataUrl: thumbForPart(session.partId),
      qty: payload.quantity,
      options,
      quotedUnitPrice: quote.quotedUnitPrice,
      quoteId: quote.quoteId,
      quotedAt: quote.quotedAt,
    });
    const preview = normalizeCart({ version: 0, lines: [draft], tombstones: [] });
    if (!preview.lines[0]?.quoteId) return { ok: false, reason: 'incomplete-quote' };
    const result = addPartLine(readCart(localStorage, userIdRef.current), draft);
    if (!result.ok) return result;
    const stored = result.cart.lines.find((row) => row.lineId === result.lineId);
    if (!stored?.quoteId) return { ok: false, reason: 'incomplete-quote' };
    persist(result.cart);
    scheduleSync();
    const shot = measureFlight(session.partId);
    if (shot) {
      flightSeq.current += 1;
      setFlight({ id: flightSeq.current, ...shot });
    }
    setPartQuote(null);
    return result;
  }, [assemblyRef, persist, scheduleSync, setPartQuote]);

  const changeQty = useCallback((lineId, qty) => {
    if (!signedInRef.current) return;
    persist(setCartQty(readCart(localStorage, userIdRef.current), lineId, qty));
    scheduleSync();
  }, [persist, scheduleSync]);

  const removeLine = useCallback((lineId) => {
    if (!signedInRef.current) return;
    persist(removeCartLine(readCart(localStorage, userIdRef.current), lineId));
    scheduleSync();
  }, [persist, scheduleSync]);

  const noteQuote = useCallback((lineId, quote) => {
    if (!signedInRef.current) return null;
    const next = noteLineQuote(readCart(localStorage, userIdRef.current), lineId, quote);
    persist(next);
    scheduleSync();
    return next;
  }, [persist, scheduleSync]);

  const startCheckout = useCallback(() => {
    const intent = orderIntent({
      signedIn: signedInRef.current,
      pending: pendingRef.current,
    });
    if (intent === 'login') {
      onNeedLoginRef.current?.();
      return { ok: false, reason: 'signed-out' };
    }
    if (intent !== 'add') return { ok: false, reason: 'pending' };
    setPartQuote(null);
    const doc = assemblyRef?.current || null;
    const scripts = scriptsForOrder(partScriptsRef?.current, liveScriptRef?.current);
    const plan = planCheckout(
      doc,
      scripts,
      readCart(localStorage, userIdRef.current),
      partRunsRef?.current,
    );
    if (!plan.payable.length) return { ok: false, reason: 'empty', ...plan };
    setOpen(false);
    onCheckoutRef.current?.(plan);
    return { ok: true, ...plan };
  }, [assemblyRef, liveScriptRef, partRunsRef, partScriptsRef, setPartQuote]);

  const refill = useCallback(() => {
    if (!signedInRef.current) return;
    const current = readCart(localStorage, userIdRef.current);
    const next = refillThumbs(current, thumbsFromFeed());
    if (next === current) return;
    persist(next);
    scheduleSync();
  }, [persist, scheduleSync]);

  const doc = signedIn ? assemblyRef?.current : null;
  const scripts = scriptsForOrder(partScriptsRef?.current, liveScriptRef?.current);
  const stored = signedIn ? cart : emptyCart();
  const lines = presentCartLines(doc, scripts, stored);
  const plan = planCheckout(doc, scripts, stored, partRunsRef?.current);

  return useMemo(() => ({
    count: signedIn ? cartCount(cart) : 0,
    lines,
    checkoutLines: plan.payable,
    checkoutNote: checkoutPageNote(plan),
    open,
    flight,
    partQuote,
    openCart,
    closeCart,
    orderPart,
    closePartQuote,
    commitQuotedLine,
    changeQty,
    removeLine,
    noteQuote,
    refill,
    clearFlight,
    startCheckout,
  }), [
    signedIn,
    cart,
    lines,
    plan,
    open,
    flight,
    partQuote,
    openCart,
    closeCart,
    orderPart,
    closePartQuote,
    commitQuotedLine,
    changeQty,
    removeLine,
    noteQuote,
    refill,
    clearFlight,
    startCheckout,
  ]);
}

export default useCart;
