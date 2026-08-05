import { useEffect, useMemo, useState } from 'react';
import { Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import { supabase, BrandData } from '../../lib/supabase';
import { calculateCountMetrics, generateCountInsight, shouldRecommendThirdCount } from '../../lib/countManagementUtils';
import type { LiveCountStats } from './CountSidePanel';

interface ManualCountTabProps {
  brandsData: BrandData[];
  companyId: string;
  onBrandsUpdated: (brands: BrandData[]) => void;
  onSaved: () => void;
  onStatsChange: (stats: LiveCountStats) => void;
}

const inputClass = 'w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 text-fg bg-surface text-sm';
const labelClass = 'block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1';

export function ManualCountTab({ brandsData, companyId, onBrandsUpdated, onSaved, onStatsChange }: ManualCountTabProps) {
  const [brandId, setBrandId] = useState('');
  const [operator1, setOperator1] = useState('');
  const [operator2, setOperator2] = useState('');
  const [totalSku, setTotalSku] = useState('');
  const [skusContados, setSkusContados] = useState('');
  const [divergenciasEncontradas, setDivergenciasEncontradas] = useState('');
  const [divergenciasRecontadas, setDivergenciasRecontadas] = useState('');
  const [divergenciasReais, setDivergenciasReais] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [saving, setSaving] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [thirdCountContext, setThirdCountContext] = useState<{ brandId: string; rootId: string } | null>(null);

  const selectedBrand = brandsData.find(b => b.id === brandId);

  useEffect(() => {
    if (selectedBrand) setTotalSku(String(selectedBrand.total_sku));
  }, [selectedBrand?.id]);

  const metrics = useMemo(() => calculateCountMetrics({
    skusContados: parseInt(skusContados) || 0,
    divergenciasEncontradas: parseInt(divergenciasEncontradas) || 0,
    divergenciasReais: parseInt(divergenciasReais) || 0,
  }), [skusContados, divergenciasEncontradas, divergenciasReais]);

  useEffect(() => {
    onStatsChange({
      linha: selectedBrand?.brand ?? '',
      totalSku: parseInt(totalSku) || 0,
      contados: parseInt(skusContados) || 0,
      divergencias: parseInt(divergenciasReais) || 0,
      acuracidade: metrics.accuracyFinal,
      active: !!brandId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, totalSku, skusContados, divergenciasReais, metrics.accuracyFinal]);

  const resetForm = (keepBrand: boolean) => {
    if (!keepBrand) setBrandId('');
    setOperator1('');
    setOperator2('');
    setSkusContados('');
    setDivergenciasEncontradas('');
    setDivergenciasRecontadas('');
    setDivergenciasReais('');
    setObservacoes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBrand || !skusContados) return;

    setSaving(true);

    const qtdContabilizada = parseInt(skusContados) || 0;
    const qtdDivergenciasReais = parseInt(divergenciasReais) || 0;

    const newDoneSku = Math.min(selectedBrand.total_sku, selectedBrand.done_sku + qtdContabilizada);
    const newDivergences = selectedBrand.divergences + qtdDivergenciasReais;

    const { error: brandError } = await supabase
      .from('inventory_brands')
      .update({ done_sku: newDoneSku, divergences: newDivergences, updated_at: new Date().toISOString() })
      .eq('id', selectedBrand.id);

    if (brandError) {
      console.error('Error updating brand from manual count:', brandError);
      setSaving(false);
      return;
    }

    const isThirdCount = thirdCountContext?.brandId === selectedBrand.id;

    const { data: recordData, error: recordError } = await supabase
      .from('inventory_count_records')
      .insert({
        company_id: companyId,
        brand_id: selectedBrand.id,
        count_number: isThirdCount ? 3 : 1,
        source: 'manual',
        linked_count_id: isThirdCount ? thirdCountContext!.rootId : null,
        operator_1: operator1 || null,
        operator_2: operator2 || null,
        total_sku: parseInt(totalSku) || selectedBrand.total_sku,
        skus_contados: qtdContabilizada,
        divergencias_encontradas: parseInt(divergenciasEncontradas) || 0,
        divergencias_recontadas: parseInt(divergenciasRecontadas) || 0,
        divergencias_reais: qtdDivergenciasReais,
        accuracy_initial: metrics.accuracyInitial,
        accuracy_final: metrics.accuracyFinal,
        observacoes: observacoes || null,
      })
      .select()
      .single();

    if (recordError) {
      console.error('Error inserting count record:', recordError);
    }

    onBrandsUpdated(brandsData.map(b => b.id === selectedBrand.id ? { ...b, done_sku: newDoneSku, divergences: newDivergences } : b));
    setInsight(generateCountInsight(metrics, qtdDivergenciasReais, selectedBrand.brand));

    if (!isThirdCount && shouldRecommendThirdCount(qtdDivergenciasReais) && recordData) {
      setThirdCountContext({ brandId: selectedBrand.id, rootId: recordData.id });
    } else {
      setThirdCountContext(null);
    }

    resetForm(true);
    onSaved();
    setSaving(false);
  };

  return (
    <Panel>
      <PanelSection padding="lg">
        {insight && (
          <div className="mb-5 p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-start gap-2 text-sm">
            <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
            <span>{insight}</span>
          </div>
        )}

        {thirdCountContext && (
          <div className="mb-5 p-3 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg flex items-start justify-between gap-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
              <span>Divergências reais acima de 10 — recomendamos uma 3ª contagem para esta linha.</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={labelClass}>Linha / Marca</label>
            <select required value={brandId} onChange={e => setBrandId(e.target.value)} className={inputClass}>
              <option value="">Selecione a linha ou marca...</option>
              {brandsData.map(b => (
                <option key={b.id} value={b.id}>{b.brand} (Pendentes: {b.total_sku - b.done_sku})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>1º Operador</label>
              <input value={operator1} onChange={e => setOperator1(e.target.value)} className={inputClass} placeholder="Nome do operador" />
            </div>
            <div>
              <label className={labelClass}>2º Operador (Recontagem)</label>
              <input value={operator2} onChange={e => setOperator2(e.target.value)} className={inputClass} placeholder="Nome do operador" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Total de SKUs</label>
              <input type="number" min="0" value={totalSku} onChange={e => setTotalSku(e.target.value)} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass}>SKUs Contados</label>
              <input type="number" required min="0" value={skusContados} onChange={e => setSkusContados(e.target.value)} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass}>Divergências Encontradas</label>
              <input type="number" min="0" value={divergenciasEncontradas} onChange={e => setDivergenciasEncontradas(e.target.value)} className={`${inputClass} font-mono`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Divergências Recontadas</label>
              <input type="number" min="0" value={divergenciasRecontadas} onChange={e => setDivergenciasRecontadas(e.target.value)} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass}>Divergências Reais (confirmadas)</label>
              <input type="number" min="0" value={divergenciasReais} onChange={e => setDivergenciasReais(e.target.value)} className={`${inputClass} font-mono bg-red-500/5 border-red-500/30`} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Observações</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={3} className={inputClass} placeholder="Notas sobre a contagem..." />
          </div>

          {(metrics.accuracyInitial !== null || metrics.accuracyFinal !== null) && (
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-edge divide-x divide-edge overflow-hidden">
              <div className="p-3 text-center">
                <p className="text-xs text-fg-subtle">Acuracidade inicial</p>
                <p className="text-sm font-semibold text-fg">{metrics.accuracyInitial !== null ? `${metrics.accuracyInitial.toFixed(1)}%` : '—'}</p>
              </div>
              <div className="p-3 text-center">
                <p className="text-xs text-fg-subtle">Acuracidade final</p>
                <p className="text-sm font-semibold text-fg">{metrics.accuracyFinal !== null ? `${metrics.accuracyFinal.toFixed(1)}%` : '—'}</p>
              </div>
              <div className="p-3 text-center">
                <p className="text-xs text-fg-subtle">Elim. divergências</p>
                <p className="text-sm font-semibold text-fg">{metrics.divergenciasEliminadas}</p>
              </div>
              <div className="p-3 text-center">
                <p className="text-xs text-fg-subtle">% redução</p>
                <p className="text-sm font-semibold text-fg">{metrics.percentReduction !== null ? `${metrics.percentReduction.toFixed(0)}%` : '—'}</p>
              </div>
            </div>
          )}

          <Button type="submit" disabled={saving} className="w-full">
            <Save size={16} />
            {saving ? 'Salvando...' : thirdCountContext ? 'Salvar 3ª Contagem' : 'Salvar e Processar'}
          </Button>
        </form>
      </PanelSection>
    </Panel>
  );
}
