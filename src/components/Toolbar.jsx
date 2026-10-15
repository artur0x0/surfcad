import React from 'react';
import {
  Undo, Redo,
  ArrowLeft, Play, BookOpen, List, SquareDashedBottomCode
} from 'lucide-react';
import { formatGameTime } from '../utils/gamePuzzle';

/**
 * Shared chrome.
 * - CAD (both shells): action bar in the Monaco mid-strip, above the editor.
 *   Desktop used to float a collapsible overlay over the viewport; it now matches
 *   phone, so there is no overlay and no collapse chevron for CAD at all.
 *   Model Upload and Download live on the Parts ribbon. Order is the part-row
 *   cart button. This strip keeps Run, Select all, Undo, and Redo. The CAD
 *   tray is gone. The puzzle is the corner easter egg.
 * - Game: the same strip, rendered inline by CodeEditor (variant="strip"), with an
 *   overlay fallback for any non-strip caller.
 */
const Toolbar = ({
  mode = 'cad',
  variant = 'overlay',
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isExecuting,
  onExitGame,
  onRun,
  /** CAD strip Run — executes the live editor buffer (game uses onRun). */
  onRunScript,
  /** CAD strip Select all — drives the editor through App's ref. */
  onSelectAll,
  onHint,
  onPickPuzzle,
  gameElapsedMs = 0,
  gameSuccess = false,
  gameBestTimeMs = null,
}) => {
  const isGame = mode === 'game';
  const isStrip = variant === 'strip';

  // ── Game mode: back, undo/redo, run, picker, hint (BookOpen only) ──
  // Slice 08: rendered inline in CodeEditor mid-strip (no absolute overlay,
  // no ChevronRight collapse).
  if (isGame) {
    const shellClass = isStrip
      ? 'flex items-center gap-0.5 sm:gap-1 flex-1 min-w-0 overflow-x-auto'
      : 'absolute top-4 left-1/2 -translate-x-1/2 lg:left-auto lg:right-4 lg:translate-x-0 flex items-center gap-1 lg:gap-2 bg-white/60 backdrop-blur-sm p-2 rounded-lg shadow-lg z-10 max-w-[calc(100vw-1rem)]';

    const btnPad = isStrip ? 'p-1.5' : 'p-2';
    const iconSize = isStrip ? 18 : 20;
    // Strip sits on Monaco dark chrome; overlay fallback keeps light frosted bar.
    const backCls = isStrip
      ? 'text-gray-300 hover:bg-chrome-border/60 hover:text-white'
      : 'text-gray-700 hover:bg-gray-100';
    const editCls = isStrip
      ? 'text-blue-400 hover:bg-chrome-border/60'
      : 'text-blue-600 hover:bg-gray-100';
    const runCls = isStrip
      ? 'text-green-400 hover:bg-chrome-border/60'
      : 'text-green-600 hover:bg-gray-100';
    const cyanCls = isStrip
      ? 'text-cyan-400 hover:bg-chrome-border/60'
      : 'text-cyan-700 hover:bg-gray-100';
    const dividerCls = isStrip ? 'w-px bg-gray-600 mx-0.5 self-stretch my-1' : 'w-px bg-gray-300 mx-1';
    const timeCls = gameSuccess
      ? (isStrip ? 'text-emerald-400 font-semibold' : 'text-emerald-700 font-semibold')
      : (isStrip ? 'text-gray-300' : 'text-gray-700');
    const spinBorder = isStrip ? 'border-green-400' : 'border-green-600';

    return (
      <div className={shellClass}>
        <button
          onClick={onExitGame}
          className={`${btnPad} flex items-center gap-1 ${backCls} rounded active:opacity-80`}
          title="Back to CAD"
          data-ui-action="data-game-exit"
        >
          <ArrowLeft size={iconSize} />
        </button>

        <div className={dividerCls} />

        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`${btnPad} flex items-center gap-2 ${editCls} rounded disabled:opacity-30 active:opacity-80`}
          title="Undo"
          data-ui-action="data-game-undo"
        >
          <Undo size={iconSize} />
        </button>

        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`${btnPad} flex items-center gap-2 ${editCls} rounded disabled:opacity-30 active:opacity-80`}
          title="Redo"
          data-ui-action="data-game-redo"
        >
          <Redo size={iconSize} />
        </button>

        <div className={dividerCls} />

        <button
          onClick={onRun}
          disabled={isExecuting}
          className={`${btnPad} flex items-center gap-1 ${runCls} rounded disabled:opacity-50 active:opacity-80`}
          title="Run script"
          data-ui-action="data-game-run"
        >
          {isExecuting ? (
            <div className={`${isStrip ? 'w-4 h-4' : 'w-5 h-5'} border-2 ${spinBorder} border-t-transparent rounded-full animate-spin`} />
          ) : (
            <Play size={iconSize} />
          )}
        </button>

        <span
          className={`px-1 min-w-[3rem] text-center text-[11px] font-mono tabular-nums ${timeCls}`}
          title="Elapsed time (lower is better)"
        >
          {formatGameTime(gameElapsedMs)}
        </span>

        {gameBestTimeMs != null && (
          <span
            className="hidden sm:inline px-1 text-[10px] font-mono tabular-nums text-gray-500"
            title="Best time for this puzzle"
          >
            best {formatGameTime(gameBestTimeMs)}
          </span>
        )}

        <button
          onClick={onPickPuzzle}
          className={`${btnPad} flex items-center gap-1 ${cyanCls} rounded active:opacity-80`}
          title="Switch puzzle"
          data-ui-action="data-game-pick-puzzle"
        >
          <List size={iconSize} />
        </button>

        {/* Slice 07: keep BookOpen as the sole Hint control (removed ⋯ overflow
            that sat next to Hint and felt like a second help entry in playtest).
            CAD Upload/Download remain available after exiting game; Account is the viewport profile chip (G9). */}
        <button
          onClick={onHint}
          className={`${btnPad} flex items-center gap-1 ${cyanCls} rounded active:opacity-80`}
          title="Hint — target code & helpers"
          data-ui-action="data-game-hint"
        >
          <BookOpen size={iconSize} />
        </button>
      </div>
    );
  }

  // CAD (desktop + phone): same mid-strip tokens as the game bar — dark, compact,
  // horizontally scrollable. The strip IS the editor header, not a viewport sheet.
  if (!isGame) {
    const btn = 'shrink-0 p-1.5 flex items-center rounded active:opacity-80 hover:bg-chrome-border/60';
    const icon = 18;
    const blue = 'text-blue-400';
    const divider = 'shrink-0 w-px bg-gray-600 mx-0.5 self-stretch my-1';
    return (
      <div
        className="flex items-center gap-0.5 sm:gap-1 flex-1 min-w-0 overflow-x-auto"
        data-toolbar-variant="strip"
        data-toolbar-chrome="full"
      >
        {/* Run is first and sits in its own section: it is the one button you
            press over and over. Green while idle, spinner while the script
            is executing. */}
        <button
          type="button"
          onClick={onRunScript}
          disabled={isExecuting}
          className={`${btn} text-green-400 disabled:opacity-60`}
          title={isExecuting ? 'Running…' : 'Run script'}
          aria-label="Run script"
          aria-busy={isExecuting}
          data-cad-run={isExecuting ? 'running' : 'idle'}
          data-ui-action="data-cad-run"
        >
          {isExecuting ? (
            <span
              className="w-[18px] h-[18px] border-2 border-green-400 border-t-transparent
                rounded-full animate-spin"
              role="status"
              aria-label="Running"
            />
          ) : (
            <Play size={icon} />
          )}
        </button>
        {/* Select all rides in Run's section, at Run's icon size — it is an
            editor action, not a model I/O one, and it used to sit alone at the
            far end of the strip at a smaller 16px. */}
        <button
          type="button"
          onClick={onSelectAll}
          className={`${btn} ${blue}`}
          title="Select all text in the editor"
          aria-label="Select all text in the editor"
          data-cad-select-all=""
          data-ui-action="data-cad-select-all"
        >
          <SquareDashedBottomCode size={icon} />
        </button>
        <div className={divider} />

        {/* Undo/redo already sit on the CAD feature bar. The editor ribbon
            keeps them too. */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={`${btn} ${blue} disabled:opacity-30`}
          title="Undo"
          data-ui-action="data-cad-undo"
        >
          <Undo size={icon} />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={`${btn} ${blue} disabled:opacity-30`}
          title="Redo"
          data-ui-action="data-cad-redo"
        >
          <Redo size={icon} />
        </button>
      </div>
    );
  }

  return null;
};

export default Toolbar;
