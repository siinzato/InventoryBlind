/**
 * Auth context — definitive implementation.
 *
 * Key rules:
 * 1. Never call supabase.from() synchronously inside onAuthStateChange — deadlock.
 *    Use setTimeout(0) to defer so the JWT is committed first.
 * 2. `view` starts as 'landing' so the homepage is never blocked.
 * 3. 8s hard timeout so loading never hangs forever.
 * 4. Authenticated users NEVER get routed to 'signup'.
 */

import React, {
  createContext, useContext, useEffect, useState,
  useCallback, useRef,
} from 'react';
import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';
import { getRememberedWorkspaceDevice } from './workspacePrefs';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  slug: string;
  plan: 'starter' | 'professional' | 'enterprise';
  settings: Record<string, unknown>;
  icon: string | null;
  description: string | null;
}

export interface CompanyMembership extends Company {
  lastAccessedAt: string | null;
}

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  company_id: string | null;
  role: 'owner' | 'admin' | 'manager' | 'lead' | 'counter' | 'viewer';
  must_change_password: boolean;
}

export type AuthView =
  | 'landing'
  | 'login'
  | 'signup'
  | 'forgot'
  | 'update-password'
  | 'confirm-email'
  | 'link-company'
  | 'complete-profile'
  | 'select-workspace'
  | 'auth-error'
  | 'app';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  company: Company | null;
  companyId: string;
  companies: CompanyMembership[];
  switchingCompany: boolean;
  authLoading: boolean;
  profileLoading: boolean;
  authError: string | null;
  view: AuthView;
  setView: (v: AuthView) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryAuth: () => void;
  linkToAZ: () => Promise<void>;
  createCompany: (companyName: string, userName?: string) => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AZ_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const AUTH_TIMEOUT_MS = 8000;

// Set by AuthPage's signup form right before calling supabase.auth.signUp(),
// consumed once inside runAuthSequence on the very next profile load for this
// user. This has to live in the ONE authoritative auth sequence rather than
// as a second, separate RPC call fired from AuthPage after signUp() resolves:
// two independent async paths both trying to set `view` after signup race,
// and whichever finishes last always wins — confirmed live, the background
// sequence (triggered by the same SIGNED_IN event) finished after AuthPage's
// own call and overwrote the correct post-onboarding view with a stale,
// pre-onboarding snapshot it had already read.
const PENDING_ONBOARDING_KEY = 'inventoryblind.pending-company-onboarding';
const PENDING_EMAIL_KEY = 'inventoryblind.pending-email';

function readPendingCompanyOnboarding(): { companyName: string; userName?: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(PENDING_ONBOARDING_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

let pendingCompanyOnboarding: { companyName: string; userName?: string } | null = readPendingCompanyOnboarding();

export function setPendingCompanyOnboarding(companyName: string, userName?: string) {
  pendingCompanyOnboarding = { companyName, userName };
  sessionStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(pendingCompanyOnboarding));
}

export function clearPendingCompanyOnboarding() {
  pendingCompanyOnboarding = null;
  sessionStorage.removeItem(PENDING_ONBOARDING_KEY);
}

export function setPendingSignupEmail(email: string) {
  sessionStorage.setItem(PENDING_EMAIL_KEY, email);
}

export function getPendingSignupEmail(): string {
  return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? '';
}

export function clearPendingSignupEmail() {
  sessionStorage.removeItem(PENDING_EMAIL_KEY);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]                       = useState<User | null>(null);
  const [session, setSession]                 = useState<Session | null>(null);
  const [profile, setProfile]                 = useState<Profile | null>(null);
  const [company, setCompany]                 = useState<Company | null>(null);
  const [companies, setCompanies]             = useState<CompanyMembership[]>([]);
  const [switchingCompany, setSwitchingCompany] = useState(false);
  const [authLoading, setAuthLoading]         = useState(true);
  const [profileLoading, setProfileLoading]   = useState(false);
  const [authError, setAuthError]             = useState<string | null>(null);
  const [view, setView]                       = useState<AuthView>('landing');

  const mountedRef    = useRef(true);
  const timeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef    = useRef(false); // prevents concurrent profile loads
  const authLoadingRef = useRef(authLoading); // live value for the one-shot timeout effect below
  const recoveryModeRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    authLoadingRef.current = authLoading;
  }, [authLoading]);

  // ── Fetch profile + company ────────────────────────────────────────────────
  const doLoadProfile = useCallback(async (u: User): Promise<Profile | null> => {
    if (import.meta.env.DEV) console.log('[Auth] Fetching profile for', u.email, u.id);

    // Attempt 1
    const { data: p1, error: e1 } = await supabase
      .from('profiles')
      .select('id, name, email, company_id, role, must_change_password')
      .eq('id', u.id)
      .maybeSingle();

    if (import.meta.env.DEV && e1) console.warn('[Auth] Profile attempt 1 error:', e1.message);

    const prof = (p1 ?? null) as Profile | null;
    if (import.meta.env.DEV) console.log('[Auth] Profile result:', prof);

    if (!prof) {
      if (import.meta.env.DEV) console.warn('[Auth] Profile not found for', u.id);
    }
    return prof;
  }, []);

  const doLoadCompany = useCallback(async (companyId: string): Promise<Company | null> => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, slug, plan, settings, icon, description')
      .eq('id', companyId)
      .maybeSingle();

    if (import.meta.env.DEV && error) console.warn('[Auth] Company error:', error.message);
    if (import.meta.env.DEV) console.log('[Auth] Company result:', data);
    return (data ?? null) as Company | null;
  }, []);

  const doLoadMemberships = useCallback(async (userId: string): Promise<CompanyMembership[]> => {
    const { data, error } = await supabase
      .from('company_members')
      .select('last_accessed_at, companies(id, name, slug, plan, settings, icon, description)')
      .eq('user_id', userId);

    if (import.meta.env.DEV && error) console.warn('[Auth] Memberships error:', error.message);

    const rows = (data ?? []) as unknown as { last_accessed_at: string | null; companies: Company | null }[];
    return rows
      .filter((r): r is { last_accessed_at: string | null; companies: Company } => !!r.companies)
      .map(r => ({ ...r.companies, lastAccessedAt: r.last_accessed_at }));
  }, []);

  // ── Resolve which view to show ─────────────────────────────────────────────
  const resolveView = useCallback((u: User, prof: Profile | null, memberships: CompanyMembership[]) => {
    if (import.meta.env.DEV) console.log('[Auth] Resolving view — user:', u.email, 'profile:', prof, 'email_confirmed:', u.email_confirmed_at);

    if (!u.email_confirmed_at) {
      if (import.meta.env.DEV) console.log('[Auth] → confirm-email');
      setView('confirm-email');
      return;
    }
    if (!prof) {
      if (import.meta.env.DEV) console.log('[Auth] → complete-profile (profile is null)');
      setView('complete-profile');
      return;
    }
    if (!prof.company_id) {
      if (import.meta.env.DEV) console.log('[Auth] → link-company (no company_id in profile)');
      setView('link-company');
      return;
    }
    if (memberships.length > 1 && !getRememberedWorkspaceDevice()) {
      if (import.meta.env.DEV) console.log('[Auth] → select-workspace (', memberships.length, 'workspaces, not remembered on this device)');
      setView('select-workspace');
      return;
    }
    if (import.meta.env.DEV) console.log('[Auth] → app ✓  role:', prof.role, 'company_id:', prof.company_id);
    setView('app');
  }, []);

  // ── Full load sequence after confirmed login ───────────────────────────────
  const runAuthSequence = useCallback(async (u: User) => {
    if (!mountedRef.current) return;
    if (loadingRef.current) {
      if (import.meta.env.DEV) console.log('[Auth] Already loading — skip');
      return;
    }

    loadingRef.current = true;
    setProfileLoading(true);

    try {
      let prof = await doLoadProfile(u);
      if (!mountedRef.current) return;

      if (prof && !prof.company_id && pendingCompanyOnboarding) {
        const { companyName, userName } = pendingCompanyOnboarding;
        try {
          const { data, error } = await supabase.rpc('create_company_onboarding', {
            p_company_name: companyName,
            p_user_name: userName ?? null,
          });
          if (!error && data?.[0]?.out_company_id) {
            prof = { ...prof, company_id: data[0].out_company_id, role: 'owner' };
            clearPendingCompanyOnboarding();
            clearPendingSignupEmail();
          } else if (import.meta.env.DEV) {
            console.error('[Auth] create_company_onboarding failed:', error?.message);
          }
        } catch (onboardErr) {
          if (import.meta.env.DEV) console.error('[Auth] create_company_onboarding threw:', onboardErr);
        }
      }

      setProfile(prof);

      if (prof?.company_id) {
        const comp = await doLoadCompany(prof.company_id);
        if (mountedRef.current) setCompany(comp);
      }

      const memberships = await doLoadMemberships(u.id);
      if (mountedRef.current) setCompanies(memberships);

      if (mountedRef.current) {
        resolveView(u, prof, memberships);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('[Auth] runAuthSequence error:', err);
      if (mountedRef.current) {
        setAuthError('Erro ao carregar dados. Tente novamente.');
        setView('auth-error');
      }
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) {
        setProfileLoading(false);
        setAuthLoading(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    }
  }, [doLoadProfile, doLoadCompany, doLoadMemberships, resolveView]);

  // ── onAuthStateChange — sets state, defers DB work via setTimeout(0) ──────
  useEffect(() => {
    // Hard timeout so authLoading never stays true forever
    timeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      if (authLoadingRef.current) {
        if (import.meta.env.DEV) console.warn('[Auth] Timeout reached');
        setAuthLoading(false);
        setAuthError('O carregamento demorou demais. Verifique sua conexão.');
        setView('auth-error');
      }
    }, AUTH_TIMEOUT_MS);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mountedRef.current) return;

      if (import.meta.env.DEV) console.log('[Auth] onAuthStateChange →', event, s?.user?.email ?? 'no user');

      setSession(s);
      setUser(s?.user ?? null);

      // A recovery link creates a temporary session. Keep it on the password
      // form instead of resolving the normal workspace/app route.
      if (event === 'PASSWORD_RECOVERY' && s?.user) {
        recoveryModeRef.current = true;
        loadingRef.current = false;
        setProfileLoading(false);
        setAuthLoading(false);
        setAuthError(null);
        setView('update-password');
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        return;
      }

      // updateUser emits USER_UPDATED; recovery remains active until sign-out.
      if (recoveryModeRef.current && s?.user) {
        setAuthLoading(false);
        setView('update-password');
        return;
      }

      if (!s?.user) {
        // Signed out or no session
        recoveryModeRef.current = false;
        setProfile(null);
        setCompany(null);
        setCompanies([]);
        loadingRef.current = false;
        setProfileLoading(false);
        setAuthLoading(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Go to landing unless already on an auth sub-page
        setView(curr => {
          const authPages: AuthView[] = ['login', 'signup', 'forgot', 'update-password', 'confirm-email'];
          return authPages.includes(curr) ? curr : 'landing';
        });
        return;
      }

      // TOKEN_REFRESHED fires on every background session revalidation —
      // including regaining tab focus, since Supabase re-checks the session
      // on visibilitychange — with the same still-valid user. session/user
      // state is already updated above; re-running the full profile/company/
      // workspace resolution here would force `view` back through
      // resolveView's workspace-selector gate even though the user is
      // already settled in 'app'. That is what caused the workspace
      // selector to reappear on tab-switch-and-return.
      if (event === 'TOKEN_REFRESHED') return;

      // User exists — defer DB queries so JWT is committed first
      const capturedUser = s.user;
      setTimeout(() => {
        if (!mountedRef.current) return;
        runAuthSequence(capturedUser);
      }, 0);
    });

    return () => {
      subscription.unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [runAuthSequence]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── signOut ────────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    loadingRef.current = false;
    recoveryModeRef.current = false;
    await supabase.auth.signOut();
    if (!mountedRef.current) return;
    setProfile(null);
    setCompany(null);
    setCompanies([]);
    setAuthError(null);
    setAuthLoading(false);
    setView('landing');
  }, []);

  // ── retryAuth ─────────────────────────────────────────────────────────────
  const retryAuth = useCallback(() => {
    window.location.reload();
  }, []);

  // ── refreshProfile ────────────────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    loadingRef.current = false;
    await runAuthSequence(user);
  }, [user, runAuthSequence]);

  // ── linkToAZ ──────────────────────────────────────────────────────────────
  const linkToAZ = useCallback(async () => {
    if (!user) throw new Error('No authenticated user');

    const isOwner = user.email === 'victor@azbuy.com.br';

    // STEP 1: Verify company exists
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', AZ_COMPANY_ID)
      .maybeSingle();

    if (import.meta.env.DEV) console.log('[LinkToAZ] STEP 1 — company lookup:', { company, error: companyErr });
    if (companyErr) throw new Error(`SELECT companies failed: ${companyErr.message} (code: ${companyErr.code}) hint: ${companyErr.hint}`);
    if (!company) throw new Error(`Company AZ (${AZ_COMPANY_ID}) not found in companies table`);

    // STEP 2: Check current profile state
    const { data: existingProfile, error: profileReadErr } = await supabase
      .from('profiles')
      .select('id, email, company_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (import.meta.env.DEV) console.log('[LinkToAZ] STEP 2 — profile read:', { existingProfile, error: profileReadErr });
    if (profileReadErr) throw new Error(`SELECT profiles failed: ${profileReadErr.message} (code: ${profileReadErr.code}) hint: ${profileReadErr.hint}`);
    if (!existingProfile) throw new Error(`Profile not found for user.id=${user.id}. Check if profile row exists and RLS SELECT policy allows it.`);

    // STEP 3: Link user to company via secure RPC (sets role='viewer')
    const { error: linkErr } = await supabase.rpc('link_user_to_company', {
      target_company_id: AZ_COMPANY_ID,
    });

    if (import.meta.env.DEV) console.log('[LinkToAZ] STEP 3 — link_user_to_company:', { error: linkErr });
    if (linkErr) throw new Error(`link_user_to_company failed: ${linkErr.message} (code: ${linkErr.code}) hint: ${linkErr.hint}`);

    // STEP 4: If this is the owner, promote via secure RPC
    if (isOwner) {
      const { error: roleErr } = await supabase.rpc('update_member_role', {
        target_user_id: user.id,
        new_role: 'owner',
      });
      if (import.meta.env.DEV) console.log('[LinkToAZ] STEP 4 — promote to owner:', { error: roleErr });
      // If this fails (no existing owner to call it), the user remains viewer
      // and can be promoted manually via SQL.
    }

    if (import.meta.env.DEV) console.log('[LinkToAZ] All steps succeeded. Reloading profile...');
    loadingRef.current = false;
    await runAuthSequence(user);
  }, [user, runAuthSequence]);

  // ── createCompany — onboarding for a brand-new, company-less user ─────────
  const createCompany = useCallback(async (companyName: string, userName?: string) => {
    if (!user) throw new Error('No authenticated user');

    const { error } = await supabase.rpc('create_company_onboarding', {
      p_company_name: companyName,
      p_user_name: userName ?? null,
    });

    if (error) throw new Error(error.message);

    loadingRef.current = false;
    await runAuthSequence(user);
  }, [user, runAuthSequence]);

  // ── switchCompany ─────────────────────────────────────────────────────────
  const switchCompany = useCallback(async (targetCompanyId: string) => {
    if (!user) return;
    if (profile?.company_id === targetCompanyId) return;

    setSwitchingCompany(true);
    try {
      const { error } = await supabase.rpc('switch_active_company', { target_company_id: targetCompanyId });
      if (error) {
        if (import.meta.env.DEV) console.error('[Auth] switchCompany error:', error.message);
        return;
      }
      loadingRef.current = false;
      await runAuthSequence(user);
    } finally {
      if (mountedRef.current) setSwitchingCompany(false);
    }
  }, [user, profile?.company_id, runAuthSequence]);

  // ── Value ──────────────────────────────────────────────────────────────────
  const value: AuthContextValue = {
    user,
    session,
    profile,
    company,
    companyId: profile?.company_id ?? '',
    companies,
    switchingCompany,
    authLoading,
    profileLoading,
    authError,
    view,
    setView,
    signOut,
    refreshProfile,
    retryAuth,
    linkToAZ,
    createCompany,
    switchCompany,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function canManageUsers(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function canWrite(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager' || role === 'counter';
}
