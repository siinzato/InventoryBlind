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
  primary: 'bg-accent hover:bg-accent-strong text-white shadow-sm',
  secondary: 'bg-surface-3 hover:bg-edge text-fg border border-edge',
  ghost: 'bg-transparent hover:bg-surface-3 text-fg-muted hover:text-fg',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
} as const;

const SIZE = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' } as const;

/** Standard button — replaces the ad-hoc font-black/emerald-500 buttons duplicated across every page. */
export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
