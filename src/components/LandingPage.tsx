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

import type { FC } from 'react';
import { useAuth } from '../lib/auth';
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
