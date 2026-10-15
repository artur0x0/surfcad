import React from 'react';
import { scsGaugeLabel } from '../../utils/scs/scsCatalog';
import { SmPopup } from './SmControls';

/**
 * Plane and edit steps on the shared feature card.
 * The material line truncates. X exits the flow without writing.
 * Width, phone dock, and the rail gap come from the card.
 */
const SheetMetalModeChip = ({ mode, compact = false, onDismiss, children }) => {
  if (!mode) return null;
  const rec = mode.sku;
  return (
    <SmPopup
      title={(
        <span className="block truncate" data-sm-material="">
          {`Sheet metal · ${rec?.name || ''}`}
        </span>
      )}
      subtitle={(
        <span data-sm-gauge="">
          {scsGaugeLabel(rec)} · {rec?.sku}
        </span>
      )}
      onClose={onDismiss}
      closeLabel="Exit sheet metal without writing"
      compact={compact}
      cardAttrs={{
        'aria-label': 'Sheet metal',
        'data-sheet-metal-mode': mode.stage,
        'data-sheet-chip-gap': 'measured',
        'data-ui-action': 'data-sheet-metal-mode-chip',
      }}
    >
      {children}
    </SmPopup>
  );
};

export default SheetMetalModeChip;
