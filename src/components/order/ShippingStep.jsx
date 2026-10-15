// components/order/ShippingStep.jsx - Shipping method selection
/* eslint-disable react-hooks/exhaustive-deps -- fetch-on-mount with isLoading guard is
   the intended once-per-mount contract; adding fn deps would refetch on every render */
import React, { useState, useEffect, useRef } from 'react';
import { Truck, Plane, Zap, Package, Calendar } from 'lucide-react';
import { quantityRejectionMessage, readJsonSafe } from '../../utils/quoteMath.js';

const SHIPPING_ICONS = {
  ground: Truck,
  '2day': Plane,
  overnight: Zap,
};

const ShippingStep = ({ address, quoteData, modelData, onComplete, onError }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [rates, setRates] = useState([]);
  const [selectedRate, setSelectedRate] = useState(null);
  const [packageInfo, setPackageInfo] = useState(null);
  const quoteRef = useRef({
    address: null
  });

  // Fetch shipping rates on mount
  useEffect(() => {
      // Prevent calls while quote is loading
      if (isLoading) {
        return;
      }

      // Skip if we already quoted for this exact address
      if (
        quoteRef.current.address &&
        addressesAreEqual(quoteRef.current.address, address)
      ) {
        setIsLoading(false);
        return;
      }

      // Store address ref
      quoteRef.current = {
        address: {...address} // shallow copy
      };
      setIsLoading(true);
      
      // Request a shipping quote
      fetchShippingRates();
    }, [address]);

  const addressesAreEqual = (a, b) => {
    if (!a || !b) return false;
    return (
      a.street === b.street &&
      a.street2 === b.street2 &&
      a.city === b.city &&
      a.state === b.state &&
      a.zip === b.zip &&
      a.country === b.country
    );
  };

  const fetchShippingRates = async () => {
  
    try {
      // First calculate package dimensions
      const packageResponse = await fetch('/api/shipping/calculate-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          boundingBox: modelData.boundingBox || {
            width: 100,
            height: 100,
            depth: 50,
          },
          materialGrams: quoteData.materialGrams || 100,
          quantity: quoteData.quantity || 1,
        }),
      });
      
      const packageData = await readJsonSafe(packageResponse);
      const packageRejected = quantityRejectionMessage(packageResponse.status, packageData);
      if (packageRejected) {
        const err = new Error(packageRejected);
        err.quantityRejected = true;
        throw err;
      }
      
      if (!packageResponse.ok || !packageData.success) {
        throw new Error(packageData.error || 'Failed to calculate package dimensions');
      }
      
      setPackageInfo(packageData.packageInfo);
      
      // Then get shipping rates
      const ratesResponse = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address,
          packageInfo: packageData.packageInfo,
        }),
      });
      
      const ratesData = await readJsonSafe(ratesResponse);
      const ratesRejected = quantityRejectionMessage(ratesResponse.status, ratesData);
      if (ratesRejected) {
        const err = new Error(ratesRejected);
        err.quantityRejected = true;
        throw err;
      }
      
      if (!ratesResponse.ok || !ratesData.success) {
        throw new Error(ratesData.error || 'Failed to get shipping rates');
      }
      
      setRates(ratesData.rates);
      
      // Auto-select cheapest option
      if (ratesData.rates.length > 0) {
        setSelectedRate(ratesData.rates[0]);
      }
      
    } catch (error) {
      console.error('Failed to fetch shipping rates:', error);
      onError(error.message);
      if (error.quantityRejected) {
        setRates([]);
        setSelectedRate(null);
        return;
      }
      
      // Fallback rates if API fails
      setRates([
        {
          code: 'ground',
          name: 'Standard Shipping',
          price: 9.99,
          estimatedDays: '5-7 business days',
          carrier: 'UPS',
        },
        {
          code: '2day',
          name: 'Express Shipping',
          price: 24.99,
          estimatedDays: '2 business days',
          carrier: 'UPS',
        },
        {
          code: 'overnight',
          name: 'Next Day',
          price: 49.99,
          estimatedDays: '1 business day',
          carrier: 'UPS',
        },
      ]);
      setSelectedRate({
        code: 'ground',
        name: 'Standard Shipping',
        price: 9.99,
        estimatedDays: '5-7 business days',
        carrier: 'UPS',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = () => {
    if (!selectedRate) return;
    
    onComplete({
      method: selectedRate.code,
      service: selectedRate.name,
      price: selectedRate.price,
      carrier: selectedRate.carrier,
      estimatedDelivery: selectedRate.estimatedDelivery,
    }, rates);
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[300px]">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-chrome-border border-t-blue-500 rounded-full animate-spin"></div>
          <Truck className="absolute inset-0 m-auto text-gray-500" size={24} />
        </div>
        <p className="text-chrome-secondary mt-4">Calculating shipping rates...</p>
        <p className="text-gray-600 text-sm mt-1">
          Shipping to {address.city}, {address.state} {address.zip}
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {/* Shipping To Summary */}
      <div className="bg-gray-800/30 rounded-xl p-4">
        <p className="text-chrome-secondary text-xs uppercase tracking-wide mb-1">Shipping to</p>
        <p className="text-white">
          {address.name}
        </p>
        <p className="text-chrome-secondary text-sm">
          {address.street}{address.street2 ? `, ${address.street2}` : ''}
        </p>
        <p className="text-chrome-secondary text-sm">
          {address.city}, {address.state} {address.zip}
        </p>
      </div>

      {/* Package Info */}
      {packageInfo && (
        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <Package size={14} />
          <span>
            Package: {packageInfo.dimensions.length}" × {packageInfo.dimensions.width}" × {packageInfo.dimensions.height}" 
            ({packageInfo.weight} lbs)
          </span>
        </div>
      )}

      {/* Shipping Options */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-300">Select shipping speed</p>
        
        {rates.map((rate) => {
          const Icon = SHIPPING_ICONS[rate.code] || Truck;
          const isSelected = selectedRate?.code === rate.code;
          
          return (
            <button
              key={rate.code}
              onClick={() => setSelectedRate(rate)}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                isSelected
                  ? 'border-white-100 bg-white-100'
                  : 'border-chrome-border bg-gray-800/30 hover:border-gray-600'
              }`}
            >
              <div className={`p-2 rounded-lg ${
                isSelected ? 'bg-gray-300/20 text-gray-300' : 'bg-chrome-border/50 text-chrome-secondary'
              }`}>
                <Icon size={20} />
              </div>
              
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                    {rate.name}
                  </span>
                  {rate.code === 'overnight' && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                      Fastest
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-gray-500 text-sm">{rate.estimatedDays}</span>
                  {rate.estimatedDelivery && (
                    <>
                      <span className="text-gray-600">•</span>
                      <span className="text-gray-500 text-sm flex items-center gap-1">
                        <Calendar size={12} />
                        Est. {formatDate(rate.estimatedDelivery)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              
              <div className="text-right">
                <span className={`font-semibold ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                  ${rate.price.toFixed(2)}
                </span>
              </div>
              
              {/* Radio indicator */}
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                isSelected ? 'border-gray-300' : 'border-chrome-border'
              }`}>
                {isSelected && (
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Order Summary Preview */}
      <div className="bg-gray-800/30 rounded-xl p-4 mt-6">
        <div className="flex justify-between text-sm text-chrome-secondary">
          <span>Qty {quoteData.quantity || 1}</span>
          <span>{quoteData.quantity > 1 ? `$${(quoteData.unitSubtotal || quoteData.subtotal).toFixed(2)} each` : ''}</span>
        </div>
        <div className="flex justify-between text-sm text-chrome-secondary mt-1">
          <span>Subtotal</span>
          <span>${quoteData.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-chrome-secondary mt-1">
          <span>Shipping</span>
          <span>${selectedRate?.price.toFixed(2) || '—'}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-500 mt-1">
          <span>Tax</span>
          <span>Calculated at checkout</span>
        </div>
        <div className="border-t border-chrome-border mt-3 pt-3 flex justify-between">
          <span className="font-medium text-white">Estimated Total</span>
          <span className="font-semibold text-white">
            ${(quoteData.subtotal + (selectedRate?.price || 0)).toFixed(2)}+
          </span>
        </div>
      </div>

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        disabled={!selectedRate}
        className="w-full py-3 bg-gray-300 text-black rounded-xl font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
      >
        Continue to Payment
      </button>
    </div>
  );
};

export default ShippingStep;
