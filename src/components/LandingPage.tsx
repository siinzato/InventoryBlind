/**
 * LandingPage — InventoryBlind SaaS
 *
 * Visual premium, cinemático — GSAP/ScrollTrigger para as grandes sequências
 * (pin, scrub, 3D), Motion (motion.dev) para toda microinteração.
 * Nunca mostra dados internos — apenas vende a plataforma.
 *
 * Composition root only — each section lives in ./landing/. Keeps the same
 * zero-props default-export contract that src/App.tsx imports.
 */

import { useEffect, type FC } from 'react';
import { useAuth } from '../lib/auth';
import { ScrollTrigger } from './landing/landingScroll';
import { Navbar } from './landing/Navbar';
import { Hero } from './landing/Hero';
import { CinematicDashboard } from './landing/CinematicDashboard';
import { OperationalJourney } from './landing/OperationalJourney';
import { Modules } from './landing/Modules';
import { KpiCounters } from './landing/KpiCounters';
import { SocialProof } from './landing/SocialProof';
import { Differentials } from './landing/Differentials';
import { Plans } from './landing/Plans';
import { FinalCta } from './landing/FinalCta';
import { Footer } from './landing/Footer';

const LandingPage: FC = () => {
  const { setView } = useAuth();
  const onLogin = () => setView('login');
  const onSignup = () => setView('signup');

  // Desktop's pin+scrub ScrollTrigger sequences (CinematicDashboard, OperationalJourney,
  // KpiCounters, Differentials — all `tier === 'full'` only) measure trigger/pin distances
  // at mount. If that happens before webfonts swap in or images finish loading, the measured
  // layout is wrong and those sequences misfire — mobile/tablet never hits this because their
  // fallback there is a simple one-shot/static render with no pin math to get wrong. A refresh
  // once layout has actually settled fixes the measurements without touching any section file.
  useEffect(() => {
    // Official GSAP mitigation for iOS Safari's address-bar/rubber-band scroll
    // jitter during pinned+scrubbed sequences (CinematicDashboard, Differentials,
    // OperationalJourney's horizontal pin) — all now pinType:'transform' too.
    ScrollTrigger.normalizeScroll(true);

    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready?.then(refresh);
    window.addEventListener('load', refresh);
    // Device rotation can cross the 1024px `full`-tier boundary, remounting a
    // section's pinned sequence with structurally different JSX — refresh so
    // ScrollTrigger re-measures against the new layout instead of stale pin distances.
    window.addEventListener('orientationchange', refresh);
    const settleTimer = setTimeout(refresh, 500);
    return () => {
      // normalizeScroll is GLOBAL: its Observer preventDefaults every wheel/touch on
      // documentElement and redirects the delta to the window scroller. The
      // authenticated shell scrolls an inner <main>, not the window — so a normalizer
      // surviving this unmount freezes the app's scroll until a full reload. It is
      // owned by this effect, so it dies with it.
      ScrollTrigger.normalizeScroll(false);
      window.removeEventListener('load', refresh);
      window.removeEventListener('orientationchange', refresh);
      clearTimeout(settleTimer);
    };
  }, []);

  return (
    <div className="bg-ink-950 min-h-screen">
      <Navbar onLogin={onLogin} onSignup={onSignup} />
      <Hero onSignup={onSignup} />
      <CinematicDashboard />
      <OperationalJourney />
      <Modules />
      <KpiCounters />
      <SocialProof />
      <Differentials />
      <Plans onSignup={onSignup} />
      <FinalCta onSignup={onSignup} />
      <Footer onLogin={onLogin} onSignup={onSignup} />
    </div>
  );
};

export default LandingPage;
