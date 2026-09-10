import { useMemo, useState } from 'react';
import { Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Input, Select, SegmentedControl, Button, type SegmentedOption } from '../ui';
import { sortPriorityCases, CASE_STATUS_LABEL, PROCESS_AREA_LABEL, CAUSE_LABEL } from '../../lib/rcaAlgorithm';
import type { RcaCase, RcaCaseStatus, RcaProcessArea, RcaRecord, RcaSourceModule } from '../../lib/supabase';
import type { TeamMember } from '../../lib/tasks/types';
import type { LegacyUnclassifiedItem } from '../../lib/rcaService';

type TabKey = 'prioritarios' | 'nao_classificados' | 'em_investigacao' | 'recorrentes' | 'todos';

const TABS: SegmentedOption<TabKey>[] = [
  { value: 'prioritarios', label: 'Prioritários' },
  { value: 'nao_classificados', label: 'Não classificados' },
  { value: 'em_investigacao', label: 'Em investigação' },
  { value: 'recorrentes', label: 'Recorrentes' },
  { value: 'todos', label: 'Todos' },
];

interface RcaCasesTableProps {
  cases: RcaCase[];
  caseDivergenceCounts: Map<string, number>;
  members: TeamMember[];
  pendingQueue: RcaRecord[];
  legacyQueue: LegacyUnclassifiedItem[];
  onOpenCase: (caseId: string) => void;
  onClassifyPending: (record: RcaRecord) => void;
  onClassifyLegacy: (item: LegacyUnclassifiedItem) => void;
}

function isOverdue(dueAt: string | null): boolean {
  return !!dueAt && new Date(dueAt).getTime() < Date.now();
}

/** Tabela "Casos que exigem atenção" (Imagem 1) — combina Casos de RCA (rca_cases) com a
 *  fila de regularização (classificação pendente + divergências legadas sem classificação)
 *  na aba "Não classificados", já que ambas são formas de "precisa de atenção" mesmo antes
 *  de existir um caso de RCA completo. */
export function RcaCasesTable({ cases, caseDivergenceCounts, members, pendingQueue, legacyQueue, onOpenCase, onClassifyPending, onClassifyLegacy }: RcaCasesTableProps) {
  const [tab, setTab] = useState<TabKey>('prioritarios');
  const [search, setSearch] = useState('');
  const [processFilter, setProcessFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const memberName = (id: string | null) => members.find(m => m.id === id)?.name ?? members.find(m => m.id === id)?.email ?? '—';

  const rows = useMemo(() => {
    let filtered = cases.filter(c => c.status !== 'encerrado' || tab === 'todos');
    if (tab === 'em_investigacao') filtered = filtered.filter(c => ['em_investigacao', 'causa_proposta', 'plano_em_execucao'].includes(c.status));
    if (tab === 'recorrentes') filtered = filtered.filter(c => (caseDivergenceCounts.get(c.id) ?? 0) > 1);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(c => c.problem_what.toLowerCase().includes(q) || `RCA-${c.case_year}-${c.case_number}`.toLowerCase().includes(q));
    }
    if (processFilter) filtered = filtered.filter(c => c.process_area === processFilter);
    if (statusFilter) filtered = filtered.filter(c => c.status === statusFilter);

    const withPriority = filtered.map(c => ({ case: c, recurrenceCount: caseDivergenceCounts.get(c.id) ?? 0 }));
    if (tab === 'prioritarios') {
      return sortPriorityCases(withPriority.map(w => ({ ...w, severity: w.case.severity, financialImpact: w.case.financial_impact, dueAt: w.case.due_at }))).slice(0, 20);
    }
    return withPriority.sort((a, b) => b.case.opened_at.localeCompare(a.case.opened_at));
  }, [cases, caseDivergenceCounts, tab, search, processFilter, statusFilter]);

  return (
    <Panel>
      <PanelSection padding="sm"><p className="text-section">Casos que exigem atenção</p></PanelSection>
      <PanelSection padding="sm" className="space-y-3">
        <SegmentedControl label="Filtro de casos" options={TABS} value={tab} onChange={setTab} />

        {tab !== 'nao_classificados' && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Input placeholder="Buscar caso ou problema..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar" />
            <Select value={processFilter} onChange={e => setProcessFilter(e.target.value)} aria-label="Processo">
              <option value="">Todos os processos</option>
              {Object.entries(PROCESS_AREA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="">Todos os status</option>
              {Object.entries(CASE_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
        )}
      </PanelSection>

      {tab === 'nao_classificados' ? (
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr><Th>Item</Th><Th>SKU/Endereço</Th><Th>Origem</Th><Th>Data</Th><Th /></Tr>
            </Thead>
            <tbody>
              {pendingQueue.length === 0 && legacyQueue.length === 0 && (
                <Tr><Td colSpan={5} className="text-center text-fg-subtle">Nenhuma pendência de classificação.</Td></Tr>
              )}
              {pendingQueue.map(r => (
                <Tr key={r.id}>
                  <Td>Resolvida — classificação pendente</Td>
                  <Td>{r.sku ?? r.location ?? '—'}</Td>
                  <Td>{SOURCE_LABEL[r.source_module]}</Td>
                  <Td>{new Date(r.occurred_at).toLocaleDateString('pt-BR')}</Td>
                  <Td><Button size="sm" variant="secondary" onClick={() => onClassifyPending(r)}>Classificar</Button></Td>
                </Tr>
              ))}
              {legacyQueue.map(item => (
                <Tr key={`${item.sourceModule}-${item.sourceItemId}`}>
                  <Td>Divergência anterior sem classificação</Td>
                  <Td>{item.sku ?? item.location ?? '—'}</Td>
                  <Td>{SOURCE_LABEL[item.sourceModule]}</Td>
                  <Td>{new Date(item.occurredAt).toLocaleDateString('pt-BR')}</Td>
                  <Td><Button size="sm" variant="secondary" onClick={() => onClassifyLegacy(item)}>Classificar</Button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr><Th>Caso</Th><Th>Problema/Contexto</Th><Th>Processo</Th><Th>Causa</Th><Th>Recorrências</Th><Th>Responsável</Th><Th>Prazo</Th><Th>Status</Th><Th /></Tr>
            </Thead>
            <tbody>
              {rows.length === 0 && <Tr><Td colSpan={9} className="text-center text-fg-subtle">Nenhum caso encontrado para este filtro.</Td></Tr>}
              {rows.map(({ case: c, recurrenceCount }) => (
                <Tr key={c.id}>
                  <Td>RCA-{c.case_year}-{String(c.case_number).padStart(3, '0')}</Td>
                  <Td className="max-w-xs truncate">{c.problem_what}</Td>
                  <Td>{PROCESS_AREA_LABEL[c.process_area as RcaProcessArea] ?? c.process_area}</Td>
                  <Td>{c.cause_category ? (CAUSE_LABEL[c.cause_category] ?? c.cause_category) : '—'}</Td>
                  <Td numeric>{recurrenceCount}</Td>
                  <Td>{memberName(c.owner_id)}</Td>
                  <Td className={isOverdue(c.due_at) ? 'text-red-500' : undefined}>{c.due_at ? new Date(c.due_at).toLocaleDateString('pt-BR') : '—'}</Td>
                  <Td><Badge variant={c.severity === 'critica' || c.severity === 'alta' ? 'danger' : 'neutral'}>{CASE_STATUS_LABEL[c.status as RcaCaseStatus]}</Badge></Td>
                  <Td><Button size="sm" variant="secondary" onClick={() => onOpenCase(c.id)}>Abrir</Button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

const SOURCE_LABEL: Record<RcaSourceModule, string> = {
  import_count: 'Contagem', full_operation: 'Full', nfe_receiving: 'Recebimento NF-e',
};
