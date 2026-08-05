/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#06070A',
          900: '#0B0D12',
          800: '#12151C',
          700: '#1B1F29',
          600: '#2A2F3B',
        },
        mist: {
          400: '#8A93A6',
          100: '#E7EAF0',
        },
        enterprise: {
          900: '#0A2647',
          700: '#123B6E',
          500: '#1E5FBF',
          400: '#3E7BE0',
          300: '#7FB3F5',
        },
        // Semantic, theme-reactive tokens for the authenticated app only.
        // Resolve via CSS custom properties (src/index.css :root / .dark) so
        // the same class works in both themes — landing/AuthPage never
        // reference these and stay on the fixed ink/mist/enterprise scale.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--surface-3) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'fg-subtle': 'rgb(var(--fg-subtle) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-strong': 'rgb(var(--accent-strong) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
