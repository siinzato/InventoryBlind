import { useState, useEffect } from 'react';

export type AnimationTier = 'full' | 'simplified' | 'minimal';

const MOBILE_QUERY = '(max-width: 1024px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function computeTier(): AnimationTier {
  if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return 'minimal';
  if (window.matchMedia(MOBILE_QUERY).matches) return 'simplified';
  return 'full';
}

/**
 * Drives how much the landing page's GSAP sequences should scale back.
 * `minimal` (prefers-reduced-motion) always wins over device/viewport —
 * it's an accessibility signal, not a performance one. `simplified` covers
 * mobile/tablet widths (reuses the project's existing `lg:` breakpoint) where
 * Motion fades stay full but GSAP drops pin/scrub for one-shot reveals.
 * Motion-owned components should prefer Motion's own `useReducedMotion()`
 * instead — this hook is for the GSAP-owning sections that need the single
 * 3-way branch.
 */
export function useAnimationTier(): AnimationTier {
  const [tier, setTier] = useState<AnimationTier>(() =>
    typeof window === 'undefined' ? 'full' : computeTier()
  );

  useEffect(() => {
    const mobile = window.matchMedia(MOBILE_QUERY);
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setTier(computeTier());

    update();
    mobile.addEventListener('change', update);
    reduced.addEventListener('change', update);

    return () => {
      mobile.removeEventListener('change', update);
      reduced.removeEventListener('change', update);
    };
  }, []);

  return tier;
}
