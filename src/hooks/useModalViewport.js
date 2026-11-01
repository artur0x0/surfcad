/**
 * Size an open order-flow sheet to the visible viewport.
 * `visualViewport` tracks the iOS Safari toolbar and the keyboard;
 * the CSS falls back to `100dvh` when this has not run yet.
 * The stylesheet keeps the document from scrolling. This hook does not
 * write overflow or position on html or body: that inline scroll lock is
 * what makes iOS Safari resample the status bar and toolbar, and the
 * sample sticks after the sheet closes. It pins window scroll so a
 * focused field cannot leave scrollY nonzero after the card closes.
 */
import { useEffect } from 'react';

let depth = 0;
let stop = null;

function readViewport() {
  const vv = window.visualViewport;
  const height = vv && vv.height > 0 ? vv.height : window.innerHeight;
  const top = vv && Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0;
  return { height, top };
}

function scrollFieldIntoView(el) {
  // The touch edit view replaces the body. Scrolling that body would fight
  // the saved position the view restores on Done.
  const card = el.closest?.('[data-feature-card]');
  if (card?.hasAttribute('data-feature-field-edit')) return;
  const scroller = el.closest('.overflow-y-auto');
  if (!scroller) return;
  const field = el.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  // A sticky footer that overlaps the scroller (feature card) eats that strip.
  const footer = card?.querySelector('[data-feature-sheet-footer]');
  const footerTop = footer ? footer.getBoundingClientRect().top : box.bottom;
  const overlap = Math.max(0, box.bottom - footerTop);
  const bottomLimit = box.bottom - overlap - 8;
  // Extra 12px of clearance when the control still fits. If that would clip
  // the top of the field, pin the top instead so the focused number stays visible.
  if (field.bottom > bottomLimit) {
    const delta = field.bottom - bottomLimit + 12;
    if (field.top - delta < box.top) scroller.scrollTop += field.top - box.top;
    else scroller.scrollTop += delta;
  } else if (field.top < box.top) {
    scroller.scrollTop -= box.top - field.top;
  }
}

function sheetField(el) {
  if (!el || !el.closest) return null;
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return null;
  if (el.closest('.modal-fit') || el.closest('[data-feature-card]') || el.closest('[data-mold-results-pane]')) return el;
  return null;
}

function focusedField() {
  return sheetField(document.activeElement);
}

function pinDocumentScroll() {
  const scroller = document.scrollingElement || document.documentElement;
  if (!window.scrollX && !window.scrollY && !scroller.scrollTop && !scroller.scrollLeft) return;
  window.scrollTo(0, 0);
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
}

function start() {
  const root = document.documentElement;
  pinDocumentScroll();

  const apply = () => {
    const { height, top } = readViewport();
    root.style.setProperty('--modal-vvh', `${height}px`);
    root.style.setProperty('--modal-vv-top', `${top}px`);
  };
  const onResize = () => {
    apply();
    const el = focusedField();
    if (el) scrollFieldIntoView(el);
  };
  apply();

  const onVvScroll = () => {
    apply();
    pinDocumentScroll();
  };
  const onScroll = () => pinDocumentScroll();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onResize);
  vv?.addEventListener('scroll', onVvScroll);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  const onFocus = (event) => {
    const el = sheetField(event.target);
    if (!el) return;
    requestAnimationFrame(() => scrollFieldIntoView(el));
  };
  document.addEventListener('focusin', onFocus);

  return () => {
    vv?.removeEventListener('resize', onResize);
    vv?.removeEventListener('scroll', onVvScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('focusin', onFocus);
    root.style.removeProperty('--modal-vvh');
    root.style.removeProperty('--modal-vv-top');
    pinDocumentScroll();
  };
}

export function useModalViewport() {
  useEffect(() => {
    if (depth === 0) stop = start();
    depth += 1;
    return () => {
      depth -= 1;
      if (depth === 0 && stop) {
        stop();
        stop = null;
      }
    };
  }, []);
}
