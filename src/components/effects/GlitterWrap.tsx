// GlitterWrap — Canvas starfield/warp-tunnel effect for the Hero background.
// Adapted from an Originkit (Framer) component: Framer-specific scaffolding
// (RenderTarget, @framerSupportedLayoutWidth annotations, prop-defaults
// merge pattern) stripped out; particle count now scales with the shared
// useAnimationTier() (mobile + prefers-reduced-motion), and the palette
// matches the existing ink/mist/enterprise homepage tokens instead of the
// original demo colors. No canvas libraries — plain Canvas2D + rAF.

import { useEffect, useRef } from 'react';
import { useAnimationTier } from '../../lib/useAnimationTier';

interface GlitterWrapProps {
  className?: string;
  /** External speed multiplier (>1 = faster) — driven by Hero for the "sem pontos cegos" moment and scroll-out deceleration. Read live via ref, no re-render. */
  speedRef?: React.MutableRefObject<number>;
}

function parseColor(input: string): [number, number, number] {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  return [255, 255, 255];
}

const PALETTE = ['#CFE0FF', '#7FB3F5', '#3E7BE0'].map(parseColor);

const TIER_PARTICLE_COUNT = { full: 220, simplified: 90, minimal: 24 } as const;

type Star = {
  x: number; y: number; z: number;
  px: number; py: number;
  seed: number; vmul: number; colorIdx: number;
  flashUntil: number; nextFlash: number;
};

export function GlitterWrap({ className = '', speedRef }: GlitterWrapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const tier = useAnimationTier();

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const FOCAL_DEPTH = 0.13;
    // Reduced motion: no glitter flashes, no turbulence wobble, calmer drift — reduced, not removed.
    const GLITTER = tier === 'minimal' ? 0.0001 : 0.3;
    const TURBULENCE = tier === 'minimal' ? 0 : 0.4;
    const STAR_SCALE = 1.8;
    const BASE_SPEED = tier === 'minimal' ? 1.2 : 5;

    const stars: Star[] = [];
    let elapsed = 0;
    let lastT = performance.now();

    const resetStar = (s: Star, initial = false) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = (0.2 + Math.random() * 0.8) * (100 / 15);
      s.x = Math.cos(angle) * radius;
      s.y = Math.sin(angle) * radius;
      s.z = initial ? Math.random() : 1.0;
      s.px = NaN; s.py = NaN;
      s.seed = Math.random() * 1000;
      s.vmul = 0.6 + Math.random() * 0.8;
      s.colorIdx = Math.floor(Math.random() * PALETTE.length);
      s.flashUntil = 0;
      s.nextFlash = elapsed + 1 + Math.random() * 4 * (1 / GLITTER);
    };

    const makeStar = (): Star => ({ x: 0, y: 0, z: 0, px: NaN, py: NaN, seed: 0, vmul: 1, colorIdx: 0, flashUntil: 0, nextFlash: 0 });

    const targetCount = TIER_PARTICLE_COUNT[tier];
    while (stars.length < targetCount) {
      const s = makeStar();
      resetStar(s, true);
      stars.push(s);
    }

    const resize = (entry?: ResizeObserverEntry) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cr = entry?.contentRect;
      const rectW = cr?.width || container.clientWidth || container.getBoundingClientRect().width;
      const rectH = cr?.height || container.clientHeight || container.getBoundingClientRect().height;
      const w = Math.max(1, Math.floor(rectW) || 600);
      const h = Math.max(1, Math.floor(rectH) || 400);

      const prev = sizeRef.current;
      if (prev.w === w && prev.h === h && prev.dpr === dpr) return;

      sizeRef.current = { w, h, dpr };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    };

    resize();
    const ro = new ResizeObserver(entries => resize(entries[0]));
    ro.observe(container);

    const drawFrame = (deltaSec: number) => {
      const speed = speedRef?.current ?? 1;
      const stepZ = BASE_SPEED * 0.0008 * speed;
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const projScale = Math.min(w, h) * 0.9;
      const dt = Math.max(0.001, Math.min(0.1, deltaSec)) * 60;

      const keep = Math.pow(0.98, dt);
      const trailAlpha = Math.max(0.02, 1 - keep);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const vz = stepZ * s.vmul * dt;
        s.z -= vz;
        if (s.z <= FOCAL_DEPTH) { resetStar(s); continue; }

        let tx = s.x, ty = s.y;
        const t = elapsed * 1.2 + s.seed;
        const amp = TURBULENCE * (1 - s.z) * 0.25;
        tx += Math.sin(t + s.seed) * amp;
        ty += Math.cos(t * 1.13 + s.seed * 0.7) * amp;

        const persp = FOCAL_DEPTH / Math.max(s.z, 0.0001);
        const sx = cx + tx * persp * projScale;
        const sy = cy + ty * persp * projScale;

        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) { resetStar(s); continue; }

        let flashMult = 1;
        if (elapsed >= s.nextFlash && s.flashUntil < elapsed) {
          s.flashUntil = elapsed + 0.04 + Math.random() * 0.07;
          s.nextFlash = elapsed + 1 + Math.random() * 4 * (1 / GLITTER);
        }
        if (elapsed <= s.flashUntil) flashMult = 1 + 2.5 * GLITTER;

        const sizePersp = Math.min(2.5, (FOCAL_DEPTH / Math.max(s.z, 0.0001)) * 0.6);
        const baseR = Math.max(0.25, STAR_SCALE * (0.4 + sizePersp));
        const maxR = 1 + STAR_SCALE * 2.5;
        const r = Math.min(baseR * flashMult, maxR);

        const lifeT = 1 - s.z;
        const a = Math.min(1, lifeT * 0.9 + 0.05) * 0.85 * (flashMult > 1 ? 1 : 0.85);

        const [cr_, cg_, cb_] = PALETTE[s.colorIdx];
        const colStr = `rgb(${cr_}, ${cg_}, ${cb_})`;

        if (!Number.isNaN(s.px) && !Number.isNaN(s.py)) {
          ctx.globalAlpha = a * 0.5;
          ctx.strokeStyle = colStr;
          ctx.lineWidth = Math.max(0.4, r * 0.4);
          ctx.beginPath();
          ctx.moveTo(s.px, s.py);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }

        ctx.globalAlpha = a;
        ctx.fillStyle = colStr;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

        if (flashMult > 1) {
          const rf = Math.min(r * 1.4, maxR * 1.4);
          ctx.globalAlpha = a * 0.5;
          ctx.fillRect(sx - rf, sy - rf, rf * 2, rf * 2);
        }

        s.px = sx; s.py = sy;
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      elapsed += Math.min(0.1, Math.max(0, deltaSec));
    };

    const loop = (t: number) => {
      const deltaSec = (t - lastT) / 1000;
      lastT = t;
      drawFrame(deltaSec);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [tier, speedRef]);

  return (
    <div ref={containerRef} className={`absolute inset-0 overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  );
}
