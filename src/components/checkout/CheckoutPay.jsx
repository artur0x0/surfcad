/**
 * One card payment for the order the page already created.
 * `priceUpdated` keeps Pay disabled until the user confirms the server total.
 */
import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';
import TermsModal from '../TermsModal';
import { confirmCheckoutPayment } from '../../utils/checkoutPay.js';

let stripePromise = null;
let stripeKey = '';

function getStripe(publishableKey) {
  if (!publishableKey) return null;
  if (!stripePromise || stripeKey !== publishableKey) {
    stripeKey = publishableKey;
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
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
          The card form didn&apos;t load. The total above is still the amount to pay.
        </p>
      );
    }
    return this.props.children;
  }
}

function PayForm({ order, priceUpdated, onPaid, onError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [priceConfirmed, setPriceConfirmed] = useState(false);
  const payLocked = priceUpdated && !priceConfirmed;

  const handlePay = async (event) => {
    event.preventDefault();
    if (busy || payLocked || !termsAccepted) {
      if (!termsAccepted) setPayError('Please accept the Terms of Sale to continue.');
      return;
    }
    setBusy(true);
    setPayError('');
    try {
      const result = await confirmCheckoutPayment({
        stripe,
        elements,
        orderId: order.id,
      });
      onPaid?.(result);
    } catch (err) {
      const message = err?.message || 'Payment failed';
      setPayError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handlePay} className="space-y-4" data-checkout-pay-form="">
      <div className="rounded-xl bg-gray-800/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-gray-300">
          <CreditCard size={16} />
          Payment
        </div>
        <StripeFrame>
          <PaymentElement />
        </StripeFrame>
      </div>

      <label className="flex items-start gap-3 text-sm text-chrome-secondary">
        <input
          type="checkbox"
          data-checkout-terms=""
          checked={termsAccepted}
          onChange={(e) => {
            setTermsAccepted(e.target.checked);
            if (e.target.checked) setPayError('');
          }}
          className="mt-1"
        />
        <span>
          I agreed to the{' '}
          <button type="button" className="text-blue-400 underline" onClick={() => setShowTerms(true)}>
            Terms of Sale
          </button>
          . Sales are final.
        </span>
      </label>

      {priceUpdated && (
        <div className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-900/30 p-4" data-price-updated="">
          <p className="text-sm font-medium text-amber-200">
            Price updated to ${Number(order.total || 0).toFixed(2)}
          </p>
          <p className="text-xs text-amber-100/80">
            The server recomputed this order. Confirm the new total before paying.
          </p>
          {!priceConfirmed && (
            <button
              type="button"
              data-price-confirm=""
              onClick={() => setPriceConfirmed(true)}
              className="w-full rounded-lg bg-amber-500 py-2 font-medium text-black hover:bg-amber-400"
            >
              Confirm updated price
            </button>
          )}
        </div>
      )}

      {payError && <p className="text-sm text-red-300">{payError}</p>}

      <p className="flex items-center justify-center gap-2 text-xs text-gray-500">
        <ShieldCheck size={14} />
        Secured by Stripe. One payment for this order.
      </p>

      <button
        type="submit"
        data-checkout-pay=""
        disabled={!stripe || busy || payLocked || !termsAccepted}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
        Pay ${Number(order.total || 0).toFixed(2)}
      </button>

      {showTerms && (
        <TermsModal
          onClose={() => setShowTerms(false)}
          onAccept={() => {
            setTermsAccepted(true);
            setShowTerms(false);
            setPayError('');
          }}
        />
      )}
    </form>
  );
}

export default function CheckoutPay({ order, priceUpdated, clientSecret, publishableKey, onPaid, onError }) {
  if (!clientSecret || !publishableKey) {
    return <p className="text-sm text-red-300">Payment could not be started.</p>;
  }
  const options = {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#3b82f6',
        colorBackground: '#1f2937',
        colorText: '#ffffff',
        borderRadius: '12px',
      },
    },
  };
  return (
    <Elements stripe={getStripe(publishableKey)} options={options}>
      <PayForm
        order={order}
        priceUpdated={!!priceUpdated}
        onPaid={onPaid}
        onError={onError}
      />
    </Elements>
  );
}
