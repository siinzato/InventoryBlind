// Analytics > Auditorias — histórico, performance e reincidência das auditorias JÁ
// realizadas. Diferente de Operações > Auditoria de Estoque (que EXECUTA a auditoria
// cruzada, em src/components/audit/): aqui só se lê o que já foi feito, reaproveitando os
// mesmos dados (inventory_count_records, inventory_count_import_items, rca_records) sem
// duplicar nenhuma tela de execução. O cálculo puro fica em auditsHistoryEngine.ts.
import { supabase } from '../supabase';
import { sanitizeExportValue } from '../spreadsheet-comparator/exportUtils';
import { listCountRecords } from '../auditCrossCheckService';
import { buildCountChains, type CountChain } from '../auditCrossCheckAlgorithm';
import { getImportItems } from '../statisticalAuditService';
import { getSettings as getRcaSettings } from '../rcaService';
import { CAUSE_LABEL } from '../rcaAlgorithm';
import {
  toSessionSummary, computeHistorySummary, isDivergentItem,
  type AuditSessionSummary, type AuditsHistorySummary,
  type DivergentItemRow, type RcaItemLink,
} from './auditsHistoryEngine';
import type { InventoryCountImportItem, RcaSettings } from '../supabase';

/** Lote do `in (...)` ao cruzar itens divergentes com rca_records — evita URL gigante sem
 *  virar uma query por item (o inverso do N+1 que o histórico não pode pagar). */
const RCA_LOOKUP_CHUNK = 200;

export type { AuditSessionSummary, AuditsHistorySummary };

export interface AuditsAnalyticsData {
  sessions: AuditSessionSummary[];
  summary: AuditsHistorySummary;
  /** Cadeias contagem→recontagem→aprovação, indexadas pela contagem raiz. Fonte única da
   *  aba Validação do detalhe — nenhum sinal de validação novo é calculado aqui. */
  chainsByRoot: Map<string, CountChain>;
  /** Operadores realmente presentes nos registros, para o filtro. */
  operators: string[];
  /** Maior taxa de divergência entre as sessões contadas, mais recentes primeiro em empate. */
  worstSessions: AuditSessionSummary[];
  rcaSettings: RcaSettings;
}

export async function getAuditsAnalyticsData(companyId: string): Promise<AuditsAnalyticsData> {
  const [countRecords, rcaSettings] = await Promise.all([
    listCountRecords(companyId),
    getRcaSettings(companyId),
  ]);

  const sessions = countRecords.map(toSessionSummary);
  const summary = computeHistorySummary(countRecords);

  const chainsByRoot = new Map<string, CountChain>();
  for (const chain of buildCountChains(countRecords)) chainsByRoot.set(chain.rootId, chain);

  const operators = Array.from(
    new Set(sessions.map(s => s.operator).filter((o): o is string => !!o && o.trim().length > 0))
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const worstSessions = [...sessions]
    .filter(s => s.skusContados > 0)
    .sort((a, b) => b.divergenciasReais / b.skusContados - a.divergenciasReais / a.skusContados)
    .slice(0, 5);

  return { sessions, summary, chainsByRoot, operators, worstSessions, rcaSettings };
}

// ---- Detalhe de UMA sessão -----------------------------------------------------------------
// Carregado só quando o usuário abre a sessão: o histórico nunca lê itens de todas as
// sessões antecipadamente.

export interface AuditSessionDivergence {
  itemId: string;
  sku: string | null;
  productName: string | null;
  location: string | null;
  saldoSistema: number | null;
  saldoContado: number | null;
  diferenca: number | null;
  status: InventoryCountImportItem['status'];
  /** Já classificado no RCA (rca_records.source_item_id) — vínculo real por id, nunca
   *  aproximação por nome ou SKU. */
  classifiedInRca: boolean;
}

export interface AuditSessionDetail {
  /** Itens item a item registrados para a sessão (0 quando a sessão não gerou esse rastro). */
  totalItems: number;
  divergences: AuditSessionDivergence[];
  classifiedInRca: number;
}

async function findRcaClassifiedItemIds(itemIds: string[], companyId: string): Promise<Set<string>> {
  const classified = new Set<string>();
  for (let i = 0; i < itemIds.length; i += RCA_LOOKUP_CHUNK) {
    const chunk = itemIds.slice(i, i + RCA_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from('rca_records')
      .select('source_item_id')
      .eq('company_id', companyId)
      .eq('source_module', 'import_count')
      .in('source_item_id', chunk);
    if (error) {
      console.error('[Audits] Error checking RCA classification:', error);
      return classified;
    }
    for (const row of data ?? []) classified.add(row.source_item_id as string);
  }
  return classified;
}

export async function getAuditSessionDetail(
  sessionId: string,
  companyId: string
): Promise<AuditSessionDetail> {
  const items = await getImportItems(sessionId, companyId);
  const divergentItems = items.filter(isDivergentItem);
  const classified = await findRcaClassifiedItemIds(divergentItems.map(i => i.id), companyId);

  const divergences: AuditSessionDivergence[] = divergentItems.map(item => ({
    itemId: item.id,
    sku: item.sku,
    productName: item.produto_nome,
    location: item.local,
    saldoSistema: item.saldo_sistema,
    saldoContado: item.saldo_contado,
    diferenca: item.diferenca,
    status: item.status,
    classifiedInRca: classified.has(item.id),
  }));

  return { totalItems: items.length, divergences, classifiedInRca: classified.size };
}

/** CSV das divergências da sessão aberta — mesma sanitização contra Formula Injection e o
 *  mesmo delimitador ";" do resto do projeto (exportUtils.ts, palletExportCsv.ts). */
export function buildSessionDivergencesCsv(divergences: AuditSessionDivergence[]): string {
  const cell = (raw: string | number | null): string => {
    const value = sanitizeExportValue(raw ?? undefined);
    return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  const line = (cells: (string | number | null)[]): string => cells.map(cell).join(';');
  const header = ['SKU', 'Produto', 'Localizacao', 'Saldo sistema', 'Saldo contado', 'Diferenca', 'Status', 'Classificado no RCA'];
  return [
    line(header),
    ...divergences.map(d => line([
      d.sku, d.productName, d.location, d.saldoSistema, d.saldoContado, d.diferenca,
      d.status, d.classifiedInRca ? 'Sim' : 'Nao',
    ])),
  ].join('\n');
}

// ---- Reincidência: divergências item a item das sessões da janela --------------------------
// Carregado só quando a aba Reincidência é aberta. Duas leituras em lote (itens divergentes
// por sessão, depois a classificação de RCA por item) — nunca uma query por SKU, por
// localização ou por item.

/** Teto de linhas lidas para a análise de reincidência. Se for atingido, a tela informa que a
 *  leitura é parcial em vez de apresentar um recorte silencioso como se fosse o total. */
const RECURRENCE_ITEM_LIMIT = 20000;
const SESSION_ID_CHUNK = 100;

export interface AuditsRecurrenceData {
  items: DivergentItemRow[];
  rcaLinks: RcaItemLink[];
  /** Sessões da janela que entraram na análise (com ou sem divergência). */
  sessionsAnalyzed: number;
  truncated: boolean;
}

const EMPTY_RECURRENCE: AuditsRecurrenceData = {
  items: [], rcaLinks: [], sessionsAnalyzed: 0, truncated: false,
};

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function findRcaLinks(itemIds: string[], companyId: string): Promise<RcaItemLink[]> {
  const links: RcaItemLink[] = [];
  for (const ids of chunk(itemIds, RCA_LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('rca_records')
      .select('source_item_id, cause_category, custom_cause_label, occurred_at')
      .eq('company_id', companyId)
      .eq('source_module', 'import_count')
      .in('source_item_id', ids);
    if (error) {
      console.error('[Audits] Error loading RCA links:', error);
      return links;
    }
    for (const row of data ?? []) {
      const causeKey = (row.cause_category as string | null) ?? null;
      // Registro pendente (sem categoria de causa) não vira causa: é ausência de evidência.
      if (!causeKey) continue;
      links.push({
        sourceItemId: row.source_item_id as string,
        causeKey,
        causeLabel: CAUSE_LABEL[causeKey] ?? (row.custom_cause_label as string | null) ?? causeKey,
        occurredAt: row.occurred_at as string,
      });
    }
  }
  return links;
}

export async function getAuditsRecurrenceData(
  companyId: string,
  sessions: AuditSessionSummary[],
  windowDays: number,
  now: number = Date.now()
): Promise<AuditsRecurrenceData> {
  const since = now - windowDays * 86400000;
  const inWindow = sessions.filter(s => new Date(s.createdAt).getTime() >= since);
  if (inWindow.length === 0) return EMPTY_RECURRENCE;

  const sessionDateById = new Map(inWindow.map(s => [s.id, s.createdAt]));
  const items: DivergentItemRow[] = [];
  let truncated = false;

  for (const ids of chunk(inWindow.map(s => s.id), SESSION_ID_CHUNK)) {
    const { data, error } = await supabase
      .from('inventory_count_import_items')
      .select('id, count_record_id, sku, produto_nome, local, saldo_sistema, saldo_contado, diferenca, status')
      .eq('company_id', companyId)
      .in('count_record_id', ids)
      .neq('status', 'correct')
      .limit(RECURRENCE_ITEM_LIMIT);
    if (error) {
      console.error('[Audits] Error loading divergent items:', error);
      throw error;
    }
    const rows = data ?? [];
    if (rows.length >= RECURRENCE_ITEM_LIMIT) truncated = true;
    for (const row of rows) {
      const sessionId = row.count_record_id as string;
      items.push({
        itemId: row.id as string,
        sessionId,
        sku: row.sku as string | null,
        productName: row.produto_nome as string | null,
        location: row.local as string | null,
        saldoSistema: row.saldo_sistema as number | null,
        saldoContado: row.saldo_contado as number | null,
        diferenca: row.diferenca as number | null,
        // A data da ocorrência é a da própria sessão — a mesma que o histórico exibe.
        occurredAt: sessionDateById.get(sessionId) ?? '',
      });
    }
    if (items.length >= RECURRENCE_ITEM_LIMIT) {
      truncated = true;
      break;
    }
  }

  const rcaLinks = items.length > 0 ? await findRcaLinks(items.map(i => i.itemId), companyId) : [];
  return { items, rcaLinks, sessionsAnalyzed: inWindow.length, truncated };
}
