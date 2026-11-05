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
  // Contorno, não bloco. §10 lista borda e contraste de superfície como soluções
  // ALTERNATIVAS, em ordem de preferência — não para empilhar. Com preenchimento e
  // borda ao mesmo tempo, o secundário ganhava peso quase igual ao do primário, e
  // dois blocos sólidos lado a lado são a assinatura visual de template SaaS.
  // O hover continua trazendo a superfície, então a afordância não se perde.
  secondary: 'bg-transparent hover:bg-surface-3 text-fg border border-edge',
  ghost: 'bg-transparent hover:bg-surface-3 text-fg-muted hover:text-fg',
  // `danger`/`danger-strong`, não `red-600`/`red-500`: o vermelho cru do
  // Tailwind é de uma família mais clara e saturada que o azul da marca, então
  // o botão destrutivo pesava mais que o primário ao lado dele. Ver §5.1.
  danger: 'bg-danger hover:bg-danger-strong text-white',
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
      // `font-medium`, não semibold: pela §4.2 o Semibold é o peso de Title e
      // Headline. Em semibold o rótulo do botão pesava igual ao título da página e
      // achatava a hierarquia — Medium é o peso de rótulo de controle no SF Pro, que
      // é a referência declarada na §1.
      //
      // O anel de foco cumpre a §5.4, que o exigia e que nem o componente nem o CSS
      // global implementavam: quem navegava por teclado não via onde estava.
      className={`inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:pointer-events-none ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
