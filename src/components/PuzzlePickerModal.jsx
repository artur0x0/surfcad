import React from 'react';
import { X, Puzzle, Clock } from 'lucide-react';
import { listPuzzles, formatGameTime } from '../utils/gamePuzzle';
import { getBestTimeMs } from '../utils/gameWins';

const DIFF_COLOR = {
  easy: 'text-emerald-400',
  medium: 'text-amber-400',
  hard: 'text-rose-400',
};

/**
 * Mobile-friendly puzzle picker (~bottom sheet on small screens).
 * Selecting a puzzle calls onSelect(puzzle) — parent loads ghost + blanks editor.
 */
const PuzzlePickerModal = ({
  onClose,
  onSelect,
  currentPuzzleId = null,
  loading = false,
}) => {
  const puzzles = listPuzzles();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center surface-scrim p-3">
      <div
        role="dialog"
        aria-labelledby="puzzle-picker-title"
        className="w-full max-w-md max-h-[85dvh] overflow-hidden flex flex-col rounded-lg surface-glass border border-chrome-border shadow-xl"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-chrome-border shrink-0">
          <div className="flex items-center gap-2 text-white">
            <Puzzle size={18} className="text-cyan-400" />
            <h2 id="puzzle-picker-title" className="font-semibold text-sm">
              Choose a puzzle
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-chrome-secondary hover:text-white hover:bg-gray-800"
            title="Close"
            disabled={loading}
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-2">
          {puzzles.map((p) => {
            const best = getBestTimeMs(p.id);
            const active = p.id === currentPuzzleId;
            return (
              <button
                key={p.id}
                type="button"
                disabled={loading}
                onClick={() => onSelect(p)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-cyan-500/70 bg-cyan-950/40'
                    : 'border-chrome-border bg-gray-850/40 hover:border-gray-500 hover:bg-gray-800/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{p.title}</div>
                    <div className="text-[11px] text-chrome-secondary mt-0.5 line-clamp-2">{p.blurb}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    {p.difficulty && (
                      <div className={`text-[10px] uppercase tracking-wide ${DIFF_COLOR[p.difficulty] || 'text-gray-500'}`}>
                        {p.difficulty}
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-1 text-[11px] font-mono tabular-nums text-gray-300">
                      <Clock size={11} className="text-gray-500" />
                      {best != null ? formatGameTime(best) : '—'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-gray-800 text-[11px] text-gray-500 shrink-0">
          Blank editor · match the grey ghost · lower time is better
        </div>
      </div>
    </div>
  );
};

export default PuzzlePickerModal;
