import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Truck, Boxes, ClipboardList, ScanLine, Target, TrendingUp } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { METODO_IB_INTRO } from '../../lib/academyContent';

gsap.registerPlugin(useGSAP);

// "Recebimento → Armazenagem → Inventário → Conferência → Acuracidade → Melhoria Contínua"
const FLOW_NODES = [
  { label: 'Recebimento', icon: Truck },
  { label: 'Armazenagem', icon: Boxes },
  { label: 'Inventário', icon: ClipboardList },
  { label: 'Conferência', icon: ScanLine },
  { label: 'Acuracidade', icon: Target },
  { label: 'Melhoria Contínua', icon: TrendingUp },
];

/** I.B Academy header — the one editorial opener inside the authenticated app.
 *
 *  Reduced from a decorative hero to a typographic one: the blueprint grid with
 *  radial mask, six ambient floating icons, two particle-emitting SVG books and
 *  the per-character SplitText blur reveal were all removed. They were the
 *  landing's visual language leaking into an operational screen, and the design
 *  doc reserves particles/abstract backgrounds for the Landing zone.
 *
 *  What stays is what carries meaning: the six-stage Método I.B. flow (a real
 *  sequence, so ordered markers are legitimate here) and one quick fade-in on
 *  page load. Motion is functional and short — it orients, it doesn't perform.
 *  `useAnimationTier` still gates it, so reduced-motion users get the final
 *  state immediately. */
export function AcademyHero() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineFillRef = useRef<HTMLDivElement>(null);
  const tier = useAnimationTier();

  useGSAP(() => {
    if (tier === 'minimal') {
      gsap.set('.academy-hero-fadein', { opacity: 1, y: 0 });
      gsap.set(nodeRefs.current, { opacity: 1 });
      gsap.set(lineFillRef.current, { scaleX: 1, transformOrigin: 'left center' });
      return;
    }

    gsap.set('.academy-hero-fadein', { opacity: 0, y: 10 });
    gsap.set(nodeRefs.current, { opacity: 0 });
    gsap.set(lineFillRef.current, { scaleX: 0, transformOrigin: 'left center' });

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.to('.academy-hero-fadein', { opacity: 1, y: 0, duration: 0.4, stagger: 0.06 })
      .to(lineFillRef.current, { scaleX: 1, duration: 0.5, ease: 'power1.inOut' }, 0.2)
      .to(nodeRefs.current, { opacity: 1, duration: 0.25, stagger: 0.05 }, 0.3);
  }, { scope: sectionRef, dependencies: [tier] });

  return (
    <section ref={sectionRef} className="rounded-container border border-edge bg-surface-2">
      <div className="px-6 py-10 space-y-4 sm:px-8">
        <div className="max-w-2xl space-y-3">
          <p className="academy-hero-fadein text-overline">
            Método I.B.® — Metodologia Oficial InventoryBlind
          </p>
          <h1 className="academy-hero-fadein text-display">InventoryBlind Academy</h1>
          <p className="academy-hero-fadein text-body text-fg-muted">
            A Plataforma Oficial de Capacitação em Gestão de Estoques e Inventário Inteligente.
          </p>
          <p className="academy-hero-fadein text-headline whitespace-pre-line text-fg-muted">
            {METODO_IB_INTRO.philosophyQuote}
          </p>
        </div>

        {/* Six-stage flow. Horizontally scrollable below sm so the labels stay
            legible instead of compressing to 9px on a phone. */}
        <div className="academy-hero-fadein relative overflow-x-auto pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="relative min-w-[540px]">
            <div className="absolute left-9 right-9 top-[18px] h-px overflow-hidden bg-edge">
              <div ref={lineFillRef} className="h-full bg-edge" style={{ transform: 'scaleX(0)' }} />
            </div>
            <div className="relative flex items-start justify-between gap-1">
              {FLOW_NODES.map((node, i) => (
                <div key={node.label} className="flex min-w-0 flex-1 flex-col items-center">
                  <div
                    ref={el => { nodeRefs.current[i] = el; }}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-fg-muted"
                  >
                    <node.icon size={15} />
                  </div>
                  <p className="mt-2 px-0.5 text-center text-caption leading-tight">
                    {node.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
