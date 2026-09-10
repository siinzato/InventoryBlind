import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Panel, PanelSection, Badge, Input, Select, Stat, StatRow, StatCell } from '../ui';
import {
  listAuditableBrands, getHistoricalProductivity, getBrandAuditHistory,
  type AuditableBrand, type BrandAuditHistory,
} from '../../lib/auditSimulationService';
import {
  simulateCount, assessCapacity, buildScenarios, buildOperatorsCurve, buildScenarioDiagnostic,
  assessForecastConfidence, CAPACITY_LABEL, type HistoricalProductivityResult, type CapacityClassification, type RiskLevel,
} from '../../lib/auditSimulationEngine';

interface InventorySimulationPanelProps {
  companyId: string;
}

const labelClass = 'block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1';

const CAPACITY_TONE: Record<CapacityClassification, { badge: 'success' | 'warning' | 'danger'; bar: string; box: string; icon: 'ok' | 'warn' }> = {
  adequada: { badge: 'success', bar: 'bg-emerald-500', box: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: 'ok' },
  atencao: { badge: 'warning', bar: 'bg-amber-500', box: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', icon: 'warn' },
  sobrecarga: { badge: 'danger', bar: 'bg-red-500', box: 'bg-red-500/10 text-red-700 dark:text-red-400', icon: 'warn' },
};

const RISK_BADGE: Record<RiskLevel, 'success' | 'warning' | 'danger'> = {
  'Muito baixo': 'success',
  'Baixo': 'success',
  'Médio': 'warning',
  'Alto': 'danger',
};

/** Curta e nunca ambígua: minutos abaixo de 1h, senão horas com 1 casa — evita truncamento
 *  de valores como "0.9 h-pessoa" numa StatCell estreita. */
function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 min';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

function formatCurrency(value: number): string {
  return Number.isFinite(value) ? `R$ ${value.toFixed(2)}` : '—';
}

function formatDays(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} dia(s)` : '—';
}

/** Simulador "what-if" antes de abrir uma contagem: usa SKUs reais da linha selecionada
 *  (inventory_brands.total_sku) e a produtividade histórica real da empresa como ponto de
 *  partida, deixando os 3 parâmetros operacionais editáveis. Hoje os cálculos são heurística
 *  determinística (auditSimulationEngine.ts); a estrutura já separa "de onde vem a
 *  produtividade" (este arquivo) de "como calcular a partir dela" (o engine), então plugar
 *  IA/histórico mais rico no futuro é trocar só getHistoricalProductivity. */
export function InventorySimulationPanel({ companyId }: InventorySimulationPanelProps) {
  const [brands, setBrands] = useState<AuditableBrand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [historicalProductivity, setHistoricalProductivity] = useState<HistoricalProductivityResult | null>(null);
  const [brandHistory, setBrandHistory] = useState<BrandAuditHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const [numOperators, setNumOperators] = useState(2);
  const [productivity, setProductivity] = useState(30);
  const [costPerHour, setCostPerHour] = useState(0);
  const [hoursPerWorkday, setHoursPerWorkday] = useState(8);

  useEffect(() => {
    setLoading(true);
    Promise.all([listAuditableBrands(companyId), getHistoricalProductivity(companyId)]).then(([brandRows, hist]) => {
      setBrands(brandRows);
      if (brandRows.length > 0) setSelectedBrandId(brandRows[0].id);
      setHistoricalProductivity(hist);
      if (hist) setProductivity(Math.round(hist.value));
      setLoading(false);
    });
  }, [companyId]);

  useEffect(() => {
    if (!selectedBrandId) { setBrandHistory(null); return; }
    getBrandAuditHistory(companyId, selectedBrandId).then(setBrandHistory);
  }, [companyId, selectedBrandId]);

  const selectedBrand = brands.find(b => b.id === selectedBrandId) ?? null;
  const totalSkus = selectedBrand?.total_sku ?? 0;

  const simulationInput = useMemo(
    () => ({
      totalSkus, numOperators, avgSkusPerHourPerOperator: productivity,
      costPerHourPerOperator: costPerHour, hoursPerWorkday, startDate: new Date().toISOString(),
    }),
    [totalSkus, numOperators, productivity, costPerHour, hoursPerWorkday]
  );

  const estimate = useMemo(() => simulateCount(simulationInput), [simulationInput]);
  const capacity = useMemo(
    () => assessCapacity(estimate.totalWorkHours, numOperators, hoursPerWorkday),
    [estimate.totalWorkHours, numOperators, hoursPerWorkday]
  );
  const scenarios = useMemo(() => buildScenarios(simulationInput), [simulationInput]);
  const recommendedScenario = scenarios.find(s => s.key === 'recomendado') ?? scenarios[0];
  const curve = useMemo(() => buildOperatorsCurve(simulationInput), [simulationInput]);
  const diagnosticMessage = useMemo(
    () => buildScenarioDiagnostic(capacity, recommendedScenario.operators),
    [capacity, recommendedScenario.operators]
  );
  const confidence = assessForecastConfidence(historicalProductivity?.sampleHours ?? null);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando dados de simulação...</PanelSection></Panel>;
  }

  if (brands.length === 0) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma linha de inventário cadastrada ainda para simular.</PanelSection></Panel>;
  }

  const tone = CAPACITY_TONE[capacity.classification];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className={labelClass}>Linha de inventário</label>
              <Select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)} className="w-full">
                {brands.map(b => <option key={b.id} value={b.id}>{b.brand} ({b.total_sku} SKUs)</option>)}
              </Select>
            </div>
            <div>
              <label className={labelClass}>Operadores</label>
              <div className="flex items-center gap-2 h-[38px]">
                <button
                  type="button"
                  onClick={() => setNumOperators(v => Math.max(1, v - 1))}
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control border border-edge bg-surface-3 hover:bg-surface-3/70 text-fg transition-colors"
                  aria-label="Diminuir operadores"
                >
                  <Minus size={16} />
                </button>
                <span className="flex-1 text-center font-display text-lg font-semibold tabular-nums">{numOperators}</span>
                <button
                  type="button"
                  onClick={() => setNumOperators(v => v + 1)}
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control border border-edge bg-surface-3 hover:bg-surface-3/70 text-fg transition-colors"
                  aria-label="Aumentar operadores"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div>
              <label className={labelClass}>Produtividade (SKUs/h por operador)</label>
              <Input type="number" min={1} value={productivity} onChange={e => setProductivity(Math.max(1, Number(e.target.value)))} />
              {historicalProductivity ? (
                <p className="text-xs text-fg-subtle mt-1 truncate">Histórico: {historicalProductivity.value.toFixed(1)} SKUs/h</p>
              ) : (
                <p className="text-xs text-fg-subtle mt-1 truncate">Sem histórico — valor manual</p>
              )}
            </div>
            <div>
              <label className={labelClass}>Custo por hora/operador (R$)</label>
              <Input type="number" min={0} step={0.5} value={costPerHour} onChange={e => setCostPerHour(Math.max(0, Number(e.target.value)))} />
            </div>
            <div>
              <label className={labelClass}>Horas por jornada</label>
              <Input type="number" min={1} max={24} value={hoursPerWorkday} onChange={e => setHoursPerWorkday(Math.max(1, Number(e.target.value)))} />
            </div>
          </div>

          {brandHistory && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-edge">
              <Badge variant="neutral">{brandHistory.previousAudits} inventário{brandHistory.previousAudits === 1 ? '' : 's'} anterior{brandHistory.previousAudits === 1 ? '' : 'es'}</Badge>
              {brandHistory.recountRatePercent !== null && (
                <Badge variant="neutral">Recontagem estimada {brandHistory.recountRatePercent.toFixed(0)}%</Badge>
              )}
            </div>
          )}
        </PanelSection>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3">Previsão Operacional</p>
            <StatRow className="sm:grid-cols-3">
              <StatCell><Stat label="Tempo estimado" value={formatHours(estimate.wallClockHours)} /></StatCell>
              <StatCell><Stat label="Horas-pessoa" value={formatHours(estimate.totalWorkHours)} /></StatCell>
              <StatCell><Stat label="Dias úteis previstos" value={formatDays(estimate.workdaysNeeded)} /></StatCell>
            </StatRow>
            <StatRow className="sm:grid-cols-3 mt-5">
              <StatCell><Stat label="Custo estimado" value={formatCurrency(estimate.estimatedCost)} /></StatCell>
              <StatCell><Stat label="Produtividade média" value={`${estimate.productivityPerOperator.toFixed(0)} SKUs/h`} /></StatCell>
              <StatCell><Stat label="Conclusão prevista" value={new Date(estimate.expectedCompletionDate).toLocaleDateString('pt-BR')} /></StatCell>
            </StatRow>
            {confidence && (
              <div className="mt-4 pt-4 border-t border-edge flex items-center justify-between">
                <span className="text-sm text-fg-muted">Confiança da previsão</span>
                <Badge variant={confidence.level === 'Alta' ? 'success' : confidence.level === 'Média' ? 'warning' : 'neutral'}>
                  {confidence.percent}% — {confidence.level}
                </Badge>
              </div>
            )}
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="md">
            <div className="flex items-center justify-between mb-3">
              <p className="text-section">Capacidade do Cenário</p>
              <Badge variant={tone.badge}>{CAPACITY_LABEL[capacity.classification]}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-fg-muted">Carga operacional</span>
              <span className="text-fg-muted">Folga operacional</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-display text-2xl font-semibold tabular-nums">{Math.round(capacity.utilizationPercent)}%</span>
              <span className="font-display text-2xl font-semibold tabular-nums text-fg-subtle">{Math.round(capacity.slackPercent)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, capacity.utilizationPercent)}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-fg-subtle mt-2">
              <span>Horas disponíveis: {capacity.availableHours.toFixed(1)} h</span>
              <span>Horas utilizadas: {capacity.usedHours.toFixed(1)} h</span>
            </div>
          </PanelSection>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3">Diagnóstico do cenário</p>
            <div className={`p-3 rounded-lg flex items-start gap-2 text-sm ${tone.box}`}>
              {tone.icon === 'ok' ? <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />}
              <span>{diagnosticMessage}</span>
            </div>
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3">Comparação de Cenários</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-fg-subtle uppercase tracking-wide">
                    <th className="pb-2 font-semibold">Cenário</th>
                    <th className="pb-2 font-semibold">Operadores</th>
                    <th className="pb-2 font-semibold">Tempo</th>
                    <th className="pb-2 font-semibold">Custo</th>
                    <th className="pb-2 font-semibold">Risco</th>
                    <th className="pb-2 font-semibold">Eficiência</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map(s => (
                    <tr key={s.key} className={s.key === 'recomendado' ? 'bg-accent/5' : ''}>
                      <td className="py-2 pr-2 whitespace-nowrap">
                        {s.key === 'recomendado' ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> {s.label}
                          </span>
                        ) : (
                          <span className="text-fg-muted">{s.label}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">{s.operators} operador{s.operators === 1 ? '' : 'es'}</td>
                      <td className="py-2 pr-2 tabular-nums">{formatHours(s.wallClockHours)}</td>
                      <td className="py-2 pr-2 tabular-nums">{formatCurrency(s.estimatedCost)}</td>
                      <td className="py-2 pr-2"><Badge variant={RISK_BADGE[s.risk]}>{s.risk}</Badge></td>
                      <td className="py-2 tabular-nums">{s.efficiencyPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-fg-subtle mt-3 pt-3 border-t border-edge">Valores calculados a partir da configuração atual e da produtividade informada.</p>
          </PanelSection>
        </Panel>
      </div>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Tempo estimado x Operadores</p>
          <OperatorsCurveChart points={curve} recommendedOperators={recommendedScenario.operators} />
        </PanelSection>
      </Panel>
    </div>
  );
}

/** SVG à mão, mesmo espírito do ParetoChart (não há lib de gráficos neste projeto): tempo de
 *  parede por nº de operadores, com o ponto recomendado destacado. */
function OperatorsCurveChart({ points, recommendedOperators }: { points: { operators: number; wallClockHours: number }[]; recommendedOperators: number }) {
  if (points.length === 0) return <p className="text-xs text-fg-subtle">Sem dados suficientes para o gráfico.</p>;

  const w = 700;
  const h = 200;
  const chartH = 140;
  const padX = 30;
  const maxMinutes = Math.max(...points.map(p => p.wallClockHours * 60), 1);
  const stepX = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const minutes = p.wallClockHours * 60;
    const x = padX + i * stepX;
    const y = chartH - (minutes / maxMinutes) * chartH;
    return { x, y, minutes, operators: p.operators };
  });

  const linePoints = coords.map(c => `${c.x},${c.y}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ minWidth: 480, height: 200 }}>
        <polyline points={linePoints} fill="none" className="stroke-fg-muted" strokeWidth="2" />
        {coords.map(c => (
          <g key={c.operators}>
            <circle cx={c.x} cy={c.y} r={c.operators === recommendedOperators ? 5 : 2.5} className={c.operators === recommendedOperators ? 'fill-accent' : 'fill-fg-muted'} />
            <text x={c.x} y={c.y - 10} textAnchor="middle" className="fill-fg text-[10px] font-semibold">
              {c.minutes >= 60 ? `${(c.minutes / 60).toFixed(1)}h` : `${Math.round(c.minutes)}min`}
            </text>
            <text x={c.x} y={chartH + 18} textAnchor="middle" className="fill-fg-subtle text-[9px]">{c.operators}</text>
          </g>
        ))}
      </svg>
      <p className="text-[10px] text-fg-subtle mt-1">Eixo horizontal = nº de operadores · ponto em destaque = cenário recomendado ({recommendedOperators} operador{recommendedOperators === 1 ? '' : 'es'})</p>
    </div>
  );
}
