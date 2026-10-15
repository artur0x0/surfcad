// components/order/PaymentStep.jsx - Payment with Stripe Elements
/* eslint-disable react-hooks/exhaustive-deps -- createOrderRef guards double-submit;
   effect must bind once on mount (see ref pattern below) */
import React, { useState, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Loader2, Lock, CreditCard, ShieldCheck } from 'lucide-react';
import TermsModal from '../TermsModal';
import { clientOrderQuote, quantityRejectionMessage, readJsonSafe } from '../../utils/quoteMath.js';

// Stripe promise - loaded once
let stripePromise = null;

const getStripe = (publishableKey) => {
  if (!stripePromise && publishableKey) {
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};

function OrderSummary({ order, quoteData, shippingOption }) {
  return (
    <div className="bg-gray-800/30 rounded-xl p-4" data-payment-summary="">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Order Summary</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-chrome-secondary" data-payment-qty="">
          <span>Qty {order.quantity || quoteData.quantity || 1}</span>
          <span></span>
        </div>
        <div className="flex justify-between text-chrome-secondary">
          <span>{quoteData.process} - {quoteData.material}</span>
          <span>${(order.subtotal ?? quoteData.subtotal).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-chrome-secondary">
          <span>{shippingOption.service}</span>
          <span>${(order.shipping ?? shippingOption.price).toFixed(2)}</span>
        </div>
        {order.tax > 0 && (
          <div className="flex justify-between text-chrome-secondary">
            <span>Tax</span>
            <span>${order.tax.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-chrome-border pt-2 mt-2 flex justify-between font-medium text-white">
          <span>Total</span>
          <span>${Number(order.total || 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

class StripeFrame extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="text-sm text-amber-200" data-payment-card-unavailable="">
          The card form didn't load. The total above is still the amount to pay.
        </p>
      );
    }
    return this.props.children;
  }
}

// Inner payment form component
const PaymentForm = ({ 
  order, 
  onComplete, 
  onError,
  quoteData,
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [priceConfirmed, setPriceConfirmed] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    if (!termsAccepted) {
      setPaymentError('Please accept the Terms of Sale to continue.');
      return;
    }

    setIsProcessing(true);
    setPaymentError(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/order/confirm`,
        },
        redirect: 'if_required',
      });

      if (error) {
        setPaymentError(error.message);
        onError(error.message);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment successful - confirm with backend
        const confirmResponse = await fetch(`/api/orders/${order.id}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            paymentIntentId: paymentIntent.id,
          }),
        });

        const confirmData = await readJsonSafe(confirmResponse);

        if (!confirmResponse.ok) {
          const rejected = quantityRejectionMessage(confirmResponse.status, confirmData);
          throw new Error(rejected || confirmData.error || 'Failed to confirm order');
        }

        onComplete({
          orderNumber: confirmData.order?.orderNumber,
          total: confirmData.order?.total,
          status: confirmData.order?.status,
          quantity: Number(confirmData.order?.quantity) || quoteData.quantity || 1,
        });
      }
    } catch (err) {
      console.error('Payment error:', err);
      setPaymentError(err.message);
      onError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTermsAccept = () => {
    setTermsAccepted(true);
    setShowTermsModal(false);
    setPaymentError(null);
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Stripe Payment Element */}
        <div className="bg-gray-800/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={18} className="text-chrome-secondary" />
            <span className="text-sm font-medium text-gray-300">Payment Details</span>
          </div>
          
          <PaymentElement 
            options={{
              layout: 'tabs',
              defaultValues: {
                billingDetails: {
                  name: '',
                },
              },
            }}
          />
        </div>

        {/* Terms of Sale Checkbox */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="terms-checkbox"
            checked={termsAccepted}
            onChange={(e) => {
              setTermsAccepted(e.target.checked);
              if (e.target.checked) setPaymentError(null);
            }}
            className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
          />
          <label htmlFor="terms-checkbox" className="text-sm text-chrome-secondary cursor-pointer">
            I carefully reviewed and agreed with the{' '}
            <button
              type="button"
              onClick={() => setShowTermsModal(true)}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Terms of Sale
            </button>
            , including that all sales are final, and parts are provided without warranty of fitness for any particular purpose and are NOT intended for use in ITAR, medical, aerospace, food contact or safety-critical applications.
          </label>
        </div>

        {order.priceUpdated && (
          <div className="bg-amber-900/30 border border-amber-500/50 rounded-xl p-4 space-y-3" data-price-updated>
            <p className="text-amber-200 text-sm font-medium">
              Price updated to ${order.total.toFixed(2)}
            </p>
            <p className="text-amber-100/80 text-xs">
              The server recomputed this order. Confirm the new total before paying.
            </p>
            {!priceConfirmed && (
              <button
                type="button"
                onClick={() => setPriceConfirmed(true)}
                className="w-full py-2 bg-amber-500 text-black rounded-lg font-medium hover:bg-amber-400 transition-colors"
              >
                Confirm updated price
              </button>
            )}
          </div>
        )}

        {/* Payment Error */}
        {paymentError && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-4">
            <p className="text-red-400 text-sm">{paymentError}</p>
          </div>
        )}

        {/* Security Note */}
        <div className="flex items-center justify-center gap-2 text-gray-500 text-xs">
          <ShieldCheck size={14} />
          <span>Secured by Stripe. Your payment info is encrypted.</span>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!stripe || isProcessing || (order.priceUpdated && !priceConfirmed)}
          className="w-full py-4 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              Processing...
            </>
          ) : (
            <>
              <Lock size={18} />
              Pay ${order.total.toFixed(2)}
            </>
          )}
        </button>
      </form>

      {/* Terms Modal */}
      {showTermsModal && (
        <TermsModal
          onClose={() => setShowTermsModal(false)}
          onAccept={handleTermsAccept}
        />
      )}
    </>
  );
};

// Main PaymentStep component
const PaymentStep = ({
  quoteData,
  modelData,
  address,
  shippingOption,
  currentScript,
  onComplete,
  onError,
}) => {
  const [isCreatingOrder, setIsCreatingOrder] = useState(true);
  const [createError, setCreateError] = useState(null);
  const [order, setOrder] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [stripeKey, setStripeKey] = useState(null);
  const createOrderRef = useRef(false);

  // Create order and get payment intent on mount
  useEffect(() => {
    if (createOrderRef.current) return;
    createOrderRef.current = true;

    createOrder();
  }, []);

  const createOrder = async () => {
    setIsCreatingOrder(true);
    setCreateError(null);

    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          modelData: {
            script: currentScript,
            process: quoteData.process,
            material: quoteData.material,
            infill: quoteData.infill,
            volume: quoteData.volume,
            surfaceArea: quoteData.surfaceArea,
            boundingBox: modelData.boundingBox,
            modelFile: modelData.modelFile,
            quantity: quoteData.quantity || 1,
          },
          quote: clientOrderQuote(quoteData, shippingOption.price),
          shipping: {
            address,
            method: shippingOption.method,
            service: shippingOption.service,
            estimatedDelivery: shippingOption.estimatedDelivery,
          },
        }),
      });

      const data = await readJsonSafe(response);

      if (!response.ok) {
        const rejected = quantityRejectionMessage(response.status, data);
        throw new Error(rejected || data.error || 'Failed to create order');
      }

      setOrder({
        ...data.order,
        priceUpdated: data.priceUpdated === true,
      });
      setClientSecret(data.clientSecret);
      setStripeKey(data.publishableKey);

    } catch (error) {
      console.error('Order creation error:', error);
      setCreateError(error.message);
      onError(error.message);
    } finally {
      setIsCreatingOrder(false);
    }
  };

  // Loading state while creating order
  if (isCreatingOrder) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[300px]">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-chrome-border border-t-gray-300 rounded-full animate-spin"></div>
          <CreditCard className="absolute inset-0 m-auto text-gray-500" size={24} />
        </div>
        <p className="text-chrome-secondary mt-4">Preparing your order...</p>
      </div>
    );
  }

  // Error state if order creation failed
  if (!order || !clientSecret || !stripeKey) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-400">{createError || 'Failed to initialize payment.'}</p>
        <button
          onClick={createOrder}
          className="mt-4 px-6 py-2 bg-chrome-border text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Stripe Elements options
  const options = {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#3b82f6',
        colorBackground: '#1f2937',
        colorText: '#ffffff',
        colorDanger: '#ef4444',
        fontFamily: 'system-ui, sans-serif',
        borderRadius: '12px',
        spacingUnit: '4px',
      },
      rules: {
        '.Input': {
          backgroundColor: '#374151',
          border: '1px solid #4b5563',
        },
        '.Input:focus': {
          border: '1px solid #3b82f6',
          boxShadow: '0 0 0 1px #3b82f6',
        },
        '.Label': {
          color: '#9ca3af',
        },
        '.Tab': {
          backgroundColor: '#374151',
          border: '1px solid #4b5563',
        },
        '.Tab:hover': {
          backgroundColor: '#4b5563',
        },
        '.Tab--selected': {
          backgroundColor: '#1f2937',
          borderColor: '#3b82f6',
        },
      },
    },
  };

  return (
    <div className="p-5 space-y-6">
      <OrderSummary order={order} quoteData={quoteData} shippingOption={shippingOption} />
      <StripeFrame>
        <Elements stripe={getStripe(stripeKey)} options={options}>
          <PaymentForm
            order={order}
            onComplete={onComplete}
            onError={onError}
            quoteData={quoteData}
          />
        </Elements>
      </StripeFrame>
    </div>
  );
};

export default PaymentStep;
