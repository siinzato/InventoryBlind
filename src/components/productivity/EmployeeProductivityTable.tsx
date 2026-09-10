import { useMemo, useState } from 'react';
import { Table, Thead, Tr, Th, Td, Badge } from '../ui';
import { UserProductivityStats } from '../../lib/supabase';
import { getRoleLabel } from '../../lib/permissionService';

interface EmployeeProductivityTableProps {
  team: UserProductivityStats[];
  achievementCounts: Map<string, number>;
  onSelectEmployee: (userId: string) => void;
}

type ProdutividadeFilter = 'todas' | 'alta' | 'media' | 'baixa';
type AcuracidadeFilter = 'todas' | 'alta' | 'media' | 'baixa';
type DivergenciasFilter = 'todas' | 'baixa' | 'media' | 'alta';
type ConquistasFilter = 'todas' | 'com' | 'sem';

const formatDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export function EmployeeProductivityTable({ team, achievementCounts, onSelectEmployee }: EmployeeProductivityTableProps) {
  const [cargoFilter, setCargoFilter] = useState<string>('todos');
  const [produtividadeFilter, setProdutividadeFilter] = useState<ProdutividadeFilter>('todas');
  const [acuracidadeFilter, setAcuracidadeFilter] = useState<AcuracidadeFilter>('todas');
  const [divergenciasFilter, setDivergenciasFilter] = useState<DivergenciasFilter>('todas');
  const [conquistasFilter, setConquistasFilter] = useState<ConquistasFilter>('todas');

  const cargos = useMemo(() => Array.from(new Set(team.map(t => t.role))), [team]);

  const filtered = useMemo(() => team.filter(t => {
    if (cargoFilter !== 'todos' && t.role !== cargoFilter) return false;

    if (produtividadeFilter === 'alta' && t.skus_contados < 2000) return false;
    if (produtividadeFilter === 'media' && (t.skus_contados < 500 || t.skus_contados >= 2000)) return false;
    if (produtividadeFilter === 'baixa' && t.skus_contados >= 500) return false;

    const acc = t.acuracidade_media ?? 0;
    if (acuracidadeFilter === 'alta' && acc < 95) return false;
    if (acuracidadeFilter === 'media' && (acc < 90 || acc >= 95)) return false;
    if (acuracidadeFilter === 'baixa' && acc >= 90) return false;

    if (divergenciasFilter === 'baixa' && t.divergencias_reais > 5) return false;
    if (divergenciasFilter === 'media' && (t.divergencias_reais <= 5 || t.divergencias_reais > 20)) return false;
    if (divergenciasFilter === 'alta' && t.divergencias_reais <= 20) return false;

    const achievements = achievementCounts.get(t.user_id) ?? 0;
    if (conquistasFilter === 'com' && achievements === 0) return false;
    if (conquistasFilter === 'sem' && achievements > 0) return false;

    return true;
  }), [team, cargoFilter, produtividadeFilter, acuracidadeFilter, divergenciasFilter, conquistasFilter, achievementCounts]);

  const selectClass = 'px-2.5 py-1.5 rounded-lg border border-edge bg-surface text-fg text-xs';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={selectClass} value={cargoFilter} onChange={e => setCargoFilter(e.target.value)}>
          <option value="todos">Todos os cargos</option>
          {cargos.map(c => <option key={c} value={c}>{getRoleLabel(c)}</option>)}
        </select>
        <select className={selectClass} value={produtividadeFilter} onChange={e => setProdutividadeFilter(e.target.value as ProdutividadeFilter)}>
          <option value="todas">Produtividade: todas</option>
          <option value="alta">Alta (≥2000 SKUs)</option>
          <option value="media">Média (500–2000)</option>
          <option value="baixa">Baixa (&lt;500)</option>
        </select>
        <select className={selectClass} value={acuracidadeFilter} onChange={e => setAcuracidadeFilter(e.target.value as AcuracidadeFilter)}>
          <option value="todas">Acuracidade: todas</option>
          <option value="alta">Alta (≥95%)</option>
          <option value="media">Média (90–95%)</option>
          <option value="baixa">Baixa (&lt;90%)</option>
        </select>
        <select className={selectClass} value={divergenciasFilter} onChange={e => setDivergenciasFilter(e.target.value as DivergenciasFilter)}>
          <option value="todas">Divergências: todas</option>
          <option value="baixa">Baixa (≤5)</option>
          <option value="media">Média (6–20)</option>
          <option value="alta">Alta (&gt;20)</option>
        </select>
        <select className={selectClass} value={conquistasFilter} onChange={e => setConquistasFilter(e.target.value as ConquistasFilter)}>
          <option value="todas">Conquistas: todas</option>
          <option value="com">Com conquistas</option>
          <option value="sem">Sem conquistas</option>
        </select>
      </div>

      <div className="border border-edge rounded-container overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              {['Nome', 'Cargo', 'SKUs', 'Contagens', 'Acuracidade', 'Divergências', 'Fulls', 'Etiquetas', 'Conquistas', 'Última Atividade', 'Status'].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </Tr>
          </Thead>
          <tbody>
            {filtered.map(t => (
              <Tr key={t.user_id} className="cursor-pointer" onClick={() => onSelectEmployee(t.user_id)}>
                <Td className="font-medium">{t.name ?? '—'}</Td>
                <Td><Badge variant="neutral">{getRoleLabel(t.role)}</Badge></Td>
                <Td>{t.skus_contados.toLocaleString('pt-BR')}</Td>
                <Td>{t.contagens.toLocaleString('pt-BR')}</Td>
                <Td>{t.acuracidade_media !== null ? `${t.acuracidade_media.toFixed(1)}%` : '—'}</Td>
                <Td>{t.divergencias_reais.toLocaleString('pt-BR')}</Td>
                <Td>{t.fulls_realizados.toLocaleString('pt-BR')}</Td>
                <Td>{t.etiquetas_geradas.toLocaleString('pt-BR')}</Td>
                <Td>{achievementCounts.get(t.user_id) ?? 0}</Td>
                <Td>{formatDate(t.ultima_atividade)}</Td>
                <Td>
                  <Badge variant={t.contagens > 0 ? 'success' : 'neutral'}>{t.contagens > 0 ? 'Ativo' : 'Sem atividade'}</Badge>
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && (
              <Tr><Td colSpan={11} className="text-center text-fg-subtle py-6">Nenhum colaborador encontrado com esses filtros.</Td></Tr>
            )}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
