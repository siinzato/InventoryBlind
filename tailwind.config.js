/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
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
      },
    },
  },
  plugins: [],
};
