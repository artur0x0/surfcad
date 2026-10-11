import React from 'react';
import { LengthNumberField } from './controls/popupUI';
import { partLengthMm } from '../utils/sliderRange';

const ACCENT = 'cyan';

/**
 * Name and Used-by banner for an open contour.
 * Circle, rectangle, and polygon sizes sit here. A constrained contour
 * is edited on the sketch. This is not a feature sheet, so a focused
 * length does not open the field-edit footer.
 */
export default function ContourEditBar({
  name = '',
  usedBy = 'Unused',
  tool = 'circle',
  params = {},
  lengthMm = 100,
  onName,
  onParam,
  onDelete,
}) {
  const L = partLengthMm(lengthMm);
  const sized = !params?.contour && (tool === 'circle' || tool === 'rectangle' || tool === 'polygon');
  const setNum = (key) => (value) => {
    if (value === '' || value === '-' || value === '.') {
      onParam?.(key, value);
      return;
    }
    const n = Number(value);
    onParam?.(key, Number.isFinite(n) ? n : value);
  };
  return (
    <div
      className="absolute left-14 right-3 top-16 z-30 flex flex-col gap-1 rounded-lg
        border border-cyan-700/60 bg-cyan-950/90 px-2.5 py-1.5 text-cyan-50 shadow-lg
        pointer-events-auto max-w-sm"
      data-contour-edit=""
    >
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
          <span className="uppercase tracking-wide text-cyan-200/80">Name</span>
          <input
            type="text"
            value={name}
            aria-label="Contour name"
            data-contour-name=""
            onChange={(event) => onName?.(event.target.value)}
            className="min-w-0 flex-1 rounded border border-cyan-700/70 bg-cyan-950 px-2 py-0.5 text-[13px] text-white"
          />
        </label>
        <button
          type="button"
          data-contour-delete=""
          aria-label="Delete contour"
          title="Delete this contour"
          onClick={() => onDelete?.()}
          className="inline-flex shrink-0 items-center rounded-md border border-red-700/60
            bg-red-950/50 px-2.5 py-1 text-[13px] font-medium text-red-200 hover:bg-red-900/70 hover:text-white"
        >
          Delete
        </button>
      </div>
      <p className="text-[12px] leading-tight text-amber-200" data-contour-used-by="">
        {usedBy}
      </p>
      {sized && tool === 'circle' && (
        <LengthNumberField
          id="radius"
          label="Radius"
          accent={ACCENT}
          valueMm={params.radius}
          onChangeMm={setNum('radius')}
          minMm={0.1}
          maxMm={0.8 * L}
        />
      )}
      {sized && tool === 'rectangle' && (
        <>
          <LengthNumberField
            id="width"
            label="Width"
            accent={ACCENT}
            valueMm={params.width}
            onChangeMm={setNum('width')}
            minMm={0.1}
            maxMm={1.2 * L}
          />
          <LengthNumberField
            id="height"
            label="Height"
            accent={ACCENT}
            valueMm={params.height}
            onChangeMm={setNum('height')}
            minMm={0.1}
            maxMm={1.2 * L}
          />
        </>
      )}
      {sized && tool === 'polygon' && (
        <LengthNumberField
          id="radius"
          label="Radius"
          accent={ACCENT}
          valueMm={params.radius}
          onChangeMm={setNum('radius')}
          minMm={0.1}
          maxMm={0.8 * L}
        />
      )}
    </div>
  );
}
