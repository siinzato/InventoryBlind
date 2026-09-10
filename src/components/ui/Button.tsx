import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { motion } from 'motion/react';

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'ref' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>;

interface ButtonProps extends NativeButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  children: ReactNode;
}

const VARIANT = {
  // Flat by default: the accent fill already carries the hierarchy, so no
  // shadow competes with it (the project's shadow scale is control/panel/
  // overlay — `shadow-sm` was stock Tailwind leaking in through this file).
  primary: 'bg-accent hover:bg-accent-strong text-white',
  secondary: 'bg-surface-3 hover:bg-edge text-fg border border-edge',
  ghost: 'bg-transparent hover:bg-surface-3 text-fg-muted hover:text-fg',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
} as const;

// Touch first: both sizes clear the 44px minimum on touch pointers, then tighten
// on fine pointers (mouse) where 44px reads oversized in dense toolbars.
// `md` is the default; `sm` is for inline/secondary actions, never the only
// action on a screen.
const SIZE = {
  sm: 'min-h-[44px] px-3 text-xs [@media(pointer:fine)]:min-h-[32px]',
  md: 'min-h-[44px] px-4 text-sm [@media(pointer:fine)]:min-h-[38px]',
} as const;

/** Standard button — replaces the ad-hoc font-black/emerald-500 buttons duplicated across every page. */
export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
