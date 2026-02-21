import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '@/config/firebase';
import SessionExpiredModal from '@/components/SessionExpiredModal';

interface User {
  id: string;
  email: string;
  name: string;
  dateOfBirth?: string;
  location?: string;
  occupation?: string;
  gender?: string;
  onboardingCompleted?: boolean;
  themePreference?: string;
  notificationPreferences?: string;
  sessionLengthDefault?: number;
  createdAt?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  error: string | null;
  clearError: () => void;
  isFirebaseReady: boolean;
  getAuthHeaders: () => Record<string, string>;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  dateOfBirth?: string;
  location?: string;
  occupation?: string;
  gender?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = '/api';

// How far before expiry to trigger a refresh (20% of remaining lifetime, minimum 5 minutes)
const REFRESH_THRESHOLD_RATIO = 0.8; // Refresh when 80% of lifetime has passed
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes minimum

/**
 * Get stored auth token from localStorage.
 */
function getStoredToken(): string | null {
  return localStorage.getItem('memd_auth_token');
}

/**
 * Store auth token in localStorage.
 */
function storeToken(token: string): void {
  localStorage.setItem('memd_auth_token', token);
}

/**
 * Clear auth token from localStorage.
 */
function clearToken(): void {
  localStorage.removeItem('memd_auth_token');
}

/**
 * Get stored token expiration time from localStorage.
 */
function getStoredTokenExpiry(): string | null {
  return localStorage.getItem('memd_token_expires_at');
}

/**
 * Store token expiration time in localStorage.
 */
function storeTokenExpiry(expiresAt: string): void {
  localStorage.setItem('memd_token_expires_at', expiresAt);
}

/**
 * Clear token expiration from localStorage.
 */
function clearTokenExpiry(): void {
  localStorage.removeItem('memd_token_expires_at');
}

/**
 * Build auth headers for API requests.
 * Uses Bearer token if available, falls back to x-user-id.
 */
function buildAuthHeaders(userId?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Also include x-user-id for backward compatibility
  const uid = userId || localStorage.getItem('memd_user_id');
  if (uid) {
    headers['x-user-id'] = uid;
  }
  return headers;
}

/**
 * Calculate when to schedule the next token refresh.
 * Returns milliseconds until refresh should occur, or null if no refresh needed.
 */
function calculateRefreshDelay(expiresAt: string): number | null {
  const expiryTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const totalLifetime = expiryTime - now;

  if (totalLifetime <= 0) {
    // Token is already expired
    return null;
  }

  // Refresh when REFRESH_THRESHOLD_RATIO of lifetime has passed
  const refreshAt = totalLifetime * (1 - REFRESH_THRESHOLD_RATIO);
  const delay = totalLifetime - refreshAt;

  // Don't schedule refresh if it's in less than MIN_REFRESH_INTERVAL_MS
  // (in that case, refresh sooner but not immediately)
  return Math.max(delay, Math.min(MIN_REFRESH_INTERVAL_MS, totalLifetime - 30000));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    return buildAuthHeaders(user?.id);
  }, [user]);

  /**
   * Clear all auth-related state and storage.
   */
  const clearAuthState = useCallback(() => {
    setUser(null);
    localStorage.removeItem('memd_user_id');
    clearToken();
    clearTokenExpiry();
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  /**
   * Refresh the current session token.
   * Called automatically before the token expires.
   */
  const refreshToken = useCallback(async (): Promise<boolean> => {
    const currentToken = getStoredToken();
    if (!currentToken) return false;

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        console.warn('[me.md:auth] Token refresh failed:', res.status);
        return false;
      }

      const data = await res.json();
      if (data.token) {
        storeToken(data.token);
        if (data.tokenExpiresAt) {
          storeTokenExpiry(data.tokenExpiresAt);
        }
        // Update user data if provided
        if (data.user) {
          setUser(data.user);
        }
        console.log('[me.md:auth] Token refreshed successfully');
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[me.md:auth] Token refresh request failed:', err);
      return false;
    }
  }, []);

  /**
   * Schedule automatic token refresh based on expiration time.
   */
  const scheduleTokenRefresh = useCallback((expiresAt: string) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const delay = calculateRefreshDelay(expiresAt);
    if (delay === null) {
      // Token already expired, trigger session expired
      console.warn('[me.md:auth] Token is already expired');
      return;
    }

    console.log(`[me.md:auth] Token refresh scheduled in ${Math.round(delay / 1000)}s (expires: ${expiresAt})`);

    refreshTimerRef.current = setTimeout(async () => {
      const success = await refreshToken();
      if (success) {
        // Schedule the next refresh based on the new token's expiry
        const newExpiry = getStoredTokenExpiry();
        if (newExpiry) {
          scheduleTokenRefresh(newExpiry);
        }
      } else {
        // Refresh failed, show re-auth prompt
        console.warn('[me.md:auth] Token refresh failed, session expired');
        setSessionExpired(true);
      }
    }, delay);
  }, [refreshToken]);

  /**
   * Store session credentials and schedule refresh.
   */
  const saveSession = useCallback((token: string, tokenExpiresAt: string | undefined, userData: User) => {
    setUser(userData);
    localStorage.setItem('memd_user_id', userData.id);
    storeToken(token);
    if (tokenExpiresAt) {
      storeTokenExpiry(tokenExpiresAt);
      scheduleTokenRefresh(tokenExpiresAt);
    }
  }, [scheduleTokenRefresh]);

  // Check for existing session on mount
  useEffect(() => {
    const storedUserId = localStorage.getItem('memd_user_id');
    const storedToken = getStoredToken();
    if (storedUserId || storedToken) {
      const headers: Record<string, string> = {};
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
      if (storedUserId) {
        headers['x-user-id'] = storedUserId;
      }

      fetch(`${API_BASE}/auth/me`, { headers })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Session expired');
        })
        .then((data) => {
          setUser(data.user);
          // Schedule refresh if we have a stored expiry
          const storedExpiry = getStoredTokenExpiry();
          if (storedExpiry) {
            scheduleTokenRefresh(storedExpiry);
          }
        })
        .catch(() => {
          localStorage.removeItem('memd_user_id');
          clearToken();
          clearTokenExpiry();
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [scheduleTokenRefresh]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
      }

      if (!res.ok) {
        let data: { error?: string };
        try {
          data = await res.json();
        } catch {
          throw new Error('Something went wrong. Please try again later.');
        }
        throw new Error(data.error || 'Login failed. Please check your credentials and try again.');
      }

      const data = await res.json();
      if (data.token) {
        saveSession(data.token, data.tokenExpiresAt, data.user);
      } else {
        setUser(data.user);
        localStorage.setItem('memd_user_id', data.user.id);
      }
      // Clear session expired state if re-authenticating
      setSessionExpired(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [saveSession]);

  const loginWithGoogle = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      if (!isFirebaseConfigured) {
        throw new Error(
          'Google Sign-In is not configured. Please set up Firebase credentials in your environment variables.'
        );
      }

      // Trigger Google Sign-In popup via Firebase
      if (!auth || !googleProvider) {
        throw new Error('Google Sign-In is not configured.');
      }
      const result = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;

      // Get the Firebase ID token to send to our backend
      const idToken = await firebaseUser.getIdToken();

      // Send the token to our backend to create/find the user
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            email: firebaseUser.email,
            name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
            firebaseUid: firebaseUser.uid,
          }),
        });
      } catch {
        throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
      }

      if (!res.ok) {
        let data: { error?: string };
        try {
          data = await res.json();
        } catch {
          throw new Error('Something went wrong. Please try again later.');
        }
        throw new Error(data.error || 'Google sign-in failed');
      }

      const data = await res.json();
      if (data.token) {
        saveSession(data.token, data.tokenExpiresAt, data.user);
      } else {
        setUser(data.user);
        localStorage.setItem('memd_user_id', data.user.id);
      }
      // Clear session expired state if re-authenticating
      setSessionExpired(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [saveSession]);

  const register = useCallback(async (data: RegisterData) => {
    setError(null);
    setIsLoading(true);
    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } catch {
        throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
      }

      if (!res.ok) {
        let resData: { error?: string };
        try {
          resData = await res.json();
        } catch {
          throw new Error('Something went wrong. Please try again later.');
        }
        throw new Error(resData.error || 'Registration failed. Please try again.');
      }

      const resData = await res.json();
      if (resData.token) {
        saveSession(resData.token, resData.tokenExpiresAt, resData.user);
      } else {
        setUser(resData.user);
        localStorage.setItem('memd_user_id', resData.user.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [saveSession]);

  const logout = useCallback(() => {
    // Try to revoke token on the server
    const headers = buildAuthHeaders(user?.id);
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers,
    }).catch(() => {
      // Ignore logout errors
    });

    clearAuthState();
    setSessionExpired(false);

    // Also sign out of Firebase if configured
    if (isFirebaseConfigured && auth) {
      auth.signOut().catch(() => {
        // Ignore sign-out errors
      });
    }
  }, [user, clearAuthState]);

  const updateUser = useCallback((userData: Partial<User>) => {
    setUser((prev) => prev ? { ...prev, ...userData } : null);
  }, []);

  /**
   * Handle re-login from the session expired modal.
   */
  const handleReLogin = useCallback(async (email: string, password: string) => {
    await login(email, password);
  }, [login]);

  /**
   * Handle logout from the session expired modal.
   */
  const handleSessionExpiredLogout = useCallback(() => {
    clearAuthState();
    setSessionExpired(false);
    // Also sign out of Firebase if configured
    if (isFirebaseConfigured && auth) {
      auth.signOut().catch(() => {});
    }
  }, [clearAuthState]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        loginWithGoogle,
        register,
        logout,
        updateUser,
        error,
        clearError,
        isFirebaseReady: isFirebaseConfigured,
        getAuthHeaders,
      }}
    >
      {children}
      {/* Session Expired re-auth modal */}
      <SessionExpiredModal
        open={sessionExpired}
        onReLogin={handleReLogin}
        onLogout={handleSessionExpiredLogout}
        userEmail={user?.email}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
