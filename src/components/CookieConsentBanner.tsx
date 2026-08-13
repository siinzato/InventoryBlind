import { useEffect, useState } from 'react';
import { hasCookieConsent, setCookieConsentAccepted } from '../lib/cookieConsent';
import { Button } from './ui/Button';

/** Global, one-time notice — mounted once in main.tsx, outside <App/>'s view switching, so it survives every route/view/workspace change by construction. */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!hasCookieConsent());
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    setCookieConsentAccepted();
    setVisible(false);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[950] flex justify-center px-4 pb-4 sm:px-6">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col items-start gap-3 rounded-sheet border border-edge bg-surface-2 p-4 shadow-overlay sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
        <div>
          <p className="text-sm font-semibold text-fg">Cookies</p>
          <p className="mt-1 text-xs text-fg-muted sm:text-sm">
            Utilizamos cookies e armazenamento local para manter suas preferências e melhorar sua experiência no InventoryBlind.
          </p>
        </div>
        <Button size="sm" className="w-full flex-shrink-0 sm:w-auto" onClick={handleAccept}>
          Aceitar cookies
        </Button>
      </div>
    </div>
  );
}
