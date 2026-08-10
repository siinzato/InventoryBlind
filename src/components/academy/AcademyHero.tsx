import { useRef } from 'react';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { Truck, Boxes, ClipboardList, ScanLine, Target, TrendingUp, BookOpen, Barcode, Wifi, Package, BarChart3, Lightbulb } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { METODO_IB_INTRO } from '../../lib/academyContent';

gsap.registerPlugin(SplitText, useGSAP);

// "Recebimento → Armazenagem → Inventário → Conferência → Acuracidade → Melhoria Contínua"
const FLOW_NODES = [
  { label: 'Recebimento', icon: Truck },
  { label: 'Armazenagem', icon: Boxes },
  { label: 'Inventário', icon: ClipboardList },
  { label: 'Conferência', icon: ScanLine },
  { label: 'Acuracidade', icon: Target },
  { label: 'Melhoria Contínua', icon: TrendingUp },
];

// Ambient icons kept to the outer edges only, so they never sit behind the centered text.
const AMBIENT_ICONS = [
  { Icon: BookOpen, left: 6, top: 14 },
  { Icon: Barcode, left: 10, top: 62 },
  { Icon: Wifi, left: 4, top: 84 },
  { Icon: Package, left: 92, top: 18 },
  { Icon: BarChart3, left: 88, top: 58 },
  { Icon: Lightbulb, left: 94, top: 86 },
];

/** I.B Academy hero — self-contained, GSAP-only addition to AcademyHome.tsx. Registers its
 *  own plugin instances from the npm packages directly (not via landing/landingScroll.ts)
 *  to keep the landing/ GSAP tree and the authenticated-app tree decoupled, per this repo's
 *  existing convention. Uses Design System 2.0 semantic tokens (bg-surface-2/text-fg/etc.),
 *  not the landing-only ink/mist palette, since this renders inside the logged-in app. */
export function AcademyHero() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const blueprintRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bookRefs = useRef<(SVGGElement | null)[]>([]);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineFillRef = useRef<HTMLDivElement>(null);
  const tier = useAnimationTier();

  const BLUEPRINT_OPACITY = 0.055;

  // Entrance sequence.
  useGSAP(() => {
    const split = headlineRef.current ? new SplitText(headlineRef.current, { type: 'words,chars' }) : null;

    if (tier === 'minimal') {
      gsap.set(blueprintRef.current, { opacity: BLUEPRINT_OPACITY });
      gsap.set('.academy-hero-fadein', { opacity: 1, y: 0, filter: 'blur(0px)' });
      gsap.set(nodeRefs.current, { opacity: 1, scale: 1 });
      gsap.set(iconRefs.current, { opacity: 0.3 });
      gsap.set(bookRefs.current, { opacity: 0.4 });
      gsap.set(lineFillRef.current, { scaleX: 1, transformOrigin: 'left center' });
      if (split) gsap.set(split.chars, { opacity: 1, y: 0, filter: 'blur(0px)' });
      return () => split?.revert();
    }

    gsap.set(blueprintRef.current, { opacity: 0 });
    gsap.set(nodeRefs.current, { opacity: 0, scale: 0.6 });
    gsap.set(iconRefs.current, { opacity: 0 });
    gsap.set(bookRefs.current, { opacity: 0 });
    gsap.set(lineFillRef.current, { scaleX: 0, transformOrigin: 'left center' });
    gsap.set('.academy-hero-fadein', { opacity: 0, y: 16 });
    if (split) gsap.set(split.chars, { opacity: 0, y: 22, filter: 'blur(9px)' });

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.to(blueprintRef.current, { opacity: BLUEPRINT_OPACITY, duration: 1.8, ease: 'power1.out' }, 0.35)
      .to(iconRefs.current, { opacity: 0.3, duration: 0.9, stagger: 0.08 }, 0.7)
      .to(bookRefs.current, { opacity: 0.45, duration: 0.7, stagger: 0.25 }, 0.9);

    if (split) {
      tl.to(split.chars, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, stagger: { each: 0.02 }, ease: 'power2.out' }, 1.1);
    }
    tl.to('.academy-hero-fadein', { opacity: 1, y: 0, duration: 0.7, stagger: 0.14 }, 1.4)
      .to(lineFillRef.current, { scaleX: 1, duration: 1.1, ease: 'power1.inOut' }, 1.9)
      .to(nodeRefs.current, { opacity: 1, scale: 1, duration: 0.4, stagger: 0.1, ease: 'back.out(2)' }, 1.95);

    return () => split?.revert();
  }, { scope: sectionRef, dependencies: [tier] });

  return (
    <section ref={sectionRef} className="relative overflow-hidden rounded-2xl border border-edge bg-surface-2">
      <div
        ref={blueprintRef}
        className="pointer-events-none absolute inset-0 text-accent"
        style={{
          opacity: 0,
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 85%)',
        }}
      />

      {tier !== 'minimal' && (
        <div className="pointer-events-none absolute inset-0">
          {AMBIENT_ICONS.map(({ Icon, left, top }, i) => (
            <div
              key={i}
              ref={el => { iconRefs.current[i] = el; }}
              className="absolute text-accent hidden sm:block"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <Icon size={20} strokeWidth={1.25} />
            </div>
          ))}
        </div>
      )}

      {tier !== 'minimal' && (
        <>
          <svg
            className="pointer-events-none absolute top-6 left-6 hidden sm:block"
            width="40" height="26" viewBox="0 0 40 26"
          >
            <g ref={el => { bookRefs.current[0] = el; }}>
              <rect x="4" y="4" width="32" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" className="text-fg-subtle" />
              <path className="book-page text-fg-subtle" d="M20,4 L20,22" stroke="currentColor" strokeWidth="1.1" fill="none" />
              {[0, 1, 2].map(p => (
                <circle key={p} className="book-particle text-accent" cx={20 + p * 3 - 3} cy="4" r="1" fill="currentColor" opacity={0} />
              ))}
            </g>
          </svg>
          <svg
            className="pointer-events-none absolute bottom-6 right-6 hidden sm:block"
            width="40" height="26" viewBox="0 0 40 26"
          >
            <g ref={el => { bookRefs.current[1] = el; }}>
              <rect x="4" y="4" width="32" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" className="text-fg-subtle" />
              <path className="book-page text-fg-subtle" d="M20,4 L20,22" stroke="currentColor" strokeWidth="1.1" fill="none" />
              {[0, 1, 2].map(p => (
                <circle key={p} className="book-particle text-accent" cx={20 + p * 3 - 3} cy="4" r="1" fill="currentColor" opacity={0} />
              ))}
            </g>
          </svg>
        </>
      )}

      <div className="relative z-10 px-6 pt-14 pb-12 space-y-4">
        <div className="text-center space-y-4">
          <p className="academy-hero-fadein inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent bg-accent/10 rounded-full px-3 py-1">
            Método I.B.® — Metodologia Oficial InventoryBlind
          </p>
          <h1 ref={headlineRef} className="text-2xl md:text-3xl font-bold text-fg tracking-tight">
            InventoryBlind Academy
          </h1>
          <p className="academy-hero-fadein text-sm text-fg-muted max-w-2xl mx-auto">
            A Plataforma Oficial de Capacitação em Gestão de Estoques e Inventário Inteligente.
          </p>
          <p className="academy-hero-fadein text-lg font-semibold text-fg whitespace-pre-line max-w-xl mx-auto">
            {METODO_IB_INTRO.philosophyQuote}
          </p>
        </div>

        <div className="academy-hero-fadein relative max-w-3xl mx-auto pt-6">
          <div className="absolute left-9 right-9 top-[27px] h-px bg-edge overflow-hidden">
            <div ref={lineFillRef} className="h-full bg-accent/50" style={{ transform: 'scaleX(0)' }} />
          </div>
          <div className="relative flex items-start justify-between gap-1">
            {FLOW_NODES.map((node, i) => (
              <div key={node.label} className="flex flex-col items-center flex-1 min-w-0">
                <div
                  ref={el => { nodeRefs.current[i] = el; }}
                  className="w-9 h-9 rounded-full bg-surface-2 border border-accent/40 flex items-center justify-center text-accent flex-shrink-0"
                >
                  <node.icon size={15} />
                </div>
                <p className="mt-2 text-[9px] sm:text-[10px] font-medium text-fg-subtle text-center leading-tight px-0.5">
                  {node.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
