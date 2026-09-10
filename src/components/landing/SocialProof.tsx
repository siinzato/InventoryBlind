import { motion, useReducedMotion } from './landingMotion';

const SEGMENTS = [
  'Distribuidoras',
  'Redes de Varejo',
  'E-commerce',
  'Indústria',
  'Atacado',
  'Farmacêutico',
  'Autopeças',
  'Alimentício',
];

export function SocialProof() {
  const reduce = useReducedMotion();
  const loop = [...SEGMENTS, ...SEGMENTS];

  return (
    <section className="relative bg-ink-950 border-y border-ink-700 py-10 overflow-hidden">
      <p className="text-center text-xs uppercase tracking-wider text-mist-400 mb-6">
        Feito para operações que não podem errar
      </p>
      <div
        className="relative"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        }}
      >
        <motion.div
          className="flex gap-3 w-max"
          animate={reduce ? undefined : { x: ['0%', '-50%'] }}
          transition={reduce ? undefined : { duration: 22, ease: 'linear', repeat: Infinity }}
        >
          {loop.map((seg, i) => (
            <span
              key={i}
              className="flex-shrink-0 px-5 py-2.5 rounded-full border border-ink-700 bg-ink-900/60 text-sm text-mist-400"
            >
              {seg}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
