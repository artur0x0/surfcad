import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import Editor from '@monaco-editor/react';
import { ArrowLeft } from 'lucide-react';
import Toolbar from './Toolbar';
import ProfileChip from './ProfileChip';
import { composeHelperInsert } from '../utils/helperPaletteSnippets';
import { wrapRawScript } from '../utils/wrapRawScript';

// "Select All" in the (long-press) context menu. Monaco 0.52 removed
// registerEditorAction from the public API, so we use the internal
// EditorAction class (same pattern Monaco's own contextmenu contribution
// uses) — this registers a command + the menu item in one shot.
import { EditorAction, registerEditorAction } from 'monaco-editor/esm/vs/editor/browser/editorExtensions.js';

let selectAllMenuRegistered = false;
function registerSelectAllMenu() {
  if (selectAllMenuRegistered) return;
  selectAllMenuRegistered = true;
  class SelectAllAction extends EditorAction {
    constructor() {
      super({
        id: 'surfcad.selectAll',
        label: 'Select All',
        contextMenuOpts: { group: '2_cutcopypaste' },
      });
    }
    run(accessor, editor) {
      editor.focus();
      editor.trigger('menu', 'editor.action.selectAll', null);
    }
  }
  registerEditorAction(SelectAllAction);
}

const CodeEditor = forwardRef(({ 
  initialScript,
  onExecute, 
  onCodeChange,
  /**
   * Called with the boot script when Monaco mounts. Return false to skip
   * the initial run and the "Initial script" history step (a remount).
   * Omitted means seed, which is the first-mount behavior.
   */
  onEditorSeed = null,
  isMobile,
  // Slice 08: action bar lives in this mid-strip (between Monaco and the
  // viewport on the mobile stack; Monaco header on desktop). Game renders its
  // strip inline. Mobile CAD portals the same strip into `onCadToolbarHost`
  // so download/export state can stay in Viewport.
  mode = 'cad',
  onExitGame,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  isExecuting = false,
  onRun,
  onHint,
  onPickPuzzle,
  gameElapsedMs = 0,
  gameSuccess = false,
  gameBestTimeMs = null,
  onCadToolbarHost = null,
  /** Right padding on Monaco only (Script-stage strip overlay); ribbon stays w-full. */
  monacoEndPadClassName = '',
  /** Same profile chip as CAD / Parts — right of Script toolbar. */
  onSignedOut = null,
  onClearLocalCadData = null,
  profileVaultName = null,
  agentBridgeLive = false,
  onAccount = null,
  /** False while the CAD drawer/sheet is closed. Monaco stays mounted. */
  shown = true,
  /** Back to the CAD view. Omitted in the puzzle. */
  onClose = null,
}, ref) => {
  const [editorValue, setEditorValue] = useState(initialScript);
  const editorRef = useRef(null);
  const valueRef = useRef(initialScript);
  const historyTimeoutRef = useRef(null);
  const programmaticValueRef = useRef(null);
  /** True while insertAtCursor runs executeEdits (sync onChange must not double-fire). */
  const paletteInsertRef = useRef(false);
  const isGame = mode === 'game';
  // Both shells host the CAD strip now — desktop moved its buttons above the editor.
  const showCadStrip = !isGame && typeof onCadToolbarHost === 'function';

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getContent: () => valueRef.current,
    /** Select-all now lives in the CAD strip next to Run, so App drives it. */
    selectAll: () => selectAll(),
    
    loadContent: (content, message = 'Content loaded', addToHistory = true) => {
      // Cancel any pending history timeout
      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
      }
      
      // Mark this value as programmatic so handleEditorChange ignores it
      programmaticValueRef.current = content;
      
      // Update state and ref
      valueRef.current = content;
      setEditorValue(content);
      
      onExecute(content, true);
      
      // Optionally add to history
      if (addToHistory) {
        onCodeChange?.(content, message);
      }
    },

    // Update the text WITHOUT re-executing. Used by the headless review loop so the
    // editor shows the exact source that produced the picture on screen. Deliberately
    // not loadContent(): that fires onExecute, which would re-run what we just ran.
    //
    // No-op when the buffer already holds this exact source. Compared against the live
    // model rather than the cached valueRef so a debounced manual edit that has not
    // flushed yet cannot trick us into a redundant write (which would disturb the cursor,
    // scroll position, and Monaco's undo stack for no reason).
    // Returns true if it wrote, false if it declined as already-current.
    setTextOnly: (content) => {
      if (typeof content !== 'string') return false;
      const current = editorRef.current ? editorRef.current.getValue() : valueRef.current;
      if (current === content) return false;          // already what we wanted: nothing to do

      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
      }
      programmaticValueRef.current = content;   // so handleEditorChange ignores this write
      valueRef.current = content;
      setEditorValue(content);
      editorRef.current?.setValue(content);
      return true;
    },

    /**
     * Slice 09: insert text at the Monaco cursor (replaces selection if any).
     * Syncs React state, triggers execute + history. Returns true on success.
     * Prefer insertHelper for palette taps (template-aware full compose).
     */
    insertAtCursor: (text) => {
      if (typeof text !== 'string' || text.length === 0) return false;
      const ed = editorRef.current;

      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
      }

      if (ed) {
        const selection = ed.getSelection();
        const range = selection
          || { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
        paletteInsertRef.current = true;
        try {
          ed.executeEdits('helper-palette', [{
            range,
            text,
            forceMoveMarkers: true,
          }]);
          const content = ed.getValue();
          valueRef.current = content;
          setEditorValue(content);
          onExecute(content);
          onCodeChange?.(content, 'Helper insert');
          try {
            const pos = ed.getPosition();
            if (pos) ed.revealPositionInCenter(pos);
            ed.focus();
          } catch { /* ignore */ }
          return true;
        } finally {
          paletteInsertRef.current = false;
        }
      }

      const current = valueRef.current || '';
      const content = current.trim()
        ? `${current}${current.endsWith('\n') ? '' : '\n'}${text}`
        : text;
      programmaticValueRef.current = content;
      valueRef.current = content;
      setEditorValue(content);
      onExecute(content);
      onCodeChange?.(content, 'Helper insert');
      return true;
    },

    /**
     * Slice 09/10/11/12: template-aware helper insert at caret with optional params,
     * faceContext, and edgeContext (selected edges for fillet/chamfer).
     * Returns true on success. Caller (game) may Auto-Run after.
     */
    insertHelper: (helperId, params = null, faceContext = null, edgeContext = null, insertAt = undefined) => {
      if (!helperId) return false;

      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
      }

      const ed = editorRef.current;
      let buffer = ed ? ed.getValue() : (valueRef.current || '');
      let caretOffset = null;
      const useBar = typeof insertAt === 'number' && Number.isFinite(insertAt);

      if (!useBar && ed) {
        const model = ed.getModel();
        const sel = ed.getSelection();
        if (model && sel) {
          const start = model.getOffsetAt(sel.getStartPosition());
          const end = model.getOffsetAt(sel.getEndPosition());
          if (start !== end) {
            buffer = buffer.slice(0, start) + buffer.slice(end);
          }
          caretOffset = start;
        } else if (model) {
          const pos = ed.getPosition();
          if (pos) caretOffset = model.getOffsetAt(pos);
        }
      }

      const content = composeHelperInsert(
        buffer,
        helperId,
        useBar ? insertAt : caretOffset,
        params,
        faceContext,
        edgeContext,
      );
      if (typeof content !== 'string') return false;

      if (ed) {
        const model = ed.getModel();
        const range = model
          ? model.getFullModelRange()
          : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
        paletteInsertRef.current = true;
        try {
          ed.executeEdits('helper-palette', [{
            range,
            text: content,
            forceMoveMarkers: true,
          }]);
          valueRef.current = content;
          setEditorValue(content);
          onExecute(content);
          onCodeChange?.(content, 'Helper insert');
          try {
            const m = ed.getModel();
            const match = /(?:\r?\n)?return\s+part\s*;\s*$/.exec(content);
            if (match && m) {
              const pos = m.getPositionAt(match.index);
              ed.setPosition(pos);
              ed.revealPositionInCenter(pos);
            }
            ed.focus();
          } catch { /* ignore */ }
          return true;
        } finally {
          paletteInsertRef.current = false;
        }
      }

      programmaticValueRef.current = content;
      valueRef.current = content;
      setEditorValue(content);
      onExecute(content);
      onCodeChange?.(content, 'Helper insert');
      return true;
    },

    /**
     * Slice 24: write a precomposed buffer (contour-mode Profile confirm/update).
     * Does not Auto-Run — caller decides. Same Monaco write path as insertHelper.
     */
    applyBuffer: (content, message = 'Contour profile') => {
      if (typeof content !== 'string') return false;

      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
      }

      const ed = editorRef.current;
      if (ed) {
        const model = ed.getModel();
        const range = model
          ? model.getFullModelRange()
          : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
        paletteInsertRef.current = true;
        try {
          ed.executeEdits('contour-profile', [{
            range,
            text: content,
            forceMoveMarkers: true,
          }]);
          valueRef.current = content;
          setEditorValue(content);
          onExecute(content);
          onCodeChange?.(content, message);
          try {
            const m = ed.getModel();
            const match = /(?:\r?\n)?return\s+part\s*;\s*$/.exec(content);
            if (match && m) {
              const pos = m.getPositionAt(match.index);
              ed.setPosition(pos);
              ed.revealPositionInCenter(pos);
            }
          } catch { /* ignore */ }
          return true;
        } catch {
          // A closed drawer still mounts Monaco. If the edit cannot land,
          // the buffer below is the write getContent and the part save see.
        } finally {
          paletteInsertRef.current = false;
        }
      }

      programmaticValueRef.current = content;
      valueRef.current = content;
      setEditorValue(content);
      onExecute(content);
      onCodeChange?.(content, message);
      return true;
    },

    /**
     * Slice Mobile B — jump caret + selection to a marked feature range
     * (offsets into the full buffer). Used by the Script-stage feature strip.
     */
    revealRange: (startOffset, endOffset) => {
      const ed = editorRef.current;
      if (!ed) return false;
      const model = ed.getModel();
      if (!model) return false;
      const len = model.getValueLength();
      const a = Math.max(0, Math.min(len, Number(startOffset) || 0));
      const b = Math.max(a, Math.min(len, Number(endOffset) || a));
      try {
        const start = model.getPositionAt(a);
        const end = model.getPositionAt(b);
        const range = {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
        ed.setSelection(range);
        ed.revealRangeInCenter(range);
        ed.focus();
        return true;
      } catch {
        return false;
      }
    },
  }));

  const handleEditorChange = (newValue) => {
    // Always sync state and ref
    valueRef.current = newValue;
    setEditorValue(newValue);

    // Palette insert owns execute + history (executeEdits fires this sync).
    if (paletteInsertRef.current) {
      return;
    }

    onExecute(newValue);
    
    // If this change came from loadContent, skip history handling
    if (programmaticValueRef.current === newValue) {
      programmaticValueRef.current = null;
      return;
    }
    programmaticValueRef.current = null;
    
    // Debounced history for manual edits
    if (historyTimeoutRef.current) {
      clearTimeout(historyTimeoutRef.current);
    }
    
    historyTimeoutRef.current = setTimeout(() => {
      onCodeChange?.(newValue, 'Manual edit');
      historyTimeoutRef.current = null;
    }, 1000);
  };

  const editorDidMount = (editor, monaco) => {
    editorRef.current = editor;

    // iOS Safari: programmatic focus on mount marks the editor focused
    // without opening the soft keyboard, so the first user tap is a no-op.
    // Only auto-focus on fine pointers; on touch, focus inside the gesture.
    const coarse = typeof window !== 'undefined'
      && !!window.matchMedia?.('(pointer: coarse)').matches;
    if (shown && !coarse && !isMobile) {
      editor.focus();
    } else {
      const dom = editor.getDomNode();
      const focusFromGesture = () => {
        editor.focus();
        const ta = dom?.querySelector?.('textarea.inputarea');
        if (ta && document.activeElement !== ta) {
          try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
        }
      };
      // touchend stays within the user-gesture window on iOS; click covers pencil/mouse.
      dom?.addEventListener('touchend', focusFromGesture, { passive: true });
      dom?.addEventListener('click', focusFromGesture);
      editor.onDidDispose(() => {
        dom?.removeEventListener('touchend', focusFromGesture);
        dom?.removeEventListener('click', focusFromGesture);
      });
    }

    // Add "Select All" to the editor context menu (once).
    // Never let an optional menu feature crash the mount.
    try {
      registerSelectAllMenu();
    } catch (err) {
      console.warn('[CodeEditor] Select All menu registration failed', err);
    }

    // Guarantee Select-All works even if a parent element swallows
    // Ctrl/Cmd+A (e.g. mobile webview).
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA,
      () => {
        editor.focus();
        editor.trigger('keybinding', 'editor.action.selectAll', null);
      }
    );

    editor.onDidPaste(() => {
      const content = editor.getValue();
      const next = wrapRawScript(content);
      if (next === content) return;
      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
      }
      programmaticValueRef.current = next;
      valueRef.current = next;
      setEditorValue(next);
      editor.setValue(next);
      onExecute(next);
      onCodeChange?.(next, 'Paste');
    });

    // First mount seeds the undo stack and builds the boot script. A remount
    // (mobile layout, drawer) keeps the live step — pushing the boot script
    // here used to make the next undo restore the wrong commit.
    const seed = typeof onEditorSeed === 'function'
      ? onEditorSeed(valueRef.current) !== false
      : true;
    if (seed) {
      onExecute(valueRef.current, true);
      onCodeChange?.(valueRef.current, 'Initial script');
    }
  };

  // The easy select-all: keyboard-only flow isn't discoverable on mobile.
  const selectAll = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    ed.trigger('select-all', 'editor.action.selectAll', null);
  };

  useEffect(() => {
    return () => {
      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
      }
    };
  }, []);

  // Opening the drawer/sheet gives Monaco a real box again. Layout, then focus.
  useEffect(() => {
    if (!shown) return undefined;
    const ed = editorRef.current;
    if (!ed) return undefined;
    try { ed.layout(); } catch { /* hidden mount has no box yet */ }
    if (!isMobile) {
      try { ed.focus(); } catch { /* ignore */ }
    }
    return undefined;
  }, [shown, isMobile]);

  useEffect(() => {
    if (!shown || typeof onClose !== 'function') return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, onClose]);

  const options = {
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: 'off',
    scrollBeyondLastLine: false,
    fontSize: isMobile ? 16 : 12,
    renderLineHighlight: 'all',
    formatOnPaste: true,
    contextmenu: true,
    wordWrap: 'on',
    quickSuggestions: false,
  };

  return (
    <div className="relative flex flex-col h-full bg-chrome-surface">
      {/* Mid-strip: Select All always. Game actions inline; CAD portals here (both shells). */}
      <div
        data-ribbon-bg="editor"
        data-editor-ribbon=""
        className="relative z-30 w-full flex items-center gap-1 px-1 py-0.5 border-b border-chrome-border/60 bg-chrome-surface shrink-0"
      >
        {typeof onClose === 'function' && (
          <button
            type="button"
            data-script-editor-close=""
            onClick={onClose}
            className={isMobile
              ? 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-blue-400 hover:bg-chrome-border/60 active:opacity-80'
              : 'shrink-0 p-1.5 flex items-center gap-1 rounded text-blue-400 hover:bg-chrome-border/60 active:opacity-80'}
            title={isMobile ? 'Back to parts' : 'Back to CAD'}
            aria-label={isMobile ? 'Back to parts' : 'Back to CAD'}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {isGame && (
          <Toolbar
            mode="game"
            variant="strip"
            onExitGame={onExitGame}
            onUndo={onUndo}
            onRedo={onRedo}
            canUndo={canUndo}
            canRedo={canRedo}
            isExecuting={isExecuting}
            onRun={onRun}
            onHint={onHint}
            onPickPuzzle={onPickPuzzle}
            gameElapsedMs={gameElapsedMs}
            gameSuccess={gameSuccess}
            gameBestTimeMs={gameBestTimeMs}
          />
        )}
        {showCadStrip && (
          <div
            ref={onCadToolbarHost}
            className="flex flex-1 min-w-0 items-center overflow-hidden"
            data-cad-toolbar-host=""
          />
        )}
        {isMobile && !isGame && (
          <div
            data-script-profile-chip=""
            className="ml-auto flex shrink-0 items-center pl-0.5"
          >
            <ProfileChip
              variant="inline"
              onAccount={onAccount}
              onSignedOut={onSignedOut}
              onClearLocalCadData={onClearLocalCadData}
              vaultName={profileVaultName}
              agentBridgeLive={agentBridgeLive}
            />
          </div>
        )}
      </div>
      <div className={`flex-1 min-h-0 ${monacoEndPadClassName || ''}`.trim()}>
        <Editor
          width="100%"
          height="100%"
          language="javascript"
          theme="vs-dark"
          value={editorValue}
          options={options}
          onChange={handleEditorChange}
          onMount={editorDidMount}
        />
      </div>
    </div>
  );
});

export default CodeEditor;
