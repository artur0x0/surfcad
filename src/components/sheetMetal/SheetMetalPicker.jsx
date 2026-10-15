import React, { useEffect, useMemo, useState } from 'react';
import {
  canStartSheetMetal,
  findScsSku,
  loadScsCatalog,
  scsGaugeOptions,
  scsMaterialOptions,
} from '../../utils/scs/scsCatalog';
import { scsCatalogCache } from '../../utils/scs/scsCatalogStore';
import { SmButton, SmPopup, SmSelect } from './SmControls';

/**
 * S1 — Sheet Metal entry. Material + gauge dropdowns over live SendCutSend
 * stock. Out-of-stock gauges stay in the list, disabled, labeled
 * "out of stock". Start designing stays disabled until an in-stock SKU is
 * picked; it binds the SKU to the active part and enters sheet-metal mode.
 * Catalog: IndexedDB cache, refreshed daily, stale cache when offline.
 */
const SheetMetalPicker = ({
  binding = null,
  /** The active part has other features → Start makes a new "Sheet" part. */
  willCreatePart = false,
  onCancel,
  onStart,
  compact = false,
  loader = loadScsCatalog,
}) => {
  const [state, setState] = useState({ loading: true, records: [], stale: false, error: null, fetchedAt: null });
  const [material, setMaterial] = useState(binding?.name || '');
  const [sku, setSku] = useState(binding?.sku || '');

  const load = (force = false) => {
    setState((s) => ({ ...s, loading: true }));
    loader({ cache: scsCatalogCache, force }).then((res) => {
      setState({ loading: false, records: res.records, stale: res.stale, error: res.error, fetchedAt: res.fetchedAt });
    });
  };
  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const materials = useMemo(() => scsMaterialOptions(state.records), [state.records]);
  const gauges = useMemo(() => scsGaugeOptions(state.records, material), [state.records, material]);
  const picked = findScsSku(state.records, sku);
  const canStart = canStartSheetMetal(state.records, sku) && gauges.some((g) => g.sku === sku && g.inStock);
  const boundGone = binding?.sku && !state.loading && state.records.length > 0
    && !canStartSheetMetal(state.records, binding.sku);

  const materialOptions = materials.map((m) => ({
    value: m.name,
    label: `${m.name}${m.inStock === false ? ' (out of stock)' : ''}${m.bendable ? '' : ' (flat only)'}`,
  }));
  const gaugeOptions = gauges.map((g) => ({
    value: g.sku,
    label: g.label,
    disabled: !!g.disabled,
  }));

  return (
    <SmPopup
      title="Sheet Metal"
      subtitle="SendCutSend stock — pick material and gauge"
      onClose={onCancel}
      closeLabel="Close sheet metal picker"
      dataAttr="data-sheet-metal-picker"
      compact={compact}
      footer={(
        <div className="flex justify-end">
          <SmButton
            variant="primary"
            disabled={!canStart}
            onClick={() => picked && onStart?.(picked)}
            data-sheet-metal-start="1"
            title={canStart ? 'Bind this SKU to the part and start designing' : 'Pick an in-stock material and gauge first'}
          >
            Start designing
          </SmButton>
        </div>
      )}
    >
      {state.loading && !state.records.length && (
        <p className="text-sm text-gray-200" data-scs-status="loading">Loading SendCutSend catalog…</p>
      )}
      {!state.loading && !state.records.length && (
        <div className="text-sm text-red-200" data-scs-status="error">
          <p>Could not load the SendCutSend catalog{state.error ? ` (${state.error})` : ''}.</p>
          <SmButton className="mt-2" onClick={() => load(true)}>Retry</SmButton>
        </div>
      )}
      {state.stale && state.records.length > 0 && (
        <div className="text-xs text-amber-200 flex items-center justify-between gap-2" data-scs-status="stale">
          <span>Offline — using saved catalog{state.fetchedAt ? ` from ${new Date(state.fetchedAt).toLocaleDateString()}` : ''}.</span>
          <button type="button" className="underline min-h-[44px] px-2" onClick={() => load(true)}>Retry</button>
        </div>
      )}
      {boundGone && (
        <p className="text-xs text-amber-200" data-scs-status="bound-out">
          This part&apos;s SKU {binding.sku} is no longer in stock — pick another.
        </p>
      )}
      {state.records.length > 0 && (
        <>
          <SmSelect
            id="sm-material"
            label="Material"
            value={material}
            placeholder="Choose material…"
            options={materialOptions}
            onChange={(v) => {
              setMaterial(v);
              setSku('');
            }}
          />
          <SmSelect
            id="sm-gauge"
            label="Gauge / thickness"
            value={gauges.some((g) => g.sku === sku && g.inStock) ? sku : ''}
            placeholder={material ? 'Choose gauge…' : 'Pick a material first'}
            disabled={!material}
            options={gaugeOptions}
            onChange={setSku}
          />
          {picked && (
            <div className="text-xs text-gray-300 leading-relaxed" data-scs-sku={picked.sku}>
              <div><span className="text-chrome-secondary">SKU</span> {picked.sku} · {picked.cuttingProcess || 'laser'}</div>
              {picked.bend ? (
                <div>
                  Bend radius {picked.bend.radiusIn}&quot; · K {picked.bend.kFactor} · max {picked.bend.maxAngleDeg}° · min flange {picked.bend.minFlangeIn}&quot;
                </div>
              ) : (
                <div className="text-amber-200">No bending on this SKU — flat parts only.</div>
              )}
            </div>
          )}
          {willCreatePart && (
            <p className="text-xs text-gray-300">No part is open — Start makes a new sheet part.</p>
          )}
        </>
      )}
    </SmPopup>
  );
};

export default SheetMetalPicker;
