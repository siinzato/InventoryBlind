import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AuthProvider } from './lib/auth.tsx';
import { ThemeProvider, applyThemeClass, getInitialTheme } from './lib/useTheme.tsx';
import { CookieConsentBanner } from './components/CookieConsentBanner.tsx';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy.tsx';
import { TermsOfUse } from './components/legal/TermsOfUse.tsx';
import { currentLegalRoute } from './lib/legal/legalRoutes.ts';
import './index.css';

applyThemeClass(getInitialTheme());

// Documentos legais: resolvidos aqui, ANTES do AuthProvider, e é isso que os
// torna públicos por construção — não existe caminho em que uma dessas páginas
// dependa de sessão. Também não montam o App, então não há troca de view nem
// estado de autenticação envolvido: `/privacidade` e `/termos` funcionam por URL
// direta e após recarregar. Ver src/lib/legal/legalRoutes.ts para o porquê de
// não haver router.
const legalRoute = currentLegalRoute();

// O BrowserRouter envolve só o app autenticado/público: as páginas legais continuam
// resolvidas por pathname acima, sem router, exatamente como antes.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {legalRoute === 'privacy' ? (
        <PrivacyPolicy />
      ) : legalRoute === 'terms' ? (
        <TermsOfUse />
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <App />
            <CookieConsentBanner />
          </AuthProvider>
        </BrowserRouter>
      )}
    </ThemeProvider>
  </StrictMode>
);
