// components/order/AuthStep.jsx - Authentication step with email verification
import React, { useState, useEffect, useRef } from 'react';
import { Mail, Lock, User, Loader2, ArrowLeft, RefreshCw, Eye, EyeOff } from 'lucide-react';
import {
  startGithubOAuth,
  resolveGithubClientId,
  GITHUB_SIGNIN_SUBTITLE,
} from '../../utils/git/githubAuth.js';
import { oauthStartPath, withAnalyticsConsent } from '../../utils/analyticsConsentAuth.js';

const AuthStep = ({ onComplete, onOAuthRedirect, onError, orderContext }) => {
  const [mode, setMode] = useState('options'); // 'options', 'login', 'signup', 'guest', 'verify'
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });
  const [formErrors, setFormErrors] = useState({});
  
  // Verification state
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verificationError, setVerificationError] = useState('');
  
  const codeInputRefs = useRef([]);

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Validate signup form
  const validateSignupForm = () => {
    const errors = {};
    
    if (!formData.email) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email';
    }
    
    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }
    
    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle OAuth login (GitHub reuses G7 githubAuth → /git/callback)
  const handleOAuthLogin = (provider) => {
    if (provider === 'github') {
      if (onOAuthRedirect) {
        onOAuthRedirect('github');
        return;
      }
      if (!startGithubOAuth()) {
        onError?.('GitHub sign-in is not configured (set GITHUB_APP_CLIENT_ID)');
      }
      return;
    }
    if (onOAuthRedirect) {
      onOAuthRedirect(provider);
    } else {
      window.location.href = oauthStartPath(
        provider,
        `${window.location.pathname}?checkout=true`,
      );
    }
  };

  const githubReady = !!resolveGithubClientId();

  // Handle local login
  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(withAnalyticsConsent({
          email: formData.email,
          password: formData.password,
        })),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Check if verification is required
        if (data.pendingVerification) {
          setVerificationEmail(data.email);
          setMode('verify');
          setResendCooldown(60); // Start cooldown since a code was just sent
          return;
        }
        throw new Error(data.error || 'Login failed');
      }
      
      onComplete({ user: data.user });
    } catch (error) {
      onError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle signup
  const handleSignup = async (e) => {
    e.preventDefault();
    
    if (!validateSignupForm()) {
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(withAnalyticsConsent({
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
        })),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }
      
      // Check if verification is required
      if (data.pendingVerification) {
        setVerificationEmail(data.email);
        setMode('verify');
        setResendCooldown(60);
        return;
      }
      
      onComplete({ user: data.user });
    } catch (error) {
      onError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle verification code input
  const handleCodeChange = (index, value) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;
    
    const newCode = [...verificationCode];
    newCode[index] = value;
    setVerificationCode(newCode);
    setVerificationError('');
    
    // Auto-focus next input
    if (value && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
    
    // Auto-submit when all digits entered and we still have the password in memory.
    if (value && index === 5 && newCode.every(d => d !== '') && formData.password.length >= 8) {
      handleVerifyCode(newCode.join(''));
    }
  };

  // Handle paste for verification code
  const handleCodePaste = (e) => {
    e.preventDefault();
      const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    
    if (pastedData.length === 6) {
      const newCode = pastedData.split('');
      setVerificationCode(newCode);
      setVerificationError('');
      codeInputRefs.current[5]?.focus();
      
      if (formData.password.length >= 8) {
        handleVerifyCode(pastedData);
      }
    }
  };

  // Handle backspace in code input
  const handleCodeKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !verificationCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  // Verify the code
  const handleVerifyCode = async (code) => {
    if (!formData.password || formData.password.length < 8) {
      setVerificationError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    setVerificationError('');
    
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(withAnalyticsConsent({
          email: verificationEmail,
          code: code || verificationCode.join(''),
          password: formData.password,
        })),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setVerificationError(data.error || 'Verification failed');
        // Clear the code inputs on error
        setVerificationCode(['', '', '', '', '', '']);
        codeInputRefs.current[0]?.focus();
        return;
      }
      
      onComplete({ user: data.user });
    } catch (error) {
      setVerificationError('Verification failed. Please try again.');
      setVerificationCode(['', '', '', '', '', '']);
      codeInputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  // Resend verification code
  const handleResendCode = async () => {
    if (resendCooldown > 0) return;
    
    setIsLoading(true);
    setVerificationError('');
    
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: verificationEmail }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (data.retryAfter) {
          setResendCooldown(data.retryAfter);
        }
        throw new Error(data.error || 'Failed to resend code');
      }
      
      setResendCooldown(60);
      setVerificationCode(['', '', '', '', '', '']);
      codeInputRefs.current[0]?.focus();
    } catch (error) {
      setVerificationError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle guest checkout
  const handleGuestCheckout = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to continue as guest');
      }
      
      onComplete({ guest: data.guest });
    } catch (error) {
      onError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Clear field error when typing
  const handleInputChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    if (formErrors[field]) {
      setFormErrors({ ...formErrors, [field]: null });
    }
  };

  // Render sign in buttons — GitHub first (G8), then Google / Apple / Email
  const renderSignInButtons = () => (
    <div className="space-y-3" data-auth-signin-options="">
      <div data-auth-github-block="">
        <button
          type="button"
          data-auth-github-signin=""
          onClick={() => handleOAuthLogin('github')}
          disabled={!githubReady}
          title={githubReady
            ? 'Sign in with GitHub'
            : 'GitHub sign-in — set GITHUB_APP_CLIENT_ID (and VITE_GITHUB_APP_CLIENT_ID) to enable'}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-xl font-medium hover:bg-chrome-surface transition-colors border border-chrome-border disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3.01.4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58C20.56 21.8 24 17.3 24 12 24 5.37 18.63 0 12 0z"/>
          </svg>
          Sign in with GitHub
        </button>
        <p
          data-auth-github-subtitle=""
          className="mt-1.5 text-center text-xs text-chrome-secondary"
        >
          {GITHUB_SIGNIN_SUBTITLE}
        </p>
      </div>

      <button
        type="button"
        data-auth-google-signin=""
        onClick={() => handleOAuthLogin('google')}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-xl font-medium hover:bg-chrome-surface transition-colors border border-chrome-border"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Sign in with Google
      </button>
      
      <button
        type="button"
        data-auth-apple-signin=""
        onClick={() => handleOAuthLogin('apple')}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-xl font-medium hover:bg-chrome-surface transition-colors border border-chrome-border"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
        </svg>
        Sign in with Apple
      </button>
      
      <button
        type="button"
        data-auth-email-signin=""
        onClick={() => setMode('login')}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-xl font-medium hover:bg-chrome-surface transition-colors border border-chrome-border"
      >
        <Mail size={20} />
        Sign in with Email
      </button>
    </div>
  );

  // Render verification view
  if (mode === 'verify') {
    return (
      <div className="p-5 space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Check your email</h3>
          <p className="text-chrome-secondary text-sm">
            We sent a 6-digit code to<br />
            <span className="text-white font-medium">{verificationEmail}</span>
          </p>
        </div>
        
        {/* Code Input */}
        <div className="flex justify-center gap-2">
          {verificationCode.map((digit, index) => (
            <input
              key={index}
              ref={(el) => (codeInputRefs.current[index] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(index, e.target.value)}
              onKeyDown={(e) => handleCodeKeyDown(index, e)}
              onPaste={index === 0 ? handleCodePaste : undefined}
              className={`w-12 h-14 text-center text-xl font-bold bg-gray-800/50 border rounded-xl text-white focus:outline-none transition-colors ${
                verificationError ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
              }`}
            />
          ))}
        </div>
        
        {/* Error */}
        {verificationError && (
          <p className="text-red-400 text-sm text-center">{verificationError}</p>
        )}

        {formData.password.length < 8 && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-10 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-gray-300 transition-colors"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleVerifyCode()}
              disabled={isLoading}
              className="w-full mt-3 py-3 bg-gray-300 text-black rounded-xl font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              Verify
            </button>
          </div>
        )}
        
        {/* Resend */}
        <div className="text-center">
          {resendCooldown > 0 ? (
            <p className="text-gray-500 text-sm">
              Resend code in {resendCooldown}s
            </p>
          ) : (
            <button
              onClick={handleResendCode}
              disabled={isLoading}
              className="text-blue-400 hover:text-blue-300 text-sm flex items-center justify-center gap-1 mx-auto disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Resend code
            </button>
          )}
        </div>
        
        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center">
            <Loader2 className="animate-spin text-blue-400" size={24} />
          </div>
        )}
        
        {/* Back */}
        <button
          onClick={() => {
            setMode('options');
            setVerificationCode(['', '', '', '', '', '']);
            setVerificationError('');
          }}
          className="w-full text-chrome-secondary text-sm hover:text-white transition-colors flex items-center justify-center gap-1"
        >
          <ArrowLeft size={14} />
          Back to sign in options
        </button>
      </div>
    );
  }

  // Render options view
  if (mode === 'options') {
    return (
      <div className="p-5 space-y-6">
        {renderSignInButtons()}
    
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-chrome-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-chrome-background text-gray-500">or</span>
          </div>
        </div>
        
        <button
          onClick={() => setMode('signup')}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-300 text-black rounded-xl font-medium hover:bg-gray-100 transition-colors"
        >
          <User size={18} />
          Create Account
        </button>
        
        {orderContext && (
          <button
            onClick={() => setMode('guest')}
            className="w-full text-chrome-secondary text-sm hover:text-white transition-colors py-2"
          >
            Continue as Guest
          </button>
        )}
      </div>
    );
  }

  // Render login form
  if (mode === 'login') {
    return (
      <form onSubmit={handleLogin} className="p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-10 text-white placeholder-gray-500 focus:outline-none focus:border-gray-300 transition-colors"
              placeholder="email"
              required
            />
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-10 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-gray-300 transition-colors"
              placeholder="••••••••"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 bg-gray-300 text-black rounded-xl font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </button>
        
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setMode('options')}
            className="text-chrome-secondary hover:text-white transition-colors"
          >
            ← Back
          </button>
        </div>
      </form>
    );
  }

  // Render signup form
  if (mode === 'signup') {
    return (
      <form onSubmit={handleSignup} className="p-5 space-y-4">
        {/* Name Fields - Side by Side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">First Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleInputChange('firstName', e.target.value)}
                className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="First"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Last Name</label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) => handleInputChange('lastName', e.target.value)}
              className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Last"
            />
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className={`w-full bg-gray-800/50 border rounded-xl py-3 px-10 text-white placeholder-gray-500 focus:outline-none transition-colors ${
                formErrors.email ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
              }`}
              placeholder="you@example.com"
              required
            />
          </div>
          {formErrors.email && (
            <p className="text-red-400 text-xs mt-1">{formErrors.email}</p>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              className={`w-full bg-gray-800/50 border rounded-xl py-3 px-10 pr-12 text-white placeholder-gray-500 focus:outline-none transition-colors ${
                formErrors.password ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
              }`}
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {formErrors.password ? (
            <p className="text-red-400 text-xs mt-1">{formErrors.password}</p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Confirm Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type={showConfirmPassword ? "text" : "password"}
              value={formData.confirmPassword}
              onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
              className={`w-full bg-gray-800/50 border rounded-xl py-3 px-10 pr-12 text-white placeholder-gray-500 focus:outline-none transition-colors ${
                formErrors.confirmPassword ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
              }`}
              placeholder="Confirm your password"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {formErrors.confirmPassword && (
            <p className="text-red-400 text-xs mt-1">{formErrors.confirmPassword}</p>
          )}
        </div>
        
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 bg-gray-300 text-black rounded-xl font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Creating account...
            </>
          ) : (
            'Create Account'
          )}
        </button>
        
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setMode('options')}
            className="text-chrome-secondary hover:text-white transition-colors"
          >
            ← Back
          </button>
        </div>
      </form>
    );
  }

  // Render guest form
  if (mode === 'guest') {
    return (
      <form onSubmit={handleGuestCheckout} className="p-5 space-y-4">
        <p className="text-chrome-secondary text-sm">
          Enter your email to continue. You can create an account after checkout to track your order.
        </p>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="you@example.com"
              required
            />
          </div>
        </div>
        
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 bg-chrome-border text-white rounded-xl font-medium hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Continuing...
            </>
          ) : (
            'Continue as Guest'
          )}
        </button>
        
        <button
          type="button"
          onClick={() => setMode('options')}
          className="w-full text-chrome-secondary text-sm hover:text-white transition-colors"
        >
          ← Back to sign in options
        </button>
      </form>
    );
  }

  return null;
};

export default AuthStep;
