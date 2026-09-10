// "Resultados por Linha" como histórico consultável — montagem e filtragem das linhas
// da listagem, pura e sem I/O. Três escopos, cada um com sua fonte real:
//
//   current   -> linhas concluídas do ciclo atual + relatório vigente do ciclo
//   completed -> relatórios já persistidos, de todos os ciclos da empresa
//   archived  -> inventory_snapshots + inventory_brand_history (histórico que já existe)
//
// Nada aqui recalcula indicador: cada linha carrega o que a fonte já gravou. Toda função
// devolve lista nova — filtrar nunca altera o dataset original.

import { buildClosingResults } from './closingReportService';
import type { ArchivedInventoryClosing } from './closingReportService';
import type { ClosingReport } from './closingReportTypes';

export type ClosingScope = 'current' | 'completed' | 'archived';

export const CLOSING_SCOPE_OPTIONS: { value: ClosingScope; label: string }[] = [
  { value: 'current', label: 'Ciclo atual' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'archived', label: 'Arquivados' },
];

export type ClosingPeriod = '30d' | '90d' | 'year' | 'all';

export const CLOSING_PERIOD_OPTIONS: { value: ClosingPeriod; label: string }[] = [
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'year', label: 'Este ano' },
  { value: 'all', label: 'Todos' },
];

/** Chave do "inventário/ciclo" de uma linha da listagem quando ela é do ciclo corrente. */
export const CURRENT_CYCLE_ID = 'current-cycle';

export interface ClosingListRow {
  /** Estável e única na listagem — serve de key de render. */
  key: string;
  scope: ClosingScope;
  /** id da linha de contagem (inventory_brands); null no histórico arquivado, que guarda
   *  só o nome da marca. */
  brandId: string | null;
  brandName: string;
  /** ISO real do fechamento/arquivamento; null quando a fonte não registrou. */
  closedAt: string | null;
  skusContados: number | null;
  divergenciasReais: number | null;
  accuracyFinal: number | null;
  /** Relatório persistido, quando existe. `null` = abrir usa o detalhe histórico. */
  report: ClosingReport | null;
  inventoryId: string;
  inventoryLabel: string;
  /** Contexto discreto exibido na linha ("Arquivado"); null quando é redundante. */
  contextLabel: string | null;
}

function reportRow(
  scope: ClosingScope,
  brandId: string | null,
  brandName: string,
  report: ClosingReport | null,
  inventoryId: string,
  inventoryLabel: string,
  contextLabel: string | null,
): ClosingListRow {
  return {
    key: report ? `report-${report.id}` : `line-${inventoryId}-${brandId ?? brandName}`,
    scope,
    brandId,
    brandName,
    closedAt: report?.generatedAt ?? null,
    skusContados: report?.skusContados ?? null,
    divergenciasReais: report?.divergenciasReais ?? null,
    accuracyFinal: report?.accuracyFinal ?? null,
    report,
    inventoryId,
    inventoryLabel,
    contextLabel,
  };
}

/** Ciclo atual: mesma semântica de antes — linha concluída (pendentes <= 0) do ciclo
 *  corrente, com o relatório vigente daquele ciclo quando já existe. */
export function buildCurrentScopeRows(
  brandsData: { id: string; brand: string; total_sku: number; done_sku: number }[],
  reports: ClosingReport[],
): ClosingListRow[] {
  return buildClosingResults(brandsData, reports).map(row =>
    reportRow('current', row.brandId, row.brandName, row.report, CURRENT_CYCLE_ID, 'Ciclo atual', null)
  );
}

function cycleLabel(cycleStart: string | null): string {
  if (!cycleStart) return 'Primeiro ciclo';
  try {
    return `Ciclo desde ${new Date(cycleStart).toLocaleDateString('pt-BR')}`;
  } catch {
    return 'Ciclo anterior';
  }
}

/** Concluídos: um registro por relatório persistido, do mais recente para o mais antigo.
 *  O nome da linha vem do cadastro atual quando ainda existe; sem isso, o próprio id
 *  identifica o registro em vez de inventarmos um nome. */
export function buildCompletedScopeRows(
  reports: ClosingReport[],
  brandNameById: Map<string, string>,
): ClosingListRow[] {
  return [...reports]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .map(report =>
      reportRow(
        'completed',
        report.brandId,
        brandNameById.get(report.brandId) ?? 'Linha removida do cadastro',
        report,
        report.cycleStart ?? CURRENT_CYCLE_ID,
        cycleLabel(report.cycleStart),
        null,
      )
    );
}

/** Arquivados: o que inventory_brand_history gravou, agrupável pelo snapshot. Sem
 *  relatório de fechamento associado — abrir mostra o detalhe histórico disponível, e
 *  nunca dispara geração de relatório para inventário antigo. */
export function buildArchivedScopeRows(archived: ArchivedInventoryClosing[]): ClosingListRow[] {
  return [...archived]
    .sort((a, b) => {
      const byInventory = (b.endDate ?? '').localeCompare(a.endDate ?? '');
      return byInventory !== 0 ? byInventory : a.brand.localeCompare(b.brand);
    })
    .map(item => ({
      key: `archived-${item.snapshotId}-${item.brand}`,
      scope: 'archived' as ClosingScope,
      brandId: null,
      brandName: item.brand,
      closedAt: item.endDate,
      skusContados: item.doneSku,
      divergenciasReais: item.divergences,
      accuracyFinal: item.accuracy,
      report: null,
      inventoryId: item.snapshotId,
      inventoryLabel: item.snapshotName,
      contextLabel: 'Arquivado',
    }));
}

/** Opções do filtro "Inventário / Ciclo", derivadas dos registros reais — nunca uma lista
 *  fixa de nomes de ciclo. Mantém a ordem em que as linhas aparecem (mais recente antes). */
export function inventoryOptions(rows: ClosingListRow[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.inventoryId)) seen.set(row.inventoryId, row.inventoryLabel);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

export interface ClosingListFilters {
  search: string;
  inventoryId: string;
  period: ClosingPeriod;
  /** Nome da linha/marca; 'all' = todas. */
  brandName: string;
}

export const EMPTY_CLOSING_FILTERS: ClosingListFilters = {
  search: '',
  inventoryId: 'all',
  period: 'all',
  brandName: 'all',
};

function periodStart(period: ClosingPeriod, now: number): number | null {
  if (period === 'all') return null;
  if (period === 'year') return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const days = period === '30d' ? 30 : 90;
  return now - days * 24 * 60 * 60 * 1000;
}

/** Filtra dentro do escopo já selecionado. Lista nova sempre; o dataset de origem nunca
 *  é reordenado nem mutado. Linha sem data não é descartada por filtro de período — a
 *  ausência de data é falta de registro, não "fora do período". */
export function filterClosingRows(
  rows: ClosingListRow[],
  filters: ClosingListFilters,
  now: number = Date.now(),
): ClosingListRow[] {
  const query = filters.search.trim().toLowerCase();
  const from = periodStart(filters.period, now);

  return rows.filter(row => {
    if (filters.inventoryId !== 'all' && row.inventoryId !== filters.inventoryId) return false;
    if (filters.brandName !== 'all' && row.brandName !== filters.brandName) return false;
    if (from !== null && row.closedAt) {
      const at = new Date(row.closedAt).getTime();
      if (!Number.isNaN(at) && at < from) return false;
    }
    if (query && !row.brandName.toLowerCase().includes(query) && !row.inventoryLabel.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

/** Nomes de linha/marca presentes no escopo, para o Select — só o que veio do workspace
 *  atual, porque é a única coisa que as fontes carregam. */
export function brandNameOptions(rows: ClosingListRow[]): string[] {
  return [...new Set(rows.map(r => r.brandName))].sort((a, b) => a.localeCompare(b));
}
