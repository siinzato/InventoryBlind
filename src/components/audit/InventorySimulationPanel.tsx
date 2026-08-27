import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelSection, Badge, Input, Select, Stat, StatRow, StatCell } from '../ui';
import { listAuditableBrands, getHistoricalProductivity, type AuditableBrand } from '../../lib/auditSimulationService';
import { simulateCount } from '../../lib/auditSimulationEngine';

interface InventorySimulationPanelProps {
  companyId: string;
}

const labelClass = 'block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1';

/** Simulador "what-if" antes de abrir uma contagem: usa SKUs reais da linha selecionada
 *  (inventory_brands.total_sku) e a produtividade histórica real da empresa como ponto de
 *  partida, deixando os 3 parâmetros operacionais editáveis. Hoje os cálculos são heurística
 *  determinística (auditSimulationEngine.ts); a estrutura já separa "de onde vem a
 *  produtividade" (este arquivo) de "como calcular a partir dela" (o engine), então plugar
 *  IA/histórico mais rico no futuro é trocar só getHistoricalProductivity. */
export function InventorySimulationPanel({ companyId }: InventorySimulationPanelProps) {
  const [brands, setBrands] = useState<AuditableBrand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [historicalProductivity, setHistoricalProductivity] = useState<number | null>(null);
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
      if (hist) setProductivity(Math.round(hist));
      setLoading(false);
    });
  }, [companyId]);

  const selectedBrand = brands.find(b => b.id === selectedBrandId) ?? null;
  const totalSkus = selectedBrand?.total_sku ?? 0;

  const estimate = useMemo(
    () => simulateCount({
      totalSkus, numOperators, avgSkusPerHourPerOperator: productivity,
      costPerHourPerOperator: costPerHour, hoursPerWorkday, startDate: new Date().toISOString(),
    }),
    [totalSkus, numOperators, productivity, costPerHour, hoursPerWorkday]
  );

  const idealOperatorsForOneDay = hoursPerWorkday > 0 && productivity > 0
    ? Math.max(1, Math.ceil(estimate.totalWorkHours / hoursPerWorkday))
    : 1;

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando dados de simulação...</PanelSection></Panel>;
  }

  if (brands.length === 0) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma linha de inventário cadastrada ainda para simular.</PanelSection></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md" className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Linha de inventário</label>
            <Select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)} className="w-full">
              {brands.map(b => <option key={b.id} value={b.id}>{b.brand} ({b.total_sku} SKUs)</option>)}
            </Select>
          </div>
          <div>
            <label className={labelClass}>Operadores (simulação)</label>
            <Input type="number" min={1} value={numOperators} onChange={e => setNumOperators(Math.max(1, Number(e.target.value)))} />
          </div>
          <div>
            <label className={labelClass}>Produtividade (SKUs/h por operador)</label>
            <Input type="number" min={1} value={productivity} onChange={e => setProductivity(Math.max(1, Number(e.target.value)))} />
            {historicalProductivity ? (
              <p className="text-xs text-fg-subtle mt-1">Histórico da empresa: {historicalProductivity.toFixed(1)} SKUs/h</p>
            ) : (
              <p className="text-xs text-fg-subtle mt-1">Sem histórico suficiente ainda — valor informado manualmente.</p>
            )}
          </div>
          <div>
            <label className={labelClass}>Custo por hora/operador (R$)</label>
            <Input type="number" min={0} step={0.5} value={costPerHour} onChange={e => setCostPerHour(Math.max(0, Number(e.target.value)))} />
          </div>
          <div>
            <label className={labelClass}>Horas por jornada de trabalho</label>
            <Input type="number" min={1} max={24} value={hoursPerWorkday} onChange={e => setHoursPerWorkday(Math.max(1, Number(e.target.value)))} />
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Estimativas para {selectedBrand?.brand} ({totalSkus} SKUs)</p>
          <StatRow className="sm:grid-cols-3">
            <StatCell><Stat label="Tempo estimado" value={`${estimate.wallClockHours.toFixed(1)} h`} /></StatCell>
            <StatCell><Stat label="Horas de trabalho (total)" value={`${estimate.totalWorkHours.toFixed(1)} h-pessoa`} /></StatCell>
            <StatCell><Stat label="Dias úteis previstos" value={`${estimate.workdaysNeeded.toFixed(1)} dia(s)`} /></StatCell>
            <StatCell><Stat label="Custo estimado" value={`R$ ${estimate.estimatedCost.toFixed(2)}`} /></StatCell>
            <StatCell><Stat label="Produtividade média esperada" value={`${estimate.productivityPerOperator.toFixed(1)} SKUs/h`} /></StatCell>
            <StatCell><Stat label="Data prevista de conclusão" value={new Date(estimate.expectedCompletionDate).toLocaleDateString('pt-BR')} /></StatCell>
          </StatRow>
          <div className="mt-4 pt-4 border-t border-edge">
            <Badge variant="accent">Quantidade ideal de operadores para concluir em 1 dia útil: {idealOperatorsForOneDay}</Badge>
          </div>
        </PanelSection>
      </Panel>
    </div>
  );
}
