import React from 'react';
import { PAINT_SWATCHES, parsePaintHex, resolvedPaintColor } from '../utils/facePaint';
import FeatureSheet from './FeatureSheet';

/**
 * Paint on the shared feature card.
 * A tap paints immediately. Confirm writes the session. X and Esc write
 * nothing. The button that opens it lives on the right rail
 * (`data-paint-chip`). Game mode does not mount this card.
 */
export function PaintModeChip({
  compact = false,
  color = null,
  custom = '',
  canUndo = false,
  canClear = false,
  canConfirm = false,
  unmatched = 0,
  onSwatch,
  onCustom,
  onPart,
  onUndo,
  onClear,
  onConfirm,
  onDismiss,
  onRemoveUnmatched,
}) {
  const typed = typeof custom === 'string' ? custom.trim() : '';
  const resolved = resolvedPaintColor(color, custom);
  const customInvalid = typed !== '' && !parsePaintHex(typed);

  return (
    <FeatureSheet
      title="Paint"
      subtitle="Tap a face. Double-tap paints the body."
      compact={compact}
      fullLeft
      onCancel={onDismiss}
      onConfirm={onConfirm}
      confirmDisabled={!canConfirm}
      cardAttrs={{
        'data-paint-mode': '1',
        'data-paint-confirm': canConfirm ? 'enabled' : 'disabled',
        'data-ui-action': 'data-paint-mode-chip',
      }}
      note={(
        <span
          className="inline-block h-4 w-4 rounded-full border border-white/40"
          data-paint-preview=""
          style={{ background: resolved || 'transparent' }}
        />
      )}
    >
      <div className="mt-1.5 flex flex-col gap-1.5 font-sans">
        <div
          className={compact
            ? 'grid w-fit grid-cols-4 gap-1.5 p-1'
            : 'flex flex-wrap gap-1.5 p-1'}
          role="group"
          aria-label="Swatches"
          data-paint-swatches=""
        >
          {PAINT_SWATCHES.map((hex) => {
            const on = !typed && color === hex;
            return (
              <button
                key={hex}
                type="button"
                data-paint-swatch={hex}
                aria-pressed={on}
                aria-label={hex}
                title={hex}
                onClick={() => onSwatch?.(hex)}
                className={`h-7 w-7 shrink-0 rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                  on ? 'border-white ring-2 ring-cyan-200' : 'border-white/40'
                }`}
                style={{ background: hex }}
              />
            );
          })}
        </div>

        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-gray-300">Hex</span>
          <input
            data-paint-hex=""
            value={custom}
            onChange={(event) => onCustom?.(event.target.value.toLowerCase())}
            placeholder="#rrggbb"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Custom hex color"
            aria-invalid={customInvalid}
            className={`min-w-0 flex-1 rounded border bg-gray-950/50 px-2 py-1 font-mono text-base text-white ${
              customInvalid ? 'border-red-400/80' : 'border-gray-600'
            }`}
          />
        </label>

        <div className="flex gap-1 flex-wrap" role="group" aria-label="Paint target">
          <button
            type="button"
            data-paint-part=""
            onClick={() => onPart?.()}
            className="px-2.5 py-1 rounded text-[13px] bg-cyan-600 text-white"
            title="Paint the whole part"
          >
            Part
          </button>
          <button
            type="button"
            data-paint-undo=""
            onClick={() => onUndo?.()}
            disabled={!canUndo}
            className={`px-2.5 py-1 rounded text-[13px] underline ${
              canUndo ? 'text-cyan-300' : 'text-gray-500 cursor-not-allowed'
            }`}
            title="Step back one paint"
          >
            Undo
          </button>
          <button
            type="button"
            data-paint-clear=""
            onClick={() => onClear?.()}
            disabled={!canClear}
            className={`px-2.5 py-1 rounded text-[13px] underline ${
              canClear ? 'text-cyan-300' : 'text-gray-500 cursor-not-allowed'
            }`}
            title="Remove the paints from this session"
          >
            Clear
          </button>
        </div>

        {unmatched > 0 && (
          <button
            type="button"
            data-paint-unmatched=""
            onClick={() => onRemoveUnmatched?.()}
            className="self-start text-[11px] text-gray-300 underline"
            title="Drop saved face colors on this part that no longer match one face"
          >
            Remove unmatched colors
          </button>
        )}
      </div>
    </FeatureSheet>
  );
}
