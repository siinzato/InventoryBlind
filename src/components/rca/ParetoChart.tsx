import { CAUSE_LABEL } from '../../lib/rcaAlgorithm';
import type { ParetoBucket } from '../../lib/rcaAlgorithm';

interface ParetoChartProps {
  buckets: ParetoBucket[];
}

/** Barras (contagem por causa) + linha de % acumulado (80/20) — SVG à mão, mesmo
 *  espírito do Sparkline usado em RiskDashboardPage/CBCDashboardPage (não há lib de
 *  gráficos neste projeto). */
export function ParetoChart({ buckets }: ParetoChartProps) {
  if (buckets.length === 0) {
    return <p className="text-xs text-fg-subtle">Nenhuma divergência classificada ainda.</p>;
  }

  const w = 700;
  const h = 240;
  const barAreaH = 160;
  const gap = 8;
  const barW = (w - gap * (buckets.length - 1)) / buckets.length;
  const maxCount = Math.max(...buckets.map(b => b.count));

  const linePoints = buckets.map((b, i) => {
    const x = i * (barW + gap) + barW / 2;
    const y = barAreaH - (b.cumulativePct / 100) * barAreaH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ minWidth: 500, height: 240 }}>
        {buckets.map((b, i) => {
          const barH = (b.count / maxCount) * barAreaH;
          const x = i * (barW + gap);
          return (
            <g key={b.category}>
              <rect x={x} y={barAreaH - barH} width={barW} height={barH} className="fill-accent/70" rx={3} />
              <text x={x + barW / 2} y={barAreaH - barH - 4} textAnchor="middle" className="fill-fg text-[10px] font-semibold">{b.count}</text>
              <text x={x + barW / 2} y={barAreaH + 16} textAnchor="middle" className="fill-fg-subtle text-[9px]">
                {CAUSE_LABEL[b.category].length > 10 ? `${CAUSE_LABEL[b.category].slice(0, 9)}…` : CAUSE_LABEL[b.category]}
              </text>
            </g>
          );
        })}
        <polyline points={linePoints} fill="none" className="stroke-red-500" strokeWidth="2" />
        {buckets.map((b, i) => {
          const x = i * (barW + gap) + barW / 2;
          const y = barAreaH - (b.cumulativePct / 100) * barAreaH;
          return <circle key={`pt-${b.category}`} cx={x} cy={y} r={2.5} className="fill-red-500" />;
        })}
      </svg>
      <p className="text-[10px] text-fg-subtle mt-1">Barras = ocorrências por causa · linha vermelha = % acumulado (Pareto 80/20)</p>
    </div>
  );
}
