import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelSection, Badge, Button, Select, Stat, StatRow, StatCell } from '../ui';
import { listImportedCountRecords, getImportItems, drawSample, logStatisticalAuditRun } from '../../lib/statisticalAuditService';
import { computeSamplingPlan, evaluateSample, INSPECTION_LEVEL_LABEL, COMMON_AQL_OPTIONS, type InspectionLevel } from '../../lib/statisticalAuditAlgorithm';
import type { InventoryCountRecord, InventoryCountImportItem } from '../../lib/supabase';

interface StatisticalAuditPanelProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

const labelClass = 'block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1';

/** Auditoria por amostragem (ISO 2859-1 / ANSI Z1.4) sobre uma contagem já importada — usa
 *  inventory_count_import_items como população real (sem tabela nova). A amostra é
 *  desenhada e os itens com status divergente/faltante/sobra dentro dela contam como
 *  "defeito" para o plano de amostragem. */
export function StatisticalAuditPanel({ companyId, userId, userEmail }: StatisticalAuditPanelProps) {
  const [records, setRecords] = useState<InventoryCountRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [items, setItems] = useState<InventoryCountImportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspectionLevel, setInspectionLevel] = useState<InspectionLevel>('II');
  const [aql, setAql] = useState<number>(2.5);
  const [sample, setSample] = useState<InventoryCountImportItem[] | null>(null);
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    setLoading(true);
    listImportedCountRecords(companyId).then(rows => {
      setRecords(rows);
      if (rows.length > 0) setSelectedRecordId(rows[0].id);
      setLoading(false);
    });
  }, [companyId]);

  useEffect(() => {
    if (!selectedRecordId) { setItems([]); return; }
    getImportItems(selectedRecordId, companyId).then(setItems);
    setSample(null);
    setLogged(false);
  }, [selectedRecordId, companyId]);

  const plan = useMemo(() => computeSamplingPlan(items.length, inspectionLevel, aql), [items.length, inspectionLevel, aql]);

  const result = useMemo(() => {
    if (!sample) return null;
    const defectsFound = sample.filter(i => i.status && i.status !== 'correct').length;
    return evaluateSample(plan, defectsFound);
  }, [sample, plan]);

  const handleDrawSample = () => {
    setSample(drawSample(items, plan.sampleSize));
    setLogged(false);
  };

  const handleLogResult = async () => {
    if (!result) return;
    await logStatisticalAuditRun(companyId, userId, userEmail, selectedRecordId, plan, result.defectsFound, result.accepted);
    setLogged(true);
  };

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando contagens importadas...</PanelSection></Panel>;
  }

  if (records.length === 0) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma contagem por importação registrada ainda — a auditoria estatística usa os itens de uma contagem importada como população.</PanelSection></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md" className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Contagem importada</label>
            <Select value={selectedRecordId} onChange={e => setSelectedRecordId(e.target.value)} className="w-full">
              {records.map(r => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleDateString('pt-BR')} — {r.skus_contados} SKUs</option>)}
            </Select>
          </div>
          <div>
            <label className={labelClass}>Nível de inspeção</label>
            <Select value={inspectionLevel} onChange={e => setInspectionLevel(e.target.value as InspectionLevel)} className="w-full">
              {(['I', 'II', 'III'] as InspectionLevel[]).map(l => <option key={l} value={l}>{INSPECTION_LEVEL_LABEL[l]}</option>)}
            </Select>
          </div>
          <div>
            <label className={labelClass}>AQL (% máx. aceitável de defeitos)</label>
            <Select value={aql} onChange={e => setAql(Number(e.target.value))} className="w-full">
              {COMMON_AQL_OPTIONS.map(v => <option key={v} value={v}>{v}%</option>)}
            </Select>
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Plano de amostragem (ISO 2859-1 / ANSI Z1.4)</p>
          <StatRow className="sm:grid-cols-5">
            <StatCell><Stat label="Tamanho da população" value={plan.populationSize} /></StatCell>
            <StatCell><Stat label="Letra-código" value={plan.codeLetter} /></StatCell>
            <StatCell><Stat label="Amostra recomendada" value={plan.sampleSize} /></StatCell>
            <StatCell><Stat label="Ac (aceitar até)" value={plan.acceptanceNumber} /></StatCell>
            <StatCell><Stat label="Re (rejeitar a partir de)" value={plan.rejectionNumber} /></StatCell>
          </StatRow>
          <p className="text-xs text-fg-subtle mt-3">Ac/Re calculados por aproximação estatística (Poisson) sobre o AQL — ver comentário em statisticalAuditAlgorithm.ts para a tabela oficial completa a integrar futuramente.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={handleDrawSample} disabled={plan.sampleSize === 0}>Sortear amostra sistemática</Button>
          </div>
        </PanelSection>
      </Panel>

      {sample && result && (
        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3">Resultado da auditoria</p>
            <StatRow className="sm:grid-cols-3 items-center">
              <StatCell><Stat label="Itens amostrados" value={sample.length} /></StatCell>
              <StatCell><Stat label="Defeitos encontrados" value={result.defectsFound} /></StatCell>
              <StatCell>
                <Badge variant={result.accepted ? 'success' : 'danger'}>{result.accepted ? 'Lote aceito' : 'Lote rejeitado'}</Badge>
              </StatCell>
            </StatRow>
            <div className="mt-4">
              <Button size="sm" variant="secondary" onClick={handleLogResult} disabled={logged}>{logged ? 'Registrado no log de auditoria' : 'Registrar resultado'}</Button>
            </div>
          </PanelSection>
        </Panel>
      )}
    </div>
  );
}
