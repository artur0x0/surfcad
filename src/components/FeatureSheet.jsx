import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useModalViewport } from '../hooks/useModalViewport';
import { featureSheetBottom, measureFeatureSheetWidth } from '../utils/featureSheetLayout';
import {
  commitFieldValue,
  featureSheetEditLift,
  fieldIsMultiline,
  isTouchEditDevice,
  keyboardField,
  readFieldLabel,
  readFieldUnit,
  readFieldValue,
} from '../utils/featureFieldEdit';

/**
 * Shared feature card. Mode chips, helper sheets, and the edit sheet
 * render inside this. One card, bottom center, on the phone and on desktop.
 *
 * Props:
 * - title, subtitle
 * - onCancel: X, Esc, and the rail X. Writes nothing.
 * - onConfirm: saves and closes. Omit it when the card has nothing to write
 *   (the standalone edge card). No swipe-to-dismiss.
 * - confirmDisabled
 * - confirmLabel (default Confirm)
 * - children: scrolling body
 * - footer: sticky blocks above the confirm row (Add/Subtract, Merge, Delete)
 * - note: node on the left of Confirm
 * - compact: phone. The card bottom docks to the hidden stage switcher.
 *   Desktop when false (10px, no switcher to hide).
 * - fullLeft: the left helper rail is not in the pane. The left edge is the
 *   10px pane inset. The right edge stays clear of the right rail. Fillet,
 *   chamfer, shell, draft, move face, delete face, cut, move, boolean, paint,
 *   and Analyze pass this, on phone and desktop. The sheet metal picker,
 *   feature edit, and any card whose left rail is still there leave this
 *   false and stay centered between both rails.
 * - headerExtra: a node in the header, between the title and X. Measure
 *   puts the mm|in toggle there. Other cards leave it empty.
 * - bodyAttrs / cardAttrs: extra data attributes for the pilot that owns the card
 * - onKeyboardDone: after Done or Enter commits a focused field, when
 *   confirm is enabled. Blur does not call it.
 *
 * The card is pointer-events-auto and stops pointerdown. The pane around it
 * is not covered, so orbit and pinch hit the canvas. Game mode does not mount it.
 *
 * On a touch device, a focused keyboard field switches the card to a
 * one-field edit view parked on the visual viewport. That is an input of
 * type text, number, search, email, url, tel, or password, or a textarea
 * or contenteditable. Selects, sliders, checkboxes, and buttons do not.
 * Desktop pointer input keeps the full card.
 *
 * Blur commits the field and restores the card. Done and Enter do that
 * too, then call onKeyboardDone when the card's confirm is enabled.
 * Dimension and Constrain pass that so create Adds and edit Confirms.
 * Other cards omit it, and Done only commits.
 */
const EDIT_INPUT_TYPES = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

function eventKeyboardField(event) {
  const target = event.target;
  const el = target && target.nodeType === 3 ? target.parentElement : target;
  return keyboardField(el);
}

function FieldEditRow({ edit, onChange, onCommit }) {
  const inputRef = useRef(null);
  const multiline = !!edit.multiline;
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch { /* number inputs can refuse */ }
  }, [edit.el]);

  const onKeyDown = (event) => {
    if (event.key !== 'Enter' || multiline) return;
    event.preventDefault();
    onCommit('enter');
  };
  const shared = {
    ref: inputRef,
    'data-feature-field-edit-input': '',
    value: edit.value,
    'aria-label': edit.label || 'Value',
    onChange: (event) => onChange(event.target.value),
    onBlur: (event) => {
      const next = event.relatedTarget;
      if (next?.closest?.('[data-feature-field-done]')) return;
      onCommit('blur');
    },
    onKeyDown,
    className: 'min-h-[44px] min-w-0 flex-1 rounded border border-gray-600/80 bg-gray-950/70 px-2 py-2 text-white',
  };

  return (
    <div
      data-feature-field-edit-view=""
      className="flex items-end gap-2 px-3 pb-2 pt-1"
      onPointerDown={(event) => {
        const target = event.target;
        if (target.closest?.('[data-feature-field-edit-input]')) return;
        if (target.closest?.('[data-feature-field-done]')) return;
        event.preventDefault();
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          data-feature-field-label=""
          className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-300"
        >
          {edit.label || 'Value'}
        </span>
        <span className="flex items-center gap-2">
          {multiline ? (
            <textarea {...shared} rows={3} className={`${shared.className} resize-none`} />
          ) : (
            <input
              {...shared}
              type={EDIT_INPUT_TYPES.has(edit.inputType) ? edit.inputType : 'text'}
              inputMode={edit.inputMode || undefined}
              min={edit.min || undefined}
              max={edit.max || undefined}
              step={edit.step || undefined}
            />
          )}
          {edit.unit ? (
            <span data-feature-field-unit="" className="shrink-0 text-[13px] text-gray-300">
              {edit.unit}
            </span>
          ) : null}
        </span>
      </label>
      <button
        type="button"
        data-feature-field-done=""
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onCommit('done')}
        className="inline-flex min-h-[44px] shrink-0 items-center rounded-md bg-cyan-600 px-3 text-[13px] font-medium text-white hover:bg-cyan-500"
      >
        Done
      </button>
    </div>
  );
}

export default function FeatureSheet({
  title,
  subtitle = '',
  onCancel,
  onConfirm,
  confirmDisabled = false,
  confirmLabel = 'Confirm',
  children,
  footer = null,
  note = null,
  compact = false,
  fullLeft = false,
  headerExtra = null,
  bodyAttrs = null,
  cardAttrs = null,
  onKeyboardDone = null,
}) {
  useModalViewport();
  const cardRef = useRef(null);
  const bodyRef = useRef(null);
  const editRef = useRef(null);
  const scrollMemoryRef = useRef(null);
  const restoreScrollRef = useRef(null);
  const [frame, setFrame] = useState(null);
  const [overflow, setOverflow] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const [thumb, setThumb] = useState(null);
  const [edit, setEdit] = useState(null);
  const [lift, setLift] = useState(0);
  const editing = edit != null;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    const card = cardRef.current;
    const pane = card?.closest('.viewport-shell') || card?.offsetParent;
    if (!pane) return undefined;
    const measure = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setFrame(measureFeatureSheetWidth(pane, root, { fullLeft }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    const left = pane.querySelector('[data-rail-pair="left"]');
    const right = pane.querySelector('[data-rail-pair="right"]');
    if (left) ro.observe(left);
    if (right) ro.observe(right);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fullLeft]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => {
      const extra = el.scrollHeight - el.clientHeight;
      const over = extra > 1;
      setOverflow(over);
      setMoreBelow(over && el.scrollTop < extra - 2);
      if (!over) {
        setThumb(null);
        return;
      }
      const ratio = el.clientHeight / el.scrollHeight;
      const thumbH = Math.max(24, el.clientHeight * ratio);
      const maxTop = Math.max(0, el.clientHeight - thumbH);
      const top = extra > 0 ? (el.scrollTop / extra) * maxTop : 0;
      setThumb({ height: thumbH, top });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [children, footer, title, subtitle]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const rememberScroll = (event) => {
      const field = eventKeyboardField(event);
      if (!field || !isTouchEditDevice()) return;
      scrollMemoryRef.current = {
        el: field,
        top: bodyRef.current ? bodyRef.current.scrollTop : 0,
      };
    };
    const onFocus = (event) => {
      const field = eventKeyboardField(event);
      if (!field || !card.contains(field) || !isTouchEditDevice()) return;
      const saved = scrollMemoryRef.current;
      scrollMemoryRef.current = null;
      const scrollTop = saved && saved.el === field
        ? saved.top
        : (bodyRef.current ? bodyRef.current.scrollTop : 0);
      const next = {
        el: field,
        label: readFieldLabel(field),
        unit: readFieldUnit(field),
        value: readFieldValue(field),
        multiline: fieldIsMultiline(field),
        inputType: String(field.getAttribute('type') || 'text').toLowerCase(),
        inputMode: field.getAttribute('inputmode') || '',
        min: field.getAttribute('min'),
        max: field.getAttribute('max'),
        step: field.getAttribute('step'),
        scrollTop,
      };
      editRef.current = next;
      setEdit(next);
    };
    card.addEventListener('pointerdown', rememberScroll);
    card.addEventListener('focusin', onFocus);
    return () => {
      card.removeEventListener('pointerdown', rememberScroll);
      card.removeEventListener('focusin', onFocus);
    };
  }, []);

  useLayoutEffect(() => {
    if (!editing) return undefined;
    const card = cardRef.current;
    const pane = card?.closest('.viewport-shell') || card?.offsetParent || card?.parentElement;
    if (!pane) return undefined;
    const apply = () => {
      const vv = window.visualViewport;
      setLift(featureSheetEditLift({
        paneBottom: pane.getBoundingClientRect().bottom,
        docTop: document.documentElement.getBoundingClientRect().top,
        scrollY: window.scrollY || window.pageYOffset || 0,
        vvHeight: vv?.height ?? window.innerHeight,
        vvOffsetTop: vv?.offsetTop ?? 0,
      }));
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    // The phone shell pins itself to the visual viewport after that event.
    // Measuring only in the event sees the old pane and lifts the card off
    // the top. The pane resize is the settled size.
    const ro = new ResizeObserver(apply);
    ro.observe(pane);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      ro.disconnect();
    };
  }, [editing]);

  useLayoutEffect(() => {
    if (editing) return undefined;
    if (restoreScrollRef.current == null) return undefined;
    const top = restoreScrollRef.current;
    restoreScrollRef.current = null;
    let frames = 0;
    let raf = 0;
    const apply = () => {
      const body = bodyRef.current;
      if (!body) return;
      body.scrollTop = top;
      // The keyboard may still be closing, so the body is short and clamps.
      // Keep the saved position until the card is tall enough to hold it.
      if (Math.abs(body.scrollTop - top) > 1 && frames < 20) {
        frames += 1;
        raf = requestAnimationFrame(apply);
      }
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    const stop = window.setTimeout(() => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
    }, 800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stop);
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
    };
  }, [editing]);

  const commitEdit = (reason) => {
    const current = editRef.current;
    if (!current) return;
    editRef.current = null;
    commitFieldValue(current.el, current.value);
    restoreScrollRef.current = current.scrollTop;
    setEdit(null);
    if ((reason === 'done' || reason === 'enter') && !confirmDisabled) onKeyboardDone?.();
  };

  const changeEdit = (value) => {
    const current = editRef.current;
    if (!current) return;
    const next = { ...current, value };
    editRef.current = next;
    setEdit(next);
    commitFieldValue(current.el, value);
  };

  const bottomCss = featureSheetBottom(compact);
  const placed = !!(frame && frame.width > 0);
  const stop = (event) => event.stopPropagation();

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={title || 'Feature'}
      data-feature-card=""
      data-feature-card-compact={compact ? '1' : '0'}
      {...(fullLeft ? { 'data-feature-card-full-left': '1' } : null)}
      {...(editing ? { 'data-feature-field-edit': '' } : null)}
      className={`feature-sheet-card pointer-events-auto absolute z-20 flex min-h-0 flex-col overflow-hidden
        rounded-xl border border-gray-500/50 text-white shadow-lg surface-glass-chip
        ${placed ? '' : 'left-1/2 w-[min(22rem,calc(100%-9.5rem))] -translate-x-1/2'}`}
      style={{
        bottom: editing ? `${lift}px` : bottomCss,
        '--feature-sheet-bottom': editing ? `${lift}px` : bottomCss,
        ...(placed ? { left: `${frame.left}px`, width: `${frame.width}px`, transform: 'none' } : null),
      }}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      {...cardAttrs}
    >
      <div className="flex shrink-0 items-start gap-2 px-3 pb-1 pt-2" data-feature-sheet-header="">
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-sm font-semibold text-white" data-feature-card-title="">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-0.5 font-sans text-[11px] text-gray-300" data-feature-card-subtitle="">
              {subtitle}
            </div>
          ) : null}
        </div>
        {headerExtra ? (
          <div className="shrink-0" data-feature-sheet-header-extra="">
            {headerExtra}
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Cancel"
          title="Cancel"
          data-feature-card-cancel=""
          onPointerDown={() => {
            if (editRef.current) onCancel?.();
          }}
          onClick={() => onCancel?.()}
          className="shrink-0 rounded-md p-1.5 text-gray-300 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
      {edit ? (
        <FieldEditRow edit={edit} onChange={changeEdit} onCommit={commitEdit} />
      ) : null}
      <div
        className="relative flex min-h-0 flex-auto flex-col"
        hidden={editing ? true : undefined}
        style={editing ? { display: 'none' } : undefined}
      >
        <div
          ref={bodyRef}
          className="feature-sheet-scroll min-h-0 flex-auto overflow-y-auto px-3 pb-1"
          data-feature-sheet-body=""
          {...bodyAttrs}
        >
          {children}
        </div>
        {overflow && thumb ? (
          <div
            className="pointer-events-none absolute bottom-1 right-1 top-1 w-2 rounded-full bg-gray-500/25"
            data-feature-sheet-scrollbar=""
            aria-hidden="true"
          >
            <div
              className="absolute left-0 w-2 rounded-full bg-gray-500/45"
              style={{ height: `${thumb.height}px`, top: `${thumb.top}px` }}
            />
          </div>
        ) : null}
        {moreBelow ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-center bg-gradient-to-t from-gray-900/80 to-transparent"
            data-feature-sheet-scroll-hint=""
            aria-hidden="true"
          >
            <ChevronDown size={14} className="mb-0.5 text-gray-200" />
          </div>
        ) : null}
      </div>
      {!editing && (footer || note || onConfirm) ? (
        // pt-4 is the shared gap above Delete/Confirm. The fillet link row
        // and every other card on this shell use it instead of a per-card margin.
        <div
          className={`shrink-0 px-3 pt-4 ${compact ? '' : 'pb-2'}`}
          style={compact
            ? { paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }
            : undefined}
          data-feature-sheet-footer=""
        >
          {footer}
          {(note || onConfirm) ? (
            <div className={`flex items-center justify-between gap-2 ${footer ? 'mt-2' : ''}`}>
              <div className="min-w-0 text-[11px] leading-tight text-gray-300">{note}</div>
              {onConfirm ? (
                <button
                  type="button"
                  onClick={() => onConfirm()}
                  disabled={confirmDisabled}
                  data-feature-card-confirm=""
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-cyan-600 px-2 py-1
                    text-[13px] font-medium text-white hover:bg-cyan-500 active:bg-cyan-400
                    disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check size={14} />
                  {confirmLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
