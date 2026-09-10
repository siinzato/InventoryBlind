// Per-device preference: skip the "Selecione seu Workspace" picker on future
// logins. Deliberately localStorage, not a DB column — this is a per-device
// convenience, not an account setting (a shared/public device shouldn't
// inherit someone else's "remembered" choice). Which workspace was last used
// is already persisted server-side by switch_active_company() (profiles.company_id),
// so this key only controls whether the picker screen shows at all.

const KEY = 'ib_remember_workspace';

export function getRememberedWorkspaceDevice(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setRememberedWorkspaceDevice(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(KEY, 'true');
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) — picker just shows every time, no crash.
  }
}
