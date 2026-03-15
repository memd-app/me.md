import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, updateUser } = useUser();

  // Initialize theme from localStorage (fast, synchronous) or default to 'light'
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('memd_theme');
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    return 'light';
  });

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // When user loads, sync theme from their profile preference
  useEffect(() => {
    if (user?.themePreference) {
      const userTheme = user.themePreference as Theme;
      if (userTheme === 'light' || userTheme === 'dark') {
        setThemeState(userTheme);
        localStorage.setItem('memd_theme', userTheme);
      }
    }
  }, [user?.themePreference]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('memd_theme', newTheme);

    // Persist to user record in local database
    updateUser({ themePreference: newTheme });
  }, [updateUser]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
