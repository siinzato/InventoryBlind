import type { BlindScoreStatus } from '../../lib/analytics/analyticsContracts';

// SVG à mão, mesmo espírito de ParetoChart.tsx/TrendSparkline (RcaDashboardPage) — não há
// lib de gráficos no projeto e o pedido não justifica adicionar uma para 2 componentes.

const GAUGE_STROKE: Record<BlindScoreStatus, string> = {
  excelente: 'stroke-emerald-500',
  bom: 'stroke-emerald-500',
  atencao: 'stroke-amber-500',
  critico: 'stroke-red-500',
  indisponivel: 'stroke-fg-subtle',
};

interface ScoreGaugeProps {
  score: number | null;
  status: BlindScoreStatus;
  size?: number;
}

/** Anel de progresso 0-100 — usado pelo BlindScore como a "nota" central da página. */
export function ScoreGauge({ score, status, size = 176 }: ScoreGaugeProps) {
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <div className="relative inline-flex flex-shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} className="stroke-surface-3" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          className={`${GAUGE_STROKE[status]} transition-[stroke-dasharray] duration-500`}
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-semibold tabular-nums text-fg">{score ?? '—'}</span>
        <span className="text-xs text-fg-subtle">/ 100</span>
      </div>
    </div>
  );
}

interface AccuracyTrendChartProps {
  points: { period: string; value: number }[];
}

/** Série real de acurácia por sessão de contagem (não uma reconstrução sintética do
 *  BlindScore histórico — ver blindScoreEngine.ts). */
export function AccuracyTrendChart({ points }: AccuracyTrendChartProps) {
  if (points.length < 2) {
    return <p className="text-xs text-fg-subtle">Dados insuficientes para exibir a evolução ainda — é preciso mais de uma sessão de contagem com acurácia calculada.</p>;
  }

  const w = 640;
  const h = 120;
  const min = Math.min(...points.map(p => p.value), 0);
  const max = Math.max(...points.map(p => p.value), 100);
  const range = Math.max(max - min, 1);

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p.value - min) / range) * h;
    return { x, y };
  });
  const linePoints = coords.map(c => `${c.x},${c.y}`).join(' ');

  const firstLabel = new Date(points[0].period).toLocaleDateString('pt-BR');
  const lastLabel = new Date(points[points.length - 1].period).toLocaleDateString('pt-BR');

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
        <polyline points={linePoints} fill="none" className="stroke-accent" strokeWidth="2" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={2.5} className="fill-accent" />
        ))}
      </svg>
      <div className="flex items-center justify-between mt-1">
        <p className="text-[10px] text-fg-subtle">{firstLabel}</p>
        <p className="text-[10px] text-fg-subtle">{lastLabel}</p>
      </div>
    </div>
  );
}
