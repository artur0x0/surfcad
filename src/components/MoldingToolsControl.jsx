// components/MoldingToolsControl.jsx — Molding tools drawer on the right rail.
//
// One trigger, one menu, same unfurl as ViewSnapControl:
//   tap      opens the six molding tools in a row to the left
//   tap again closes it — the icon becomes a left arrow while open
// The menu flies out left because the rail lives on the right edge.
// `w-max` + `flex-nowrap` keep that row from collapsing (see ViewSnapControl).
// The row is one step tighter than view snap so six icons clear the left
// rail on a 390px phone.
//
// A tool press closes the flyout, then opens or toggles that pane.
// These stay toggles: a second press on the same tool turns the pane off.
import React, { useState } from 'react';
import {
  AlignHorizontalSpaceAround,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpFromLine,
  ClipboardList,
  Factory,
  Receipt,
  SquareSplitHorizontal,
} from 'lucide-react';
import { pressMoldTool } from './pressMoldTool';
import { toolToggleClass } from './toolToggle';

const MoldingToolsControl = ({
  showWall = false,
  wallActive = false,
  onWallToggle = null,
  showParting = false,
  partingActive = false,
  onPartingToggle = null,
  showSideActions = false,
  sideActionsActive = false,
  onSideActionsToggle = null,
  showMoldDraft = false,
  moldDraftActive = false,
  onMoldDraftToggle = null,
  showDfm = false,
  dfmActive = false,
  onDfmToggle = null,
  showQuote = false,
  quoteActive = false,
  onQuoteToggle = null,
  /** Initial open state. The rail leaves this unset; tests pass true. */
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(!!defaultOpen);
  const anyShown = showWall || showParting || showSideActions || showMoldDraft || showDfm || showQuote;
  if (!anyShown) return null;
  const anyOn = (showWall && wallActive)
    || (showParting && partingActive)
    || (showSideActions && sideActionsActive)
    || (showMoldDraft && moldDraftActive)
    || (showDfm && dfmActive)
    || (showQuote && quoteActive);

  return (
    <div className="relative flex" data-mold-tools="">
      {open && (
        <div
          className="mold-tools-popup absolute right-full top-1/2 -translate-y-1/2 mr-2.5
            flex w-max flex-nowrap items-center gap-1
            bg-white/60 backdrop-blur-sm p-2 rounded-lg shadow-lg"
          role="group"
          aria-label="Molding tools"
          data-mold-tools-popup=""
        >
          {showWall && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onWallToggle)}
              className={toolToggleClass(wallActive)}
              title={wallActive ? 'Hide wall thickness' : 'Show wall thickness'}
              aria-label={wallActive ? 'Hide wall thickness' : 'Show wall thickness'}
              aria-pressed={!!wallActive}
              data-wall-heatmap=""
              data-wall-heatmap-state={wallActive ? 'on' : 'off'}
              data-ui-action="data-wall-heatmap"
            >
              <AlignHorizontalSpaceAround size={20} />
            </button>
          )}
          {showParting && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onPartingToggle)}
              className={toolToggleClass(partingActive)}
              title={partingActive ? 'Hide core and cavity' : 'Show core and cavity'}
              aria-label={partingActive ? 'Hide core and cavity' : 'Show core and cavity'}
              aria-pressed={!!partingActive}
              data-mold-parting=""
              data-mold-parting-state={partingActive ? 'on' : 'off'}
              data-ui-action="data-mold-parting"
            >
              <SquareSplitHorizontal size={20} />
            </button>
          )}
          {showSideActions && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onSideActionsToggle)}
              className={toolToggleClass(sideActionsActive)}
              title={sideActionsActive ? 'Hide side actions' : 'Show side actions'}
              aria-label={sideActionsActive ? 'Hide side actions' : 'Show side actions'}
              aria-pressed={!!sideActionsActive}
              data-mold-side-actions=""
              data-mold-side-actions-state={sideActionsActive ? 'on' : 'off'}
              data-ui-action="data-mold-side-actions"
            >
              <ArrowLeftRight size={20} />
            </button>
          )}
          {showMoldDraft && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onMoldDraftToggle)}
              className={toolToggleClass(moldDraftActive)}
              title={moldDraftActive ? 'Hide mold draft' : 'Show mold draft'}
              aria-label={moldDraftActive ? 'Hide mold draft' : 'Show mold draft'}
              aria-pressed={!!moldDraftActive}
              data-mold-draft=""
              data-mold-draft-state={moldDraftActive ? 'on' : 'off'}
              data-ui-action="data-mold-draft"
            >
              <ArrowUpFromLine size={20} />
            </button>
          )}
          {showDfm && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onDfmToggle)}
              className={toolToggleClass(dfmActive)}
              title={dfmActive ? 'Hide DFM report' : 'Show DFM report'}
              aria-label={dfmActive ? 'Hide DFM report' : 'Show DFM report'}
              aria-pressed={!!dfmActive}
              data-mold-dfm=""
              data-mold-dfm-state={dfmActive ? 'on' : 'off'}
              data-ui-action="data-mold-dfm"
            >
              <ClipboardList size={20} />
            </button>
          )}
          {showQuote && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onQuoteToggle)}
              className={toolToggleClass(quoteActive)}
              title={quoteActive ? 'Hide budgetary quote' : 'Show budgetary quote'}
              aria-label={quoteActive ? 'Hide budgetary quote' : 'Show budgetary quote'}
              aria-pressed={!!quoteActive}
              data-mold-quote=""
              data-mold-quote-state={quoteActive ? 'on' : 'off'}
              data-ui-action="data-mold-quote"
            >
              <Receipt size={20} />
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={toolToggleClass(open || anyOn)}
        title={open ? 'Hide molding tools' : 'Molding tools'}
        aria-label="Molding tools"
        aria-expanded={open}
        data-mold-tools-toggle=""
        data-mold-tools-toggle-state={open ? 'on' : 'off'}
        data-ui-action="data-mold-tools-toggle"
      >
        {open ? <ArrowLeft size={20} /> : <Factory size={20} />}
      </button>
    </div>
  );
};

export default MoldingToolsControl;
