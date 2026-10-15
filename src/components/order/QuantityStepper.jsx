import React from 'react';

export const QTY_MIN = 1;
export const QTY_MAX = 999;

const QuantityStepper = ({ value, onChange, id = 'order-quantity' }) => {
  const qty = Number.isInteger(value) && value >= QTY_MIN && value <= QTY_MAX ? value : QTY_MIN;

  const setQty = (next) => {
    const n = parseInt(next, 10);
    if (!Number.isInteger(n)) return;
    onChange(Math.max(QTY_MIN, Math.min(QTY_MAX, n)));
  };

  return (
    <div className="flex items-center justify-between gap-3" data-quote-quantity>
      <label htmlFor={id} className="text-sm font-medium text-gray-300">
        Quantity
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={() => setQty(qty - 1)}
          disabled={qty <= QTY_MIN}
          className="w-9 h-9 rounded-lg border border-gray-600 bg-gray-800 text-white text-lg leading-none disabled:opacity-40 disabled:cursor-not-allowed hover:bg-chrome-border"
        >
          −
        </button>
        <input
          id={id}
          data-quote-qty-input
          type="number"
          inputMode="numeric"
          min={QTY_MIN}
          max={QTY_MAX}
          value={qty}
          aria-label="Quantity"
          onChange={(e) => {
            if (e.target.value === '') return;
            setQty(e.target.value);
          }}
          className="w-16 bg-chrome-background text-white text-center border border-gray-600 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-white"
        />
        <button
          type="button"
          aria-label="Increase quantity"
          onClick={() => setQty(qty + 1)}
          disabled={qty >= QTY_MAX}
          className="w-9 h-9 rounded-lg border border-gray-600 bg-gray-800 text-white text-lg leading-none disabled:opacity-40 disabled:cursor-not-allowed hover:bg-chrome-border"
        >
          +
        </button>
      </div>
    </div>
  );
};

export default QuantityStepper;
