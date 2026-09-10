// Motion (motion.dev) primitives shared across landing/ sections — the ~80-90%
// "small component" bucket (fades, slides, scale, hover, stagger). GSAP-owned
// sequences live in landingScroll.ts instead.

import { type ReactNode, type ComponentPropsWithoutRef, type MouseEvent, useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  useInView,
  useReducedMotion,
  useMotionValue,
  useSpring,
  type Variants,
} from 'motion/react';

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const DURATION = { fast: 0.3, base: 0.5, slow: 0.8 };

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base, ease: EASE } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE } },
};

export const hoverLift = { y: -4, transition: { duration: DURATION.fast, ease: EASE } };
export const tapScale = { scale: 0.98 };

/** Per-grid stagger factory — mirrors the old FadeIn's per-section delay tuning. */
export function staggerContainer(stagger = 0.08, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  };
}

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  variants?: Variants;
  amount?: number;
}

/** Drop-in scroll-reveal wrapper — replacement for the old useIntersect()+FadeIn pair. */
export function Reveal({ children, delay = 0, className = '', variants = fadeInUp, amount = 0.15 }: RevealProps) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount, margin: '-80px' }}
      variants={variants}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Thin wrapper around Motion's own useInView, reserved for the minority of
 * cases needing a raw boolean (e.g. gating when a GSAP timeline should play).
 * Most call sites should use `Reveal`/`whileInView` directly instead.
 */
export function useInViewOnce<T extends Element = HTMLDivElement>(
  options?: Omit<NonNullable<Parameters<typeof useInView>[1]>, 'once'>
) {
  const ref = useRef<T>(null);
  const isInView = useInView(ref, { amount: 0.15, ...options, once: true });
  return { ref, isInView };
}

interface TiltOptions {
  maxTilt?: number;
}

/**
 * Cursor-driven 3D tilt (rotateX/rotateY spring toward the pointer, relative
 * to element center). Spread the returned props onto a motion element:
 * `<motion.div ref={tilt.ref} style={tilt.style} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>`.
 * No-ops under prefers-reduced-motion.
 */
export function useTiltHover<T extends HTMLElement = HTMLDivElement>({ maxTilt = 10 }: TiltOptions = {}) {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRX = useSpring(rotateX, { stiffness: 220, damping: 22, mass: 0.6 });
  const springRY = useSpring(rotateY, { stiffness: 220, damping: 22, mass: 0.6 });

  const onMouseMove = (e: MouseEvent) => {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(px * maxTilt);
    rotateX.set(-py * maxTilt);
  };

  const onMouseLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return { ref, style: { rotateX: springRX, rotateY: springRY, transformPerspective: 800 }, onMouseMove, onMouseLeave };
}

interface RippleDot {
  id: number;
  cx: number;
  cy: number;
}

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'ref' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>;

interface MagneticButtonProps extends NativeButtonProps {
  /** Max magnetic pull, in px, at the element's edge. */
  strength?: number;
  variant?: 'solid' | 'ghost';
}

/**
 * Reusable premium CTA: magnetic spring-follow toward the cursor, tap-scale,
 * and an expanding ripple from the click point. Used by every primary button
 * across the homepage and the login screen so all CTAs share one feel.
 * Fully inert (no magnetism/ripple) under prefers-reduced-motion.
 */
export function MagneticButton({
  children,
  className = '',
  strength = 16,
  onClick,
  variant = 'solid',
  ...rest
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 300, damping: 20, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 300, damping: 20, mass: 0.5 });
  const [ripples, setRipples] = useState<RippleDot[]>([]);
  const rippleId = useRef(0);

  const handleMove = (e: MouseEvent) => {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set(((e.clientX - rect.left - rect.width / 2) / rect.width) * strength);
    y.set(((e.clientY - rect.top - rect.height / 2) / rect.height) * strength);
  };

  const handleLeave = () => {
    x.set(0);
    y.set(0);
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!reduce && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const id = rippleId.current++;
      setRipples(r => [...r, { id, cx: e.clientX - rect.left, cy: e.clientY - rect.top }]);
      setTimeout(() => setRipples(r => r.filter(rp => rp.id !== id)), 650);
    }
    onClick?.(e);
  };

  const base =
    variant === 'solid'
      ? 'bg-gradient-to-r from-enterprise-500 to-enterprise-400 text-white shadow-lg shadow-enterprise-900/40'
      : 'border border-ink-600 text-mist-100 hover:border-enterprise-400 hover:text-white';

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      style={{ x: springX, y: springY }}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      className={`relative isolate overflow-hidden ${base} ${className}`}
      {...rest}
    >
      {children}
      {ripples.map(r => (
        <motion.span
          key={r.id}
          className="pointer-events-none absolute rounded-full bg-white/30"
          style={{ left: r.cx, top: r.cy, translateX: '-50%', translateY: '-50%' }}
          initial={{ width: 0, height: 0, opacity: 0.55 }}
          animate={{ width: 260, height: 260, opacity: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        />
      ))}
    </motion.button>
  );
}

export { motion, AnimatePresence, useReducedMotion };
export type { Variants };
