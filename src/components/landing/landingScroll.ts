// GSAP + ScrollTrigger primitives shared across landing/ sections — the
// "big cinematic sequence" bucket (Hero entrance, CinematicDashboard pinned
// timeline, OperationalJourney horizontal pin, scrub-synced KPI counters).
// Small/independent animations should use landingMotion.tsx (Motion) instead.

import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { useGSAP } from '@gsap/react';
import type { AnimationTier } from '../../lib/useAnimationTier';

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin);

export { gsap, ScrollTrigger, useGSAP, SplitText, DrawSVGPlugin };

export function formatCount(n: number, decimals = 0, prefix = '', suffix = '') {
  return `${prefix}${n.toFixed(decimals).replace('.', ',')}${suffix}`;
}

/**
 * Adds a count-up tween (writes to `el.textContent`, bypasses React state) onto
 * an existing timeline at `position` — for counters that must stay perfectly
 * in sync with a larger master sequence (e.g. CinematicDashboard's pinned
 * timeline) instead of owning their own independent ScrollTrigger.
 */
export function addCounterTween(
  timeline: gsap.core.Timeline,
  el: Element | null | undefined,
  { end, decimals = 0, prefix = '', suffix = '' }: { end: number; decimals?: number; prefix?: string; suffix?: string },
  position?: gsap.Position
) {
  if (!el) return timeline;
  const target = el as HTMLElement;
  const counter = { val: 0 };
  target.textContent = formatCount(0, decimals, prefix, suffix);
  timeline.to(
    counter,
    {
      val: end,
      ease: 'none',
      onUpdate: () => {
        target.textContent = formatCount(counter.val, decimals, prefix, suffix);
      },
    },
    position
  );
  return timeline;
}

interface UseCountUpOptions {
  end: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  tier?: AnimationTier;
  /** Ties the count progress to scroll position instead of firing once on entry. */
  scrub?: boolean;
}

/**
 * Animates a number into an element's textContent when it enters the
 * viewport. Writes directly to the DOM so a 60fps count-up never triggers a
 * React re-render. On `minimal` tier the final value is set immediately with
 * no tween, respecting prefers-reduced-motion.
 */
export function useCountUp<T extends HTMLElement = HTMLSpanElement>({
  end,
  duration = 1.6,
  decimals = 0,
  prefix = '',
  suffix = '',
  tier = 'full',
  scrub = false,
}: UseCountUpOptions) {
  const ref = useRef<T>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      if (tier === 'minimal') {
        el.textContent = formatCount(end, decimals, prefix, suffix);
        return;
      }

      const counter = { val: 0 };
      el.textContent = formatCount(0, decimals, prefix, suffix);

      gsap.to(counter, {
        val: end,
        duration: scrub ? undefined : duration,
        ease: scrub ? 'none' : 'power1.out',
        onUpdate: () => {
          el.textContent = formatCount(counter.val, decimals, prefix, suffix);
        },
        scrollTrigger: scrub
          ? { trigger: el, start: 'top 90%', end: 'top 35%', scrub: 0.5 }
          : { trigger: el, start: 'top 85%', once: true },
      });
    },
    { scope: ref, dependencies: [end, duration, decimals, prefix, suffix, tier, scrub] }
  );

  return ref;
}

/**
 * Classic GSAP horizontal-scroll-pin recipe: pins `container`, translates
 * `track` left by its overflow width as the user scrolls vertically through
 * the pinned range. The returned timeline has the horizontal move as its
 * only tween (duration 1, `ease: 'none'`) — callers add further tweens
 * (camera dot, stage focus, SVG path draw) at fractional positions (0–1) on
 * the SAME timeline so everything stays scrubbed to the identical scroll
 * range. Must be called from inside the component's own `useGSAP` scope so
 * `@gsap/react` reverts it on unmount/StrictMode re-invoke.
 */
export function createHorizontalPin(container: Element, track: HTMLElement, pin = true) {
  const distance = () => track.scrollWidth - container.clientWidth;
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: container,
      start: 'top top',
      end: () => `+=${Math.max(distance(), 1)}`,
      scrub: 1,
      pin,
      invalidateOnRefresh: true,
    },
  });
  tl.to(track, { x: () => -distance(), ease: 'none', duration: 1 });
  return tl;
}
