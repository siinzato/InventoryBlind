/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Body/UI text. 'SF Pro Text' stays first so licensed files take over
        // the moment they're installed — see the comment in src/index.css.
        sans: ['SF Pro Text', 'Geist Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Headings, KPIs, page titles — anywhere size carries the hierarchy.
        display: ['SF Pro Display', 'Geist Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Precision data: KPI values, table/ledger numbers, IDs, timestamps.
        mono: ['SF Mono', 'Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
        rail: 'rgb(var(--rail) / <alpha-value>)',
        'rail-active': 'rgb(var(--rail-active) / <alpha-value>)',
        'rail-fg': 'rgb(var(--rail-fg) / <alpha-value>)',
        'rail-fg-muted': 'rgb(var(--rail-fg-muted) / <alpha-value>)',
      },
      // NOTE: the app's body/label type lift is NOT here. Overriding `sm`/`xs`
      // globally would also resize the Landing and AuthPage, which are frozen —
      // 70 usages in that zone would have changed silently. The lift lives in
      // src/index.css scoped to [data-app-shell] instead.
      borderRadius: {
        // Explicit scale (brief §6/§22) instead of one flat radius reused for
        // every concern. Existing rounded-xl/lg usage is untouched — these
        // are additive, semantic names for the redesign to grow into.
        control: '0.625rem',   // buttons, inputs, small controls
        container: '0.4375rem', // cards, panels — 7px: canto reto e técnico, ainda suavizado
        sheet: '0.5rem',        // modals, drawers, bottom sheets — 8px, um passo acima de container
      },
      boxShadow: {
        // Deliberately quiet — most surfaces should need none of these at
        // all (border + surface contrast carries depth instead).
        control: '0 1px 2px rgb(0 0 0 / 0.04)',
        panel: '0 1px 2px rgb(0 0 0 / 0.03), 0 1px 1px rgb(0 0 0 / 0.02)',
        overlay: '0 16px 40px -12px rgb(0 0 0 / 0.22), 0 4px 12px -4px rgb(0 0 0 / 0.08)',
      },
    },
  },
  plugins: [],
};
