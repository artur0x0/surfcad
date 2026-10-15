import { useMemo } from 'react';
import { SCS_ORDER_URL } from '../../utils/scs/scsCatalog';
import { downloadBlob } from '../../utils/model-io';
import { buildSheetExport } from '../../utils/sheetMetal/sheetExport';
import { readSheetMetalSpec } from '../../utils/sheetMetal/sheetMetalScript';
import { formatSheetLength } from '../../utils/sheetMetal/sheetUnits';
import { useDisplayUnit } from '../../hooks/useDisplayUnit';
import { SmButton } from './SmControls';

const downloadText = (file) => {
  if (!file?.text) return;
  downloadBlob(new Blob([file.text], { type: `${file.mime || 'text/plain'};charset=utf-8` }), file.name);
};

/**
 * DXF, STEP, and the SendCutSend redirect. Shown instead of the SurfCAD
 * quote. It does not price the part and does not write a cart line.
 */
const ScsHandoff = ({ script, partName = 'sheet', onQuoteInstead }) => {
  const [unit] = useDisplayUnit();
  const model = useMemo(() => {
    const spec = readSheetMetalSpec(script);
    if (!spec) return null;
    return {
      sku: spec.sku || '',
      bundle: buildSheetExport(spec, { script: script ?? null, partName: partName || 'sheet', unit }),
    };
  }, [script, partName, unit]);
  const bundle = model?.bundle || null;
  const blocked = !bundle || bundle.blocked;
  const files = bundle?.files || {};
  const size = bundle?.flat?.size;
  const stepSource = bundle?.stepSource || 'none';
  const bendCount = files.step?.stats?.bendFaces ? files.step.stats.bendFaces / 2 : 0;

  return (
    <div className="space-y-4" data-scs-panel="">
      <p className="text-sm text-gray-300">
        This part is only sheet metal and passed the SendCutSend checks.
        Download a file and upload it there.
      </p>
      {size && (
        <p className="text-xs text-gray-300" data-sm-flat-size="1">
          Flat {formatSheetLength(size[0], unit, 1)} × {formatSheetLength(size[1], unit, 1)}
          {model?.sku ? ` · ${model.sku}` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <SmButton
          data-sm-dxf="1"
          disabled={blocked || !files.dxf}
          className="w-full"
          title={blocked ? 'Fix DFM fails first' : files.dxf?.name}
          onClick={() => downloadText(files.dxf)}
        >
          Download DXF
        </SmButton>
        <SmButton
          data-sm-step="1"
          disabled={blocked || !files.step}
          className="w-full"
          title={blocked ? 'Fix DFM fails first' : (files.step?.name || 'Run the part first')}
          onClick={() => downloadText(files.step)}
        >
          Download STEP
        </SmButton>
      </div>
      <SmButton
        variant="primary"
        className="w-full"
        data-sm-order="1"
        disabled={blocked}
        title={blocked ? 'Fix DFM fails first' : 'Open SendCutSend to upload DXF or STEP'}
        onClick={() => {
          if (blocked) return;
          window.open(SCS_ORDER_URL, '_blank', 'noopener,noreferrer');
        }}
      >
        Order on SendCutSend
      </SmButton>
      <p className="text-[11px] text-chrome-secondary" data-sm-step-source={stepSource}>
        DXF is the flat cut (mm). STEP is the bent 3D part
        {stepSource === 'spec' ? `, built from the sheet spec with exact bends${bendCount ? ` (${bendCount} cylindrical)` : ''}` : ''}
        {stepSource === 'mesh' ? ', faceted from the 3D part' : ''}
        . Upload either at app.sendcutsend.com.
      </p>
      <button
        type="button"
        data-scs-surf-quote=""
        onClick={() => onQuoteInstead?.()}
        className="min-h-[44px] text-sm text-gray-300 underline underline-offset-2 hover:text-white"
      >
        Quote with SurfCAD instead
      </button>
    </div>
  );
};

export default ScsHandoff;
