import { CAUSE_LABEL } from '../../lib/rcaAlgorithm';
import type { ParetoBucket } from '../../lib/rcaAlgorithm';

interface ParetoChartProps {
  buckets: ParetoBucket[];
  onSelectCategory?: (category: string) => void;
}

/** Barras (contagem por causa, uma única cor) + linha de % acumulado + referência de 80%
 *  (Pareto clássico) — SVG à mão, mesmo espírito do Sparkline usado em
 *  RiskDashboardPage/CBCDashboardPage (não há lib de gráficos neste projeto). A linha
 *  acumulada usa tom neutro (não vermelho) — vermelho é reservado a alerta real. */
export function ParetoChart({ buckets, onSelectCategory }: ParetoChartProps) {
  if (buckets.length === 0) {
    return <p className="text-xs text-fg-subtle">Nenhuma divergência classificada ainda.</p>;
  }

  const w = 700;
  const h = 240;
  const barAreaH = 160;
  const gap = 8;
  const barW = (w - gap * (buckets.length - 1)) / buckets.length;
  const maxCount = Math.max(...buckets.map(b => b.count));
  const labelFor = (category: string) => CAUSE_LABEL[category] ?? category;

  const linePoints = buckets.map((b, i) => {
    const x = i * (barW + gap) + barW / 2;
    const y = barAreaH - (b.cumulativePct / 100) * barAreaH;
    return `${x},${y}`;
  }).join(' ');
  const refY80 = barAreaH - 0.8 * barAreaH;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ minWidth: 500, height: 240 }}>
        <line x1={0} y1={refY80} x2={w} y2={refY80} className="stroke-edge" strokeWidth="1" strokeDasharray="4 4" />
        <text x={w} y={refY80 - 4} textAnchor="end" className="fill-fg-subtle text-[9px]">80%</text>
        {buckets.map((b, i) => {
          const barH = (b.count / maxCount) * barAreaH;
          const x = i * (barW + gap);
          const label = labelFor(b.category);
          return (
            <g
              key={b.category}
              role={onSelectCategory ? 'button' : undefined}
              onClick={onSelectCategory ? () => onSelectCategory(b.category) : undefined}
              className={onSelectCategory ? 'cursor-pointer' : undefined}
            >
              <rect x={x} y={barAreaH - barH} width={barW} height={barH} className="fill-accent/70" rx={3} />
              <text x={x + barW / 2} y={barAreaH - barH - 4} textAnchor="middle" className="fill-fg text-[10px] font-semibold">{b.count}</text>
              <text x={x + barW / 2} y={barAreaH + 16} textAnchor="middle" className="fill-fg-subtle text-[9px]">
                {label.length > 10 ? `${label.slice(0, 9)}…` : label}
              </text>
            </g>
          );
        })}
        <polyline points={linePoints} fill="none" className="stroke-fg-muted" strokeWidth="2" />
        {buckets.map((b, i) => {
          const x = i * (barW + gap) + barW / 2;
          const y = barAreaH - (b.cumulativePct / 100) * barAreaH;
          return <circle key={`pt-${b.category}`} cx={x} cy={y} r={2.5} className="fill-fg-muted" />;
        })}
      </svg>
      <p className="text-[10px] text-fg-subtle mt-1">Barras = ocorrências por causa · linha = % acumulado · tracejado = referência de 80% (Pareto)</p>
    </div>
  );
}
