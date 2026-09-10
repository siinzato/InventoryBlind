// Curva ABC — Pareto em SVG inline, sem dependência nova (mesma técnica de
// AnalyticsCharts.tsx: viewBox + classes de tema + vectorEffect). Barras = métrica por SKU em
// ordem decrescente; linha = acumulado percentual real; tracejados discretos = limites A e B
// da própria análise. Uma barra pode agregar vários SKUs quando a análise é grande — o cálculo
// continua por SKU (buildPareto), só o desenho é agregado.
//
// Um só matiz (o azul institucional) em três intensidades para A/B/C: a curva fica legível sem
// transformar o painel em gráfico colorido.

import { useState } from 'react';
import type { ParetoData, AbcMetric } from '../../lib/abcCurve/abcCurveAnalytics';

interface AbcParetoChartProps {
  data: ParetoData;
  metric: AbcMetric;
  thresholdA: number;
  thresholdB: number;
}

const W = 1000;
const H = 200;

const CLASS_FILL: Record<string, string> = {
  A: 'fill-accent',
  B: 'fill-accent/55',
  C: 'fill-accent/25',
};

const fmtMoney = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export function AbcParetoChart({ data, metric, thresholdA, thresholdB }: AbcParetoChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.bins.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        Nenhum SKU elegível nesta curva — não há concentração para exibir.
      </p>
    );
  }

  const maxValue = Math.max(...data.bins.map(b => b.value));
  const slot = W / data.bins.length;
  const barWidth = Math.max(slot * 0.72, 1);
  const yForPct = (pct: number) => H - (pct / 100) * H;
  const centerX = (index: number) => index * slot + slot / 2;

  // Com uma única barra o acumulado é 100% — desenha um segmento horizontal, porque uma
  // polyline de um ponto só não renderiza nada.
  const linePoints = data.bins.length === 1
    ? `0,${yForPct(data.bins[0].cumulativePct)} ${W},${yForPct(data.bins[0].cumulativePct)}`
    : data.bins.map(b => `${centerX(b.index)},${yForPct(b.cumulativePct)}`).join(' ');

  const fmtValue = metric === 'turnover' ? fmtQty : fmtMoney;
  const active = hovered !== null ? data.bins[hovered] ?? null : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }} preserveAspectRatio="none" role="img"
        aria-label={`Pareto de ${data.eligibleCount} SKUs elegíveis com linha de acumulado percentual.`}>
        <line x1={0} x2={W} y1={yForPct(thresholdA)} y2={yForPct(thresholdA)} className="stroke-edge" strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={yForPct(thresholdB)} y2={yForPct(thresholdB)} className="stroke-edge" strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />

        {data.bins.map(b => (
          <rect
            key={`bar-${b.index}`}
            x={centerX(b.index) - barWidth / 2}
            y={H - (b.value / maxValue) * H}
            width={barWidth}
            height={Math.max((b.value / maxValue) * H, 1)}
            className={CLASS_FILL[b.cls ?? ''] ?? 'fill-accent/25'}
          />
        ))}

        <polyline points={linePoints} fill="none" className="stroke-fg/70" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />

        {data.bins.map(b => (
          <rect
            key={`hit-${b.index}`}
            x={b.index * slot}
            y={0}
            width={slot}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHovered(b.index)}
            onMouseLeave={() => setHovered(prev => (prev === b.index ? null : prev))}
          >
            <title>
              {`${b.label}${b.sublabel ? ` (${b.sublabel})` : ''} · ${fmtValue(b.value)} · ${b.individualPct.toFixed(1)}% individual · ${b.cumulativePct.toFixed(1)}% acumulado${b.cls ? ` · classe ${b.cls}` : ''}`}
            </title>
          </rect>
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-1 z-10 w-56 max-w-[80%] rounded-control border border-edge bg-surface p-2.5 shadow-panel"
          style={{ left: `${(centerX(active.index) / W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <p className="truncate text-xs font-medium text-fg" title={active.label}>{active.label}</p>
          {active.sublabel && <p className="truncate text-[11px] text-fg-subtle">{active.sublabel}</p>}
          <dl className="mt-1.5 space-y-0.5 text-[11px]">
            <div className="flex justify-between gap-2"><dt className="text-fg-muted">Valor</dt><dd className="tabular-nums text-fg">{fmtValue(active.value)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-fg-muted">Individual</dt><dd className="tabular-nums text-fg">{active.individualPct.toFixed(1)}%</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-fg-muted">Acumulado</dt><dd className="tabular-nums text-fg">{active.cumulativePct.toFixed(1)}%</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-fg-muted">Classe</dt><dd className="text-fg">{active.cls ?? 'Mistas'}</dd></div>
          </dl>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-3">
          {(['A', 'B', 'C'] as const).map(cls => (
            <span key={cls} className="flex items-center gap-1.5 text-caption">
              <span className={`inline-block h-2 w-2 rounded-sm ${cls === 'A' ? 'bg-accent' : cls === 'B' ? 'bg-accent/55' : 'bg-accent/25'}`} />
              Classe {cls}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-caption">
            <span className="inline-block w-3 border-t border-fg/70" />
            Acumulado
          </span>
          <span className="flex items-center gap-1.5 text-caption">
            <span className="inline-block w-3 border-t border-dashed border-edge" />
            Limites {thresholdA}% / {thresholdB}%
          </span>
        </div>
        <p className="text-caption">
          {data.eligibleCount.toLocaleString('pt-BR')} SKUs elegíveis
          {data.grouped && ` · barras agrupadas em ${data.bins.length} faixas`}
        </p>
      </div>
    </div>
  );
}
