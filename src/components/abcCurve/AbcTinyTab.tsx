// Curva ABC — comparativo com a referência da Curva ABC do Tiny anexada à análise.
//
// O vocabulário aqui é deliberado: "coincidente", "diferente", "sem correspondência". Nunca
// "correto" ou "errado" — as duas classificações podem usar período, base e critério
// diferentes, e divergir não prova que alguma das duas esteja errada.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Input, Panel, PanelSection, Select, Table, Thead, Tr, Th, Td, Stat, StatRow, StatCell, Button } from '../ui';
import {
  buildTinyComparison, filterTinyRows, tinyBasisIsValue,
  TINY_FILTER_OPTIONS, TINY_SITUATION_LABEL,
  type TinyAwareRow, type TinySituation, type TinySituationFilter,
} from '../../lib/abcCurve/abcCurveTiny';

interface AbcTinyTabProps {
  rows: TinyAwareRow[];
  /** Contagens do lado do arquivo, gravadas no batch da importação. */
  fileRows: number | null;
  fileMatched: number | null;
  fileUnmatched: number | null;
}

const PAGE_SIZE = 50;

const fmtMoney = (value: number | null) => value === null ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtInt = (value: number) => value.toLocaleString('pt-BR');

const SITUATION_VARIANT: Record<TinySituation, 'success' | 'warning' | 'neutral'> = {
  match: 'success',
  different: 'warning',
  unmatched: 'neutral',
};

export function AbcTinyTab({ rows, fileRows, fileMatched, fileUnmatched }: AbcTinyTabProps) {
  const [search, setSearch] = useState('');
  const [situation, setSituation] = useState<TinySituationFilter>('all');
  const [page, setPage] = useState(0);

  const { rows: comparisonRows, summary } = useMemo(() => buildTinyComparison(rows), [rows]);
  const basisIsValue = useMemo(() => tinyBasisIsValue(rows), [rows]);
  const filtered = useMemo(() => filterTinyRows(comparisonRows, { search, situation }), [comparisonRows, search, situation]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const filtersActive = search.trim() !== '' || situation !== 'all';

  return (
    <Panel>
      <PanelSection padding="md">
        <p className="text-section">Comparação de referência</p>
        <p className="text-caption mt-1">
          {basisIsValue
            ? 'A referência do Tiny é comparada com a classificação por faturamento do InventoryBlind quando os dados permitem essa equivalência. Diferenças podem decorrer do período, base ou critérios utilizados.'
            : 'O arquivo do Tiny não trouxe valor nem percentuais, então a equivalência com uma curva específica não pode ser afirmada. As classes são mostradas lado a lado apenas como referência; diferenças podem decorrer do período, base ou critérios utilizados.'}
        </p>
      </PanelSection>

      <PanelSection padding="md">
        <StatRow>
          <StatCell><Stat label="SKUs comparáveis" value={fmtInt(summary.comparable)} context="com classe nas duas pontas" /></StatCell>
          <StatCell><Stat label="Mesma classe" value={fmtInt(summary.sameClass)} /></StatCell>
          <StatCell><Stat label="Classe diferente" value={fmtInt(summary.differentClass)} /></StatCell>
          <StatCell><Stat label="Sem correspondência" value={fmtInt(summary.unmatched)} context="SKUs desta análise fora do arquivo" /></StatCell>
        </StatRow>
      </PanelSection>

      {fileRows !== null && (
        <PanelSection padding="sm" className="text-caption">
          Arquivo do Tiny: {fmtInt(fileRows)} SKUs com código
          {fileMatched !== null && ` · ${fmtInt(fileMatched)} correspondentes nesta análise`}
          {fileUnmatched !== null && ` · ${fmtInt(fileUnmatched)} sem correspondência (não constam nesta análise e não foram criados)`}.
        </PanelSection>
      )}

      <PanelSection padding="md" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-sm">
            <Input
              icon={<Search size={14} />}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Buscar SKU ou produto"
              aria-label="Buscar SKU ou produto no comparativo Tiny"
            />
          </div>
          <div>
            <label className="text-label mb-1 block" htmlFor="abc-tiny-situation">Situação</label>
            <Select id="abc-tiny-situation" value={situation} onChange={e => { setSituation(e.target.value as TinySituationFilter); setPage(0); }}>
              {TINY_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </div>
        <p className="text-caption">
          {filtersActive ? `${fmtInt(filtered.length)} de ${fmtInt(comparisonRows.length)} SKUs` : `${fmtInt(comparisonRows.length)} SKUs`}
        </p>
      </PanelSection>

      {filtered.length === 0 ? (
        <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum SKU atende aos filtros aplicados.</PanelSection>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="min-w-max">
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">SKU</Th>
                  <Th className="whitespace-nowrap">Produto</Th>
                  <Th className="whitespace-nowrap">Classe Tiny</Th>
                  <Th className="whitespace-nowrap">ABC Faturamento I.B</Th>
                  <Th className="whitespace-nowrap">Valor Tiny</Th>
                  <Th className="whitespace-nowrap">Faturamento I.B</Th>
                  <Th className="whitespace-nowrap">Situação</Th>
                </Tr>
              </Thead>
              <tbody>
                {paged.map(row => (
                  <Tr key={row.sku}>
                    <Td className="whitespace-nowrap text-fg-subtle">{row.sku}</Td>
                    <Td className="max-w-xs"><span className="block truncate" title={row.productName ?? undefined}>{row.productName ?? '—'}</span></Td>
                    <Td>{row.tinyClass ? <Badge variant="neutral">{row.tinyClass}</Badge> : '—'}</Td>
                    <Td>{row.ibClass ? <Badge variant="neutral">{row.ibClass}</Badge> : '—'}</Td>
                    <Td numeric className="whitespace-nowrap">{fmtMoney(row.tinyValue)}</Td>
                    <Td numeric className="whitespace-nowrap">{fmtMoney(row.ibRevenue)}</Td>
                    <Td><Badge variant={SITUATION_VARIANT[row.situation]}>{TINY_SITUATION_LABEL[row.situation]}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <PanelSection padding="sm" className="flex items-center justify-between text-sm text-fg-muted">
            <span>página {safePage + 1} de {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</Button>
              <Button variant="ghost" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Próxima</Button>
            </div>
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

export default AbcTinyTab;
