// components/order/ConfirmationStep.jsx - Order confirmation
import React from 'react';
import { CheckCircle, Package, Mail } from 'lucide-react';

const ConfirmationStep = ({ order, isGuest, onConvertAccount, onClose, onViewOrders, onNextPart }) => {
  return (
    <div className="p-6 text-center">
      {/* Success Animation */}
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 bg-green-500/20 rounded-full animate-ping"></div>
        <div className="relative w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-green-500" />
        </div>
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-white mb-2">
        Order Confirmed!
      </h2>
      <p className="text-chrome-secondary mb-6">
        Thank you for your order. We're getting started on it right away.
      </p>

      {/* Order Number */}
      <div className="bg-gray-800/50 rounded-xl p-4 mb-6">
        <p className="text-chrome-secondary text-sm mb-1">Order Number</p>
        <p className="text-2xl font-mono font-bold text-white tracking-wider">
          {order.orderNumber}
        </p>
        <p className="text-chrome-secondary text-sm mt-2" data-order-qty="">Qty {order.quantity || 1}</p>
      </div>

      {/* Order Details */}
      <div className="bg-gray-800/30 rounded-xl p-4 mb-6 text-left">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Package className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-white font-medium">Order Details</p>
            <p className="text-gray-500 text-sm">What happens next</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-green-400 text-xs font-bold">1</span>
            </div>
            <div>
              <p className="text-gray-300 text-sm font-medium">Order Received</p>
              <p className="text-gray-500 text-xs">We've received your order and payment</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-chrome-border flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-chrome-secondary text-xs font-bold">2</span>
            </div>
            <div>
              <p className="text-gray-300 text-sm font-medium">Manufacturing</p>
              <p className="text-gray-500 text-xs">Your part will be manufactured with care</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-chrome-border flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-chrome-secondary text-xs font-bold">3</span>
            </div>
            <div>
              <p className="text-gray-300 text-sm font-medium">Quality Check</p>
              <p className="text-gray-500 text-xs">Each part is inspected before shipping</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-chrome-border flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-chrome-secondary text-xs font-bold">4</span>
            </div>
            <div>
              <p className="text-gray-300 text-sm font-medium">Shipped</p>
              <p className="text-gray-500 text-xs">You'll receive tracking info via email</p>
            </div>
          </div>
        </div>
      </div>

      {/* Email Confirmation */}
      <div className="flex items-center justify-center gap-2 text-chrome-secondary text-sm mb-6">
        <Mail size={16} />
        <span>Confirmation email sent</span>
      </div>

      {/* Guest Account Conversion / View Orders */}
      {isGuest ? (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
          <p className="text-blue-400 font-medium mb-2">
            Create an account to track your order
          </p>
          <p className="text-chrome-secondary text-sm mb-4">
            Add a password to save your details for future orders.
          </p>
          <button
            onClick={onConvertAccount}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Create Account
          </button>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          <button
            onClick={onViewOrders}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            View My Orders
          </button>
        </div>
      )}

      {onNextPart ? (
        <button
          type="button"
          data-checkout-next=""
          onClick={onNextPart}
          className="w-full py-3 mb-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
        >
          Next part
        </button>
      ) : null}

      {/* Close Button */}
      <button
        onClick={onClose}
        className="w-full py-3 bg-chrome-border text-white rounded-xl font-medium hover:bg-gray-600 transition-colors"
      >
        Done
      </button>
    </div>
  );
};

export default ConfirmationStep;
