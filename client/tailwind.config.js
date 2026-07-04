/** @type {import('tailwindcss').Config} */
// Design tokens: DESIGN.md ("Modern Editorial"). The `primary` and `gray`
// scales are re-valued rather than renamed so existing utility usage picks
// up the new identity without a page-by-page sweep.
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The amber accent (DESIGN.md `accent`, #C77B21 at 500)
        primary: {
          50: '#FBF3E6',
          100: '#F6E7CC',
          200: '#EFD4A6',
          300: '#E5BB78',
          400: '#D89A48',
          500: '#C77B21',
          600: '#AC671A',
          700: '#8C5115',
          800: '#6B3D10',
          900: '#4E2C0C',
          950: '#2C1806',
        },
        // Warm neutral ramp: doubles as light-mode text (600-900) and
        // dark-mode surfaces (700-950), mirroring stock Tailwind gray usage.
        gray: {
          50: '#FAF8F2',
          100: '#F4EFE4',
          200: '#E7DFD0',
          300: '#D5CAB6',
          400: '#A99E8A',
          500: '#857B69',
          600: '#665D4E',
          700: '#453D30',
          800: '#2A2318',
          900: '#1E1912',
          950: '#17130D',
        },
        white: '#FFFEFA',
        // Named identity tokens
        paper: '#FBF9F4',
        ink: '#1E1912',
        panel: '#F4EDDF',
        rule: '#E7DFD0',
        // Status colors
        verified: '#22c55e',
        pending: '#f59e0b',
        rejected: '#ef4444',
        // Dark mode ("lamplight") surfaces
        dark: {
          bg: '#17130D',
          surface: '#1F1A12',
          card: '#241D14',
          border: '#3A3226',
        },
      },
      fontFamily: {
        sans: ['Public Sans', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Newsreader', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      lineHeight: {
        relaxed: '1.75',
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.3s ease-out',
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
