// Simple, one-time cookie/local-storage consent notice. Deliberately just a
// boolean flag (no categories/granular consent) per current requirements —
// see workspacePrefs.ts for the same "localStorage flag, fail silently in
// private browsing" pattern this mirrors.

const KEY = 'inventoryblind_cookie_consent';

export function hasCookieConsent(): boolean {
  try {
    return localStorage.getItem(KEY) === 'accepted';
  } catch {
    return true; // storage unavailable — don't block the app on a banner that can't persist anyway
  }
}

export function setCookieConsentAccepted(): void {
  try {
    localStorage.setItem(KEY, 'accepted');
  } catch {
    // localStorage unavailable (private browsing, etc.) — banner will just show again next time, no crash.
  }
}
