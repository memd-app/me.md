import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '@/config/firebase';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    return buildAuthHeaders(user?.id);
  }, [user]);

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
        })
        .catch(() => {
          localStorage.removeItem('memd_user_id');
          clearToken();
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
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
      setUser(data.user);
      localStorage.setItem('memd_user_id', data.user.id);
      // Store the session token
      if (data.token) {
        storeToken(data.token);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      const res = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          email: firebaseUser.email,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          firebaseUid: firebaseUser.uid,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Google sign-in failed');
      }

      const data = await res.json();
      setUser(data.user);
      localStorage.setItem('memd_user_id', data.user.id);
      // Store the session token
      if (data.token) {
        storeToken(data.token);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      setUser(resData.user);
      localStorage.setItem('memd_user_id', resData.user.id);
      // Store the session token
      if (resData.token) {
        storeToken(resData.token);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Try to revoke token on the server
    const headers = buildAuthHeaders(user?.id);
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers,
    }).catch(() => {
      // Ignore logout errors
    });

    setUser(null);
    localStorage.removeItem('memd_user_id');
    clearToken();
    // Also sign out of Firebase if configured
    if (isFirebaseConfigured && auth) {
      auth.signOut().catch(() => {
        // Ignore sign-out errors
      });
    }
  }, [user]);

  const updateUser = useCallback((userData: Partial<User>) => {
    setUser((prev) => prev ? { ...prev, ...userData } : null);
  }, []);

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
