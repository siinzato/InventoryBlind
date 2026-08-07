import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Panel, PanelSection, Badge, Button } from '../ui';
import { getCrossCheckData, approveCount } from '../../lib/auditCrossCheckService';
import type { CountChain, CrossCheckSummary } from '../../lib/auditCrossCheckAlgorithm';

interface CrossCheckPanelProps {
  companyId: string;
  userId: string;
  userEmail: string;
  canEdit: boolean;
}

function reliabilityVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}

/** Rastreabilidade contagem→recontagem→aprovação: reconstrói as cadeias a partir de
 *  inventory_count_records (já existente) e sinaliza quando a mesma pessoa acumula mais de
 *  uma etapa. "Aprovar" é a única escrita nova deste módulo (approved_by/approved_at). */
export function CrossCheckPanel({ companyId, userId, userEmail, canEdit }: CrossCheckPanelProps) {
  const [chains, setChains] = useState<CountChain[]>([]);
  const [summary, setSummary] = useState<CrossCheckSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getCrossCheckData(companyId);
    setChains(data.chains);
    setSummary(data.summary);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (rootId: string) => {
    setApprovingId(rootId);
    await approveCount(rootId, companyId, userId, userEmail);
    await load();
    setApprovingId(null);
  };

  if (loading || !summary) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando auditoria cruzada...</PanelSection></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md" className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><p className="text-xs text-fg-subtle">% Recontagens</p><p className="text-sm font-semibold text-fg">{summary.pctRecontagens.toFixed(0)}%</p></div>
          <div><p className="text-xs text-fg-subtle">% Auditorias independentes</p><p className="text-sm font-semibold text-fg">{summary.pctAuditoriasIndependentes.toFixed(0)}%</p></div>
          <div><p className="text-xs text-fg-subtle">% Aprovadas</p><p className="text-sm font-semibold text-fg">{summary.pctAprovadas.toFixed(0)}%</p></div>
          <div>
            <p className="text-xs text-fg-subtle">Índice de confiabilidade</p>
            <Badge variant={reliabilityVariant(summary.reliabilityIndex)}>{summary.reliabilityIndex.toFixed(0)}/100</Badge>
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Cadeias de contagem ({chains.length})</p>
          {chains.length === 0 && <p className="text-xs text-fg-subtle">Nenhuma contagem registrada ainda.</p>}
          <div className="space-y-1">
            {chains.map(chain => {
              const hasOverlap = chain.sameUserCountAndRecount || chain.sameOperatorNameCountAndRecount || chain.sameUserCountAndApproval;
              return (
                <div key={chain.rootId} className="flex flex-wrap items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm text-fg">
                      Contou: <span className="font-medium">{chain.contadorName ?? 'Não informado'}</span>
                      {chain.hasRecount && <> · Recontou: <span className="font-medium">{chain.recontadorName ?? 'Não informado'}</span></>}
                    </p>
                    <p className="text-xs text-fg-subtle">{new Date(chain.createdAt).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasOverlap && (
                      <Badge variant="danger"><AlertTriangle size={12} className="inline mr-1" />Mesma pessoa em etapas diferentes</Badge>
                    )}
                    {!chain.hasRecount && <Badge variant="neutral">Sem recontagem</Badge>}
                    {chain.isApproved ? (
                      <Badge variant="success">Aprovada</Badge>
                    ) : canEdit ? (
                      <Button size="sm" variant="secondary" onClick={() => handleApprove(chain.rootId)} disabled={approvingId === chain.rootId}>
                        {approvingId === chain.rootId ? 'Aprovando...' : 'Aprovar'}
                      </Button>
                    ) : (
                      <Badge variant="neutral">Pendente</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </PanelSection>
      </Panel>
    </div>
  );
}
