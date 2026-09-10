import type { AuditSessionSummary } from '../../lib/analytics/auditsHistoryEngine';
import { countNumberLabel } from '../../lib/analytics/auditsHistoryEngine';

// SVG à mão, mesmo espírito de AnalyticsCharts.tsx/ParetoChart.tsx — não há lib de gráficos
// no projeto e não se justifica adicionar uma. Componente próprio da tela de Auditorias para
// não alterar o AccuracyTrendChart compartilhado com o BlindScore.

export type SessionMetric = 'accuracy' | 'coverage' | 'divergence';

const SESSION_METRIC_LABEL: Record<SessionMetric, string> = {
  accuracy: 'Acurácia por sessão',
  coverage: 'Cobertura por sessão',
  divergence: 'Taxa de divergência por sessão',
};

function valueOf(session: AuditSessionSummary, metric: SessionMetric): number | null {
  if (metric === 'accuracy') return session.accuracy;
  if (metric === 'coverage') return session.coveragePct;
  return session.divergenceRatePct;
}

const pct = (value: number) => `${value.toFixed(1).replace('.', ',')}%`;
const int = (value: number) => value.toLocaleString('pt-BR');

interface AuditsSessionChartProps {
  /** Sessões em ordem cronológica crescente. */
  sessions: AuditSessionSummary[];
  metric: SessionMetric;
  onSelect?: (session: AuditSessionSummary) => void;
}

/** Uma leitura temporal por vez sobre as MESMAS sessões, com o tamanho da amostra sempre
 *  visível: a barra cinza sob a linha é a quantidade de SKUs contados na sessão, e o raio do
 *  ponto acompanha essa base. Uma sessão de 16 SKUs nunca fica parecendo uma de 195. */
export function AuditsSessionChart({ sessions, metric, onSelect }: AuditsSessionChartProps) {
  const points = sessions
    .map(session => ({ session, value: valueOf(session, metric) }))
    .filter((p): p is { session: AuditSessionSummary; value: number } => p.value !== null);

  if (points.length < 2) {
    return (
      <p className="text-xs text-fg-subtle">
        Ainda não há duas sessões com esse dado calculado — a evolução aparece a partir da segunda.
      </p>
    );
  }

  const w = 640;
  const h = 132;
  const barsH = 22;
  const gap = 8;
  const totalH = h + gap + barsH;

  const values = points.map(p => p.value);
  const max = metric === 'divergence' ? Math.max(10, ...values) : 100;
  const min = 0;
  const yFor = (value: number) => h - ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * h;

  const maxCounted = Math.max(...points.map(p => p.session.skusContados), 1);
  const xFor = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const barWidth = Math.max(3, Math.min(18, w / (points.length * 2)));

  const line = points.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(' ');
  const stroke = metric === 'divergence' ? 'stroke-amber-500' : 'stroke-accent';
  const fill = metric === 'divergence' ? 'fill-amber-500' : 'fill-accent';

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${totalH}`} className="w-full" style={{ height: totalH }} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(f => (
          <line
            key={f}
            x1={0}
            x2={w}
            y1={h * f}
            y2={h * f}
            className="stroke-edge"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline points={line} fill="none" className={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const s = p.session;
          const radius = 3 + (s.skusContados / maxCounted) * 3.5;
          const tooltip = [
            `${new Date(s.createdAt).toLocaleDateString('pt-BR')} · ${countNumberLabel(s.countNumber)}`,
            `Operador: ${s.operator ?? 'não informado'}`,
            `SKUs contados: ${int(s.skusContados)} de ${int(s.totalSku)}`,
            `Cobertura: ${s.coveragePct !== null ? pct(s.coveragePct) : 'sem universo previsto'}`,
            `Divergências: ${int(s.divergenciasReais)}${s.divergenceRatePct !== null ? ` (${pct(s.divergenceRatePct)})` : ''}`,
            `Acurácia: ${s.accuracy !== null ? pct(s.accuracy) : 'não calculada'}`,
          ].join('\n');
          return (
            <g key={s.id} className={onSelect ? 'cursor-pointer' : undefined} onClick={() => onSelect?.(s)}>
              <title>{tooltip}</title>
              {/* Barra da base real da sessão — a amostra fica explícita, não implícita. */}
              <rect
                x={xFor(i) - barWidth / 2}
                y={h + gap + (barsH - (s.skusContados / maxCounted) * barsH)}
                width={barWidth}
                height={Math.max(1, (s.skusContados / maxCounted) * barsH)}
                className="fill-fg/15"
              />
              <circle cx={xFor(i)} cy={yFor(p.value)} r={radius} className={fill} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-[10px] text-fg-subtle">{new Date(points[0].session.createdAt).toLocaleDateString('pt-BR')}</p>
        <p className="text-[10px] text-fg-subtle">
          {SESSION_METRIC_LABEL[metric]} · barra cinza = SKUs contados (máx. {int(maxCounted)})
        </p>
        <p className="text-[10px] text-fg-subtle">
          {new Date(points[points.length - 1].session.createdAt).toLocaleDateString('pt-BR')}
        </p>
      </div>
    </div>
  );
}
