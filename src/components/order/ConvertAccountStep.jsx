// components/order/ConvertAccountStep.jsx - Convert guest to account
import React, { useEffect, useState } from 'react';
import { Lock, Loader2, UserPlus, Check } from 'lucide-react';

const ConvertAccountStep = ({ email, address, onComplete, onSkip, onError }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [errors, setErrors] = useState({});

  const requestCode = async () => {
    setSendingCode(true);
    try {
      const response = await fetch('/api/auth/guest/convert/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onError(data.error || 'Could not send a verification code');
        return false;
      }
      setCodeSent(true);
      return true;
    } catch {
      onError('Could not send a verification code');
      return false;
    } finally {
      setSendingCode(false);
    }
  };

  useEffect(() => {
    requestCode();
    // Send once when this step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateForm = () => {
    const newErrors = {};

    if (!code || String(code).trim().length < 6) {
      newErrors.code = 'Enter the 6-digit code from your email';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/guest/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password, code: String(code).trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create account');
      }

      onComplete(data.user);
    } catch (error) {
      onError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <UserPlus className="w-8 h-8 text-blue-400" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">
          Create Your Account
        </h3>
        <p className="text-chrome-secondary text-sm">
          We emailed a code to confirm this address, then add a password
        </p>
      </div>

      {/* Saved Info Summary */}
      <div className="bg-gray-800/30 rounded-xl p-4 mb-6">
        <p className="text-chrome-secondary text-xs uppercase tracking-wide mb-2">
          Your saved information
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-green-400" />
            <span className="text-gray-300 text-sm">{email}</span>
          </div>
          {address && (
            <div className="flex items-center gap-2">
              <Check size={14} className="text-green-400" />
              <span className="text-gray-300 text-sm">
                {address.street}, {address.city}, {address.state}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Password Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Verification code
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (errors.code) setErrors({ ...errors, code: null });
            }}
            className={`w-full bg-gray-800/50 border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none transition-colors ${
              errors.code ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
            }`}
            placeholder="6-digit code"
          />
          {errors.code && (
            <p className="text-red-400 text-xs mt-1">{errors.code}</p>
          )}
          <button
            type="button"
            onClick={requestCode}
            disabled={sendingCode}
            className="mt-2 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {sendingCode ? 'Sending…' : codeSent ? 'Resend code' : 'Send code'}
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Create Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors({ ...errors, password: null });
              }}
              className={`w-full bg-gray-800/50 border rounded-xl py-3 px-10 text-white placeholder-gray-500 focus:outline-none transition-colors ${
                errors.password ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
              }`}
              placeholder="At least 8 characters"
            />
          </div>
          {errors.password && (
            <p className="text-red-400 text-xs mt-1">{errors.password}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Confirm Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword) setErrors({ ...errors, confirmPassword: null });
              }}
              className={`w-full bg-gray-800/50 border rounded-xl py-3 px-10 text-white placeholder-gray-500 focus:outline-none transition-colors ${
                errors.confirmPassword ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
              }`}
              placeholder="Confirm your password"
            />
          </div>
          {errors.confirmPassword && (
            <p className="text-red-400 text-xs mt-1">{errors.confirmPassword}</p>
          )}
        </div>

        {/* Benefits */}
        <div className="bg-gray-800/20 rounded-xl p-4 space-y-2">
          <p className="text-gray-300 text-sm font-medium">With an account you can:</p>
          <ul className="space-y-1.5 text-chrome-secondary text-sm">
            <li className="flex items-center gap-2">
              <Check size={14} className="text-green-400" />
              Track your order status
            </li>
            <li className="flex items-center gap-2">
              <Check size={14} className="text-green-400" />
              View order history
            </li>
            <li className="flex items-center gap-2">
              <Check size={14} className="text-green-400" />
              Save addresses for faster checkout
            </li>
            <li className="flex items-center gap-2">
              <Check size={14} className="text-green-400" />
              Save your designs
            </li>
          </ul>
        </div>

        {/* Buttons */}
        <div className="space-y-3 pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Creating Account...
              </>
            ) : (
              'Create Account'
            )}
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="w-full py-2 text-chrome-secondary text-sm hover:text-white transition-colors"
          >
            Skip for now
          </button>
        </div>
      </form>
    </div>
  );
};

export default ConvertAccountStep;
