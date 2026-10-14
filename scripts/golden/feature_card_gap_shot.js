/**
 * Shared feature-card gap. Fillet's Tangent / Clear / Undo row and Delete
 * Face’s Undo / Clear row both sit above Delete and Confirm. The space
 * between them is the feature-card footer, not a margin on either chip.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FilletModeChip from '../../src/components/FilletModeChip.jsx';
import DeleteFaceModeChip from '../../src/components/DeleteFaceModeChip.jsx';

export function renderFeatureCardGapShot(el) {
  createRoot(el).render(React.createElement(Shot));
}

function Shot() {
  const [card, setCard] = useState('fillet');
  const [compact, setCompact] = useState(true);

  useEffect(() => {
    window.__SHOW_CARD__ = (name, phone) => {
      setCard(name);
      setCompact(!!phone);
    };
    window.__READY__ = true;
  }, []);

  const noop = () => {};
  const chip = card === 'delete-face'
    ? React.createElement(DeleteFaceModeChip, {
      faces: [{ center: [0, 0, 10], normal: [0, 0, 1] }, { center: [10, 0, 0], normal: [1, 0, 0] }],
      compact,
      onUndo: noop,
      onClear: noop,
      onConfirm: noop,
      onDismiss: noop,
      onDelete: noop,
    })
    : React.createElement(FilletModeChip, {
      kind: 'fillet',
      edgeCount: 4,
      partCount: 1,
      tangentOn: true,
      params: { radius: 2, _sweepMax: 20 },
      pathOk: true,
      componentCount: 4,
      compact,
      onToggleTangent: noop,
      onClear: noop,
      onAccept: noop,
      onBack: noop,
      onDismiss: noop,
      onParamChange: noop,
      onDelete: noop,
    });

  return React.createElement(
    'div',
    {
      'data-feature-card-gap-shot': card,
      className: 'viewport-shell relative h-screen w-full overflow-hidden bg-[#1e1e1e]',
      'data-mobile-stage': 'cad',
      'data-harness-pane': '',
    },
    React.createElement('div', {
      'data-rail-pair': 'right',
      className: 'absolute bottom-2.5 right-2.5 z-10 w-14 rounded-lg bg-white/70',
      style: { height: 280 },
    }),
    chip,
  );
}
