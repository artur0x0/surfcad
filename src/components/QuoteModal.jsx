import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { X, DollarSign, Clock, Package, ShoppingCart, ChevronDown } from 'lucide-react';
import { PROCESSES } from '../utils/quoting';
import { generate3MFBlob } from '../utils/exportModel';
import { scriptHash } from '../utils/cart.js';
import { requestPartQuote } from '../utils/quoteApi.js';
import { sheetCheckoutRoute } from '../utils/sheetMetal/sheetCheckout.js';
import CheckoutStepper from './CheckoutStepper';
import QuantityStepper from './order/QuantityStepper';
import ScsHandoff from './sheetMetal/ScsHandoff';
import ModalFit from './ModalFit';

function initialProcess(options) {
  const key = options?.process;
  if (key && PROCESSES[key] && !PROCESSES[key].disabled) return key;
  return 'FDM';
}

function initialMaterial(options) {
  const process = initialProcess(options);
  const want = options?.material;
  const list = PROCESSES[process].materials;
  return list.includes(want) ? want : list[0];
}

function addFailure(reason) {
  if (reason === 'full') return 'The cart is full.';
  if (reason === 'incomplete-quote') return 'The quote was incomplete. Nothing was added to the cart.';
  if (reason === 'signed-out') return 'Sign in to add this part to the cart.';
  return 'Could not add this part. Nothing was added to the cart.';
}

const QuoteModal = ({
  onClose,
  onGetQuote,
  onOrder,
  onAddToCart,
  mode = 'checkout',
  currentScript,
  currentFilename,
  fixedQuantity = null,
  initialOptions = null,
  partId = null,
  lineError = '',
  checkoutStep = null,
}) => {
  const addingToCart = mode === 'add';
  const locked = !addingToCart && Number.isInteger(fixedQuantity) && fixedQuantity >= 1;
  const [selectedProcess, setSelectedProcess] = useState(() => initialProcess(initialOptions));
  const [selectedMaterial, setSelectedMaterial] = useState(() => initialMaterial(initialOptions));
  const [infill, setInfill] = useState(() => {
    const n = Number(initialOptions?.infill);
    return Number.isFinite(n) ? n : 20;
  });
  const [quantity, setQuantity] = useState(locked ? fixedQuantity : 1);
  const qty = locked ? fixedQuantity : quantity;
  const [quoteResult, setQuoteResult] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [surfInstead, setSurfInstead] = useState(false);
  const onGetQuoteRef = useRef(onGetQuote);
  onGetQuoteRef.current = onGetQuote;
  const route = useMemo(() => sheetCheckoutRoute(currentScript), [currentScript]);
  const bodyRef = useRef(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const syncScrollHint = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  // Checkout of a stored line stays on the SurfCAD quote. The handoff is only
  // the part-row Order path, and it does not write or remove a line.
  const showHandoff = addingToCart && route === 'scs' && !surfInstead;
  useLayoutEffect(() => {
    syncScrollHint();
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => syncScrollHint());
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [syncScrollHint, quoteResult, showHandoff, error, selectedProcess, infill, quantity]);

  const currentProcess = PROCESSES[selectedProcess];
  const handoffName = String(currentFilename || 'sheet').replace(/\.js$/i, '') || 'sheet';

  // Auto-calculate quote when modal opens or options change.
  // The handoff does not price the part.
  useEffect(() => {
    if (showHandoff) return;
    const getQuote = async () => {
      setError(null);

      try {
        const result = await onGetQuoteRef.current({
          process: selectedProcess,
          material: selectedMaterial,
          infill: infill,
          quantity: qty,
        });

        setQuoteResult(result);
      } catch (err) {
        console.error('Quote error:', err);
        setQuoteResult(null);
        setError(err?.message || lineError || 'Failed to calculate quote. Please try again.');
      }
    };

    getQuote();
  }, [showHandoff, selectedProcess, selectedMaterial, infill, qty, lineError]);

  const handleProcessChange = (process) => {
    if (PROCESSES[process].disabled) return;
    setSelectedProcess(process);
    // Reset to first available material for this process
    setSelectedMaterial(PROCESSES[process].materials[0]);
  };

  const exportModelFile = async () => {
    const name = currentFilename
      ? `${currentFilename.split('.')[0]}.3mf`
      : 'model.3mf';
    const blob = await generate3MFBlob(currentScript, { partId, lineError });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return {
      blob,
      modelFile: {
        contentType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
        sizeBytes: blob.size,
        filename: name,
        data: btoa(binary),
      },
    };
  };

  // Checkout still hands one part to OrderModal. Add to cart prices on the server first.
  const handleOrder = async () => {
    if (!quoteResult || !onOrder || adding) return;

    let exported;
    try {
      exported = await exportModelFile();
    } catch (err) {
      setError(err?.message || lineError || 'Could not export this part.');
      return;
    }
    const { blob, modelFile } = exported;
    const base64 = modelFile.data;
    const name = modelFile.filename;

    const quoteData = {
      process: selectedProcess,
      material: selectedMaterial,
      infill: infill,
      volume: quoteResult.volume,
      surfaceArea: quoteResult.surfaceArea,
      // Extended (unit × qty). An old orders route ignores quantity and
      // charges subtotal once, so this must already include the copies.
      materialCost: quoteResult.costs.material,
      machineCost: quoteResult.costs.machine,
      subtotal: quoteResult.subtotal,
      materialGrams: quoteResult.materialGrams,
      quantity: quoteResult.quantity || qty,
      unitSubtotal: quoteResult.unitSubtotal,
      unitMaterial: quoteResult.unitMaterial,
      unitMachine: quoteResult.unitMachine,
      unitGrams: quoteResult.unitGrams,
      unitPrintTime: quoteResult.unitPrintTime,
      printTime: quoteResult.printTime,
    };

    const modelData = {
      boundingBox: quoteResult.boundingBox || {
        width: quoteResult.bounds?.size?.[0] || 100,
        height: quoteResult.bounds?.size?.[1] || 100,
        depth: quoteResult.bounds?.size?.[2] || 50,
      },
      modelFile: {
        contentType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
        sizeBytes: blob.size,
        filename: name,
        data: base64
      }
    };

    onOrder(quoteData, modelData);
  };

  const handleAddToCart = async () => {
    if (!quoteResult || adding) return;
    if (!onAddToCart) {
      setError('Could not add this part.');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const { modelFile } = await exportModelFile();
      const accepted = await requestPartQuote({
        scriptHash: scriptHash(currentScript),
        process: selectedProcess,
        material: selectedMaterial,
        infill,
        modelFile,
      });
      const wrote = await onAddToCart({
        process: selectedProcess,
        material: selectedMaterial,
        infill,
        quantity: qty,
        script: currentScript,
        quote: accepted,
      });
      if (wrote && wrote.ok === false) setError(addFailure(wrote.reason));
    } catch (err) {
      setError(err?.message || 'Could not add this part. Nothing was added to the cart.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <ModalFit
      className="surface-scrim flex items-center justify-center z-50 px-4"
      data-quote-mode={addingToCart ? 'add' : 'checkout'}
      data-scs-handoff={showHandoff ? '' : undefined}
    >
      <div className="modal-fit-panel surface-glass rounded-lg shadow-2xl max-w-2xl w-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-chrome-border">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            {showHandoff ? null : <DollarSign size={24} />}
            {showHandoff ? 'SendCutSend' : 'Manufacturing Quote'}
          </h2>
          <button
            onClick={onClose}
            className="text-chrome-secondary hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {checkoutStep && !showHandoff ? <CheckoutStepper {...checkoutStep} /> : null}

        {/* Content. The hint sits outside the scroller so it is not a sticky footer. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={bodyRef}
          className="quote-scroll min-h-0 flex-1 overflow-y-auto p-6 space-y-6"
          data-quote-scroll=""
          onScroll={syncScrollHint}
        >
        {showHandoff ? (
          <ScsHandoff
            script={currentScript}
            partName={handoffName}
            onQuoteInstead={() => setSurfInstead(true)}
          />
        ) : (
        <>
        {/* Process Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            Manufacturing Process
          </label>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(PROCESSES).map(([key, process]) => (
              <button
                key={key}
                onClick={() => handleProcessChange(key)}
                disabled={process.disabled}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedProcess === key
                    ? 'border-gray bg-chrome-border'
                    : 'border-gray-600 bg-gray-800/50 hover:border-gray-500'
                } ${
                  process.disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer'
                }`}
              >
                <div className="font-medium text-white">{key}</div>
                <div className="text-xs text-chrome-secondary mt-1">{process.name}</div>
                {process.disabled && (
                  <div className="text-xs text-yellow-500 mt-1">Coming Soon</div>
                )}
              </button>
            ))}
          </div>
        </div>

          {/* Max Size Info */}
          <div className="bg-gray-800/50 rounded-lg p-4 border border-chrome-border">
            <div className="text-sm text-gray-300">
              <span className="font-medium">Maximum Build Size:</span>{' '}
              {currentProcess.maxSize.x} × {currentProcess.maxSize.y} × {currentProcess.maxSize.z} mm
            </div>
          </div>

          {/* Material Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Material
            </label>
            <div className="relative">
              <select
                value={selectedMaterial}
                onChange={(e) => setSelectedMaterial(e.target.value)}
                className="w-full bg-chrome-background text-white border border-gray-600 rounded-lg px-4 py-3 pr-10 focus:outline-none focus:ring-1 focus:ring-grey focus:border-white appearance-none cursor-pointer"
              >
                {currentProcess.materials.map((material) => (
                  <option 
                    key={material} 
                    value={material}
                    className="bg-chrome-background text-white"
                  >
                    {material}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {locked ? null : (
            <QuantityStepper id="quote-quantity" value={quantity} onChange={setQuantity} />
          )}

          {/* Infill Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Infill Density: {infill}%
            </label>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={infill}
              onChange={(e) => setInfill(parseInt(e.target.value))}
              className="w-full h-2 bg-chrome-border rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>10% (Faster, Less Strong)</span>
              <span>100% (Slower, Stronger)</span>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4" data-quote-error="">
              <div className="text-red-400 text-sm">{error}</div>
            </div>
          )}

          {/* Quote Result */}
          {quoteResult && (
            <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-6 space-y-4">
              <h3 className="text-lg font-semibold text-green-400">Quote Breakdown</h3>
              
              <div className="space-y-3">
                {/* Material Usage */}
                <div className="flex items-center justify-between text-gray-300">
                  <div className="flex items-center gap-2">
                    <Package size={18} className="text-blue-400" />
                    <span>Material Usage:</span>
                  </div>
                  <span className="font-medium">
                    {quoteResult.materialUsage.grams.toFixed(1)}g 
                    {quoteResult.materialUsage.meters > 0 && 
                      ` (${quoteResult.materialUsage.meters.toFixed(1)}m)`
                    }
                  </span>
                </div>

                {/* Print Time */}
                <div className="flex items-center justify-between text-gray-300">
                  <div className="flex items-center gap-2">
                    <Clock size={18} className="text-yellow-400" />
                    <span>Estimated Print Time:</span>
                  </div>
                  <span className="font-medium">
                    {quoteResult.printTime.toFixed(1)} hours
                  </span>
                </div>

                <div className="flex items-center justify-between text-gray-300" data-quote-qty="">
                  <span>Qty {quoteResult.quantity || qty}</span>
                  {quoteResult.quantity > 1 && (
                    <span className="font-medium text-sm text-chrome-secondary">
                      ${quoteResult.unitSubtotal.toFixed(2)} each
                    </span>
                  )}
                </div>

                <div className="border-t border-gray-600 my-4"></div>

                {/* Cost Breakdown */}
                <div className="space-y-2">
                  <div className="flex justify-between text-chrome-secondary text-sm">
                    <span>Material Cost:</span>
                    <span>${quoteResult.costs.material.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-chrome-secondary text-sm">
                    <span>Machine Time:</span>
                    <span>${quoteResult.costs.machine.toFixed(2)}</span>
                  </div>
                  
                  <div className="border-t border-gray-600 my-2"></div>
                  
                  <div className="flex justify-between text-white text-lg font-bold" data-quote-total="">
                    <span>Total:</span>
                    <span className="text-green-400">${quoteResult.costs.total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Quote Details */}
                <div className="text-xs text-gray-500 mt-4 pt-4 border-t border-chrome-border">
                  <div>Process: {selectedProcess}</div>
                  <div>Material: {selectedMaterial}</div>
                  <div>Infill: {infill}%</div>
                  <div>Qty {quoteResult.quantity || qty}</div>
                </div>

                {/* Order Button */}
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={addingToCart ? handleAddToCart : handleOrder}
                    disabled={adding}
                    data-quote-add={addingToCart ? '' : undefined}
                    data-quote-order={addingToCart ? undefined : ''}
                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 text-lg font-semibold transition-colors disabled:cursor-wait disabled:opacity-70"
                  >
                    <ShoppingCart size={24} />
                    {addingToCart ? (adding ? 'Adding…' : 'Add to cart') : 'Order'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
        )}
        </div>
        {moreBelow ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-gradient-to-t from-chrome-surface to-transparent"
            data-quote-scroll-hint=""
            aria-hidden="true"
          >
            <ChevronDown size={18} className="mb-1 text-chrome-text" />
          </div>
        ) : null}
        </div>
      </div>
    </ModalFit>
  );
};

export default QuoteModal;
