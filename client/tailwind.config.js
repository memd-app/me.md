/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Light mode primary
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        // Status colors
        verified: '#22c55e',
        pending: '#f59e0b',
        rejected: '#ef4444',
        // Dark mode backgrounds
        dark: {
          bg: '#0f172a',
          surface: '#1e293b',
          card: '#1e293b',
          border: '#334155',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      lineHeight: {
        relaxed: '1.75',
      },
    },
  },
  safelist: [
    // Force-generate dark mode classes for custom colors
    // (needed because fast-glob may fail on paths with special characters)
    'dark:bg-dark-bg',
    'dark:bg-dark-surface',
    'dark:bg-dark-border',
    'dark:border-dark-border',
    'dark:border-dark-bg',
    'dark:text-dark-bg',
    'dark:divide-dark-border',
    'dark:to-dark-surface',
    'bg-dark-bg',
    'bg-dark-surface',
    'bg-dark-border',
    'border-dark-border',
    'dark:bg-dark-card',
    'dark:hover:bg-dark-surface',
  ],
  plugins: [],
};
