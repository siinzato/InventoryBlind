import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './lib/auth.tsx';
import { ThemeProvider, applyThemeClass, getInitialTheme } from './lib/useTheme.tsx';
import { CookieConsentBanner } from './components/CookieConsentBanner.tsx';
import './index.css';

applyThemeClass(getInitialTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
        <CookieConsentBanner />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
