// Planejamento puro da importação: decide, para cada registro da planilha, a
// qual produto do InventoryBlind ele corresponde — e o que gravar.
//
// A regra de associação NÃO é escrita aqui. Ela é a canônica do domínio de
// integrações (`resolveMatch`, src/lib/integrations/matching.ts): link existente
// pelo id externo, depois SKU exato, depois EAN exato; nome nunca; empate nunca
// associa. Este arquivo só a alimenta e traduz o resultado em decisões.
//
// Pure de propósito (nenhum import de supabase): a decisão que pode juntar dois
// produtos de um cliente precisa ser testável sem banco.

import { normalizeEan, normalizeSku, resolveMatch } from '../matching';
import type { MatchCandidate } from '../matching';
import type { EntityLink, MatchSource } from '../types';
import type { TinyStockSheetRecord } from './tinyStockSheetContract';

export type StockSheetOutcome =
  /** Associado a um produto do workspace — o saldo da fonte tem dono. */
  | 'linked'
  /** A fonte conhece o registro, o InventoryBlind ainda não: fica mapeado sem produto. */
  | 'unlinked'
  /** Mais de um candidato empatou (ou a chave se repete no arquivo): nunca associa. */
  | 'ambiguous'
  /** Sem saldo na planilha — nada a gravar como saldo. */
  | 'skipped'
  /** Linha recusada na leitura (sem ID, ID repetido, saldo inválido). */
  | 'rejected';

export interface StockSheetDecision {
  record: TinyStockSheetRecord;
  outcome: StockSheetOutcome;
  internalId: string | null;
  matchSource: MatchSource | null;
  /** Link novo para este id externo (vira `created` no histórico). */
  isNewLink: boolean;
  /** Motivo legível, quando há um. */
  reason: string | null;
}

export interface StockSheetCounters {
  /** Linhas lidas do arquivo. */
  processed: number;
  /** Registros que a fonte passou a conhecer nesta importação. */
  created: number;
  /** Registros que a fonte já conhecia e foram reescritos. */
  updated: number;
  /** Linhas sem saldo — não entram no snapshot. */
  skipped: number;
  /** Linhas recusadas na leitura. */
  failed: number;
  linked: number;
  unlinked: number;
  ambiguous: number;
}

export interface StockSheetPlan {
  decisions: StockSheetDecision[];
  counters: StockSheetCounters;
}

/** Chaves que aparecem mais de uma vez no próprio arquivo.
 *
 *  Mesma postura de `buildTinyStockIndex` (Emitir Relatório): uma chave repetida
 *  na planilha não preenche nada, porque não há como saber de quem é o número.
 *  Sem isso, duas linhas com o mesmo SKU associariam ao MESMO produto e a fonte
 *  ficaria com dois saldos concorrentes para ele. */
function duplicatedKeys(records: TinyStockSheetRecord[]): { skus: Set<string>; eans: Set<string> } {
  const skuCount = new Map<string, number>();
  const eanCount = new Map<string, number>();

  for (const record of records) {
    if (record.issue !== null) continue;
    const sku = normalizeSku(record.sku);
    if (sku) skuCount.set(sku, (skuCount.get(sku) ?? 0) + 1);
    const ean = normalizeEan(record.ean);
    if (ean) eanCount.set(ean, (eanCount.get(ean) ?? 0) + 1);
  }

  const skus = new Set<string>();
  for (const [key, count] of skuCount) if (count > 1) skus.add(key);
  const eans = new Set<string>();
  for (const [key, count] of eanCount) if (count > 1) eans.add(key);
  return { skus, eans };
}

export interface PlanStockSheetInput {
  records: TinyStockSheetRecord[];
  /** Links já existentes desta fonte, por id externo (integration_entity_links). */
  existingLinks: Map<string, EntityLink>;
  /** Produtos do workspace que podem corresponder. Carregado uma vez, sob RLS. */
  candidates: MatchCandidate[];
}

export function planStockSheetImport({
  records,
  existingLinks,
  candidates,
}: PlanStockSheetInput): StockSheetPlan {
  const duplicated = duplicatedKeys(records);
  const decisions: StockSheetDecision[] = [];

  const counters: StockSheetCounters = {
    processed: records.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    linked: 0,
    unlinked: 0,
    ambiguous: 0,
  };

  for (const record of records) {
    const existing = existingLinks.get(record.externalId);
    const isNewLink = record.externalId !== '' && existing == null;

    if (record.issue !== null) {
      if (record.issue === 'missing-balance') counters.skipped += 1;
      else counters.failed += 1;
      decisions.push({
        record,
        outcome: record.issue === 'missing-balance' ? 'skipped' : 'rejected',
        internalId: null,
        matchSource: null,
        isNewLink: false,
        reason: record.issue,
      });
      continue;
    }

    if (isNewLink) counters.created += 1;
    else counters.updated += 1;

    const sku = normalizeSku(record.sku);
    const ean = normalizeEan(record.ean);
    // Chave duplicada no arquivo só bloqueia a associação por aquela chave
    // quando ela seria a chave vencedora — um link já existente pelo id externo
    // continua valendo, porque ali a identidade já foi resolvida antes.
    const blockedBySku = sku != null && duplicated.skus.has(sku);
    const blockedByEan = ean != null && duplicated.eans.has(ean);

    const outcome = resolveMatch(
      {
        externalId: record.externalId,
        sku: blockedBySku ? null : record.sku,
        ean: blockedByEan ? null : record.ean,
        name: record.name,
      },
      existing ? [{ externalId: existing.externalId, internalId: existing.internalId }] : [],
      candidates
    );

    if (outcome.internalId != null) {
      counters.linked += 1;
      decisions.push({
        record,
        outcome: 'linked',
        internalId: outcome.internalId,
        matchSource: outcome.source,
        isNewLink,
        reason: null,
      });
      continue;
    }

    if (outcome.ambiguous || blockedBySku || blockedByEan) {
      counters.ambiguous += 1;
      decisions.push({
        record,
        outcome: 'ambiguous',
        internalId: null,
        matchSource: null,
        isNewLink,
        reason: outcome.ambiguous
          ? 'mais de um produto do workspace bate com esta chave'
          : 'chave repetida na própria planilha',
      });
      continue;
    }

    counters.unlinked += 1;
    decisions.push({
      record,
      outcome: 'unlinked',
      internalId: null,
      matchSource: null,
      isNewLink,
      reason: 'nenhum produto do workspace com este SKU ou EAN',
    });
  }

  return { decisions, counters };
}

/** As decisões que produzem saldo no snapshot da fonte. */
export function decisionsWithBalance(decisions: StockSheetDecision[]): StockSheetDecision[] {
  return decisions.filter(
    decision =>
      decision.record.issue === null &&
      decision.record.quantity !== null &&
      decision.record.externalId !== ''
  );
}
