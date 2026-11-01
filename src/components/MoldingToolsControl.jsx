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
  wallPending = false,
  onWallToggle = null,
  showParting = false,
  partingActive = false,
  partingPending = false,
  onPartingToggle = null,
  showSideActions = false,
  sideActionsActive = false,
  sideActionsPending = false,
  onSideActionsToggle = null,
  showMoldDraft = false,
  moldDraftActive = false,
  moldDraftPending = false,
  onMoldDraftToggle = null,
  showDfm = false,
  dfmActive = false,
  dfmPending = false,
  onDfmToggle = null,
  showQuote = false,
  quoteActive = false,
  quotePending = false,
  onQuoteToggle = null,
  /** Initial open state. The rail leaves this unset; tests pass true. */
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(!!defaultOpen);
  const anyShown = showWall || showParting || showSideActions || showMoldDraft || showDfm || showQuote;
  if (!anyShown) return null;
  const anyOn = (showWall && (wallActive || wallPending))
    || (showParting && (partingActive || partingPending))
    || (showSideActions && (sideActionsActive || sideActionsPending))
    || (showMoldDraft && (moldDraftActive || moldDraftPending))
    || (showDfm && (dfmActive || dfmPending))
    || (showQuote && (quoteActive || quotePending));
  const toolState = (active, pending) => (pending ? 'pending' : (active ? 'on' : 'off'));

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
              className={toolToggleClass(wallActive || wallPending)}
              title={wallPending ? 'Computing wall thickness' : (wallActive ? 'Hide wall thickness' : 'Show wall thickness')}
              aria-label={wallPending ? 'Computing wall thickness' : (wallActive ? 'Hide wall thickness' : 'Show wall thickness')}
              aria-pressed={!!wallActive}
              aria-busy={wallPending || undefined}
              data-wall-heatmap=""
              data-wall-heatmap-state={toolState(wallActive, wallPending)}
              data-ui-action="data-wall-heatmap"
            >
              <AlignHorizontalSpaceAround size={20} />
            </button>
          )}
          {showParting && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onPartingToggle)}
              className={toolToggleClass(partingActive || partingPending)}
              title={partingPending ? 'Computing core and cavity' : (partingActive ? 'Hide core and cavity' : 'Show core and cavity')}
              aria-label={partingPending ? 'Computing core and cavity' : (partingActive ? 'Hide core and cavity' : 'Show core and cavity')}
              aria-pressed={!!partingActive}
              aria-busy={partingPending || undefined}
              data-mold-parting=""
              data-mold-parting-state={toolState(partingActive, partingPending)}
              data-ui-action="data-mold-parting"
            >
              <SquareSplitHorizontal size={20} />
            </button>
          )}
          {showSideActions && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onSideActionsToggle)}
              className={toolToggleClass(sideActionsActive || sideActionsPending)}
              title={sideActionsPending ? 'Computing side actions' : (sideActionsActive ? 'Hide side actions' : 'Show side actions')}
              aria-label={sideActionsPending ? 'Computing side actions' : (sideActionsActive ? 'Hide side actions' : 'Show side actions')}
              aria-pressed={!!sideActionsActive}
              aria-busy={sideActionsPending || undefined}
              data-mold-side-actions=""
              data-mold-side-actions-state={toolState(sideActionsActive, sideActionsPending)}
              data-ui-action="data-mold-side-actions"
            >
              <ArrowLeftRight size={20} />
            </button>
          )}
          {showMoldDraft && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onMoldDraftToggle)}
              className={toolToggleClass(moldDraftActive || moldDraftPending)}
              title={moldDraftPending ? 'Computing mold draft' : (moldDraftActive ? 'Hide mold draft' : 'Show mold draft')}
              aria-label={moldDraftPending ? 'Computing mold draft' : (moldDraftActive ? 'Hide mold draft' : 'Show mold draft')}
              aria-pressed={!!moldDraftActive}
              aria-busy={moldDraftPending || undefined}
              data-mold-draft=""
              data-mold-draft-state={toolState(moldDraftActive, moldDraftPending)}
              data-ui-action="data-mold-draft"
            >
              <ArrowUpFromLine size={20} />
            </button>
          )}
          {showDfm && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onDfmToggle)}
              className={toolToggleClass(dfmActive || dfmPending)}
              title={dfmPending ? 'Computing DFM report' : (dfmActive ? 'Hide DFM report' : 'Show DFM report')}
              aria-label={dfmPending ? 'Computing DFM report' : (dfmActive ? 'Hide DFM report' : 'Show DFM report')}
              aria-pressed={!!dfmActive}
              aria-busy={dfmPending || undefined}
              data-mold-dfm=""
              data-mold-dfm-state={toolState(dfmActive, dfmPending)}
              data-ui-action="data-mold-dfm"
            >
              <ClipboardList size={20} />
            </button>
          )}
          {showQuote && (
            <button
              type="button"
              onClick={() => pressMoldTool(setOpen, onQuoteToggle)}
              className={toolToggleClass(quoteActive || quotePending)}
              title={quotePending ? 'Computing budgetary quote' : (quoteActive ? 'Hide budgetary quote' : 'Show budgetary quote')}
              aria-label={quotePending ? 'Computing budgetary quote' : (quoteActive ? 'Hide budgetary quote' : 'Show budgetary quote')}
              aria-pressed={!!quoteActive}
              aria-busy={quotePending || undefined}
              data-mold-quote=""
              data-mold-quote-state={toolState(quoteActive, quotePending)}
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
