// hooks/useAuth.js - Authentication hook
/* eslint-disable react-hooks/exhaustive-deps -- checkAuth is a stable useCallback([]);
   effect must bind once on mount */
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { applyServerConsent } from '../utils/consent';
import {
  bootAnalytics,
  resetAnalyticsIdentity,
  syncAnalyticsIdentity,
  track,
} from '../utils/analytics';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [guest, setGuest] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    bootAnalytics();
    checkAuth();
  }, []);

  useEffect(() => {
    if (isLoading) return undefined;
    void syncAnalyticsIdentity(user, isAuthenticated);
    return undefined;
  }, [user, isAuthenticated, isLoading]);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      
      const data = await response.json();
      
      if (data.authenticated) {
        applyServerConsent(data.user?.consent);
        setUser(data.user);
        setIsAuthenticated(true);
        setGuest(null);
      } else if (data.guest) {
        setGuest(data.guest);
        setIsAuthenticated(false);
        setUser(null);
      } else {
        setUser(null);
        setGuest(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
      setGuest(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }
    
    applyServerConsent(data.user?.consent);
    setUser(data.user);
    setIsAuthenticated(true);
    setGuest(null);
    track('logged_in');
    
    return data.user;
  }, []);

  const register = useCallback(async (email, password, name) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, name }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    
    applyServerConsent(data.user?.consent);
    setUser(data.user);
    setIsAuthenticated(true);
    setGuest(null);
    track('signed_up');
    track('logged_in');
    
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    setUser(null);
    setGuest(null);
    setIsAuthenticated(false);
    resetAnalyticsIdentity();
  }, []);

  const startGuestSession = useCallback(async (email) => {
    const response = await fetch('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start guest session');
    }
    
    setGuest(data.guest);
    return data.guest;
  }, []);

  const convertGuestToUser = useCallback(async (password) => {
    const response = await fetch('/api/auth/guest/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create account');
    }
    
    applyServerConsent(data.user?.consent);
    setUser(data.user);
    setIsAuthenticated(true);
    setGuest(null);
    track('signed_up');
    track('logged_in');
    
    return data.user;
  }, []);

  const value = {
    user,
    guest,
    isLoading,
    isAuthenticated,
    isGuest: !!guest,
    email: user?.email || guest?.email,
    checkAuth,
    login,
    register,
    logout,
    startGuestSession,
    convertGuestToUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default useAuth;
