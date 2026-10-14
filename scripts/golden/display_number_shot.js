/**
 * Calculated numbers at four decimals. Chamfer size, a length, a plane
 * angle, and a hole diameter. The script assigned on window stays put
 * until the user types a different number.
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FilletModeChip from '../../src/components/FilletModeChip.jsx';
import { LengthNumberField, NumberField } from '../../src/components/controls/popupUI.jsx';
import { formatDisplayLength, setDisplayUnit } from '../../src/utils/displayUnit.js';

const SCRIPT = 'part = filletAlongPath(part, path1, 0.1, { profile: \'chamfer\' });';

export function renderDisplayNumberShot(el, { compact = false } = {}) {
  setDisplayUnit('in');
  window.__SCRIPT__ = SCRIPT;
  window.__TOUCHED__ = false;
  window.__DISPLAY_NUMBER__ = { script: SCRIPT, touched: false };
  createRoot(el).render(React.createElement(Shot, { compact }));
}

function remember(next) {
  window.__TOUCHED__ = true;
  window.__SCRIPT__ = next;
  window.__DISPLAY_NUMBER__ = { script: next, touched: true };
}

function Shot({ compact }) {
  const [chamfer, setChamfer] = useState(0.1);
  const [offset, setOffset] = useState(10.123456789);
  const [angle, setAngle] = useState(90.0000000001);
  const [hole, setHole] = useState(4.2);
  const [oneInch, setOneInch] = useState(25.4);
  return React.createElement(
    'div',
    {
      className: 'viewport-shell',
      'data-display-number-shot': compact ? '390' : '1280',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement(
      'div',
      {
        'data-display-number-readouts': '',
        style: { position: 'relative', zIndex: 5, padding: 16, color: 'white', font: '13px sans-serif' },
      },
      React.createElement('div', { 'data-display-readout': 'length' }, formatDisplayLength(0.1, 'in')),
      React.createElement(LengthNumberField, {
        id: 'offset',
        label: 'Offset',
        valueMm: offset,
        onChangeMm: (mm) => {
          setOffset(mm);
          remember(`offset ${mm}`);
        },
        minMm: -40,
        maxMm: 40,
        signed: true,
      }),
      React.createElement(NumberField, {
        id: 'angle',
        label: 'Angle',
        unit: '°',
        value: angle,
        onChange: (raw) => {
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          setAngle(n);
          remember(`angle ${n}`);
        },
        min: -180,
        max: 180,
        step: 1,
      }),
      React.createElement(LengthNumberField, {
        id: 'hole',
        label: 'Diameter',
        valueMm: hole,
        onChangeMm: (mm) => {
          setHole(mm);
          remember(`hole ${mm}`);
        },
        minMm: 0.1,
        maxMm: 40,
      }),
      React.createElement(LengthNumberField, {
        id: 'inch',
        label: 'Length',
        valueMm: oneInch,
        onChangeMm: (mm) => {
          setOneInch(mm);
          remember(`inch ${mm}`);
        },
        minMm: 0,
        maxMm: 100,
      }),
    ),
    React.createElement(FilletModeChip, {
      kind: 'chamfer',
      edgeCount: 11,
      pathOk: true,
      compact,
      params: { chamfer, _blendMin: 0.1, _blendMax: 40 },
      onParamChange: (next) => {
        setChamfer(next.chamfer);
        remember(`part = filletAlongPath(part, path1, ${next.chamfer}, { profile: 'chamfer' });`);
      },
      onAccept: () => {},
      onDismiss: () => {},
    }),
  );
}
