// components/OrderModal.jsx - Main order flow modal with checkout state persistence
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import AuthStep from './order/AuthStep';
import AddressStep from './order/AddressStep';
import ShippingStep from './order/ShippingStep';
import PaymentStep from './order/PaymentStep';
import ConfirmationStep from './order/ConfirmationStep';
import ConvertAccountStep from './order/ConvertAccountStep';
import QuantityStepper from './order/QuantityStepper';
import CheckoutStepper from './CheckoutStepper';
import { applyClientQuantity, clampQuantity } from '../utils/quoteMath.js';
import { saveCheckoutState, getOAuthReturnUrl } from '../utils/checkoutStorage';
import { saveEditorState } from '../utils/editorStorage';
import { startGithubOAuth } from '../utils/git/githubAuth.js';
import ModalFit from './ModalFit';

const STEPS = {
  AUTH: 'auth',
  ADDRESS: 'address',
  SHIPPING: 'shipping',
  PAYMENT: 'payment',
  CONFIRMATION: 'confirmation',
  CONVERT: 'convert',
};

const OrderModal = ({ 
  onClose, 
  quoteData,
  modelData,
  currentScript,
  restoredStep,
  restoredAddress,
  restoredGuestEmail,
  onOpenAccount,
  checkoutStep = null,
  lineId = null,
  onOrderPlaced,
  hasNextPart = false,
  onNextPart,
}) => {
  const [currentStep, setCurrentStep] = useState(restoredStep || STEPS.AUTH);
  const [user, setUser] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [guestEmail, setGuestEmail] = useState(restoredGuestEmail || '');
  const [address, setAddress] = useState(restoredAddress || null);
  const [shippingOption, setShippingOption] = useState(null);
  // value kept for future re-render of restored rates; setter is live (handleShippingComplete)
  const [_shippingRates, setShippingRates] = useState([]);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [quantity, setQuantity] = useState(() => clampQuantity(quoteData?.quantity, { missing: 1 }) || 1);
  const liveQuote = useMemo(
    () => applyClientQuantity(quoteData, quantity),
    [quoteData, quantity],
  );

  // Check existing auth on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Auto-advance from auth step after auth detection
  useEffect(() => {
    if (currentStep === STEPS.AUTH) {
      if (user) {
        if (user.addresses?.length > 0) {
          const defaultAddr = user.addresses.find(a => a.isDefault) || user.addresses[0];
          setAddress(defaultAddr);
          setCurrentStep(STEPS.SHIPPING);
        } else {
          setCurrentStep(STEPS.ADDRESS);
        }
      } else if (isGuest) {
        setCurrentStep(STEPS.ADDRESS);
      }
    }
  }, [user, isGuest, currentStep]);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await response.json();
      
      if (data.authenticated) {
        setUser(data.user);
        // For restored state, addresses are handled in the auto-advance effect
      } else if (data.guest) {
        setIsGuest(true);
        setGuestEmail(data.guest.email);
        if (data.guest.address) {
          setAddress(data.guest.address);
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  };

  // Save state before OAuth redirect
  const handleSaveAndRedirect = useCallback((provider) => {
    // Save editor state
    saveEditorState({
      currentScript,
      currentFilename: null, // TO-DO Add currentFilename prop
    });

    const checkout = true;
    
    // Save checkout state
    saveCheckoutState({
      quoteData: liveQuote,
      modelData,
      currentStep,
      address,
      guestEmail,
      checkout,
      lineId,
      script: currentScript,
    });

    // G8: GitHub reuses githubAuth → /git/callback (not passport /api/auth/github)
    if (provider === 'github') {
      if (!startGithubOAuth()) {
        setError('GitHub sign-in is not configured (set GITHUB_APP_CLIENT_ID)');
      }
      return;
    }

    const returnUrl = encodeURIComponent(getOAuthReturnUrl());
    const authUrl = `/api/auth/${provider}?returnTo=${returnUrl}`;
    
    window.location.href = authUrl;
  }, [liveQuote, modelData, currentScript, currentStep, address, guestEmail, lineId]);

  // Handle auth completion (for non-OAuth flows like guest checkout)
  const handleAuthComplete = useCallback((authData) => {
    if (authData.user) {
      setUser(authData.user);
      setIsGuest(false);
      // Advancement handled by useEffect
    } else if (authData.guest) {
      setIsGuest(true);
      setGuestEmail(authData.guest.email);
      // Advancement handled by useEffect
    }
  }, []);

  // Handle address completion
  const handleAddressComplete = useCallback((addressData) => {
    setAddress(addressData);
    setCurrentStep(STEPS.SHIPPING);
  }, []);

  // Handle shipping selection
  const handleShippingComplete = useCallback((shipping, rates) => {
    setShippingOption(shipping);
    setShippingRates(rates);
    setCurrentStep(STEPS.PAYMENT);
  }, []);

  // Handle payment completion
  const handlePaymentComplete = useCallback((orderData) => {
    setOrder(orderData);
    onOrderPlaced?.(orderData);
    setCurrentStep(STEPS.CONFIRMATION);
  }, [onOrderPlaced]);

  // Handle account conversion prompt
  const handleConvertAccount = useCallback(() => {
    setCurrentStep(STEPS.CONVERT);
  }, []);

  // Handle account conversion completion
  const handleConversionComplete = useCallback((userData) => {
    setUser(userData);
    setIsGuest(false);
    setCurrentStep(STEPS.CONFIRMATION);
  }, []);

  const handleViewOrders = () => {
    onClose();
    onOpenAccount('orders');
  };

  // Go back to previous step
  const handleBack = useCallback(() => {
    switch (currentStep) {
      case STEPS.ADDRESS:
        setCurrentStep(STEPS.AUTH);
        break;
      case STEPS.SHIPPING:
        setCurrentStep(STEPS.ADDRESS);
        break;
      case STEPS.PAYMENT:
        setCurrentStep(STEPS.SHIPPING);
        break;
      case STEPS.CONVERT:
        setCurrentStep(STEPS.CONFIRMATION);
        break;
      default:
        break;
    }
  }, [currentStep]);

  // Get step title
  const getStepTitle = () => {
    switch (currentStep) {
      case STEPS.AUTH: return 'Sign In';
      case STEPS.ADDRESS: return 'Shipping Address';
      case STEPS.SHIPPING: return 'Shipping Method';
      case STEPS.PAYMENT: return 'Payment';
      case STEPS.CONFIRMATION: return 'Order Confirmed';
      case STEPS.CONVERT: return 'Create Account';
      default: return 'Checkout';
    }
  };

  // Can go back?
  const canGoBack = [STEPS.ADDRESS, STEPS.SHIPPING, STEPS.PAYMENT, STEPS.CONVERT].includes(currentStep);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case STEPS.AUTH:
        return (
          <AuthStep
            onComplete={handleAuthComplete}
            onOAuthRedirect={handleSaveAndRedirect}
            onError={setError}
            orderContext={true}
          />
        );
        
      case STEPS.ADDRESS:
        return (
          <AddressStep
            initialAddress={address}
            onComplete={handleAddressComplete}
            onError={setError}
            isGuest={isGuest}
          />
        );
        
      case STEPS.SHIPPING:
        return (
          <ShippingStep
            key={`${liveQuote.quantity}:${liveQuote.materialGrams}`}
            address={address}
            quoteData={liveQuote}
            modelData={modelData}
            onComplete={handleShippingComplete}
            onError={setError}
          />
        );
        
      case STEPS.PAYMENT:
        return (
          <PaymentStep
            key={`${liveQuote.quantity}:${liveQuote.subtotal}:${shippingOption?.method}:${shippingOption?.price}`}
            quoteData={liveQuote}
            modelData={modelData}
            address={address}
            shippingOption={shippingOption}
            currentScript={currentScript}
            user={user}
            guestEmail={guestEmail}
            onComplete={handlePaymentComplete}
            onError={setError}
          />
        );
        
      case STEPS.CONFIRMATION:
        return (
          <ConfirmationStep
            order={order}
            isGuest={isGuest}
            onConvertAccount={handleConvertAccount}
            onClose={onClose}
            onViewOrders={handleViewOrders}
            onNextPart={hasNextPart ? onNextPart : null}
          />
        );
        
      case STEPS.CONVERT:
        return (
          <ConvertAccountStep
            email={guestEmail}
            address={address}
            onComplete={handleConversionComplete}
            onSkip={() => setCurrentStep(STEPS.CONFIRMATION)}
            onError={setError}
          />
        );
        
      default:
        return null;
    }
  };

  return (
    <ModalFit className="surface-scrim flex items-center justify-center z-50 px-4">
      <div className="modal-fit-panel surface-glass rounded-2xl shadow-2xl max-w-lg w-full flex flex-col border border-chrome-border/50">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-chrome-border/50">
          <div className="flex items-center gap-3">
            {canGoBack && (
              <button
                onClick={handleBack}
                className="p-1.5 hover:bg-chrome-border/50 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} className="text-chrome-secondary" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-white">
              {getStepTitle()}
            </h2>
          </div>
          {currentStep !== STEPS.CONFIRMATION && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-chrome-border/50 rounded-lg transition-colors"
            >
              <X size={20} className="text-chrome-secondary" />
            </button>
          )}
        </div>

        {checkoutStep ? <CheckoutStepper {...checkoutStep} /> : null}

        {/* Progress Indicator */}
        {currentStep !== STEPS.CONFIRMATION && currentStep !== STEPS.CONVERT && (
          <div className="px-5 py-3 border-b border-chrome-border/30">
            <div className="flex items-center gap-2">
              {[STEPS.AUTH, STEPS.ADDRESS, STEPS.SHIPPING, STEPS.PAYMENT].map((step, idx) => (
                <React.Fragment key={step}>
                  <div
                    className={`w-2 h-2 rounded-full transition-colors ${
                      currentStep === step 
                        ? 'bg-gray-200' 
                        : [STEPS.AUTH, STEPS.ADDRESS, STEPS.SHIPPING, STEPS.PAYMENT].indexOf(currentStep) > idx
                          ? 'bg-gray-200'
                          : 'bg-chrome-border'
                    }`}
                  />
                  {idx < 3 && (
                    <div className={`flex-1 h-0.5 ${
                      [STEPS.AUTH, STEPS.ADDRESS, STEPS.SHIPPING, STEPS.PAYMENT].indexOf(currentStep) > idx
                        ? 'bg-gray-200' 
                        : 'bg-chrome-border'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {currentStep !== STEPS.CONFIRMATION && currentStep !== STEPS.CONVERT && (
          <div className="px-5 pt-4">
            <QuantityStepper
              id="order-quantity"
              value={quantity}
              onChange={(next) => {
                setQuantity(next);
                if (currentStep === STEPS.PAYMENT) {
                  setShippingOption(null);
                  setCurrentStep(STEPS.SHIPPING);
                }
              }}
            />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-300 text-xs underline mt-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto">
          {renderStep()}
        </div>
      </div>
    </ModalFit>
  );
};

export default OrderModal;