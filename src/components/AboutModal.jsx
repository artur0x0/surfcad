import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { BrandMark } from './brand/BrandWordmark';
import {
  formatSurfcadBuildTime,
  surfcadAboutBuildMeta,
} from '../utils/surfcadBuildInfo.js';

function focusableIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export default function AboutModal({ open = false, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const items = focusableIn(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const { shortCommit, commitUrl, buildTimeIso } = surfcadAboutBuildMeta();
  const builtLabel = formatSurfcadBuildTime(buildTimeIso);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center surface-scrim p-3"
      data-about-modal=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-surfcad-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-xs rounded-lg surface-glass border border-chrome-border shadow-xl"
        data-about-modal-panel=""
      >
        <div className="flex items-center justify-between gap-2 border-b border-chrome-border px-4 py-3">
          <h2 id="about-surfcad-title" className="text-sm font-semibold text-chrome-text">
            About SurfCAD
          </h2>
          <button
            ref={closeRef}
            type="button"
            data-about-modal-close=""
            aria-label="Close"
            className="rounded p-1.5 text-chrome-secondary hover:bg-white/10 hover:text-chrome-text"
            onClick={() => onClose?.()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col items-center px-4 py-5 text-center">
          <BrandMark size={56} />
          <p className="mt-4 text-xs text-chrome-secondary" data-about-build-time="">
            Built {builtLabel}
          </p>
          <p className="mt-2 font-mono text-xs text-chrome-text" data-about-commit="">
            {commitUrl ? (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-300 hover:underline"
                data-about-commit-link=""
              >
                {shortCommit}
              </a>
            ) : (
              <span data-about-commit-unknown="">{shortCommit}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
