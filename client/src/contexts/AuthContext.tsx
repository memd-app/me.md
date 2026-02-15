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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Check for existing session on mount
  useEffect(() => {
    const storedUserId = localStorage.getItem('memd_user_id');
    if (storedUserId) {
      fetch(`${API_BASE}/auth/me`, {
        headers: { 'x-user-id': storedUserId },
      })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Session expired');
        })
        .then((data) => {
          setUser(data.user);
        })
        .catch(() => {
          localStorage.removeItem('memd_user_id');
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
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }

      const data = await res.json();
      setUser(data.user);
      localStorage.setItem('memd_user_id', data.user.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
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
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || 'Registration failed');
      }

      const resData = await res.json();
      setUser(resData.user);
      localStorage.setItem('memd_user_id', resData.user.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('memd_user_id');
    // Also sign out of Firebase if configured
    if (isFirebaseConfigured) {
      auth.signOut().catch(() => {
        // Ignore sign-out errors
      });
    }
  }, []);

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
