import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// `min-h-[44px]` on touch pointers, tightened on fine pointers — a form field
// is the most-tapped element in the counting/picking flows, where the operator
// is standing, one-handed and often gloved.
const FIELD_BASE =
  'bg-surface-3 border border-edge rounded-control text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] [@media(pointer:fine)]:min-h-[38px]';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Leading icon (search, filter, etc.) — positioned absolute inside the field. */
  icon?: ReactNode;
}

/** Standard text input — replaces the ad-hoc bg-surface-3/border-edge input duplicated across every page. */
export function Input({ icon, className = '', ...rest }: InputProps) {
  if (!icon) {
    return <input className={`w-full px-3 py-2 ${FIELD_BASE} ${className}`} {...rest} />;
  }
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none [&>svg]:w-[18px] [&>svg]:h-[18px]">
        {icon}
      </span>
      <input className={`w-full pl-10 pr-4 py-2.5 ${FIELD_BASE} ${className}`} {...rest} />
    </div>
  );
}

/** Standard select — same surface/border/focus treatment as Input, for form consistency. */
export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`px-3 py-2 ${FIELD_BASE} ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** Standard textarea — same treatment, resize-y by default so forms can't be dragged wider than their column. */
export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`w-full px-3 py-2 resize-y ${FIELD_BASE} ${className}`} {...rest} />;
}
