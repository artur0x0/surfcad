import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import { sanitizeAssemblyName } from '../utils/assembly.js';
import { PARTS_TEXT_INPUT_STYLE } from '../utils/partsChrome.js';

/** Same wait as the CAD feature-sheet long-press. */
export const GROUP_LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 8;

/**
 * One group in the Parts list, drawn like a thread: chevron, name, count,
 * then indented parts joined by a vertical line. Collapse is the caller's
 * state. Actions live on the overflow menu; a long-press opens the same menu.
 */
export default function PartGroupBlock({
  group,
  open = true,
  menuOpen = false,
  editing = false,
  count = 0,
  onToggle,
  onOpenMenu,
  onCloseMenu,
  onStartRename,
  onRename,
  onAction,
  children,
}) {
  const menuBtnRef = useRef(null);
  const pressRef = useRef(null);
  const suppressClickRef = useRef(false);
  const onCloseMenuRef = useRef(onCloseMenu);
  onCloseMenuRef.current = onCloseMenu;
  const [menuPos, setMenuPos] = useState(null);
  const id = group?.id || '';
  const name = group?.name || '';

  const clearPress = () => {
    if (pressRef.current) {
      clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  useEffect(() => () => clearPress(), []);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return undefined;
    }
    const place = () => {
      const rect = menuBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 220;
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      });
    };
    place();
    const onDown = (event) => {
      const target = event.target;
      if (target?.closest?.('[data-part-group-actions],[data-part-group-menu]')) return;
      onCloseMenuRef.current?.();
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

  const openMenuFrom = () => {
    onOpenMenu?.();
  };

  const onPointerDown = (event) => {
    if (editing) return;
    if (event.button != null && event.button !== 0) return;
    if (event.target?.closest?.('[data-part-group-menu],[data-part-group-name-input]')) return;
    clearPress();
    const origin = { x: event.clientX, y: event.clientY };
    const timer = setTimeout(() => {
      pressRef.current = null;
      suppressClickRef.current = true;
      openMenuFrom();
    }, GROUP_LONG_PRESS_MS);
    pressRef.current = { timer, ...origin };
  };

  const onPointerMove = (event) => {
    const press = pressRef.current;
    if (!press) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) {
      clearPress();
    }
  };

  const menu = menuOpen ? (
    <div
      data-part-group-actions=""
      role="menu"
      className="z-50 min-w-[13.5rem] rounded-md border border-gray-600 bg-chrome-surface py-1 shadow-lg"
      style={menuPos ? { position: 'fixed', top: menuPos.top, left: menuPos.left } : { position: 'absolute', right: 8, top: '100%' }}
    >
      <GroupMenuItem action="rename" label="Rename" onAction={onAction} />
      <GroupMenuItem action="ungroup" label="Ungroup" onAction={onAction} />
      <GroupMenuItem action="copy-all" label="Copy all to this assembly" onAction={onAction} />
      <GroupMenuItem action="remove" label="Remove group" danger onAction={onAction} />
    </div>
  ) : null;

  const portaled = menu && menuPos && typeof document !== 'undefined';

  return (
    <div
      data-part-group={id}
      data-part-group-source={group?.source || ''}
      data-part-group-open={open ? 'true' : 'false'}
    >
      <div
        role="button"
        tabIndex={0}
        data-part-group-row=""
        data-part-group-long-press={String(GROUP_LONG_PRESS_MS)}
        aria-expanded={open ? 'true' : 'false'}
        className="relative flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left hover:bg-white/5"
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (editing) return;
          if (event.target?.closest?.('[data-part-group-menu],[data-part-group-name-input]')) return;
          if (event.detail > 1) return;
          onToggle?.();
        }}
        onDoubleClick={(event) => {
          if (event.target?.closest?.('[data-part-group-menu]')) return;
          event.preventDefault();
          event.stopPropagation();
          onStartRename?.();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenuFrom();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle?.();
          }
          if (event.key === 'F2') {
            event.preventDefault();
            onStartRename?.();
          }
        }}
      >
        <span data-part-group-chevron="" className="shrink-0 text-chrome-secondary" aria-hidden="true">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <GroupName
          id={id}
          name={name}
          editing={editing}
          onRename={onRename}
        />
        <span
          data-part-group-count=""
          className="shrink-0 text-[11px] tabular-nums text-chrome-secondary"
        >
          {count}
        </span>
        <button
          ref={menuBtnRef}
          type="button"
          data-part-group-menu=""
          aria-label="Group actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen ? 'true' : 'false'}
          className="ml-auto shrink-0 rounded-full p-1.5 text-chrome-secondary hover:bg-white/10 hover:text-gray-200"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (menuOpen) onCloseMenu?.();
            else onOpenMenu?.();
          }}
        >
          <MoreVertical size={16} />
        </button>
        {menu && !portaled ? menu : null}
      </div>
      {open ? (
        <div className="relative" data-part-group-members="">
          <div
            data-part-group-thread=""
            className="pointer-events-none absolute bottom-2 left-[1.125rem] top-0 w-px bg-gray-300"
            aria-hidden="true"
          />
          <div className="pl-6">
            {children}
          </div>
        </div>
      ) : null}
      {portaled ? createPortal(menu, document.body) : null}
    </div>
  );
}

function GroupMenuItem({ action, label, danger = false, onAction }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-part-group-action={action}
      className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 ${
        danger ? 'text-red-300' : 'text-chrome-text'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onAction?.(action);
      }}
    >
      {label}
    </button>
  );
}

function GroupName({ id, name, editing, onRename }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setDraft(name || '');
      inputRef.current?.select();
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (!editing) return;
    const next = sanitizeAssemblyName(draft);
    onRename?.(id, next && next !== (name || '') ? next : name);
  };

  if (editing) {
    const stop = (event) => event.stopPropagation();
    return (
      <input
        ref={inputRef}
        value={draft}
        draggable={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onClick={stop}
        onDoubleClick={stop}
        onPointerDown={stop}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          if (event.key === 'Escape') { event.preventDefault(); onRename?.(id, name); }
          event.stopPropagation();
        }}
        className="min-w-0 flex-1 truncate rounded border border-blue-400/80 bg-chrome-surface px-1 text-base font-medium text-chrome-text outline-none"
        style={PARTS_TEXT_INPUT_STYLE}
        aria-label="Group name"
        data-part-group-name-input={id}
      />
    );
  }
  return (
    <span data-part-group-name="" className="min-w-0 truncate text-sm font-medium text-chrome-text" title={name}>
      {name}
    </span>
  );
}
