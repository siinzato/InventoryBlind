// HeroAnimation — the two GSAP pieces added on top of Hero.tsx's existing
// SplitText entrance timeline: a "scanner" highlight moment on the closing
// phrase, and a scroll-linked deceleration/fade. Kept separate from Hero.tsx's
// own useGSAP (mockup reveal, KPI tiles, ambient particles) so neither has to
// be rewritten — this hook only adds new tweens, it doesn't touch the
// existing sequence.

import { useRef, type RefObject } from 'react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useGSAP, gsap, ScrollTrigger } from '../landing/landingScroll';

interface UseHeroAnimationArgs {
  sectionRef: RefObject<HTMLElement | null>;
  highlightRef: RefObject<HTMLSpanElement | null>;
  headlineWrapperRef: RefObject<HTMLDivElement | null>;
}

/** Returns a ref GlitterWrap reads every frame (1 = normal speed). Mutating it directly avoids any React re-render. */
export function useHeroAnimation({ sectionRef, highlightRef, headlineWrapperRef }: UseHeroAnimationArgs) {
  const speedRef = useRef(1);
  const tier = useAnimationTier();

  useGSAP(
    () => {
      if (tier === 'minimal') return;

      // "sem pontos cegos." scanner moment — fires once, timed to land just after
      // Hero's own char-stagger entrance settles (~1.6s in, matches its timeline).
      if (highlightRef.current) {
        const el = highlightRef.current;
        gsap.set(el, { backgroundPosition: '200% 0' });

        const tl = gsap.timeline({ delay: 1.6 });
        tl.to(speedRef, { current: 2.2, duration: 0.35, ease: 'power2.out' })
          .to(el, { backgroundPosition: '-200% 0', duration: 0.9, ease: 'power2.inOut' }, '<')
          .to(speedRef, { current: 1, duration: 0.8, ease: 'power2.inOut' }, '-=0.2');
      }

      // Scroll-out: particles slow down, headline scales/fades slightly — cinematic exit.
      if (tier === 'full' && sectionRef.current) {
        ScrollTrigger.create({
          trigger: sectionRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.5,
          onUpdate: self => {
            speedRef.current = 1 - self.progress * 0.7;
          },
        });

        if (headlineWrapperRef.current) {
          gsap.to(headlineWrapperRef.current, {
            scale: 0.92,
            opacity: 0.6,
            ease: 'none',
            scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: 0.5 },
          });
        }
      }
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  return { speedRef };
}
